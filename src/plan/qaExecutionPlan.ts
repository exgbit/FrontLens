import type { QaExecutionPlanItem, QaExecutionPlanResult, QaResult, RegressionPlanItem } from '../types.js';
import { buildRoleMatrixNeed } from '../permissions/roleMatrixNeed.js';
import { buildSourceScriptPlanNeed } from '../source/sourceScriptPlan.js';

export type QaExecutionPlanInput = Pick<
  QaResult,
  | 'summary'
  | 'requirementCoverage'
  | 'journeyTests'
  | 'interactionTests'
  | 'rootCauseGroups'
  | 'defectProof'
  | 'regressionPlan'
  | 'professionalSummary'
  | 'claimGuard'
  | 'qaIntake'
  | 'qaSignoff'
  | 'environment'
  | 'pageProfile'
  | 'pageModel'
  | 'permissionChecks'
  | 'scopeReview'
  | 'sourceAnalysis'
  | 'sourceHealth'
  | 'testData'
  | 'artifactIntegrity'
  | 'artifacts'
>;

function quote(value: string): string {
  return JSON.stringify(value);
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function priorityRank(priority: QaExecutionPlanItem['priority']): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function baseQaCommand(result: QaExecutionPlanInput, output = 'reports/frontlens/qa-plan-rerun'): string {
  return `node dist/cli.js qa --url ${quote(result.summary.url)} --output ${quote(output)} --no-trace --json${result.sourceAnalysis.root ? ` --source-root ${quote(result.sourceAnalysis.root)}` : ''}`;
}

function itemFromRegression(regression: RegressionPlanItem): QaExecutionPlanItem {
  return {
    id: regression.id,
    type: regression.type === 'full-rerun' ? 'rerun' : regression.type,
    priority: regression.priority,
    owner: regression.owner,
    status: regression.status,
    title: regression.title,
    why: regression.notes?.[0] ?? '来自 regressionPlan 的专业复测项。',
    commands: regression.commands,
    steps: regression.steps,
    expected: regression.expected,
    evidenceRefs: regression.evidenceRefs,
    issueIds: regression.issueIds,
    requirementIds: regression.requirementIds,
    journeyIds: regression.journeyIds,
    notes: regression.notes
  };
}

function addItem(items: QaExecutionPlanItem[], item: Omit<QaExecutionPlanItem, 'id'>): void {
  const id = `QAP-${String(items.length + 1).padStart(3, '0')}`;
  items.push({
    ...item,
    id,
    commands: unique(item.commands),
    evidenceRefs: unique(item.evidenceRefs)
  });
}

function evidenceList(value: string[], max = 6): string[] {
  return unique(value).slice(0, max);
}

export function buildQaExecutionPlan(result: QaExecutionPlanInput): QaExecutionPlanResult {
  const items: QaExecutionPlanItem[] = [];
  const fullRerun = baseQaCommand(result);
  const roleNeed = buildRoleMatrixNeed({
    pageModel: result.pageModel,
    permissionChecks: result.permissionChecks,
    pageProfile: result.pageProfile,
    requirementCoverage: result.requirementCoverage
  });
  const sourceScriptNeed = buildSourceScriptPlanNeed(result.sourceHealth);
  const productContextConfig = typeof result.artifacts.productContextConfig === 'string' ? result.artifacts.productContextConfig : undefined;
  const productContextRerun = productContextConfig
    ? `node dist/cli.js qa --url ${quote(result.summary.url)} --config ${quote(productContextConfig)} --output ${quote('reports/frontlens/qa-plan-product-context')} --no-trace --json${result.sourceAnalysis.root ? ` --source-root ${quote(result.sourceAnalysis.root)}` : ''}`
    : undefined;
  const envCompare = result.environment.trust.performance === 'high' && result.environment.trust.security === 'high'
    ? undefined
    : `node dist/cli.js env-compare --dev-url ${quote(result.summary.url)} --preview-url "<preview-or-production-like-url>" --output ${quote('reports/frontlens/qa-plan-env')}${result.sourceAnalysis.root ? ` --source-root ${quote(result.sourceAnalysis.root)}` : ''}`;
  const roleMatrix = roleNeed.needed || result.qaSignoff.scope.authStateProvided
    ? `node dist/cli.js role-matrix --url ${quote(result.summary.url)} --roles "<roles.json>" --output ${quote('reports/frontlens/qa-plan-roles')}`
    : undefined;

  addItem(items, {
    type: 'rerun',
    priority: result.qaSignoff.status === 'blocked' || result.qaSignoff.status === 'fail' ? 'P0' : 'P2',
    owner: 'test',
    status: 'ready',
    title: '完整复跑当前页面并刷新专业签核',
    why: '专业测试工程师不能只看一次扫描；修复或补充输入后必须复跑同一范围。',
    commands: [fullRerun],
    steps: ['运行完整 FrontLens QA。', '优先读取 brief.md / qa-plan.md / professional-audit.md。', '确认 adjustedScore、qaSignoff、defectProof、issueDisposition 和 artifactIntegrity。'],
    expected: ['qaSignoff 不低于当前结果。', '新增 critical/high proof-ready 缺陷为 0。', 'artifactIntegrity 不存在缺失证据路径。'],
    evidenceRefs: ['qaSignoff', 'professionalSummary', 'artifactIntegrity']
  });

  if (result.requirementCoverage.source === 'none' || result.requirementCoverage.source === 'inferred' || result.requirementCoverage.summary.highPriorityGapCount > 0) {
    addItem(items, {
      type: 'requirement',
      priority: result.requirementCoverage.summary.highPriorityGapCount > 0 ? 'P1' : 'P2',
      owner: 'product',
      status: 'needs-input',
      title: '补充 PRD / 验收标准并转换为可执行 requirements',
      why: '缺少显式验收标准时，业务通过只能算未验证或推断覆盖，不能给 100% 结论。',
      commands: ['node dist/cli.js requirements synthesize --input "<prd.md>" --output "requirements.json"', `${fullRerun} --requirements "requirements.json"`],
      steps: ['提供 PRD、用户故事或验收标准。', '把自然语言要求转成 selectors / expectedTexts / apiPatterns / journeySteps。', '用 --requirements 复跑并核对 requirementCoverage。'],
      expected: ['关键 P0/P1 需求有 runtime evidence。', 'free-text 需求被标记为待复核，而不是自动通过。'],
      evidenceRefs: ['requirementCoverage', 'qaSignoff'],
      notes: result.requirementCoverage.gaps.slice(0, 5)
    });
  }

  const passedJourneyWithAssertion = result.qaSignoff.scope.passedJourneyWithAssertionCount;
  if (passedJourneyWithAssertion === 0 && result.qaSignoff.businessValidationConfidence !== 'runtime-verified') {
    addItem(items, {
      type: 'journey',
      priority: 'P1',
      owner: 'test',
      status: 'needs-input',
      title: '录制并补断言核心业务路径',
      why: '没有带成功断言的 journey，点击/填写不崩溃也不能证明业务功能通过。',
      commands: [`node dist/cli.js journey record --url ${quote(result.summary.url)} --output "journeys/<flow>.json" --name "<core flow>"`, `${fullRerun} --journeys`],
      steps: ['录制真实人工业务路径。', '补 expectVisible / expectText / expectUrl / expectRequest。', '为写操作补 testData setup/cleanup。'],
      expected: ['至少一个核心路径 journey 带断言通过。', 'qaSignoff.businessValidationConfidence 提升到 runtime-verified 或明确说明剩余缺口。'],
      evidenceRefs: ['journeyTests', 'qaSignoff.scope', 'testData']
    });
  }

  if (result.pageProfile.status !== 'configured' || result.scopeReview?.status === 'needs-input') {
    addItem(items, {
      type: 'product-context',
      priority: 'P2',
      owner: 'product',
      status: 'needs-input',
      title: '确认 productContext，冻结产品/设计取舍',
      why: '样式、分页、导出、刷新、触控目标等问题需要产品范围合同，避免每轮由 LLM 猜测。',
      commands: productContextRerun ? [productContextRerun] : [fullRerun],
      steps: ['阅读 product-context.md 的问题。', '审核/编辑 product-context.config.json。', '用确认后的 --config 重跑 QA。'],
      expected: ['pageProfile.status 为 configured。', '产品取舍类 findings 稳定进入 product-decision / non-actionable 桶。'],
      evidenceRefs: ['product-context.md', 'product-context.config.json', 'scopeReview', 'pageProfile'],
      notes: result.scopeReview?.questions?.slice(0, 5).map((item) => item.question) ?? result.pageProfile.questions.slice(0, 5)
    });
  }

  if (roleNeed.needed) {
    addItem(items, {
      type: 'role-matrix',
      priority: roleNeed.priority,
      owner: 'test',
      status: 'needs-input',
      title: '补齐角色/权限矩阵，避免单角色误判',
      why: '页面存在凭证/权限敏感画像、危险/授权类操作、权限检查告警或权限需求；专业 QA 需要验证不同角色的可见能力和禁止能力。',
      commands: roleMatrix ? [roleMatrix] : [],
      steps: ['准备 admin / normal / readonly / unauthorized 等角色 storageState。', '在 roles.json 写入 expectedAllowedTexts 和 expectedForbiddenTexts。', '运行 role-matrix，并把差异绑定到权限需求后再签核。'],
      expected: ['低权限角色不可见或不可执行禁止能力。', '高权限角色具备应允许能力。', '权限差异均能对应到显式需求或产品决策。'],
      evidenceRefs: evidenceList(['permissionChecks', 'pageProfile', 'pageModel.buttons', 'requirementCoverage', ...roleNeed.permissionCheckIds]),
      notes: roleNeed.signals
    });
  }

  if (sourceScriptNeed.needed) {
    addItem(items, {
      type: 'source-health',
      priority: sourceScriptNeed.priority,
      owner: 'test',
      status: 'needs-input',
      title: '补跑项目已有自动化脚本，避免只凭页面扫描签核',
      why: '源码仓库存在 build/typecheck/test/e2e/lint 等项目自有质量门，但本轮 sourceHealth 没有执行这些脚本；专业 QA 需要把它们纳入签核或明确排除。',
      commands: [...sourceScriptNeed.commands, fullRerun],
      steps: ['在 sourceRoot 下运行列出的 package scripts。', '失败时先修复源码/测试夹具/环境。', '用 --source-run-scripts 或项目 CI 证据复跑并记录结果。'],
      expected: ['关键项目脚本通过或范围外原因被明确记录。', 'sourceHealth.scriptChecks 或 CI 产物可证明脚本状态。'],
      evidenceRefs: ['sourceHealth.packageScripts', 'sourceHealth.scriptChecks'],
      notes: sourceScriptNeed.signals
    });
  }

  for (const item of [...result.professionalSummary.mustFix, ...result.professionalSummary.shouldFix]
    .filter((entry) => entry.kind === 'defect')
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 8)) {
    addItem(items, {
      type: 'root-cause',
      priority: item.priority,
      owner: item.owner,
      status: item.priority === 'P0' ? 'blocked' : 'ready',
      title: item.title,
      why: item.rationale,
      commands: [fullRerun],
      steps: ['修复对应 root cause。', '运行项目 typecheck/lint/build 或根因 verificationCommand。', '重跑 FrontLens 并确认相关 issueIds 消失。'],
      expected: ['defectProof 仍为 proven/probable 或 issue 已 resolved。', 'professionalSummary 不再列入 mustFix/shouldFix。'],
      evidenceRefs: evidenceList(item.evidenceRefs),
      issueIds: item.issueIds,
      requirementIds: item.requirementIds,
      journeyIds: item.journeyIds
    });
  }

  for (const proof of result.defectProof.items
    .filter((item) => item.status === 'needs-evidence')
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 6)) {
    addItem(items, {
      type: 'defect-proof',
      priority: proof.priority,
      owner: 'test',
      status: 'needs-input',
      title: `补证后再判定：${proof.title}`,
      why: proof.missingEvidence.slice(0, 2).join('；') || 'defectProof 标记为 needs-evidence。',
      commands: [fullRerun],
      steps: proof.nextSteps.length ? proof.nextSteps : ['补 runtime/source/requirement/product/repro/owner 证据。'],
      expected: ['该项变为 proven/probable 后再进入修复，或被降级为非缺陷/产品决策/工具局限。'],
      evidenceRefs: evidenceList([proof.id, proof.rootCauseGroupId, ...proof.evidenceRefs]),
      issueIds: proof.issueIds
    });
  }

  for (const regression of result.regressionPlan.items
    .filter((item) => item.type !== 'full-rerun' && item.type !== 'root-cause' && item.type !== 'defect-proof')
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
    .slice(0, 10)) {
    const mapped = itemFromRegression(regression);
    if (!items.some((item) => item.type === mapped.type && item.title === mapped.title)) items.push(mapped);
  }

  if (envCompare) {
    addItem(items, {
      type: 'environment',
      priority: 'P2',
      owner: 'test',
      status: result.environment.kind === 'local-dev' ? 'needs-input' : 'ready',
      title: '用生产等价环境复核性能/安全/发布结论',
      why: 'dev server 只能支持功能/源码关联，不能作为生产性能、安全响应头或发布签核依据。',
      commands: [envCompare],
      steps: ['准备 build preview 或生产等价 URL。', '运行 env-compare。', '只把 persistent/preview-only 问题纳入发布判断。'],
      expected: ['dev-only 噪音不进入修复队列。', '性能/安全结论来自 preview/production-like 环境。'],
      evidenceRefs: ['environment']
    });
  }

  const blockers = unique([
    ...result.claimGuard.requiredInputs,
    ...result.qaIntake.topQuestions.filter((item) => item.priority === 'P0' || item.priority === 'P1').map((item) => item.question),
    result.artifactIntegrity.status === 'failed' ? result.artifactIntegrity.summary : '',
    result.testData.status === 'failed' ? `testData failed: productionRisk=${result.testData.summary.productionRiskCount}, missingCleanup=${result.testData.summary.missingCleanupCount}` : ''
  ]).slice(0, 10);

  const blocked = result.qaSignoff.status === 'blocked' || items.some((item) => item.status === 'blocked' && item.priority === 'P0');
  const needsInput = blockers.length > 0 || items.some((item) => item.status === 'needs-input');
  const status: QaExecutionPlanResult['status'] = blocked ? 'blocked' : needsInput ? 'needs-input' : 'ready';
  const confidence: QaExecutionPlanResult['confidence'] = result.requirementCoverage.source === 'provided' && result.qaSignoff.confidence === 'high'
    ? 'high'
    : result.qaSignoff.confidence === 'low' || result.requirementCoverage.source === 'none'
      ? 'low'
      : 'medium';

  return {
    generatedAt: new Date().toISOString(),
    status,
    confidence,
    summary: status === 'ready'
      ? 'QA execution plan is ready for repair verification and acceptance rerun.'
      : status === 'blocked'
        ? 'QA execution plan has blocking inputs or P0 blockers before acceptance can be claimed.'
        : 'QA execution plan needs PRD/product/test-data/journey/environment inputs before professional acceptance claims.',
    scope: {
      targetUrl: result.summary.url,
      sourceRoot: result.sourceAnalysis.root,
      signoffStatus: result.qaSignoff.status,
      businessValidationConfidence: result.qaSignoff.businessValidationConfidence,
      requirementSource: result.requirementCoverage.source,
      environmentKind: result.environment.kind,
      pageType: result.pageProfile.pageType
    },
    commands: {
      fullRerun,
      productContextRerun,
      envCompare,
      roleMatrix
    },
    items: items.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)),
    blockers,
    notes: [
      'Use this plan as the professional QA worklist; raw issues remain evidence, not the schedule.',
      'Do not claim full business pass until requirement and journey items are runtime-verified.',
      'Keep product/design/style observations out of implementation fixes until productContext is confirmed.'
    ]
  };
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

function truncate(value: string, max = 140): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${escapeMarkdown(item)}`).join('\n') : '-';
}

export function formatQaExecutionPlan(plan: QaExecutionPlanResult): string {
  const rows = plan.items.slice(0, 20).map((item) =>
    `| ${item.priority} | ${item.type} | ${item.status} | ${item.owner} | ${escapeMarkdown(truncate(item.title, 90))} | ${escapeMarkdown(truncate(item.why, 120))} | ${escapeMarkdown(truncate(item.expected.join('；'), 120))} |`
  );
  const commands = Object.entries(plan.commands)
    .filter(([, command]) => Boolean(command))
    .map(([name, command]) => `### ${name}\n\n\`\`\`bash\n${command}\n\`\`\``);

  return `# FrontLens QA Execution Plan

## Status

- Plan status: **${plan.status}** / confidence **${plan.confidence}**
- Sign-off: **${plan.scope.signoffStatus}** / business **${plan.scope.businessValidationConfidence}**
- Requirement source: **${plan.scope.requirementSource}**
- Environment: **${plan.scope.environmentKind}**
- Page type: **${plan.scope.pageType}**
- Summary: ${escapeMarkdown(plan.summary)}

## Commands

${commands.length ? commands.join('\n\n') : '-'}

## Execution items

${rows.length ? ['| Priority | Type | Status | Owner | Item | Why | Expected |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : '当前没有待执行 QA 计划项。'}

## Blocking inputs

${list(plan.blockers)}

## Notes

${list(plan.notes)}
`;
}
