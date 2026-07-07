import type { ClaimGuardClaimType, QaIntakeQuestion, QaIntakeResult, QaResult, ScopeReviewQuestion } from '../types.js';

type QaIntakeInput = Pick<
  QaResult,
  | 'claimGuard'
  | 'scopeReview'
  | 'qaSignoff'
  | 'qualityGate'
  | 'requirementCoverage'
  | 'environment'
  | 'sourceAnalysis'
  | 'sourceRuntimeCorrelation'
  | 'sourceHealth'
  | 'artifactIntegrity'
  | 'testData'
  | 'regressionPlan'
  | 'defectProof'
  | 'rootCauseGroups'
  | 'issueDisposition'
  | 'artifacts'
>;

type DraftQuestion = Omit<QaIntakeQuestion, 'id'>;

const PRIORITY_WEIGHT: Record<QaIntakeQuestion['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};

const CLAIM_CATEGORY: Record<ClaimGuardClaimType, QaIntakeQuestion['category']> = {
  'business-validation': 'requirements',
  'release-signoff': 'claim-guard',
  'production-performance': 'environment',
  'production-security': 'environment',
  'frontend-defect': 'claim-guard',
  'api-ui-data-binding': 'source-health',
  'download-export': 'download-export',
  'source-health': 'source-health'
};

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function priorityFromClaim(status: 'allowed' | 'limited' | 'blocked', claim: ClaimGuardClaimType): QaIntakeQuestion['priority'] {
  if (status === 'blocked') return 'P0';
  if (claim === 'business-validation' || claim === 'release-signoff') return 'P1';
  if (claim === 'api-ui-data-binding' || claim === 'source-health') return 'P1';
  if (claim === 'production-performance' || claim === 'production-security') return 'P2';
  return 'P3';
}

function mapScopeCategory(question: ScopeReviewQuestion): QaIntakeQuestion['category'] {
  switch (question.category) {
    case 'requirement':
      return 'requirements';
    case 'product':
    case 'device':
    case 'accessibility':
    case 'feature':
      return 'product-scope';
    case 'role':
      return 'role-auth';
    case 'test-data':
      return 'test-data';
    case 'environment':
      return 'environment';
  }
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function pushUnique(target: DraftQuestion[], input: DraftQuestion): void {
  const key = `${input.category}:${normalizeKey(input.question)}`;
  const existingIndex = target.findIndex((item) => `${item.category}:${normalizeKey(item.question)}` === key);
  if (existingIndex === -1) {
    target.push({
      ...input,
      evidenceRefs: uniq(input.evidenceRefs),
      blocksClaims: uniq(input.blocksClaims) as ClaimGuardClaimType[]
    });
    return;
  }

  const existing = target[existingIndex];
  const stronger = PRIORITY_WEIGHT[input.priority] < PRIORITY_WEIGHT[existing.priority] ? input.priority : existing.priority;
  target[existingIndex] = {
    ...existing,
    priority: stronger,
    why: uniq([existing.why, input.why]).join('；'),
    howToAnswer: uniq([existing.howToAnswer, input.howToAnswer]).join('；'),
    evidenceRefs: uniq([...existing.evidenceRefs, ...input.evidenceRefs]),
    blocksClaims: uniq([...existing.blocksClaims, ...input.blocksClaims]) as ClaimGuardClaimType[],
    configHint: existing.configHint ?? input.configHint
  };
}

function sortQuestions(items: QaIntakeQuestion[]): QaIntakeQuestion[] {
  return [...items].sort((left, right) => {
    const byPriority = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
    if (byPriority !== 0) return byPriority;
    return left.id.localeCompare(right.id);
  });
}

function addClaimGuardQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  const hasDownloadContext = (result.artifacts.downloadedFiles?.length ?? 0) > 0 || result.regressionPlan.items.some((entry) => entry.type === 'download');
  for (const item of result.claimGuard.items) {
    if (item.status === 'allowed' || item.requiredInputs.length === 0) continue;
    if (item.claim === 'download-export' && !hasDownloadContext) continue;
    pushUnique(questions, {
      category: CLAIM_CATEGORY[item.claim],
      priority: priorityFromClaim(item.status, item.claim),
      question: item.requiredInputs.join(' '),
      why: item.summary,
      howToAnswer: `补齐 ${item.evidenceRefs.join(' / ')} 证据后复测；最终报告只能使用 allowed wording：${item.allowedWording}`,
      evidenceRefs: item.evidenceRefs,
      blocksClaims: [item.claim],
      configHint: item.claim === 'business-validation' ? 'requirements[] + productContext + 带 expect 的 journeySteps' : undefined
    });
  }
}

function addScopeQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  for (const item of result.scopeReview.questions) {
    pushUnique(questions, {
      category: mapScopeCategory(item),
      priority: item.category === 'requirement' ? 'P1' : item.category === 'role' ? 'P2' : 'P3',
      question: item.question,
      why: item.impact,
      howToAnswer: item.category === 'requirement'
        ? '提供 PRD/验收标准，优先转成 selectors、expectedTexts、apiPatterns 或 journeySteps。'
        : '把确认后的范围写入 productContext（pageType/deviceScope/accessibilityTarget/requiredFeatures/optionalFeatures/outOfScopeFeatures/decisions）。',
      evidenceRefs: [`scopeReview.${item.id}`, 'pageProfile', 'requirementCoverage'],
      blocksClaims: item.category === 'requirement' ? ['business-validation', 'release-signoff'] : ['release-signoff'],
      configHint: item.category === 'requirement' ? 'requirements[]' : 'productContext'
    });
  }
}

function addQaSignoffQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  for (const blocker of result.qaSignoff.blockers) {
    pushUnique(questions, {
      category: 'regression',
      priority: 'P0',
      question: blocker,
      why: 'qaSignoff blocker 会阻断专业测试签核和发布结论。',
      howToAnswer: '先修复或补齐对应证据，再按 regressionPlan 复测。',
      evidenceRefs: ['qaSignoff.blockers', 'qualityGate', 'regressionPlan'],
      blocksClaims: ['release-signoff', 'business-validation']
    });
  }
  for (const gap of result.qaSignoff.coverageGaps) {
    pushUnique(questions, {
      category: /PRD|需求|验收/i.test(gap) ? 'requirements' : 'journey',
      priority: 'P1',
      question: gap,
      why: '覆盖缺口会把业务验收置信度降级，不能据此得出完整业务通过。',
      howToAnswer: '补充显式 requirement 或带成功断言的 journey，并关联到核心业务路径。',
      evidenceRefs: ['qaSignoff.coverageGaps', 'requirementCoverage', 'journeyTests'],
      blocksClaims: ['business-validation', 'release-signoff'],
      configHint: 'requirements[] / journeyTests[].steps[].expect*'
    });
  }
  for (const followup of result.qaSignoff.requiredFollowups) {
    pushUnique(questions, {
      category: /role|权限|auth|登录/i.test(followup) ? 'role-auth' : /data|cleanup|测试数据|清理/i.test(followup) ? 'test-data' : 'regression',
      priority: 'P2',
      question: followup,
      why: 'requiredFollowups 是专业测试工程师会要求补齐的复核输入。',
      howToAnswer: '提供对应配置、账号/存储态、测试数据或专项复测结果。',
      evidenceRefs: ['qaSignoff.requiredFollowups'],
      blocksClaims: ['business-validation', 'release-signoff']
    });
  }
}

function addRegressionQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  for (const item of result.regressionPlan.items) {
    if (item.status === 'ready') continue;
    pushUnique(questions, {
      category: item.type === 'environment' ? 'environment' : item.type === 'artifact-integrity' ? 'artifact-integrity' : item.type === 'download' ? 'download-export' : item.type === 'role-matrix' ? 'role-auth' : item.type === 'source-health' ? 'source-health' : 'regression',
      priority: item.status === 'blocked' ? 'P0' : item.priority,
      question: item.title,
      why: item.notes?.join('；') || '该复测项缺少输入或被阻断，修复后不能直接签核。',
      howToAnswer: item.steps.join('；') || item.commands.join('；') || '补齐输入后执行 regressionPlan 中的复测命令。',
      evidenceRefs: item.evidenceRefs.length ? item.evidenceRefs : ['regressionPlan'],
      blocksClaims: ['release-signoff'],
      configHint: item.commands[0]
    });
  }
}

function addEnvironmentQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  if (result.environment.trust.performance !== 'high') {
    pushUnique(questions, {
      category: 'environment',
      priority: 'P2',
      question: '是否可以提供 build+preview 或生产等价 HTTPS 环境用于性能结论？',
      why: `当前 environment=${result.environment.kind}，performance trust=${result.environment.trust.performance}；dev server 的请求数、HMR、模块体积不能代表生产性能。`,
      howToAnswer: '运行 pnpm/npm build 后用 preview/nginx/CDN 地址复测，必要时使用 env-compare。',
      evidenceRefs: ['environment', 'coverage', 'p2', 'performance'],
      blocksClaims: ['production-performance'],
      configHint: 'frontlens env-compare --dev-url ... --preview-url ...'
    });
  }
  if (result.environment.trust.security !== 'high') {
    pushUnique(questions, {
      category: 'environment',
      priority: 'P2',
      question: '是否可以提供生产等价部署入口用于安全头/TLS/点击劫持等被动安全结论？',
      why: `当前 security trust=${result.environment.trust.security}；本地/dev 的响应头缺失通常是部署层或环境噪音。`,
      howToAnswer: '在真实 nginx/CDN/网关/HTTPS 环境复测安全项；前端报告只保留部署 checklist。',
      evidenceRefs: ['environment', 'security', 'issueDisposition'],
      blocksClaims: ['production-security']
    });
  }
}

function addSourceQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  if (result.sourceHealth.status === 'failed') {
    pushUnique(questions, {
      category: 'source-health',
      priority: 'P0',
      question: 'sourceHealth 检查失败：请先修复语法错误或失败的受控脚本。',
      why: '源码健康失败是源码确认阻断，会让运行时症状解释不可信。',
      howToAnswer: '查看 source-health.json 中 findings/scriptChecks，修复后运行 --source-run-scripts 复测。',
      evidenceRefs: ['sourceHealth.findings', 'sourceHealth.scriptChecks'],
      blocksClaims: ['source-health', 'release-signoff']
    });
  } else if (result.sourceAnalysis.status === 'skipped' || result.sourceRuntimeCorrelation.status === 'skipped') {
    pushUnique(questions, {
      category: 'source-health',
      priority: 'P1',
      question: '是否可以提供 frontend sourceRoot，并允许源码索引/必要时运行 typecheck、lint？',
      why: '没有源码×运行时绑定时，不能把全局 Network 观察直接升级为“接口有数据但页面空”等前端缺陷。',
      howToAnswer: '使用 --source-root <repo>，专业签核时加 --source-run-scripts --source-scripts "typecheck,lint"。',
      evidenceRefs: ['sourceAnalysis', 'sourceRuntimeCorrelation', 'sourceHealth'],
      blocksClaims: ['frontend-defect', 'api-ui-data-binding', 'source-health'],
      configHint: '--source-root /path/to/frontend --source-run-scripts --source-scripts "typecheck,lint"'
    });
  }
  for (const gap of result.sourceRuntimeCorrelation.gaps.slice(0, 3)) {
    pushUnique(questions, {
      category: 'source-health',
      priority: 'P2',
      question: gap,
      why: 'source/runtime 绑定缺口会降低 API/UI 数据关系结论的可信度。',
      howToAnswer: '补充 apiPatterns、selectors 或更精确 journey，让请求、组件和状态信号可绑定。',
      evidenceRefs: ['sourceRuntimeCorrelation.gaps'],
      blocksClaims: ['api-ui-data-binding']
    });
  }
}

function addTestDataQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  if (result.testData.status === 'skipped') return;
  for (const finding of result.testData.findings) {
    pushUnique(questions, {
      category: 'test-data',
      priority: finding.severity === 'critical' || finding.severity === 'high' ? 'P1' : 'P2',
      question: finding.message,
      why: '测试数据生命周期不完整会让写入/删除/导入/导出类业务验证不可复现或不可回滚。',
      howToAnswer: '提供 testData.records/setupSteps/cleanupSteps，标明 staging/local 环境和回滚策略。',
      evidenceRefs: [`testData.findings.${finding.id}`],
      blocksClaims: ['business-validation', 'release-signoff'],
      configHint: 'testData.records + setupSteps + cleanupSteps'
    });
  }
  for (const recommendation of result.testData.recommendations.slice(0, 3)) {
    pushUnique(questions, {
      category: 'test-data',
      priority: 'P3',
      question: recommendation,
      why: '测试数据建议有助于把一次性观察变成可重复验收。',
      howToAnswer: '按建议补充测试数据配置或说明该业务路径本次不在范围内。',
      evidenceRefs: ['testData.recommendations'],
      blocksClaims: ['business-validation']
    });
  }
}

function addArtifactQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  if (result.artifactIntegrity.status !== 'failed') return;
  pushUnique(questions, {
    category: 'artifact-integrity',
    priority: 'P0',
    question: `证据产物缺失 ${result.artifactIntegrity.missingCount} 项，是否需要重新生成报告或修复路径引用？`,
    why: '报告中引用的截图/视频/trace/download 等路径不存在时，专业测试结论不可复核。',
    howToAnswer: '查看 artifact-integrity.json 的 missing 列表，重新运行 QA 或修正报告产物路径。',
    evidenceRefs: ['artifactIntegrity.missing', 'artifacts'],
    blocksClaims: ['release-signoff', 'download-export']
  });
}

function addDefectProofQuestions(result: QaIntakeInput, questions: DraftQuestion[]): void {
  for (const item of result.defectProof.items.filter((entry) => entry.status === 'needs-evidence').slice(0, 5)) {
    pushUnique(questions, {
      category: item.missingEvidence.some((entry) => /source/i.test(entry)) ? 'source-health' : 'regression',
      priority: item.priority === 'P0' || item.priority === 'P1' ? 'P1' : 'P2',
      question: `${item.rootCauseGroupId} 缺陷证明不足：${item.missingEvidence.slice(0, 2).join('；') || item.title}`,
      why: '专业缺陷登记需要用户影响、运行时证据、源码/owner 修复面、复现步骤，以及必要的需求/产品范围上下文。',
      howToAnswer: item.nextSteps.join('；') || '补齐缺陷证明链路后再把该 root cause 排入 must-fix。',
      evidenceRefs: item.evidenceRefs.length ? item.evidenceRefs : [item.rootCauseGroupId],
      blocksClaims: ['frontend-defect', 'release-signoff'],
      configHint: item.nextSteps[0]
    });
  }
}

function buildReadyToProceed(result: QaIntakeInput, questions: QaIntakeQuestion[]): string[] {
  const ready: string[] = [];
  const proofReadyCount = result.defectProof.items.filter((item) => item.status === 'proven' || item.status === 'probable').length;
  if (proofReadyCount > 0) {
    ready.push(`已有 ${proofReadyCount} 个 proof-ready rootCauseGroups，可先按根因表安排修复，不要按 raw issue 数量排期。`);
  } else if (result.rootCauseGroups.some((group) => group.status === 'actionable')) {
    ready.push('存在 actionable rootCauseGroups，但 defectProof 尚未证明；先补证据或降级，不要直接排入 must-fix。');
  }
  if (result.issueDisposition.summary.nonActionableCount > 0) {
    ready.push('已有 raw finding 被归入部署/产品/工具/证据不足等非缺陷或条件项，可先从修复队列中排除。');
  }
  if (result.claimGuard.status !== 'clear') {
    ready.push('可以使用 claimGuard.allowedWording 给出限定结论，但必须避开 forbiddenClaims。');
  }
  if (questions.length === 0) {
    ready.push('输入项齐备；可按 qaSignoff、professionalSummary 和 regressionPlan 进行签核与复测。');
  }
  return ready;
}

export function buildQaIntake(result: QaIntakeInput): QaIntakeResult {
  const drafts: DraftQuestion[] = [];
  addClaimGuardQuestions(result, drafts);
  addScopeQuestions(result, drafts);
  addQaSignoffQuestions(result, drafts);
  addRegressionQuestions(result, drafts);
  addEnvironmentQuestions(result, drafts);
  addSourceQuestions(result, drafts);
  addTestDataQuestions(result, drafts);
  addArtifactQuestions(result, drafts);
  addDefectProofQuestions(result, drafts);

  const questions = sortQuestions(drafts.map((item, index) => ({
    id: `INTAKE-Q-${String(index + 1).padStart(3, '0')}`,
    ...item,
    evidenceRefs: uniq(item.evidenceRefs),
    blocksClaims: uniq(item.blocksClaims) as ClaimGuardClaimType[]
  })));
  const blocked = questions.some((item) => item.priority === 'P0') || result.qaSignoff.status === 'blocked' || result.qualityGate.status === 'blocked';
  const status: QaIntakeResult['status'] = blocked ? 'blocked' : questions.length > 0 ? 'needs-input' : 'ready';
  const configHints = uniq(questions.map((item) => item.configHint ?? '').filter(Boolean));
  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: status === 'ready'
      ? 'QA intake ready: no blocking follow-up input is required before using the professional QA conclusions.'
      : status === 'blocked'
        ? `QA intake blocked: ${questions.filter((item) => item.priority === 'P0').length} P0 follow-up input(s) or blockers must be resolved before professional sign-off.`
        : `QA intake needs input: answer the top ${Math.min(questions.length, 5)} question(s) before broad business/product/release conclusions.`,
    topQuestions: questions.slice(0, 5),
    questions,
    readyToProceed: buildReadyToProceed(result, questions),
    configHints,
    notes: [
      'QA intake is the professional-tester follow-up list: ask these before guessing product intent or overstating business validation.',
      'Questions are cross-page generic and are derived from claimGuard, scopeReview, qaSignoff, regressionPlan, environment, source, testData, and artifact integrity.',
      'Do not convert a question into a defect until the answer contradicts explicit requirements or runtime/source evidence.'
    ]
  };
}

export function createEmptyQaIntake(): QaIntakeResult {
  const question: QaIntakeQuestion = {
    id: 'INTAKE-Q-001',
    category: 'claim-guard',
    priority: 'P1',
    question: '请重新运行 FrontLens 1.30+ 生成 qaIntake，以获得专业测试工程师式待补输入清单。',
    why: '旧报告缺少统一 intake，容易把产品范围/PRD/角色/测试数据缺口误写成缺陷或过度结论。',
    howToAnswer: '使用当前版本重新运行 QA，或手动检查 claimGuard、scopeReview、qaSignoff 和 regressionPlan。',
    evidenceRefs: ['result.metadata.schemaVersion'],
    blocksClaims: ['business-validation', 'release-signoff']
  };
  return {
    generatedAt: new Date().toISOString(),
    status: 'needs-input',
    summary: 'QA intake missing from report; rerun or normalize the report before professional sign-off.',
    topQuestions: [question],
    questions: [question],
    readyToProceed: ['可以先读取 professionalSummary、claimGuard、issueDisposition 和 rootCauseGroups 做保守 triage。'],
    configHints: [],
    notes: ['Older reports may not contain qaIntake. Use conservative wording until regenerated.']
  };
}
