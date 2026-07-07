import type {
  AccessibilityCheckResult,
  ExceptionSimulationResult,
  InteractionTestResult,
  JourneyAssertionAuditItem,
  JourneyTestResult,
  QaCoverageMatrixItem,
  QaResult,
  RequirementCoverageItem,
  ResponsiveCheckResult,
  TestCaseItem,
  TestCaseMatrixResult,
  TestCaseStatus
} from '../types.js';
import { markdownEscape } from '../utils/text.js';

export type TestCaseMatrixInput = Pick<
  QaResult,
  | 'summary'
  | 'requirementCoverage'
  | 'journeyTests'
  | 'journeyAssertionAudit'
  | 'interactionTests'
  | 'exceptionSimulations'
  | 'accessibilityChecks'
  | 'responsiveChecks'
  | 'apiContract'
  | 'coverage'
  | 'p2'
  | 'security'
  | 'sourceHealth'
  | 'testData'
  | 'artifactIntegrity'
  | 'qaCoverage'
  | 'issueDisposition'
  | 'defectProof'
>;

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function countByStatus(items: TestCaseItem[], status: TestCaseStatus): number {
  return items.filter((item) => item.status === status).length;
}

function priorityRank(priority: TestCaseItem['priority']): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function isHighPriority(priority: TestCaseItem['priority']): boolean {
  return priority === 'P0' || priority === 'P1';
}

function add(items: TestCaseItem[], item: Omit<TestCaseItem, 'id'>): void {
  const id = `TC-${String(items.length + 1).padStart(3, '0')}`;
  items.push({
    ...item,
    id,
    preconditions: unique(item.preconditions),
    steps: unique(item.steps),
    expected: unique(item.expected),
    evidenceRefs: unique(item.evidenceRefs),
    issueIds: unique(item.issueIds),
    requirementIds: unique(item.requirementIds),
    journeyIds: unique(item.journeyIds),
    nextSteps: unique(item.nextSteps),
    notes: unique(item.notes)
  });
}

function requirementStatus(item: RequirementCoverageItem): TestCaseStatus {
  if (item.status === 'passed') return 'passed';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'partial') return 'partial';
  if (item.status === 'not-covered') return 'needs-input';
  return 'skipped';
}

function interactionStatus(status: InteractionTestResult['status']): TestCaseStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'warning') return 'partial';
  return 'skipped';
}

function journeyStatus(journey: JourneyTestResult, audit?: JourneyAssertionAuditItem): TestCaseStatus {
  if (journey.status === 'failed') return 'failed';
  if (journey.status === 'skipped') return 'skipped';
  if (journey.status === 'warning') return 'partial';
  if (!audit) return journey.status === 'passed' ? 'partial' : 'needs-input';
  if (audit.quality === 'runtime-verified') return 'passed';
  if (audit.quality === 'failed') return 'failed';
  if (audit.quality === 'skipped') return 'skipped';
  return 'partial';
}

function exceptionStatus(item: ExceptionSimulationResult): TestCaseStatus {
  if (item.status === 'passed') return 'passed';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'warning') return 'partial';
  return 'skipped';
}

function accessibilityStatus(item: AccessibilityCheckResult): TestCaseStatus {
  if (item.status === 'passed') return 'passed';
  if (item.status === 'failed') return 'failed';
  return 'partial';
}

function responsiveStatus(item: ResponsiveCheckResult): TestCaseStatus {
  if (item.horizontalOverflow || item.clippedInteractiveCount > 0 || item.tableOverflowCount > 0) return 'failed';
  if (item.smallTapTargetCount > 0 || item.observations.length > 0) return 'partial';
  return 'passed';
}

function priorityFromSeverity(severity: AccessibilityCheckResult['severity']): TestCaseItem['priority'] {
  if (severity === 'critical') return 'P0';
  if (severity === 'high') return 'P1';
  if (severity === 'medium') return 'P2';
  return 'P3';
}

function statusFromCoverage(item: QaCoverageMatrixItem): TestCaseStatus {
  if (item.status === 'covered') return 'passed';
  if (item.status === 'failed') return 'failed';
  if (item.status === 'needs-input') return 'needs-input';
  if (item.status === 'skipped') return 'skipped';
  return 'partial';
}

function actualFromStatus(status: TestCaseStatus, summary: string): string {
  return `${status}: ${summary}`;
}

export function buildTestCaseMatrix(result: TestCaseMatrixInput): TestCaseMatrixResult {
  const items: TestCaseItem[] = [];

  for (const req of result.requirementCoverage.items.slice(0, 40)) {
    const status = requirementStatus(req);
    add(items, {
      kind: 'requirement',
      title: req.title,
      priority: req.priority,
      status,
      confidence: req.confidence,
      executionMode: req.evidence.journeyIds.length || req.evidence.interactionTestIds.length || req.evidence.networkRequestIds.length ? 'runtime' : req.source === 'provided' ? 'manual-required' : 'manual-required',
      owner: req.source === 'provided' ? 'test' : 'product',
      preconditions: ['已确认 PRD/验收标准；若为 inferred，则不能作为正式通过结论。'],
      steps: req.evidence.journeyIds.length ? req.evidence.journeyIds.map((id) => `运行 journey ${id}`) : ['补充 selector/text/API/journey 断言后执行。'],
      expected: ['需求有明确 runtime/source 证据，且无 linked failed issue。'],
      actual: actualFromStatus(status, req.gaps[0] || `evidence selectors=${req.evidence.selectors.length}, journeys=${req.evidence.journeyIds.length}, requests=${req.evidence.networkRequestIds.length}`),
      evidenceRefs: ['requirementCoverage', ...req.evidence.selectors, ...req.evidence.journeyIds, ...req.evidence.interactionTestIds, ...req.evidence.networkRequestIds],
      issueIds: req.evidence.issueIds,
      requirementIds: [req.id],
      journeyIds: req.evidence.journeyIds,
      nextSteps: status === 'passed' ? [] : req.gaps.length ? req.gaps : ['补齐可执行断言并复跑。'],
      notes: req.evidence.notes
    });
  }

  const auditByJourney = new Map(result.journeyAssertionAudit.items.map((item) => [item.journeyId, item]));
  for (const journey of result.journeyTests.slice(0, 30)) {
    const audit = auditByJourney.get(journey.id);
    const status = journeyStatus(journey, audit);
    add(items, {
      kind: 'journey',
      title: journey.name,
      priority: journey.requirementIds?.length ? 'P1' : 'P2',
      status,
      confidence: audit?.quality === 'runtime-verified' ? 'high' : journey.status === 'failed' ? 'high' : 'medium',
      executionMode: 'runtime',
      owner: 'test',
      preconditions: ['浏览器可达目标 URL。', '如涉及登录/写操作，需要 storageState 与 testData。'],
      steps: journey.steps.slice(0, 8).map((step) => `${step.index}. ${step.action}${step.target ? ` ${step.target}` : ''}`),
      expected: ['旅程完成并包含有业务意义的 expectVisible/expectText/expectUrl/expectRequest 断言。'],
      actual: actualFromStatus(status, audit ? `quality=${audit.quality}, assertions=${audit.meaningfulAssertionStepCount}` : `journey status=${journey.status}`),
      evidenceRefs: ['journeyTests', 'journeyAssertionAudit', journey.id],
      issueIds: journey.issue ? [journey.issue] : [],
      requirementIds: journey.requirementIds ?? [],
      journeyIds: [journey.id],
      nextSteps: status === 'passed' ? [] : ['补充业务成功断言、角色态和测试数据后复跑。'],
      notes: audit?.findings.map((finding) => finding.title) ?? []
    });
  }

  for (const interaction of result.interactionTests.slice(0, 30)) {
    const status = interactionStatus(interaction.status);
    add(items, {
      kind: 'interaction',
      title: `${interaction.kind}: ${interaction.target}`,
      priority: interaction.status === 'failed' ? 'P2' : 'P3',
      status,
      confidence: interaction.status === 'failed' || interaction.status === 'passed' ? 'medium' : 'low',
      executionMode: 'runtime',
      owner: 'test',
      preconditions: ['安全非破坏交互可执行；下载/上传/写操作需显式授权。'],
      steps: (interaction.actions?.length ? interaction.actions : [`执行 ${interaction.kind} 探索。`]),
      expected: ['交互不产生未预期错误，并有可观察状态/请求/下载产物。'],
      actual: actualFromStatus(status, interaction.issue || interaction.observations?.error || `network=${interaction.observations?.networkRequestIds?.length ?? 0}`),
      evidenceRefs: ['interactionTests', interaction.id, ...(interaction.observations?.networkRequestIds ?? []), ...(interaction.observations?.consoleIds ?? []), ...(interaction.observations?.pageErrorIds ?? [])],
      issueIds: interaction.issue ? [interaction.issue] : [],
      requirementIds: [],
      journeyIds: [],
      nextSteps: status === 'failed' ? ['按 issue / console / network 证据复核是否为真实缺陷。'] : status === 'skipped' ? ['提供稳定 selector 或 journey。'] : [],
      notes: []
    });
  }

  for (const exception of result.exceptionSimulations.slice(0, 12)) {
    const status = exceptionStatus(exception);
    add(items, {
      kind: 'exception',
      title: `异常韧性：${exception.kind}${exception.target ? ` ${exception.target}` : ''}`,
      priority: exception.status === 'failed' ? 'P1' : 'P2',
      status,
      confidence: exception.status === 'failed' || exception.status === 'passed' ? 'high' : 'medium',
      executionMode: 'runtime',
      owner: 'frontend',
      preconditions: ['异常模拟启用；合成 4xx/5xx/timeout 不代表真实后端故障。'],
      steps: [`模拟 ${exception.kind}`],
      expected: ['页面显示明确错误/权限/重试/恢复反馈，不把失败伪装成空态。'],
      actual: actualFromStatus(status, exception.issue || exception.observations.error || `errorFeedback=${exception.observations.bodyHasErrorFeedback ?? false}`),
      evidenceRefs: ['exceptionSimulations', exception.id, ...(exception.observations.networkRequestIds ?? []), ...(exception.observations.consoleIds ?? []), ...(exception.observations.pageErrorIds ?? [])],
      issueIds: exception.issue ? [exception.issue] : [],
      requirementIds: [],
      journeyIds: [],
      nextSteps: status === 'failed' ? ['检查源码 error/loading/empty/retry 分支并补重试入口。'] : [],
      notes: []
    });
  }

  for (const check of result.accessibilityChecks.filter((item) => item.status !== 'passed').slice(0, 20)) {
    const status = accessibilityStatus(check);
    add(items, {
      kind: 'accessibility',
      title: check.title,
      priority: priorityFromSeverity(check.severity),
      status,
      confidence: 'medium',
      executionMode: 'hybrid',
      owner: 'frontend',
      preconditions: ['可访问性规则启用。'],
      steps: [`检查规则 ${check.rule}`],
      expected: ['违反项为 0，或有明确产品/无障碍范围接受。'],
      actual: actualFromStatus(status, `${check.count} node(s)`),
      evidenceRefs: ['accessibilityChecks', check.id, ...check.nodes.slice(0, 5).map((node) => node.selector)],
      issueIds: [],
      requirementIds: [],
      journeyIds: [],
      nextSteps: status === 'failed' ? ['按 selector/source file:line 修复。'] : ['确认 a11y 目标后决定是否修复。'],
      notes: []
    });
  }

  for (const viewport of result.responsiveChecks.filter((item) => item.horizontalOverflow || item.clippedInteractiveCount > 0 || item.smallTapTargetCount > 0 || item.tableOverflowCount > 0).slice(0, 12)) {
    const status = responsiveStatus(viewport);
    add(items, {
      kind: 'responsive',
      title: `响应式视口：${viewport.name} ${viewport.width}x${viewport.height}`,
      priority: status === 'failed' ? 'P2' : 'P3',
      status,
      confidence: 'medium',
      executionMode: 'runtime',
      owner: 'frontend',
      preconditions: ['已确认 deviceScope；未确认时小触控目标属于覆盖观察。'],
      steps: [`打开 ${viewport.width}x${viewport.height} 视口。`],
      expected: ['无水平溢出、裁剪交互或范围内触控目标问题。'],
      actual: actualFromStatus(status, `overflow=${viewport.horizontalOverflow}, clipped=${viewport.clippedInteractiveCount}, smallTap=${viewport.smallTapTargetCount}`),
      evidenceRefs: ['responsiveChecks', viewport.screenshot ?? ''],
      issueIds: [],
      requirementIds: [],
      journeyIds: [],
      nextSteps: ['按 productContext.deviceScope 判断是修复、产品接受还是非缺陷。'],
      notes: viewport.observations
    });
  }

  const contractIssues = result.apiContract.summary.statusMismatchCount + result.apiContract.summary.schemaMismatchCount + result.apiContract.summary.undocumentedCount;
  add(items, {
    kind: 'api-contract',
    title: 'API contract / 数据契约检查',
    priority: contractIssues > 0 ? 'P2' : 'P3',
    status: !result.apiContract.enabled ? 'skipped' : contractIssues > 0 ? 'partial' : result.apiContract.summary.endpointCount === 0 ? 'needs-input' : 'passed',
    confidence: result.apiContract.summary.endpointCount > 0 ? 'medium' : 'low',
    executionMode: 'hybrid',
    owner: 'backend',
    preconditions: ['API contract 模块启用；有真实 OpenAPI/后端包络时置信度更高。'],
    steps: ['采集页面 API 请求并与 contract/包络约定对比。'],
    expected: ['状态码、响应结构和业务包络符合约定。'],
    actual: actualFromStatus(!result.apiContract.enabled ? 'skipped' : contractIssues > 0 ? 'partial' : result.apiContract.summary.endpointCount === 0 ? 'needs-input' : 'passed', `endpoints=${result.apiContract.summary.endpointCount}, findings=${contractIssues}`),
    evidenceRefs: ['apiContract'],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: contractIssues > 0 ? ['结合真实后端契约复核，排除异常模拟流量。'] : [],
    notes: []
  });

  const budgetFailed = result.p2.budgets.filter((item) => item.status === 'failed').length;
  add(items, {
    kind: 'performance',
    title: 'Performance / Coverage / P2 预算',
    priority: budgetFailed > 0 || result.p2.visual.status === 'failed' ? 'P2' : 'P3',
    status: result.coverage.status === 'failed' || result.p2.visual.status === 'failed' || budgetFailed > 0 ? 'failed' : result.coverage.status === 'skipped' && !result.p2.enabled ? 'skipped' : 'passed',
    confidence: 'medium',
    executionMode: 'runtime',
    owner: 'frontend',
    preconditions: ['性能结论应来自 build/preview 或生产等价环境；dev server 仅作源码线索。'],
    steps: ['采集 Coverage、P2 visual、预算和网络 profile。'],
    expected: ['预算通过，视觉 diff 在阈值内，未使用资源有明确解释。'],
    actual: actualFromStatus(result.coverage.status === 'failed' || result.p2.visual.status === 'failed' || budgetFailed > 0 ? 'failed' : result.coverage.status === 'skipped' && !result.p2.enabled ? 'skipped' : 'passed', `coverage=${result.coverage.status}, visual=${result.p2.visual.status}, failedBudgets=${budgetFailed}`),
    evidenceRefs: ['coverage', 'p2', 'performance'],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: budgetFailed > 0 ? ['在生产等价环境复测，并定位 route lazy loading / bundle split。'] : [],
    notes: []
  });

  add(items, {
    kind: 'security',
    title: 'Passive security scan',
    priority: result.security.summary.highCount > 0 ? 'P1' : result.security.summary.failedCount > 0 ? 'P2' : 'P3',
    status: result.security.status === 'failed' ? 'failed' : result.security.status === 'skipped' ? 'skipped' : 'passed',
    confidence: 'medium',
    executionMode: 'hybrid',
    owner: 'security',
    preconditions: ['security.mode=passive；生产响应头/TLS 需要生产等价环境。'],
    steps: ['检查响应头、TLS、敏感信息、cookie、被动安全信号。'],
    expected: ['无真实敏感信息暴露；生产安全头/TLS 符合上线要求。'],
    actual: actualFromStatus(result.security.status === 'failed' ? 'failed' : result.security.status === 'skipped' ? 'skipped' : 'passed', `score=${result.security.score}, failed=${result.security.summary.failedCount}, warnings=${result.security.summary.warningCount}`),
    evidenceRefs: ['security', ...result.security.checks.filter((item) => item.status === 'failed').slice(0, 5).map((item) => item.id)],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: result.security.status === 'failed' ? ['区分前端代码、部署网关和测试环境噪音。'] : [],
    notes: []
  });

  add(items, {
    kind: 'source-health',
    title: 'Source health / 项目脚本',
    priority: result.sourceHealth.status === 'failed' ? 'P0' : result.sourceHealth.packageScripts.length > result.sourceHealth.scriptChecks.length ? 'P2' : 'P3',
    status: result.sourceHealth.status === 'failed' ? 'blocked' : result.sourceHealth.enabled ? 'passed' : 'skipped',
    confidence: result.sourceHealth.enabled ? 'high' : 'low',
    executionMode: 'static',
    owner: 'frontend',
    preconditions: ['提供 sourceRoot；显式允许时运行 typecheck/lint/build/test/e2e。'],
    steps: ['解析源码并运行已授权的项目脚本。'],
    expected: ['无语法错误，已执行脚本通过，未执行脚本作为 sign-off gap 记录。'],
    actual: actualFromStatus(result.sourceHealth.status === 'failed' ? 'blocked' : result.sourceHealth.enabled ? 'passed' : 'skipped', `status=${result.sourceHealth.status}, scripts=${result.sourceHealth.scriptChecks.length}/${result.sourceHealth.packageScripts.length}`),
    evidenceRefs: ['sourceHealth', ...result.sourceHealth.scriptChecks.map((check) => check.id)],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: result.sourceHealth.status === 'failed' ? ['修复语法/脚本失败后复跑。'] : result.sourceHealth.packageScripts.length > result.sourceHealth.scriptChecks.length ? ['补跑未执行的 build/typecheck/test/e2e/lint 或明确范围外。'] : [],
    notes: []
  });

  add(items, {
    kind: 'test-data',
    title: 'Test data lifecycle',
    priority: result.testData.status === 'failed' ? 'P0' : result.testData.status === 'warning' ? 'P1' : 'P3',
    status: result.testData.status === 'failed' ? 'blocked' : result.testData.status === 'warning' ? 'partial' : result.testData.status === 'skipped' ? 'skipped' : 'passed',
    confidence: 'medium',
    executionMode: result.testData.enabled ? 'hybrid' : 'manual-required',
    owner: 'test',
    preconditions: ['写操作/数据正确性验收需要隔离记录、setup、cleanup、环境授权。'],
    steps: ['检查 testData.records/setup/cleanup/operations。'],
    expected: ['测试数据可重复、可清理、无未授权生产写入。'],
    actual: actualFromStatus(result.testData.status === 'failed' ? 'blocked' : result.testData.status === 'warning' ? 'partial' : result.testData.status === 'skipped' ? 'skipped' : 'passed', `records=${result.testData.summary.recordCount}, missingCleanup=${result.testData.summary.missingCleanupCount}, productionRisk=${result.testData.summary.productionRiskCount}`),
    evidenceRefs: ['testData'],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: result.testData.recommendations.slice(0, 5),
    notes: result.testData.findings.slice(0, 5).map((item) => item.message)
  });

  add(items, {
    kind: 'artifact',
    title: 'Artifact integrity / 证据路径完整性',
    priority: result.artifactIntegrity.status === 'failed' ? 'P1' : 'P3',
    status: result.artifactIntegrity.status === 'failed' ? 'blocked' : result.artifactIntegrity.status === 'skipped' ? 'skipped' : result.artifactIntegrity.status === 'warning' ? 'partial' : 'passed',
    confidence: 'high',
    executionMode: 'static',
    owner: 'test',
    preconditions: ['报告已写出。'],
    steps: ['校验截图、DOM、JSON sidecar、下载、视觉 diff 路径。'],
    expected: ['被引用的本地证据均存在，或明确标记 unchecked/missing。'],
    actual: actualFromStatus(result.artifactIntegrity.status === 'failed' ? 'blocked' : result.artifactIntegrity.status === 'skipped' ? 'skipped' : result.artifactIntegrity.status === 'warning' ? 'partial' : 'passed', `missing=${result.artifactIntegrity.missingCount}, present=${result.artifactIntegrity.presentCount}`),
    evidenceRefs: ['artifactIntegrity'],
    issueIds: [],
    requirementIds: [],
    journeyIds: [],
    nextSteps: result.artifactIntegrity.status === 'failed' ? ['重新生成缺失证据或修复路径引用。'] : [],
    notes: result.artifactIntegrity.missing.slice(0, 5).map((item) => item.source)
  });

  for (const coverage of result.qaCoverage.items.filter((item) => item.status === 'failed' || item.status === 'needs-input').slice(0, 8)) {
    add(items, {
      kind: 'triage',
      title: `覆盖缺口：${coverage.title}`,
      priority: coverage.area === 'requirements' || coverage.area === 'journey' ? 'P1' : 'P2',
      status: statusFromCoverage(coverage),
      confidence: coverage.confidence,
      executionMode: 'manual-required',
      owner: coverage.area === 'product-scope' ? 'product' : 'test',
      preconditions: ['需要补充输入或复跑专项模块。'],
      steps: coverage.nextSteps.length ? coverage.nextSteps : ['按 qaCoverage 缺口补测。'],
      expected: ['coverage item 不再 failed/needs-input。'],
      actual: actualFromStatus(statusFromCoverage(coverage), coverage.gaps[0] || coverage.status),
      evidenceRefs: ['qaCoverage', coverage.id, ...coverage.evidenceRefs],
      issueIds: [],
      requirementIds: [],
      journeyIds: [],
      nextSteps: coverage.nextSteps,
      notes: coverage.gaps
    });
  }

  const sorted = items.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id)).slice(0, 180);
  const passedCount = countByStatus(sorted, 'passed');
  const failedCount = countByStatus(sorted, 'failed');
  const partialCount = countByStatus(sorted, 'partial');
  const blockedCount = countByStatus(sorted, 'blocked');
  const skippedCount = countByStatus(sorted, 'skipped');
  const needsInputCount = countByStatus(sorted, 'needs-input');
  const runtimeVerifiedCount = sorted.filter((item) => item.kind !== 'requirement' && item.executionMode === 'runtime' && item.status === 'passed' && item.confidence === 'high').length;
  const manualRequiredCount = sorted.filter((item) => item.executionMode === 'manual-required' || item.status === 'needs-input').length;
  const highPriorityOpenCount = sorted.filter((item) => isHighPriority(item.priority) && item.status !== 'passed' && item.status !== 'skipped').length;
  const status: TestCaseMatrixResult['status'] = blockedCount > 0 ? 'blocked' : failedCount > 0 ? 'failed' : needsInputCount > 0 ? 'needs-input' : partialCount > 0 ? 'partial' : sorted.length === 0 || skippedCount === sorted.length ? 'skipped' : 'passed';
  const confidence: TestCaseMatrixResult['confidence'] = status === 'passed' && runtimeVerifiedCount > 0 ? 'high' : status === 'blocked' || status === 'failed' || result.requirementCoverage.source === 'none' ? 'low' : 'medium';

  return {
    generatedAt: new Date().toISOString(),
    status,
    confidence,
    summary: {
      totalCount: sorted.length,
      passedCount,
      failedCount,
      partialCount,
      blockedCount,
      skippedCount,
      needsInputCount,
      runtimeVerifiedCount,
      manualRequiredCount,
      highPriorityOpenCount
    },
    items: sorted,
    notes: [
      'Test cases are generated from requirements, journeys, interactions, exceptions, a11y/responsive/performance/security/source/test-data/artifact evidence.',
      'A passed test case is scoped evidence, not global business validation. Use qaSignoff, claimGuard, qaCoverage, and riskAcceptance before release wording.',
      'needs-input/manual-required rows are professional tester follow-ups, not implementation defects by themselves.'
    ]
  };
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cell(value: unknown): string {
  return markdownEscape(truncate(String(value ?? '-')));
}

export function formatTestCaseMatrix(result: TestCaseMatrixResult): string {
  const rows = result.items.slice(0, 80).map((item) => `| ${item.id} | ${item.priority} | ${item.kind} | ${item.status} | ${item.executionMode} | ${item.confidence} | ${cell(item.title)} | ${cell(item.actual)} | ${cell(item.nextSteps.slice(0, 2).join('；') || '-')} |`);
  return `# FrontLens Test Case Matrix

## Status

- Status: **${result.status}** / confidence **${result.confidence}**
- Passed / failed / partial / blocked / skipped / needs-input: **${result.summary.passedCount} / ${result.summary.failedCount} / ${result.summary.partialCount} / ${result.summary.blockedCount} / ${result.summary.skippedCount} / ${result.summary.needsInputCount}**
- Runtime-verified: **${result.summary.runtimeVerifiedCount}**
- Manual-required / high-priority open: **${result.summary.manualRequiredCount} / ${result.summary.highPriorityOpenCount}**

## Test Cases

${rows.length ? ['| ID | Pri | Kind | Status | Mode | Confidence | Test case | Actual | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No test cases generated.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
