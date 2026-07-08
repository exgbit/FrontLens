import type {
  EnvironmentAssessment,
  QaIntakeCategory,
  QaResult,
  QaStrategyDecision,
  QaStrategyEnvironmentPlan,
  QaStrategyModule,
  QaStrategyModuleDecision,
  QaStrategyQuestion,
  QaStrategyResult,
  QaStrategyRiskLevel,
  QaStrategyRunMode
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type QaStrategyInput = Pick<QaResult,
  | 'summary'
  | 'metadata'
  | 'pageModel'
  | 'network'
  | 'pageProfile'
  | 'requirementCoverage'
  | 'scopeReview'
  | 'qaIntake'
  | 'journeyTests'
  | 'journeyAssertionAudit'
  | 'assertionSuggestions'
  | 'apiContract'
  | 'testCases'
  | 'riskRegister'
  | 'riskAcceptance'
  | 'testData'
  | 'environment'
  | 'sourceAnalysis'
  | 'sourceRuntimeCorrelation'
  | 'sourceHealth'
  | 'artifactIntegrity'
  | 'evidenceBundle'
  | 'automationSpecs'
  | 'defectTickets'
  | 'traceability'
  | 'qaCoverage'
  | 'qaPlan'
  | 'qaSignoff'
  | 'qualityGate'
  | 'security'
  | 'coverage'
  | 'p2'
  | 'accessibilityChecks'
  | 'responsiveChecks'
  | 'exceptionSimulations'
  | 'permissionChecks'
>;

type Priority = QaStrategyModuleDecision['priority'];

type DecisionSeed = Omit<QaStrategyModuleDecision, 'requiredInputs' | 'evidenceRefs' | 'commandHints'> & {
  requiredInputs?: string[];
  evidenceRefs?: string[];
  commandHints?: string[];
};

const DECISION_ORDER: Record<QaStrategyDecision, number> = {
  blocked: 0,
  run: 1,
  'run-if-input': 2,
  'already-covered': 3,
  'out-of-scope': 4
};

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function uniq(items: Array<string | undefined | null>): string[] {
  return [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function productText(input: QaStrategyInput): string {
  const productContext = input.metadata.config.productContext;
  return [
    input.summary.title,
    input.pageProfile.pageType,
    productContext.pageType,
    productContext.pageName,
    ...productContext.requiredFeatures,
    ...productContext.optionalFeatures,
    ...productContext.outOfScopeFeatures,
    ...productContext.decisions.flatMap((decision) => [decision.id, decision.title, decision.rationale, ...(decision.appliesTo ?? [])]),
    input.pageModel.stats.bodyTextSample,
    ...input.pageProfile.signals,
    ...input.pageProfile.caveats
  ].filter(Boolean).join(' ');
}

function isPermissionSensitive(input: QaStrategyInput): boolean {
  return input.pageProfile.pageType === 'credential-security'
    || input.pageProfile.pageType === 'auth-login'
    || hasAny(productText(input), ['credential', 'secret', 'token', 'password', 'permission', 'role', 'auth', 'login', 'admin', '凭证', '密钥', '令牌', '权限', '角色', '登录', '管理']);
}

function hasMutatingOrDangerousFlow(input: QaStrategyInput): boolean {
  const verbs = ['create', 'edit', 'delete', 'remove', 'upload', 'import', 'submit', 'save', 'export', 'download', '新增', '创建', '编辑', '删除', '上传', '导入', '提交', '保存', '导出', '下载'];
  return hasAny(productText(input), verbs)
    || input.requirementCoverage.items.some((item) => hasAny(`${item.title} ${item.description ?? ''}`, verbs))
    || input.journeyTests.some((journey) => hasAny(`${journey.name} ${journey.steps.map((step) => `${step.action} ${step.target ?? ''} ${step.value ?? ''}`).join(' ')}`, verbs));
}

function isLocalLike(environment: EnvironmentAssessment): boolean {
  return environment.isLocalOrPrivate || environment.kind === 'local-dev' || environment.kind === 'local-preview' || environment.kind === 'staging-or-private' || environment.isViteDevServer;
}

function envKindForPlan(environment: EnvironmentAssessment): QaStrategyEnvironmentPlan['kind'] {
  if (environment.kind === 'local-dev') return 'dev';
  if (environment.kind === 'local-preview') return 'preview';
  if (environment.kind === 'production-like') return 'production';
  if (environment.kind === 'staging-or-private') return 'staging';
  return 'unknown';
}

function commandQa(input: QaStrategyInput, extra = ''): string {
  const source = input.sourceAnalysis.root ? ` --source-root ${JSON.stringify(input.sourceAnalysis.root)}` : '';
  return `frontlens qa --url ${JSON.stringify(input.summary.url)}${source}${extra}`;
}

function commandEnvCompare(input: QaStrategyInput): string {
  return `frontlens env-compare --dev-url ${JSON.stringify(input.summary.url)} --preview-url <preview-or-build-url>`;
}

function commandRoleMatrix(input: QaStrategyInput): string {
  return `frontlens role-matrix --url ${JSON.stringify(input.summary.url)} --role admin=<admin-storage-state.json> --role viewer=<viewer-storage-state.json>`;
}

function sortModules(items: QaStrategyModuleDecision[]): QaStrategyModuleDecision[] {
  return items.slice().sort((left, right) =>
    PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
    || DECISION_ORDER[left.decision] - DECISION_ORDER[right.decision]
    || left.module.localeCompare(right.module)
  );
}

function decideRisk(input: QaStrategyInput): QaStrategyRiskLevel {
  if (input.riskRegister.summary.releaseBlockingCount > 0 || input.riskAcceptance.status === 'blocked' || input.qaSignoff.status === 'blocked' || input.qaSignoff.status === 'fail') {
    return 'critical';
  }
  if (
    isPermissionSensitive(input)
    || input.defectTickets.counts.total > 0
    || input.testCases.summary.highPriorityOpenCount > 0
    || input.traceability.summary.highPriorityGapCount > 0
    || input.riskRegister.summary.highCount + input.riskRegister.summary.criticalCount > 0
  ) {
    return 'high';
  }
  if (
    input.qaIntake.questions.length > 0
    || input.scopeReview.status === 'needs-input'
    || input.environment.trust.performance !== 'high'
    || input.environment.trust.security !== 'high'
    || (input.sourceHealth.packageScripts.length > 0 && input.sourceHealth.scriptChecks.length === 0)
    || input.journeyAssertionAudit.summary.pathOnlyJourneyCount + input.journeyAssertionAudit.summary.weaklyAssertedJourneyCount > 0
  ) {
    return 'medium';
  }
  return 'low';
}

function decideStatus(input: QaStrategyInput, modules: QaStrategyModuleDecision[], questions: QaStrategyQuestion[]): QaStrategyResult['status'] {
  if (modules.some((item) => item.decision === 'blocked') || input.riskAcceptance.status === 'blocked') return 'blocked';
  if (modules.some((item) => item.decision === 'run-if-input') || questions.some((item) => item.priority === 'P0' || item.priority === 'P1')) return 'needs-input';
  return 'ready';
}

function runMode(status: QaStrategyResult['status'], riskLevel: QaStrategyRiskLevel): QaStrategyRunMode {
  if (status === 'blocked') return 'blocked';
  if (riskLevel === 'critical' || riskLevel === 'high') return 'full';
  if (riskLevel === 'medium') return 'focused';
  return 'smoke';
}

function module(seed: DecisionSeed): QaStrategyModuleDecision {
  return {
    ...seed,
    requiredInputs: uniq(seed.requiredInputs ?? []),
    evidenceRefs: uniq(seed.evidenceRefs ?? []),
    commandHints: uniq(seed.commandHints ?? [])
  };
}

function testDataReady(input: QaStrategyInput): boolean {
  return input.testData.enabled && input.testData.status === 'passed' && input.testData.summary.recordCount > 0 && input.testData.summary.missingCleanupCount === 0 && input.testData.summary.productionRiskCount === 0;
}

function buildModules(input: QaStrategyInput): QaStrategyModuleDecision[] {
  const sourceRootMissing = !input.sourceAnalysis.root && input.sourceAnalysis.status === 'skipped';
  const sourceScriptsDetected = input.sourceHealth.packageScripts.length > 0;
  const sourceScriptsMissing = sourceScriptsDetected && input.sourceHealth.scriptChecks.length === 0;
  const weakJourneyCount = input.journeyAssertionAudit.summary.pathOnlyJourneyCount + input.journeyAssertionAudit.summary.weaklyAssertedJourneyCount;
  const hasApi = input.apiContract.summary.endpointCount > 0 || input.network.requests.some((request) => String((request as { url?: string }).url ?? '').includes('/api/'));
  const hasRequirements = input.requirementCoverage.summary.providedCount > 0;
  const configuredScope = input.metadata.config.productContext.enabled && input.pageProfile.status === 'configured';
  const desktopOnly = input.metadata.config.productContext.deviceScope === 'desktop-only' || input.metadata.config.productContext.deviceScope === 'desktop-first';
  const mobileRequired = input.metadata.config.productContext.deviceScope === 'responsive' || input.metadata.config.productContext.deviceScope === 'mobile-first';
  const productionLike = input.environment.kind === 'production-like' || input.environment.kind === 'local-preview';
  const permissionSensitive = isPermissionSensitive(input);
  const mutating = hasMutatingOrDangerousFlow(input);

  const decisions: QaStrategyModuleDecision[] = [];

  decisions.push(module({
    module: 'runtime-smoke',
    decision: 'run',
    priority: 'P0',
    owner: 'test',
    reason: '每次页面 QA 都必须保留加载、DOM/screenshot、Console/Network、非破坏性交互探索，作为后续所有结论的最小证据底座。',
    evidenceRefs: ['pageModel', 'network', 'console', 'artifacts.screenshot'],
    commandHints: [commandQa(input, ' --sme --json-summary')]
  }));

  decisions.push(module({
    module: 'requirements',
    decision: hasRequirements ? (input.requirementCoverage.summary.highPriorityGapCount > 0 ? 'run' : 'already-covered') : 'run-if-input',
    priority: hasRequirements ? (input.requirementCoverage.summary.highPriorityGapCount > 0 ? 'P1' : 'P2') : 'P0',
    owner: hasRequirements ? 'test' : 'product',
    reason: hasRequirements
      ? `已有 ${input.requirementCoverage.summary.providedCount} 条显式需求；按 coverage/traceability 继续验证，不再凭页面外观猜业务意图。`
      : '缺少 PRD/验收标准时，功能“通过/失败”只能降级为页面可用性观察，避免把产品设计选择误报成缺陷。',
    requiredInputs: hasRequirements ? [] : ['PRD/验收标准 JSON 或 Markdown', '关键功能的 expectedTexts/selectors/apiPatterns/journeySteps'],
    evidenceRefs: ['requirementCoverage', 'traceability'],
    commandHints: hasRequirements ? ['frontlens traceability --report <result.json>'] : ['frontlens requirements synthesize --input <prd.md> --output requirements.json', commandQa(input, ' --requirements requirements.json')]
  }));

  decisions.push(module({
    module: 'journeys',
    decision: input.journeyTests.length === 0 || weakJourneyCount > 0 ? 'run-if-input' : input.journeyAssertionAudit.summary.runtimeVerifiedJourneyCount > 0 ? 'already-covered' : 'run',
    priority: input.journeyTests.length === 0 || weakJourneyCount > 0 ? 'P1' : 'P2',
    owner: 'test',
    reason: input.journeyTests.length === 0
      ? '没有可执行业务旅程，不能宣称完整业务功能验证；先录制/补断言。'
      : weakJourneyCount > 0
        ? `存在 ${weakJourneyCount} 条 path-only/weak journey，需要业务断言后再计入通过。`
        : '已有 runtime-verified journey，可作为业务路径证据复用。',
    requiredInputs: input.journeyTests.length === 0 || weakJourneyCount > 0 ? ['业务主路径步骤', 'expectVisible/expectText/expectUrl/expectRequest 断言', '角色和测试数据'] : [],
    evidenceRefs: ['journeyAssertionAudit', 'assertionSuggestions', 'testCases'],
    commandHints: [input.journeyTests.length === 0 ? `frontlens journey record --url ${JSON.stringify(input.summary.url)} --output journey.json` : 'frontlens assertion-suggestions --report <result.json>']
  }));

  decisions.push(module({
    module: 'api-contract',
    decision: hasApi ? (input.requirementCoverage.summary.providedCount > 0 || input.apiContract.schemaPath ? 'run' : 'run-if-input') : 'out-of-scope',
    priority: hasApi ? 'P1' : 'P3',
    owner: hasApi ? 'backend' : 'test',
    reason: hasApi
      ? '页面存在 API/Network 证据；接口契约应以显式 schema/需求为准，避免仅凭状态码或扫描注入结果定责。'
      : '未发现业务 API 证据，接口契约专项可跳过。',
    requiredInputs: hasApi && !input.apiContract.schemaPath && input.requirementCoverage.summary.providedCount === 0 ? ['OpenAPI/接口契约或需求中的 apiPatterns', '错误码/包络约定'] : [],
    evidenceRefs: ['network', 'apiContract', 'sourceRuntimeCorrelation'],
    commandHints: hasApi ? [commandQa(input, input.apiContract.schemaPath ? '' : ' --requirements requirements.json')] : []
  }));

  decisions.push(module({
    module: 'source-correlation',
    decision: sourceRootMissing ? 'run-if-input' : input.sourceRuntimeCorrelation.status === 'passed' ? 'already-covered' : 'run',
    priority: sourceRootMissing ? 'P1' : 'P2',
    owner: 'frontend',
    reason: sourceRootMissing
      ? '未提供 sourceRoot 时，只能保留运行时观察，不能稳定定位前端文件/行号。'
      : '已具备源码路径，可将运行时证据绑定到路由、组件、API 调用和错误态代码。',
    requiredInputs: sourceRootMissing ? ['前端 sourceRoot 路径'] : [],
    evidenceRefs: ['sourceAnalysis', 'sourceRuntimeCorrelation', 'rootCauseGroups.sourceLocations'],
    commandHints: sourceRootMissing ? [commandQa(input, ' --source-root <frontend-source-root>')] : ['frontlens inspect --report <result.json>']
  }));

  decisions.push(module({
    module: 'source-scripts',
    decision: sourceScriptsMissing ? 'run-if-input' : input.sourceHealth.status === 'failed' ? 'run' : sourceScriptsDetected ? 'already-covered' : 'out-of-scope',
    priority: sourceScriptsMissing || input.sourceHealth.status === 'failed' ? 'P1' : 'P3',
    owner: 'frontend',
    reason: sourceScriptsMissing
      ? '检测到 package scripts 但未执行 typecheck/lint/build/test，发布级结论应先补本地脚本证据。'
      : input.sourceHealth.status === 'failed'
        ? '源码健康检查存在失败项，需先修复或明确接受。'
        : sourceScriptsDetected
          ? '源码脚本已执行并可作为静态质量证据。'
          : '未检测到可执行脚本，跳过源码脚本门禁。',
    requiredInputs: sourceScriptsMissing ? ['允许执行非破坏性 source scripts（typecheck,lint,build/test 可按需）'] : [],
    evidenceRefs: ['sourceHealth'],
    commandHints: sourceScriptsMissing ? [commandQa(input, ' --source-run-scripts --source-scripts typecheck,lint')] : []
  }));

  decisions.push(module({
    module: 'accessibility',
    decision: input.metadata.config.productContext.accessibilityTarget === 'unknown' ? 'run-if-input' : 'run',
    priority: input.metadata.config.productContext.accessibilityTarget === 'unknown' ? 'P2' : 'P1',
    owner: 'test',
    reason: input.metadata.config.productContext.accessibilityTarget === 'unknown'
      ? 'a11y 可继续作为 WCAG/交互基础扫描，但是否把样式/目标尺寸升级为缺陷需产品确认目标。'
      : `产品范围声明 a11y target=${input.metadata.config.productContext.accessibilityTarget}，按该目标执行。`,
    requiredInputs: input.metadata.config.productContext.accessibilityTarget === 'unknown' ? ['a11y 目标（basic / WCAG AA / WCAG AAA）'] : [],
    evidenceRefs: ['accessibilityChecks', 'pageProfile', 'scopeReview'],
    commandHints: ['frontlens qa --url <url> --config <product-context.config.json>']
  }));

  decisions.push(module({
    module: 'responsive',
    decision: mobileRequired ? 'run' : configuredScope && desktopOnly ? 'out-of-scope' : 'run-if-input',
    priority: mobileRequired ? 'P1' : 'P3',
    owner: configuredScope ? 'product' : 'test',
    reason: mobileRequired
      ? '产品范围要求响应式/移动端，需要验证断点和触控体验。'
      : configuredScope && desktopOnly
        ? `产品范围为 ${input.metadata.config.productContext.deviceScope}，移动端触控尺寸类问题仅记录为可选体验，不进缺陷队列。`
        : '缺少设备范围，触控目标/断点问题应先作为 scope question，避免把设计取舍当缺陷。',
    requiredInputs: mobileRequired || (configuredScope && desktopOnly) ? [] : ['支持设备范围（desktop-only / desktop-first / responsive / mobile-first）'],
    evidenceRefs: ['responsiveChecks', 'scopeReview'],
    commandHints: mobileRequired ? [commandQa(input)] : ['frontlens product-context --report <result.json>']
  }));

  decisions.push(module({
    module: 'performance',
    decision: productionLike ? 'run' : 'run-if-input',
    priority: productionLike ? 'P2' : 'P3',
    owner: 'frontend',
    reason: productionLike
      ? '目标环境接近构建产物，性能/coverage/bundle 证据可用于优化判断。'
      : '当前目标是本地/私网/dev-like；模块请求、HMR、源码传输会污染性能结论，需 build/preview 或 env-compare 后再定责。',
    requiredInputs: productionLike ? [] : ['build/preview URL 或生产类环境 URL', '性能预算（如存在）'],
    evidenceRefs: ['environment', 'coverage', 'p2'],
    commandHints: productionLike ? ['frontlens coverage --report <result.json>'] : [commandEnvCompare(input)]
  }));

  decisions.push(module({
    module: 'security-passive',
    decision: productionLike ? 'run' : 'run-if-input',
    priority: productionLike || permissionSensitive ? 'P1' : 'P3',
    owner: 'security',
    reason: productionLike
      ? '生产类响应头、Cookie、传输安全可作为被动安全证据。'
      : 'dev/local 环境的源码模块、HMR、HTTP、缺响应头多为环境噪声；安全缺陷需在 preview/staging/production-like 环境确认。',
    requiredInputs: productionLike ? [] : ['preview/staging/production-like URL', '部署层安全头/HTTPS 配置归属'],
    evidenceRefs: ['environment', 'security'],
    commandHints: productionLike ? ['frontlens security --report <result.json>'] : [commandEnvCompare(input)]
  }));

  decisions.push(module({
    module: 'exception-simulation',
    decision: input.exceptionSimulations.length > 0 ? 'already-covered' : 'run',
    priority: 'P1',
    owner: 'frontend',
    reason: input.exceptionSimulations.length > 0
      ? '异常注入已执行；失败项需结合源码错误态和截图/DOM 定责。'
      : '加载失败、500/404/timeout 是专业前端 QA 的基础健壮性用例，默认执行。',
    evidenceRefs: ['exceptionSimulations', 'defectProof', 'sourceRuntimeCorrelation'],
    commandHints: [commandQa(input, ' --simulate-exceptions')]
  }));

  decisions.push(module({
    module: 'role-matrix',
    decision: permissionSensitive ? 'run-if-input' : input.permissionChecks.length > 0 ? 'already-covered' : 'out-of-scope',
    priority: permissionSensitive ? 'P1' : 'P3',
    owner: 'test',
    reason: permissionSensitive
      ? '凭证/权限/管理页面需要多角色访问矩阵；无 storageState 时不能验证权限边界。'
      : '页面未显现权限敏感动作，角色矩阵可不做。',
    requiredInputs: permissionSensitive ? ['admin/viewer/readonly 等角色 storageState', '允许/禁止文本或接口规则'] : [],
    evidenceRefs: ['permissionChecks', 'pageProfile', 'qaPlan'],
    commandHints: permissionSensitive ? [commandRoleMatrix(input)] : []
  }));

  decisions.push(module({
    module: 'test-data',
    decision: mutating ? (testDataReady(input) ? 'already-covered' : 'run-if-input') : 'out-of-scope',
    priority: mutating ? 'P1' : 'P3',
    owner: mutating ? 'test' : 'product',
    reason: mutating
      ? (testDataReady(input) ? '测试数据记录、setup/cleanup 已就绪，可安全验证增删改/导入导出类流程。' : '页面/需求包含写入或下载导出类流程，缺测试数据生命周期时不能宣称业务验证通过。')
      : '未发现写入/导入导出/提交类流程，测试数据专项可跳过。',
    requiredInputs: mutating && !testDataReady(input) ? ['隔离测试记录', 'setup/cleanup/rollback 步骤', '是否允许生产写入'] : [],
    evidenceRefs: ['testData', 'qaIntake'],
    commandHints: mutating && !testDataReady(input) ? [commandQa(input, ' --config qa-intake.config.json')] : []
  }));

  decisions.push(module({
    module: 'env-compare',
    decision: isLocalLike(input.environment) ? 'run-if-input' : 'already-covered',
    priority: isLocalLike(input.environment) ? 'P2' : 'P3',
    owner: 'test',
    reason: isLocalLike(input.environment)
      ? '当前目标为 local/private/dev-like；需与 build/preview 对比后才能采信生产性能、安全头和打包形态。'
      : '当前环境已较接近生产，env-compare 不是必须项。',
    requiredInputs: isLocalLike(input.environment) ? ['preview/build URL'] : [],
    evidenceRefs: ['environment'],
    commandHints: isLocalLike(input.environment) ? [commandEnvCompare(input)] : []
  }));

  decisions.push(module({
    module: 'automation',
    decision: input.automationSpecs.status === 'ready' ? 'already-covered' : input.automationSpecs.status === 'skipped' ? 'run-if-input' : 'run-if-input',
    priority: input.automationSpecs.summary.needsInputCount > 0 || input.automationSpecs.status !== 'ready' ? 'P2' : 'P3',
    owner: 'test',
    reason: input.automationSpecs.status === 'ready'
      ? '已生成 review-only 自动化草案；执行前仍需测试工程师校验选择器、角色、数据和安全边界。'
      : '自动化草案缺少可执行断言/测试数据/需求输入，不能替代已执行回归。',
    requiredInputs: input.automationSpecs.status === 'ready' ? [] : ['已审阅的 requirements/journeys/assertionSuggestions/testData'],
    evidenceRefs: ['automationSpecs', 'assertionSuggestions', 'traceability'],
    commandHints: ['frontlens automation-specs --report <result.json>']
  }));

  decisions.push(module({
    module: 'evidence-handoff',
    decision: input.evidenceBundle.status === 'blocked' || input.artifactIntegrity.status === 'failed' ? 'blocked' : input.evidenceBundle.status === 'ready' ? 'already-covered' : 'run-if-input',
    priority: input.evidenceBundle.status === 'blocked' || input.artifactIntegrity.status === 'failed' ? 'P0' : 'P2',
    owner: 'test',
    reason: input.evidenceBundle.status === 'blocked' || input.artifactIntegrity.status === 'failed'
      ? '存在缺失截图/视频/下载/Markdown/JSON 路径，报告不能引用不存在的证据。'
      : input.evidenceBundle.status === 'ready'
        ? '证据包可分享；缺陷、失败用例、traceability gaps 与本地 artifact 可用性已索引。'
        : '证据包仍需补 artifact 或 proof-ready 票据后再作为专业移交材料。',
    requiredInputs: input.evidenceBundle.status === 'blocked' || input.artifactIntegrity.status === 'failed' ? ['重新生成缺失 artifact 或删除无效引用'] : [],
    evidenceRefs: ['artifactIntegrity', 'evidenceBundle'],
    commandHints: ['frontlens artifact-integrity --report <result.json>', 'frontlens evidence-bundle --report <result.json>']
  }));

  return sortModules(decisions);
}

function mapIntakeQuestion(input: QaStrategyInput, question: QaStrategyInput['qaIntake']['questions'][number], index: number): QaStrategyQuestion {
  const categoryToModules: Partial<Record<QaIntakeCategory, QaStrategyModule[]>> = {
    requirements: ['requirements', 'journeys', 'automation'],
    'product-scope': ['responsive', 'accessibility', 'requirements'],
    'role-auth': ['role-matrix'],
    'test-data': ['test-data', 'journeys'],
    environment: ['env-compare', 'performance', 'security-passive'],
    'source-health': ['source-correlation', 'source-scripts'],
    journey: ['journeys', 'automation'],
    'artifact-integrity': ['evidence-handoff'],
    regression: ['automation', 'source-scripts'],
    'claim-guard': ['requirements', 'evidence-handoff'],
    'download-export': ['test-data', 'journeys']
  };
  return {
    id: `STR-Q-${String(index + 1).padStart(3, '0')}`,
    priority: question.priority,
    category: question.category,
    question: question.question,
    reason: question.why || '补齐该输入后才能提升报告可信度和签核结论。',
    unblocks: categoryToModules[question.category] ?? ['requirements']
  };
}

function buildQuestions(input: QaStrategyInput, modules: QaStrategyModuleDecision[]): QaStrategyQuestion[] {
  const questions = input.qaIntake.topQuestions.slice(0, 8).map((question, index) => mapIntakeQuestion(input, question, index));
  const existing = new Set(questions.map((question) => question.category));
  const add = (question: Omit<QaStrategyQuestion, 'id'>) => {
    questions.push({ ...question, id: `STR-Q-${String(questions.length + 1).padStart(3, '0')}` });
  };
  if (modules.some((item) => item.module === 'env-compare' && item.decision === 'run-if-input') && !existing.has('environment')) {
    add({ priority: 'P2', category: 'environment', question: '请提供 build/preview/staging URL，用于过滤 Vite dev/HMR/源码模块带来的性能和安全噪声。', reason: '生产打包、响应头、HTTPS、缓存和 bundle 体积只能在生产类环境采信。', unblocks: ['env-compare', 'performance', 'security-passive'] });
  }
  if (modules.some((item) => item.module === 'role-matrix' && item.decision === 'run-if-input') && !existing.has('role-auth')) {
    add({ priority: 'P1', category: 'role-auth', question: '请提供至少 admin/viewer 两类 storageState 与允许/禁止动作期望。', reason: '权限敏感页面无法通过单角色静态扫描验证访问控制。', unblocks: ['role-matrix'] });
  }
  if (modules.some((item) => item.module === 'test-data' && item.decision === 'run-if-input') && !existing.has('test-data')) {
    add({ priority: 'P1', category: 'test-data', question: '请提供隔离测试记录、setup/cleanup/rollback 规则，以及是否允许写生产数据。', reason: '没有数据生命周期时，增删改/导入导出流程只能作为待测项，不能宣称通过。', unblocks: ['test-data', 'journeys'] });
  }
  return questions.slice(0, 12);
}

function buildEnvironmentPlans(input: QaStrategyInput): QaStrategyEnvironmentPlan[] {
  const plans: QaStrategyEnvironmentPlan[] = [
    {
      kind: envKindForPlan(input.environment),
      purpose: '当前 URL：用于功能冒烟、DOM/Console/Network、源码关联和异常反馈验证。',
      trust: input.environment.trust.functional,
      required: true,
      commandHint: commandQa(input)
    }
  ];
  if (isLocalLike(input.environment)) {
    plans.push({
      kind: 'preview',
      purpose: '生产类 build/preview：用于性能、bundle/coverage、安全响应头、CSP/HTTPS/缓存等结论。',
      trust: 'high',
      required: true,
      commandHint: commandEnvCompare(input)
    });
  }
  if (isPermissionSensitive(input)) {
    plans.push({
      kind: 'staging',
      purpose: '带真实角色/权限矩阵的安全测试环境：用于 role-matrix 与敏感操作授权验证。',
      trust: 'high',
      required: true,
      commandHint: commandRoleMatrix(input)
    });
  }
  return plans;
}

function buildNextCommands(input: QaStrategyInput, modules: QaStrategyModuleDecision[]): string[] {
  const commands = modules.flatMap((item) => item.commandHints).filter(Boolean);
  return uniq([
    commandQa(input, ' --sme --json-summary'),
    ...commands,
    'frontlens test-strategy --report <result.json>',
    'frontlens brief --report <result.json>'
  ]).slice(0, 12);
}

export function buildQaStrategy(input: QaStrategyInput): QaStrategyResult {
  const modules = buildModules(input);
  const questions = buildQuestions(input, modules);
  const status = decideStatus(input, modules, questions);
  const riskLevel = decideRisk(input);
  const recommendedRunMode = runMode(status, riskLevel);
  const runCount = modules.filter((item) => item.decision === 'run').length;
  const runIfInputCount = modules.filter((item) => item.decision === 'run-if-input').length;
  const outOfScopeCount = modules.filter((item) => item.decision === 'out-of-scope').length;
  const blockedCount = modules.filter((item) => item.decision === 'blocked').length;
  const requiredInputCount = modules.reduce((count, item) => count + item.requiredInputs.length, 0) + questions.length;
  const notes = [
    'QA strategy is a planning gate: it decides what evidence is required before conclusions are promoted, not a replacement for executed runtime tests.',
    'Modules marked run-if-input should be asked or encoded into productContext/requirements/testData/storageState before rerun; do not guess product intent.',
    'Dev/local/private targets are valid for functional/source correlation but not for production bundle/security-header sign-off unless env-compare or preview evidence exists.'
  ];
  if (input.scopeReview.status === 'needs-input') {
    notes.push('Product/device/a11y scope is incomplete; style, layout density, pagination/export, and touch-target findings should stay conditional until scope is confirmed.');
  }
  if (input.evidenceBundle.status === 'blocked') {
    notes.push('Evidence bundle is blocked: fix missing artifact references before sharing screenshots/videos/download paths.');
  }

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      targetUrl: input.summary.url,
      pageType: input.pageProfile.pageType,
      riskLevel,
      recommendedRunMode,
      runCount,
      runIfInputCount,
      outOfScopeCount,
      blockedCount,
      requiredInputCount
    },
    modules,
    environments: buildEnvironmentPlans(input),
    questions,
    nextCommands: buildNextCommands(input, modules),
    notes
  };
}

function formatList(items: string[]): string {
  return items.length ? items.map((item) => `- ${markdownEscape(item)}`).join('<br>') : '-';
}

export function formatQaStrategy(strategy: QaStrategyResult): string {
  const moduleRows = strategy.modules.map((item) => `| ${markdownEscape(item.priority)} | ${markdownEscape(item.module)} | ${markdownEscape(item.decision)} | ${markdownEscape(item.owner)} | ${markdownEscape(truncateMiddle(item.reason, 140))} | ${formatList(item.requiredInputs)} | ${formatList(item.commandHints.slice(0, 2))} |`);
  const questionRows = strategy.questions.map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.priority)} | ${markdownEscape(item.category)} | ${markdownEscape(truncateMiddle(item.question, 160))} | ${markdownEscape(truncateMiddle(item.reason, 140))} | ${markdownEscape(item.unblocks.join(', '))} |`);
  const envRows = strategy.environments.map((item) => `| ${markdownEscape(item.kind)} | ${item.required ? 'yes' : 'no'} | ${markdownEscape(item.trust)} | ${markdownEscape(truncateMiddle(item.purpose, 160))} | ${markdownEscape(item.commandHint ?? '-')} |`);
  const commandLines = strategy.nextCommands.map((command) => `- \`${markdownEscape(command)}\``).join('\n');
  const notes = strategy.notes.map((note) => `- ${markdownEscape(note)}`).join('\n');

  return `# FrontLens QA Test Strategy

## Summary

- Status: **${strategy.status}**
- Target: ${markdownEscape(strategy.summary.targetUrl)}
- Page type / risk / run mode: **${strategy.summary.pageType}** / **${strategy.summary.riskLevel}** / **${strategy.summary.recommendedRunMode}**
- Module decisions: run ${strategy.summary.runCount} / run-if-input ${strategy.summary.runIfInputCount} / out-of-scope ${strategy.summary.outOfScopeCount} / blocked ${strategy.summary.blockedCount}
- Required inputs/questions: ${strategy.summary.requiredInputCount}

## Module decisions

${moduleRows.length ? ['| Pri | Module | Decision | Owner | Reason | Required inputs | Command hints |', '| --- | --- | --- | --- | --- | --- | --- |', ...moduleRows, ''].join('\n') : 'No strategy modules were generated.'}

## Environment plan

${envRows.length ? ['| Environment | Required | Trust | Purpose | Command |', '| --- | --- | --- | --- | --- |', ...envRows, ''].join('\n') : 'No environment plan was generated.'}

## Questions to unblock higher-confidence QA

${questionRows.length ? ['| ID | Pri | Category | Question | Reason | Unblocks |', '| --- | --- | --- | --- | --- | --- |', ...questionRows, ''].join('\n') : 'No blocking questions. Continue with the recommended run mode.'}

## Next commands

${commandLines || '- None'}

## Notes

${notes}
`;
}
