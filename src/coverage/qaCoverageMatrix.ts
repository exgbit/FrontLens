import type { QaCoverageMatrixItem, QaCoverageMatrixResult, QaResult } from '../types.js';

export type QaCoverageMatrixInput = Pick<
  QaResult,
  | 'pageModel'
  | 'network'
  | 'console'
  | 'requirementCoverage'
  | 'journeyTests'
  | 'interactionTests'
  | 'exceptionSimulations'
  | 'apiContract'
  | 'realtime'
  | 'sourceAnalysis'
  | 'sourceRuntimeCorrelation'
  | 'sourceHealth'
  | 'accessibilityChecks'
  | 'responsiveChecks'
  | 'coverage'
  | 'p2'
  | 'security'
  | 'environment'
  | 'pageProfile'
  | 'scopeReview'
  | 'testData'
  | 'artifactIntegrity'
  | 'issueDisposition'
  | 'rootCauseGroups'
  | 'defectProof'
  | 'qaSignoff'
>;

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function countByStatus(items: QaCoverageMatrixItem[], status: QaCoverageMatrixItem['status']): number {
  return items.filter((item) => item.status === status).length;
}

function add(items: QaCoverageMatrixItem[], item: Omit<QaCoverageMatrixItem, 'id'>): void {
  const id = `COV-${String(items.length + 1).padStart(3, '0')}`;
  items.push({
    ...item,
    id,
    evidenceRefs: unique(item.evidenceRefs),
    covered: unique(item.covered),
    gaps: unique(item.gaps),
    nextSteps: unique(item.nextSteps)
  });
}

function moduleStatus(enabled: boolean, failed: boolean, partial: boolean): QaCoverageMatrixItem['status'] {
  if (!enabled) return 'skipped';
  if (failed) return 'failed';
  if (partial) return 'partial';
  return 'covered';
}

export function buildQaCoverageMatrix(result: QaCoverageMatrixInput): QaCoverageMatrixResult {
  const items: QaCoverageMatrixItem[] = [];

  add(items, {
    area: 'runtime',
    title: '页面加载 / DOM / 截图基础证据',
    status: result.pageModel.stats.domNodes > 0 ? 'covered' : 'failed',
    confidence: result.pageModel.stats.domNodes > 0 ? 'high' : 'low',
    evidenceRefs: ['pageModel', 'artifacts.screenshot', 'artifacts.domSnapshot'],
    covered: result.pageModel.stats.domNodes > 0 ? [`DOM nodes: ${result.pageModel.stats.domNodes}`, `components: ${result.pageModel.components.length}`] : [],
    gaps: result.pageModel.stats.domNodes > 0 ? [] : ['页面 DOM 未成功采集。'],
    nextSteps: result.pageModel.stats.domNodes > 0 ? [] : ['确认 URL、鉴权状态、网络和页面启动状态后重跑。']
  });

  add(items, {
    area: 'api-network',
    title: 'Network / Console 基础运行证据',
    status: result.network.requests.length > 0 || result.console.messages.length > 0 ? 'covered' : 'partial',
    confidence: 'high',
    evidenceRefs: ['network.requests', 'console.messages', 'console.pageErrors'],
    covered: [`requests: ${result.network.requests.length}`, `console errors: ${result.console.errors.length}`, `page errors: ${result.console.pageErrors.length}`],
    gaps: result.network.requests.length === 0 ? ['未捕获到网络请求；可能是静态页、缓存、或采集过早。'] : [],
    nextSteps: result.console.pageErrors.length > 0 ? ['优先复核 pageErrors 是否阻断核心路径。'] : []
  });

  const req = result.requirementCoverage;
  add(items, {
    area: 'requirements',
    title: 'PRD / 验收标准覆盖',
    status: req.source === 'provided' && req.summary.highPriorityGapCount === 0 ? 'covered' : req.source === 'none' || req.source === 'inferred' ? 'needs-input' : 'partial',
    confidence: req.source === 'provided' ? 'high' : req.source === 'mixed' ? 'medium' : 'low',
    evidenceRefs: ['requirementCoverage'],
    covered: [`requirements: ${req.summary.requirementCount}`, `provided: ${req.summary.providedCount}`, `passed: ${req.summary.passedCount}`],
    gaps: [...req.gaps.slice(0, 6), req.source !== 'provided' ? '缺少已确认 PRD/验收标准；页面推断能力不能代表业务通过。' : ''].filter(Boolean),
    nextSteps: req.source === 'provided' ? ['补齐 not-covered/partial/failed 的需求运行证据。'] : ['提供 PRD/验收标准并运行 requirements synthesize 或 --requirements。']
  });

  const journeyCount = result.journeyTests.length;
  const failedJourneys = result.journeyTests.filter((item) => item.status === 'failed').length;
  const passedJourneys = result.journeyTests.filter((item) => item.status === 'passed').length;
  add(items, {
    area: 'journey',
    title: '用户旅程 / 业务路径',
    status: journeyCount === 0 ? 'skipped' : failedJourneys > 0 ? 'failed' : result.qaSignoff.scope.passedJourneyWithAssertionCount > 0 ? 'covered' : 'partial',
    confidence: result.qaSignoff.scope.passedJourneyWithAssertionCount > 0 ? 'high' : journeyCount > 0 ? 'medium' : 'low',
    evidenceRefs: ['journeyTests', 'qaSignoff.scope'],
    covered: [`journeys: ${journeyCount}`, `passed: ${passedJourneys}`, `passed with assertion: ${result.qaSignoff.scope.passedJourneyWithAssertionCount}`],
    gaps: journeyCount === 0 ? ['没有执行用户旅程。'] : result.qaSignoff.scope.passedJourneyWithAssertionCount === 0 ? ['没有带 expect 断言的通过旅程，不能证明业务成功。'] : [],
    nextSteps: result.qaSignoff.scope.passedJourneyWithAssertionCount > 0 ? [] : ['录制核心业务路径并补 expectVisible/expectText/expectUrl/expectRequest。']
  });

  const interactionCount = result.interactionTests.length;
  const failedInteractions = result.interactionTests.filter((item) => item.status === 'failed').length;
  add(items, {
    area: 'interaction',
    title: '安全非破坏交互探索',
    status: interactionCount === 0 ? 'skipped' : failedInteractions > 0 ? 'failed' : result.interactionTests.some((item) => item.status === 'passed') ? 'covered' : 'partial',
    confidence: interactionCount > 0 ? 'medium' : 'low',
    evidenceRefs: ['interactionTests'],
    covered: [`interaction tests: ${interactionCount}`, `failed: ${failedInteractions}`],
    gaps: interactionCount === 0 ? ['没有安全交互探索结果。'] : result.interactionTests.every((item) => item.status === 'skipped') ? ['交互测试均 skipped；不能说明搜索/表单/抽屉/下载已验证。'] : [],
    nextSteps: interactionCount === 0 || result.interactionTests.every((item) => item.status === 'skipped') ? ['为关键交互提供 journey 或稳定 selector。'] : []
  });

  const exceptionCount = result.exceptionSimulations.length;
  const failedExceptions = result.exceptionSimulations.filter((item) => item.status === 'failed').length;
  add(items, {
    area: 'exception',
    title: '异常 / 失败态模拟',
    status: exceptionCount === 0 ? 'skipped' : failedExceptions > 0 ? 'failed' : 'covered',
    confidence: exceptionCount > 0 ? 'high' : 'low',
    evidenceRefs: ['exceptionSimulations'],
    covered: [`exception simulations: ${exceptionCount}`, `failed: ${failedExceptions}`],
    gaps: exceptionCount === 0 ? ['未执行 500/404/timeout/offline 等异常模拟。'] : [],
    nextSteps: failedExceptions > 0 ? ['复核失败态是否有可见错误提示和重试入口。'] : []
  });

  add(items, {
    area: 'api-network',
    title: 'API Contract / 数据契约',
    status: moduleStatus(result.apiContract.enabled, (result.apiContract.summary.statusMismatchCount + result.apiContract.summary.schemaMismatchCount) > 0, result.apiContract.summary.endpointCount === 0),
    confidence: result.apiContract.enabled ? 'medium' : 'low',
    evidenceRefs: ['apiContract'],
    covered: [`endpoints: ${result.apiContract.summary.endpointCount}`, `mismatches: ${result.apiContract.summary.statusMismatchCount + result.apiContract.summary.schemaMismatchCount}`],
    gaps: result.apiContract.enabled && result.apiContract.summary.endpointCount === 0 ? ['未识别到可分析 API endpoint。'] : !result.apiContract.enabled ? ['API contract 模块未启用。'] : [],
    nextSteps: (result.apiContract.summary.statusMismatchCount + result.apiContract.summary.schemaMismatchCount) > 0 ? ['结合真实 OpenAPI/后端包络约定复核 contract drift。'] : []
  });

  add(items, {
    area: 'source',
    title: '源码健康 / 源码运行时关联',
    status: result.sourceAnalysis.enabled ? result.sourceHealth.status === 'failed' ? 'failed' : result.sourceRuntimeCorrelation.status === 'passed' ? 'covered' : 'partial' : 'skipped',
    confidence: result.sourceAnalysis.enabled ? 'high' : 'low',
    evidenceRefs: ['sourceAnalysis', 'sourceRuntimeCorrelation', 'sourceHealth'],
    covered: [`source files: ${result.sourceAnalysis.scannedFiles}`, `runtime links: ${result.sourceRuntimeCorrelation.summary.linkedRequestCount}`, `source health: ${result.sourceHealth.status}`],
    gaps: result.sourceAnalysis.enabled ? result.sourceRuntimeCorrelation.gaps.slice(0, 5) : ['未提供 sourceRoot，无法做 file:line 级源码复核。'],
    nextSteps: result.sourceAnalysis.enabled ? ['对 needs-evidence 前端缺陷补 medium/high source-runtime 绑定。'] : ['使用 --source-root 指向前端仓库。']
  });

  add(items, {
    area: 'accessibility',
    title: 'Accessibility / 可访问性',
    status: result.accessibilityChecks.length === 0 ? 'skipped' : result.accessibilityChecks.some((item) => item.status === 'failed') ? 'failed' : 'covered',
    confidence: result.accessibilityChecks.length > 0 ? 'medium' : 'low',
    evidenceRefs: ['accessibilityChecks'],
    covered: [`checks: ${result.accessibilityChecks.length}`],
    gaps: result.accessibilityChecks.length === 0 ? ['未执行可访问性检查。'] : [],
    nextSteps: result.accessibilityChecks.some((item) => item.status === 'failed') ? ['按 selector 和源码 file:line 复核 a11y 问题。'] : []
  });

  add(items, {
    area: 'responsive',
    title: 'Responsive / 视口适配',
    status: result.responsiveChecks.length === 0 ? 'skipped' : result.responsiveChecks.some((item) => item.horizontalOverflow || item.clippedInteractiveCount > 0) ? 'failed' : 'covered',
    confidence: result.responsiveChecks.length > 0 ? 'medium' : 'low',
    evidenceRefs: ['responsiveChecks'],
    covered: [`viewports: ${result.responsiveChecks.length}`],
    gaps: result.responsiveChecks.length === 0 ? ['未执行响应式视口检查。'] : [],
    nextSteps: result.responsiveChecks.some((item) => item.horizontalOverflow || item.clippedInteractiveCount > 0) ? ['按 productContext.deviceScope 判断是缺陷还是产品取舍。'] : []
  });

  add(items, {
    area: 'performance',
    title: 'Performance / Coverage / P2',
    status: result.coverage.status === 'failed' || result.p2.visual.status === 'failed' || result.p2.budgets.some((item) => item.status === 'failed') ? 'failed' : result.coverage.status === 'skipped' && !result.p2.enabled ? 'skipped' : 'covered',
    confidence: result.environment.trust.performance === 'high' ? 'high' : 'medium',
    evidenceRefs: ['coverage', 'p2', 'performance', 'environment'],
    covered: [`coverage: ${result.coverage.status}`, `p2 visual: ${result.p2.visual.status}`, `budgets failed: ${result.p2.budgets.filter((item) => item.status === 'failed').length}`],
    gaps: result.environment.trust.performance !== 'high' ? ['当前环境不足以支持生产性能结论。'] : [],
    nextSteps: result.environment.trust.performance !== 'high' ? ['用 build/preview 或 production-like URL 复测性能。'] : []
  });

  add(items, {
    area: 'security',
    title: 'Passive security / 部署安全',
    status: result.security.status === 'failed' ? 'failed' : result.security.status === 'skipped' ? 'skipped' : 'covered',
    confidence: result.environment.trust.security === 'high' ? 'high' : 'medium',
    evidenceRefs: ['security', 'environment'],
    covered: [`security status: ${result.security.status}`, `score: ${result.security.score}`],
    gaps: result.environment.trust.security !== 'high' ? ['当前环境不足以支持生产安全响应头/TLS 结论。'] : [],
    nextSteps: result.environment.trust.security !== 'high' ? ['在生产等价 HTTPS/网关环境复测安全头。'] : []
  });

  add(items, {
    area: 'environment',
    title: '环境可信度',
    status: result.environment.trust.functional === 'high' && result.environment.trust.businessSignoff === 'high' ? 'covered' : 'partial',
    confidence: result.environment.confidence,
    evidenceRefs: ['environment'],
    covered: [`kind: ${result.environment.kind}`, `functional: ${result.environment.trust.functional}`, `business: ${result.environment.trust.businessSignoff}`],
    gaps: result.environment.warnings.slice(0, 6),
    nextSteps: result.environment.recommendations.slice(0, 6)
  });

  add(items, {
    area: 'product-scope',
    title: '产品范围 / ADR / deviceScope',
    status: result.scopeReview.status === 'configured' ? 'covered' : 'needs-input',
    confidence: result.scopeReview.confidence,
    evidenceRefs: ['scopeReview', 'pageProfile', 'product-context.md', 'product-context.config.json'],
    covered: [`page type: ${result.pageProfile.pageType}`, `scope: ${result.scopeReview.status}`],
    gaps: result.scopeReview.questions.slice(0, 6).map((item) => item.question),
    nextSteps: result.scopeReview.status === 'configured' ? [] : ['审核 product-context.config.json 并用 --config 重跑。']
  });

  add(items, {
    area: 'test-data',
    title: '测试数据生命周期',
    status: result.testData.status === 'passed' || result.testData.status === 'skipped' ? result.testData.status === 'skipped' ? 'skipped' : 'covered' : result.testData.status === 'failed' ? 'failed' : 'partial',
    confidence: result.testData.status === 'passed' ? 'high' : 'medium',
    evidenceRefs: ['testData'],
    covered: [`records: ${result.testData.summary.recordCount}`, `setup: ${result.testData.summary.setupStepCount}`, `cleanup: ${result.testData.summary.cleanupStepCount}`],
    gaps: result.testData.findings.slice(0, 6).map((item) => item.message),
    nextSteps: result.testData.recommendations.slice(0, 6)
  });

  add(items, {
    area: 'artifact',
    title: '证据产物完整性',
    status: result.artifactIntegrity.status === 'passed' ? 'covered' : result.artifactIntegrity.status === 'failed' ? 'failed' : result.artifactIntegrity.status === 'warning' ? 'partial' : 'skipped',
    confidence: result.artifactIntegrity.status === 'passed' ? 'high' : 'medium',
    evidenceRefs: ['artifactIntegrity'],
    covered: [`present: ${result.artifactIntegrity.presentCount}`, `missing: ${result.artifactIntegrity.missingCount}`],
    gaps: result.artifactIntegrity.missing.slice(0, 6).map((item) => item.source),
    nextSteps: result.artifactIntegrity.status === 'failed' ? ['重新生成缺失截图/DOM/JSON sidecar，或移除无效引用。'] : []
  });

  add(items, {
    area: 'triage',
    title: '缺陷 triage / proof gate',
    status: result.defectProof.status === 'blocked' ? 'failed' : result.defectProof.status === 'needs-evidence' ? 'partial' : 'covered',
    confidence: result.defectProof.status === 'ready' ? 'high' : 'medium',
    evidenceRefs: ['issueDisposition', 'rootCauseGroups', 'defectProof'],
    covered: [`actionable: ${result.issueDisposition.summary.actionableCount}`, `root causes: ${result.rootCauseGroups.length}`, `proof-ready: ${result.defectProof.counts.proven + result.defectProof.counts.probable}`],
    gaps: result.defectProof.items.filter((item) => item.status === 'needs-evidence').slice(0, 6).flatMap((item) => item.missingEvidence.slice(0, 1)),
    nextSteps: result.defectProof.status === 'needs-evidence' ? ['补齐 runtime/source/requirement/product/repro/owner 证据，或降级为非缺陷。'] : []
  });

  const coveredCount = countByStatus(items, 'covered');
  const partialCount = countByStatus(items, 'partial');
  const skippedCount = countByStatus(items, 'skipped');
  const needsInputCount = countByStatus(items, 'needs-input');
  const failedCount = countByStatus(items, 'failed');
  const blockerCount = items.filter((item) => item.status === 'failed' || (item.status === 'needs-input' && (item.area === 'requirements' || item.area === 'journey'))).length;
  const status: QaCoverageMatrixResult['status'] = failedCount > 0 || needsInputCount > 2 ? 'insufficient' : partialCount > 0 || skippedCount > 0 || needsInputCount > 0 ? 'partial' : 'sufficient';
  const confidence: QaCoverageMatrixResult['confidence'] = status === 'sufficient' ? 'high' : status === 'partial' ? 'medium' : 'low';

  return {
    generatedAt: new Date().toISOString(),
    status,
    confidence,
    summary: {
      itemCount: items.length,
      coveredCount,
      partialCount,
      skippedCount,
      needsInputCount,
      failedCount,
      blockerCount
    },
    items,
    notes: [
      'Coverage matrix states what was actually exercised; it is not a pass/fail substitute for PRD-backed acceptance.',
      'Skipped or needs-input rows must remain coverage gaps in final wording, not passed features.',
      'Use qaPlan for the execution worklist that closes the gaps in this matrix.'
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

export function formatQaCoverageMatrix(matrix: QaCoverageMatrixResult): string {
  const rows = matrix.items.map((item) =>
    `| ${item.id} | ${item.area} | ${item.status} | ${item.confidence} | ${escapeMarkdown(truncate(item.title, 80))} | ${escapeMarkdown(truncate(item.covered.join('；') || '-', 120))} | ${escapeMarkdown(truncate(item.gaps.join('；') || '-', 120))} |`
  );
  const blockers = matrix.items.filter((item) => item.status === 'failed' || item.status === 'needs-input').map((item) => `${item.id} ${item.area}: ${item.title}`);
  return `# FrontLens QA Coverage Matrix

## Status

- Coverage status: **${matrix.status}** / confidence **${matrix.confidence}**
- Covered / partial / skipped / needs-input / failed: **${matrix.summary.coveredCount} / ${matrix.summary.partialCount} / ${matrix.summary.skippedCount} / ${matrix.summary.needsInputCount} / ${matrix.summary.failedCount}**
- Blocker-like gaps: **${matrix.summary.blockerCount}**

## Matrix

${['| ID | Area | Status | Confidence | Scope | Covered evidence | Gaps |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n')}

## Blocking / needs-input rows

${list(blockers)}

## Notes

${list(matrix.notes)}
`;
}
