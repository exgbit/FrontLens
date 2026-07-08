import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from 'playwright';
import { loadConfig } from './config.js';
import { ConsoleCollector } from './collectors/consoleCollector.js';
import { NetworkCollector } from './collectors/networkCollector.js';
import { EvidenceCollector } from './evidence/evidenceCollector.js';
import { PageExplorer } from './explorer/pageExplorer.js';
import { analyzeAll } from './analyzers/index.js';
import { writeReports } from './reporter.js';
import { applyAdjustedScore, buildSummary } from './summary.js';
import { SafeInteractionTester } from './interactions/safeInteractionTester.js';
import { ResponsiveTester } from './responsive/responsiveTester.js';
import { ExceptionTester } from './exceptions/exceptionTester.js';
import { AccessibilityChecker } from './accessibility/accessibilityChecker.js';
import { runAnalyzerPlugins } from './plugins/pluginManager.js';
import { PerformanceCollector, performanceInitScript } from './performance/performanceCollector.js';
import { runAiAnalyzer } from './ai/aiAnalyzer.js';
import { PermissionChecker } from './permissions/permissionChecker.js';
import { CoverageCollector, createEmptyCoverageResult } from './coverage/coverageCollector.js';
import { createEmptySecurityResult, runSecurityScanner } from './security/securityScanner.js';
import { JourneyTester } from './journeys/journeyTester.js';
import { analyzeApiContract } from './contract/apiContract.js';
import { RealtimeCollector, createEmptyRealtimeResult } from './realtime/realtimeCollector.js';
import { P2Tester, createEmptyP2Result } from './p2/p2Tester.js';
import { buildJourneyAssertionAudit } from './journeys/journeyAssertionAudit.js';
import { applySuggestionTemplates } from './fix/suggestionTemplates.js';
import { dedupeIssues } from './fix/issueDedupe.js';
import { generateFixTasks } from './fix/fixTasks.js';
import { buildQualityGate } from './qualityGate.js';
import { buildQaSignoff } from './signoff/qaSignoff.js';
import { buildEnvironmentAssessment } from './environment/environmentAssessment.js';
import { buildPageProfileAssessment } from './product/pageProfile.js';
import { buildScopeReview } from './product/scopeReview.js';
import { buildRequirementCoverage } from './requirements/requirementCoverage.js';
import { buildTestDataAssessment } from './testData/testDataAssessment.js';
import { buildRegressionPlan } from './regression/regressionPlan.js';
import { buildProfessionalSummary } from './summary/professionalSummary.js';
import { buildClaimGuard } from './claims/claimGuard.js';
import { buildQaIntake } from './intake/qaIntake.js';
import { buildQaExecutionPlan } from './plan/qaExecutionPlan.js';
import { buildQaCoverageMatrix } from './coverage/qaCoverageMatrix.js';
import { buildRiskRegister } from './risk/riskRegister.js';
import { buildRiskAcceptance } from './risk/riskAcceptance.js';
import { buildTestCaseMatrix } from './cases/testCases.js';
import { buildAssertionSuggestions } from './journeys/assertionSuggestions.js';
import { buildDefectTickets } from './tickets/defectTickets.js';
import { buildTraceabilityMatrix } from './traceability/traceabilityMatrix.js';
import { buildAutomationSpecs } from './automation/automationSpecs.js';
import { createSkippedReportContentAudit } from './audit/reportContentAudit.js';
import { buildDefectProof } from './proof/defectProof.js';
import { applyRequirementJourneySynthesis } from './requirements/requirementJourneys.js';
import { createEmptyArtifactIntegrity } from './artifacts/artifactIntegrity.js';
import { buildRootCauseGroups } from './rootCause/rootCauseGroups.js';
import { buildIssueDisposition, filterActionableIssues } from './disposition/issueDisposition.js';
import { analyzeSource, createEmptySourceAnalysis } from './source/sourceAnalyzer.js';
import { buildSourceRuntimeCorrelation, createEmptySourceRuntimeCorrelation } from './source/sourceRuntimeCorrelation.js';
import { analyzeSourceHealth, createEmptySourceHealth } from './source/sourceHealth.js';
import { sessionStorageSidecarPath } from './auth.js';
import type { AccessibilityCheckResult, ApiContractResult, ArtifactIndex, BrowserName, CoverageResult, DefectProofResult, EnvironmentAssessment, ExceptionSimulationResult, FixTask, FrontLensConfig, InteractionTestResult, Issue, JourneyTestResult, PageModel, PageProfileAssessment, P2TestResult, PerformanceMetrics, PermissionCheckResult, PhaseError, QaIntakeResult, QaResult, QaRunInput, RealtimeResult, ResourceRecord, ResponsiveCheckResult, ScopeReviewResult, SecurityScanResult, SourceAnalysisResult, SourceHealthResult, SourceRuntimeCorrelationResult, TestDataAssessmentResult } from './types.js';
import { ensureDir, resolveOutputDir, writeJson } from './utils/fs.js';
import { RESULT_SCHEMA_VERSION } from './resultNormalizer.js';
import { redactText, redactUrl } from './utils/redact.js';
import { isReadOnlyGraphqlOperation } from './utils/graphql.js';

const VERSION = '0.1.0';

function launcherFor(browserName: BrowserName) {
  switch (browserName) {
    case 'chromium':
      return chromium;
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
  }
}

function createRunOutputDir(config: FrontLensConfig, explicitOutput?: string): string {
  const base = resolveOutputDir(explicitOutput ?? config.report.outputDir);
  if (explicitOutput) {
    return base;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(base, stamp);
}

function createArtifacts(outputDir: string): ArtifactIndex {
  return {
    outputDir,
    videoDir: path.join(outputDir, 'videos')
  };
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function isReadOnlyGraphqlPost(url: string, headers: Record<string, string>, postData: string | null | undefined): boolean {
  const contentType = headers['content-type'] ?? headers['Content-Type'] ?? '';
  const body = parseJson(postData);
  const operations = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  if (!/graphql/i.test(url) && !/graphql/i.test(contentType) && operations.length === 0) {
    return false;
  }

  return operations.length > 0 && operations.every((operation) => {
    if (!operation || typeof operation !== 'object') {
      return false;
    }
    const item = operation as Record<string, unknown>;
    const query = item.query;
    const operationName = typeof item.operationName === 'string' ? item.operationName : undefined;
    if (typeof query !== 'string') {
      return false;
    }
    return isReadOnlyGraphqlOperation(query, operationName);
  });
}

function matchesAnyPattern(value: string, patterns: string[] | undefined): boolean {
  return (patterns ?? []).some((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(value);
    } catch {
      return value.toLowerCase().includes(pattern.toLowerCase());
    }
  });
}

export function shouldBlockMutatingRequest(config: FrontLensConfig, method: string, url = '', postData?: string | null, headers: Record<string, string> = {}): boolean {
  if (!config.safety.blockMutatingRequests) {
    return false;
  }
  const upper = method.toUpperCase();
  if (upper === 'POST' && matchesAnyPattern(url, config.safety.readOnlyPostPatterns)) {
    return false;
  }
  if (upper === 'POST' && isReadOnlyGraphqlPost(url, headers, postData)) {
    return false;
  }
  if (upper === 'POST' && !config.safety.allowSubmit && !config.safety.allowCreate && !config.safety.allowUpload) return true;
  if ((upper === 'PUT' || upper === 'PATCH') && !config.safety.allowEdit) return true;
  if (upper === 'DELETE' && !config.safety.allowDelete) return true;
  return false;
}

interface SessionStorageStateFile {
  sessionStorage?: Array<{
    origin: string;
    items: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function resolveSessionStorageState(config: FrontLensConfig): Promise<SessionStorageStateFile['sessionStorage']> {
  const candidates = [
    config.auth.sessionStorageState,
    config.auth.storageState ? sessionStorageSidecarPath(config.auth.storageState) : undefined
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    try {
      if (!(await fileExists(candidate))) {
        continue;
      }
      const parsed = JSON.parse(await readFile(candidate, 'utf8')) as SessionStorageStateFile;
      if (Array.isArray(parsed.sessionStorage)) {
        return parsed.sessionStorage;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

async function createContext(browser: Browser, config: FrontLensConfig, artifacts: ArtifactIndex): Promise<BrowserContext> {
  const options: BrowserContextOptions = {
    viewport: config.browser.viewport,
    locale: config.browser.locale,
    timezoneId: config.browser.timezoneId,
    storageState: config.auth.storageState,
    acceptDownloads: config.safety.allowDownload,
    recordVideo: config.report.video ? { dir: artifacts.videoDir ?? path.join(artifacts.outputDir, 'videos') } : undefined
  };

  const context = await browser.newContext(options);
  if (config.analysis.performance) {
    await context.addInitScript(performanceInitScript);
  }
  const sessionStorageEntries = await resolveSessionStorageState(config);
  if (sessionStorageEntries?.length) {
    await context.addInitScript((entries: NonNullable<SessionStorageStateFile['sessionStorage']>) => {
      const match = entries.find((entry) => entry.origin === location.origin);
      if (!match) return;
      for (const item of match.items) {
        try {
          window.sessionStorage.setItem(item.name, item.value);
        } catch {
          // Ignore quota/security errors for individual sessionStorage keys.
        }
      }
    }, sessionStorageEntries);
  }
  context.setDefaultTimeout(config.browser.timeoutMs);
  context.setDefaultNavigationTimeout(config.browser.timeoutMs);

  if (config.safety.blockMutatingRequests) {
    await context.route('**/*', async (route, request) => {
      if (shouldBlockMutatingRequest(config, request.method(), request.url(), request.postData(), request.headers())) {
        await route.abort('blockedbyclient');
      } else {
        await route.continue();
      }
    });
  }

  return context;
}

function emptyPageModel(url: string): PageModel {
  return {
    url,
    title: '',
    meta: {
      h1: [],
      openGraph: {}
    },
    breadcrumbs: [],
    headings: [],
    structureTree: '页面加载失败',
    components: [],
    forms: [],
    tables: [],
    buttons: [],
    inputs: [],
    images: [],
    links: [],
    stats: {
      domNodes: 0,
      visibleTextLength: 0,
      bodyTextSample: ''
    }
  };
}

function emptyPerformanceMetrics(): PerformanceMetrics {
  return {
    collectedAt: new Date().toISOString(),
    paint: {},
    longTasks: {
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0
    },
    layoutShift: {
      score: 0,
      count: 0
    },
    resources: {
      count: 0,
      totalTransferSize: 0,
      totalEncodedBodySize: 0,
      slowest: []
    },
    dom: {
      nodeCount: 0,
      maxDepth: 0
    },
    mutations: {
      count: 0
    }
  };
}

function createNavigationIssue(error: unknown, artifacts: ArtifactIndex): Issue {
  const message = redactText(error instanceof Error ? error.message : String(error));
  return {
    id: 'ISSUE-001',
    title: '页面打开失败或导航超时',
    category: 'frontend-routing',
    severity: 'critical',
    confidence: 0.96,
    description: message,
    evidence: {
      screenshot: artifacts.screenshot,
      details: {
        error: message
      }
    },
    reproduceSteps: ['使用 FrontLens 打开目标 URL', '等待页面导航完成', '观察导航错误或超时信息'],
    reason: '页面无法正常打开会阻断后续所有前端 QA 检查，常见原因包括 URL 不可达、登录态缺失、证书/网络错误或首屏脚本阻塞。',
    suggestion: {
      frontend: '检查路由、首屏脚本异常、登录跳转和错误页兜底。',
      backend: '确认目标服务、网关、DNS、证书和鉴权入口可用。',
      test: '补充目标 URL 的 smoke test 和登录态可用性检查。',
      priority: 'P0'
    },
    source: 'rule'
  };
}

function reindexIssues(issues: Issue[]): Issue[] {
  return issues.map((issue, index) => ({
    ...issue,
    id: `ISSUE-${String(index + 1).padStart(3, '0')}`
  }));
}

function exceptionNetworkRequestIds(exceptionSimulations: ExceptionSimulationResult[]): string[] {
  return exceptionSimulations.flatMap((item) => item.observations.networkRequestIds ?? []);
}

function emptyApiContract(config: FrontLensConfig): ApiContractResult {
  return {
    enabled: config.contract.enabled,
    schemaPath: config.contract.schemaPath,
    checkedAt: new Date().toISOString(),
    summary: {
      endpointCount: 0,
      undocumentedCount: 0,
      statusMismatchCount: 0,
      schemaMismatchCount: 0,
      inferredCount: 0
    },
    endpoints: []
  };
}

function toPhaseError(phase: string, error: unknown): PhaseError {
  return {
    phase,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timestamp: new Date().toISOString()
  };
}

async function safePhase<T>(phase: string, phaseErrors: PhaseError[], fallback: T, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    phaseErrors.push(toPhaseError(phase, error));
    return fallback;
  }
}

export async function runQa(input: QaRunInput): Promise<QaResult> {
  const started = Date.now();
  const config = await loadConfig(input);
  const outputDir = createRunOutputDir(config, input.outputDir);
  config.report.outputDir = outputDir;
  const artifacts = createArtifacts(outputDir);
  await ensureDir(outputDir);

  const browser = await launcherFor(config.browser.name).launch({
    headless: config.browser.headless
  });

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let pageModel: PageModel = emptyPageModel(config.target.url);
  let navigationError: unknown;
  const networkCollector = new NetworkCollector(config.analysis);
  const consoleCollector = new ConsoleCollector();
  const resourceRecords: ResourceRecord[] = [];
  let performanceMetrics: PerformanceMetrics = emptyPerformanceMetrics();
  let interactionTests: InteractionTestResult[] = [];
  let accessibilityChecks: AccessibilityCheckResult[] = [];
  let permissionChecks: PermissionCheckResult[] = [];
  let responsiveChecks: ResponsiveCheckResult[] = [];
  let journeyTests: JourneyTestResult[] = [];
  let exceptionSimulations: ExceptionSimulationResult[] = [];
  let coverage: CoverageResult = createEmptyCoverageResult(config, 'skipped', config.analysis.coverage ? 'Coverage was not collected.' : 'Coverage analysis disabled.');
  let security: SecurityScanResult = createEmptySecurityResult(config, config.security.enabled ? 'Security scan was not collected.' : 'Security analysis disabled.');
  let securityIssues: Issue[] = [];
  let apiContract: ApiContractResult = emptyApiContract(config);
  let contractIssues: Issue[] = [];
  let sourceAnalysis: SourceAnalysisResult = createEmptySourceAnalysis(config, config.source.enabled ? 'skipped' : 'skipped', config.source.enabled ? 'Source analysis was not collected.' : 'Source analysis disabled.');
  let sourceRuntimeCorrelation: SourceRuntimeCorrelationResult = createEmptySourceRuntimeCorrelation('skipped', config.source.enabled ? 'Source/runtime correlation was not collected.' : 'Source analysis disabled.');
  let sourceHealth: SourceHealthResult = createEmptySourceHealth(config, config.source.enabled ? 'skipped' : 'skipped', config.source.enabled ? 'Source health was not collected.' : 'Source analysis disabled.');
  let sourceIssues: Issue[] = [];
  let sourceHealthIssues: Issue[] = [];
  let realtime: RealtimeResult = createEmptyRealtimeResult(config);
  let p2: P2TestResult = createEmptyP2Result(config);
  let p2Issues: Issue[] = [];
  let p2NetworkRequestIds: string[] = [];
  let securityNetworkRequestIds: string[] = [];
  let interactionRestoreNetworkRequestIds: string[] = [];
  let interactionRestoreConsoleIds: string[] = [];
  let interactionRestorePageErrorIds: string[] = [];
  let exceptionPhaseNetworkRequestIds: string[] = [];
  let exceptionPhaseConsoleIds: string[] = [];
  let exceptionPhasePageErrorIds: string[] = [];
  const phaseErrors: PhaseError[] = [];
  const testedAt = new Date().toISOString();
  const coverageCollector = new CoverageCollector(config);
  const realtimeCollector = new RealtimeCollector(config);

  try {
    const sourceOutput = await safePhase('source.analyze', phaseErrors, { result: sourceAnalysis, issues: [] as Issue[] }, () => analyzeSource(config));
    sourceAnalysis = sourceOutput.result;
    sourceIssues = sourceOutput.issues;
    const sourceHealthOutput = await safePhase('source.health', phaseErrors, { result: sourceHealth, issues: [] as Issue[] }, () => analyzeSourceHealth(config));
    sourceHealth = sourceHealthOutput.result;
    sourceHealthIssues = sourceHealthOutput.issues;
    context = await createContext(browser, config, artifacts);
    realtimeCollector.attach(context);
    if (config.analysis.console) {
      consoleCollector.attachContext(context);
    }
    if (config.analysis.network || config.analysis.integration) {
      networkCollector.attach(context);
    }

    if (config.report.trace) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true
      });
      artifacts.trace = path.join(outputDir, 'trace.zip');
    }

    page = await context.newPage();
    const initialCoverage = await coverageCollector.start(page).catch((error: unknown) => createEmptyCoverageResult(config, 'failed', error instanceof Error ? error.message : String(error)));
    if (initialCoverage) {
      coverage = initialCoverage;
    }

    await page.goto(config.target.url, {
      waitUntil: config.browser.waitUntil,
      timeout: config.browser.timeoutMs
    }).catch((error: unknown) => {
      navigationError = error;
    });

    if (config.browser.extraWaitMs > 0) {
      await page.waitForTimeout(config.browser.extraWaitMs).catch(() => undefined);
    }

    const activePage = page;
    const activeContext = context;
    const evidence = new EvidenceCollector(config, artifacts);
    await safePhase('evidence.prepare', phaseErrors, undefined, () => evidence.prepare());
    pageModel = await safePhase('page.explore', phaseErrors, emptyPageModel(redactUrl(activePage.url() ?? config.target.url)), () => new PageExplorer().explore(activePage));
    applyRequirementJourneySynthesis(config, pageModel);
    performanceMetrics = config.analysis.performance ? await safePhase('performance.collect', phaseErrors, emptyPerformanceMetrics(), () => new PerformanceCollector().collect(activePage)) : emptyPerformanceMetrics();
    await safePhase('evidence.capture.initial', phaseErrors, undefined, () => evidence.capturePageArtifacts(activePage));
    if (config.analysis.resource) {
      resourceRecords.push(...(await safePhase('resources.collect.initial', phaseErrors, [], () => evidence.collectResources(activePage))));
    }
    interactionTests = await safePhase('interactions.run', phaseErrors, [], () =>
      new SafeInteractionTester({
        config,
        artifacts,
        getNetworkRecords: () => networkCollector.list(),
        getConsoleRecords: () => consoleCollector.getMessages(),
        getPageErrors: () => consoleCollector.getPageErrors()
      }).run(activePage, pageModel)
    );
    if (interactionTests.length > 0) {
      const restoreNetworkBefore = new Set(networkCollector.list().map((record) => record.id));
      const restoreConsoleBefore = new Set(consoleCollector.getMessages().map((record) => record.id));
      const restorePageErrorsBefore = new Set(consoleCollector.getPageErrors().map((record) => record.id));
      await safePhase('interactions.restore-page', phaseErrors, undefined, async () => {
        await activePage.goto(config.target.url, { waitUntil: config.browser.waitUntil, timeout: config.browser.timeoutMs });
        if (config.browser.extraWaitMs > 0) {
          await activePage.waitForTimeout(config.browser.extraWaitMs).catch(() => undefined);
        }
        await networkCollector.flush();
      });
      interactionRestoreNetworkRequestIds = networkCollector.list().filter((record) => !restoreNetworkBefore.has(record.id)).map((record) => record.id);
      interactionRestoreConsoleIds = consoleCollector.getMessages().filter((record) => !restoreConsoleBefore.has(record.id)).map((record) => record.id);
      interactionRestorePageErrorIds = consoleCollector.getPageErrors().filter((record) => !restorePageErrorsBefore.has(record.id)).map((record) => record.id);
    }
    accessibilityChecks = config.analysis.accessibility ? await safePhase('accessibility.check', phaseErrors, [], () => new AccessibilityChecker().check(activePage)) : [];
    permissionChecks = await safePhase('permissions.check', phaseErrors, [], async () => new PermissionChecker().check(pageModel, networkCollector.list()));
    journeyTests = await safePhase('journeys.run', phaseErrors, [], () =>
      new JourneyTester({
        config,
        artifacts,
        getNetworkRecords: () => networkCollector.list(),
        getConsoleRecords: () => consoleCollector.getMessages(),
        getPageErrors: () => consoleCollector.getPageErrors()
      }).run(activeContext)
    );
    const securityNetworkBefore = new Set(networkCollector.list().map((record) => record.id));
    const securityOutput = await safePhase(
      'security.scan',
      phaseErrors,
      { result: createEmptySecurityResult(config, 'Security scan failed or was skipped before completion.'), issues: [] as Issue[] },
      () =>
        runSecurityScanner({
          page: activePage,
          config,
          artifacts,
          pageModel,
          networkRecords: networkCollector.list(),
          consoleRecords: consoleCollector.getMessages(),
          pageErrors: consoleCollector.getPageErrors(),
          resourceRecords
        })
    );
    securityNetworkRequestIds = networkCollector.list().filter((record) => !securityNetworkBefore.has(record.id)).map((record) => record.id);
    security = securityOutput.result;
    securityIssues = securityOutput.issues;
    responsiveChecks = await safePhase('responsive.run', phaseErrors, [], () => new ResponsiveTester(config, artifacts).run(activePage));
    const p2NetworkBefore = new Set(networkCollector.list().map((record) => record.id));
    const p2Output = await safePhase('p2.run', phaseErrors, { result: createEmptyP2Result(config), issues: [] as Issue[] }, async () => {
      if (!config.p2.enabled) {
        return { result: createEmptyP2Result(config), issues: [] as Issue[] };
      }
      let p2Context: BrowserContext | undefined;
      let p2Page: Page | undefined;
      try {
        p2Context = await createContext(browser, config, artifacts);
        networkCollector.attach(p2Context);
        if (config.analysis.console) {
          consoleCollector.attachContext(p2Context);
        }
        p2Page = await p2Context.newPage();
        await p2Page.goto(config.target.url, { waitUntil: config.browser.waitUntil, timeout: config.browser.timeoutMs }).catch(() => undefined);
        if (config.browser.extraWaitMs > 0) {
          await p2Page.waitForTimeout(config.browser.extraWaitMs).catch(() => undefined);
        }
        await networkCollector.flush();
        return await new P2Tester(config, artifacts, performanceMetrics, networkCollector.list()).run(p2Context, p2Page);
      } finally {
        await p2Page?.close().catch(() => undefined);
        await p2Context?.close().catch((error: unknown) => phaseErrors.push(toPhaseError('p2.context.close', error)));
      }
    });
    p2NetworkRequestIds = networkCollector.list().filter((record) => !p2NetworkBefore.has(record.id)).map((record) => record.id);
    p2 = p2Output.result;
    p2Issues = p2Output.issues;
    if (coverage.status !== 'failed') {
      coverage = await safePhase('coverage.stop', phaseErrors, coverage, () => coverageCollector.stop());
    }
    const exceptionNetworkBefore = new Set(networkCollector.list().map((record) => record.id));
    const exceptionConsoleBefore = new Set(consoleCollector.getMessages().map((record) => record.id));
    const exceptionPageErrorsBefore = new Set(consoleCollector.getPageErrors().map((record) => record.id));
    exceptionSimulations = await safePhase('exceptions.run', phaseErrors, [], () =>
      new ExceptionTester({
        config,
        getNetworkRecords: () => networkCollector.list(),
        getConsoleRecords: () => consoleCollector.getMessages(),
        getPageErrors: () => consoleCollector.getPageErrors()
      }).run(activeContext, activePage)
    );
    exceptionPhaseNetworkRequestIds = networkCollector.list().filter((record) => !exceptionNetworkBefore.has(record.id)).map((record) => record.id);
    exceptionPhaseConsoleIds = consoleCollector.getMessages().filter((record) => !exceptionConsoleBefore.has(record.id)).map((record) => record.id);
    exceptionPhasePageErrorIds = consoleCollector.getPageErrors().filter((record) => !exceptionPageErrorsBefore.has(record.id)).map((record) => record.id);
    await safePhase('network.flush.pre-realtime', phaseErrors, undefined, () => networkCollector.flush());
    realtime = await safePhase('realtime.finalize', phaseErrors, createEmptyRealtimeResult(config), async () =>
      realtimeCollector.build(networkCollector.list(), {
        excludedNetworkRequestIds: [...interactionRestoreNetworkRequestIds, ...securityNetworkRequestIds, ...p2NetworkRequestIds, ...exceptionPhaseNetworkRequestIds, ...exceptionNetworkRequestIds(exceptionSimulations)]
      })
    );
  } finally {
    await coverageCollector.dispose().catch(() => undefined);
    if (context && config.report.trace && artifacts.trace) {
      await context.tracing.stop({ path: artifacts.trace }).catch((error: unknown) => {
        phaseErrors.push(toPhaseError('trace.stop', error));
        artifacts.trace = undefined;
      });
    }
    const video = page?.video();
    await context?.close().catch((error: unknown) => phaseErrors.push(toPhaseError('context.close', error)));
    if (video) {
      const videoPath = await video.path().catch(() => undefined);
      if (videoPath) {
        artifacts.videoFiles = [videoPath];
      }
    }
    await browser.close().catch(() => undefined);
  }

  await networkCollector.flush().catch((error: unknown) => phaseErrors.push(toPhaseError('network.flush', error)));

  artifacts.networkLog = path.join(outputDir, 'network.json');
  artifacts.consoleLog = path.join(outputDir, 'console.json');
  artifacts.resourcesLog = path.join(outputDir, 'resources.json');
  artifacts.coverageLog = path.join(outputDir, 'coverage.json');
  artifacts.realtimeLog = path.join(outputDir, 'realtime.json');
  artifacts.apiContractLog = path.join(outputDir, 'api-contract.json');
  artifacts.p2Log = path.join(outputDir, 'p2.json');
  await writeJson(artifacts.networkLog, networkCollector.list());
  await writeJson(artifacts.consoleLog, {
    messages: consoleCollector.getMessages(),
    pageErrors: consoleCollector.getPageErrors()
  });
  await writeJson(artifacts.resourcesLog, resourceRecords);
  await writeJson(artifacts.coverageLog, coverage);
  const syntheticNetworkRequestIds = [...interactionRestoreNetworkRequestIds, ...securityNetworkRequestIds, ...p2NetworkRequestIds, ...exceptionPhaseNetworkRequestIds, ...exceptionNetworkRequestIds(exceptionSimulations)];
  const contractOutput = await safePhase('contract.analyze', phaseErrors, { result: emptyApiContract(config), issues: [] as Issue[] }, () => analyzeApiContract(config, networkCollector.list(), artifacts, { excludedNetworkRequestIds: syntheticNetworkRequestIds }));
  apiContract = contractOutput.result;
  contractIssues = contractOutput.issues;
  sourceRuntimeCorrelation = await safePhase(
    'source.runtime-correlate',
    phaseErrors,
    createEmptySourceRuntimeCorrelation('failed', 'Source/runtime correlation failed.'),
    async () =>
      buildSourceRuntimeCorrelation({
        sourceAnalysis,
        networkRecords: networkCollector.list().filter((record) => !syntheticNetworkRequestIds.includes(record.id)),
        pageModel
      })
  );
  await writeJson(artifacts.realtimeLog as string, realtime);
  await writeJson(artifacts.apiContractLog as string, apiContract);
  await writeJson(artifacts.p2Log as string, p2);

  const analyzerContext = {
    config,
    artifacts,
    pageModel,
    networkRecords: networkCollector.list(),
    consoleRecords: consoleCollector.getMessages(),
    pageErrors: consoleCollector.getPageErrors(),
    resourceRecords,
    performanceMetrics,
    coverage,
    apiContract,
    realtime,
    interactionTests,
    journeyTests,
    accessibilityChecks,
    permissionChecks,
    responsiveChecks,
    exceptionSimulations,
    security,
    p2,
    sourceAnalysis,
    sourceRuntimeCorrelation,
    sourceHealth,
    analysisExclusions: {
      networkRequestIds: [...interactionRestoreNetworkRequestIds, ...securityNetworkRequestIds, ...p2NetworkRequestIds, ...exceptionPhaseNetworkRequestIds],
      consoleIds: [...interactionRestoreConsoleIds, ...exceptionPhaseConsoleIds],
      pageErrorIds: [...interactionRestorePageErrorIds, ...exceptionPhasePageErrorIds],
      reason: 'Synthetic security, P2 network-profile, and exception probes are excluded from normal network/API/integration analysis.'
    }
  };
  const journeyNetworkRequestIds = journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.networkRequestIds ?? []));
  const journeyConsoleIds = journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.consoleIds ?? []));
  const journeyPageErrorIds = journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.pageErrorIds ?? []));
  const sanitizedNetworkIds = new Set([...syntheticNetworkRequestIds, ...journeyNetworkRequestIds]);
  const sanitizedConsoleIds = new Set([...interactionRestoreConsoleIds, ...exceptionPhaseConsoleIds, ...exceptionSimulations.flatMap((item) => item.observations.consoleIds ?? []), ...journeyConsoleIds]);
  const sanitizedPageErrorIds = new Set([...interactionRestorePageErrorIds, ...exceptionPhasePageErrorIds, ...exceptionSimulations.flatMap((item) => item.observations.pageErrorIds ?? []), ...journeyPageErrorIds]);
  const sanitizedAnalyzerContext = {
    ...analyzerContext,
    networkRecords: analyzerContext.networkRecords.filter((record) => !sanitizedNetworkIds.has(record.id)),
    consoleRecords: analyzerContext.consoleRecords.filter((record) => !sanitizedConsoleIds.has(record.id)),
    pageErrors: analyzerContext.pageErrors.filter((record) => !sanitizedPageErrorIds.has(record.id))
  };
  const analysis = analyzeAll(analyzerContext);
  const pluginIssues = await runAnalyzerPlugins(sanitizedAnalyzerContext);
  const baseIssues = [
    ...(navigationError ? [createNavigationIssue(navigationError, artifacts)] : []),
    ...analysis.issues,
    ...securityIssues,
    ...contractIssues,
    ...p2Issues,
    ...sourceIssues,
    ...sourceHealthIssues,
    ...pluginIssues
  ];
  const normalizedBaseIssues = reindexIssues(dedupeIssues(applySuggestionTemplates(baseIssues)));
  const aiAnalysis = await runAiAnalyzer(sanitizedAnalyzerContext, normalizedBaseIssues);

  const issues = reindexIssues(dedupeIssues(applySuggestionTemplates([
    ...normalizedBaseIssues,
    ...aiAnalysis.issues
  ])));
  const requirementCoverage = buildRequirementCoverage({
    config,
    pageModel,
    networkRecords: networkCollector.list(),
    issues,
    journeyTests,
    interactionTests,
    accessibilityChecks
  });
  const resultConfig: FrontLensConfig = {
    ...config,
    target: {
      ...config.target,
      url: redactUrl(config.target.url)
    }
  };
  const journeyAssertionAudit = buildJourneyAssertionAudit({
    journeyTests,
    requirementCoverage
  });
  const testData: TestDataAssessmentResult = buildTestDataAssessment(resultConfig, requirementCoverage);
  const environment: EnvironmentAssessment = buildEnvironmentAssessment({
    config,
    pageModel,
    networkRecords: networkCollector.list()
  });
  const pageProfile: PageProfileAssessment = buildPageProfileAssessment({
    config,
    pageModel
  });
  const scopeReview: ScopeReviewResult = buildScopeReview({
    config: resultConfig,
    pageProfile,
    requirementCoverage,
    title: pageModel.title
  });
  const preliminaryDisposition = buildIssueDisposition(issues, resultConfig, [], { requirementCoverage });
  const rootCauseGroups = buildRootCauseGroups(filterActionableIssues(issues, preliminaryDisposition), resultConfig, sourceRuntimeCorrelation, sourceAnalysis);
  const issueDisposition = buildIssueDisposition(issues, resultConfig, rootCauseGroups, { requirementCoverage });
  const defectProof: DefectProofResult = buildDefectProof({
    rootCauseGroups,
    issues,
    issueDisposition,
    requirementCoverage,
    sourceAnalysis,
    sourceRuntimeCorrelation,
    sourceHealth,
    scopeReview,
    environment
  });
  const fixTasks: FixTask[] = generateFixTasks(issues, resultConfig, rootCauseGroups, defectProof);
  const initialArtifactIntegrity = createEmptyArtifactIntegrity();
  const qualityGate = buildQualityGate({
    issues,
    pageModel,
    phaseErrors,
    interactionTests,
    journeyTests,
    exceptionSimulations,
    coverage,
    security,
    requirementCoverage,
    artifactIntegrity: initialArtifactIntegrity,
    issueDisposition,
    defectProof
  });
  const qaSignoff = buildQaSignoff({
    config: resultConfig,
    qualityGate,
    requirementCoverage,
    sourceHealth,
    artifactIntegrity: initialArtifactIntegrity,
    journeyAssertionAudit,
    environment,
    pageProfile,
    testData,
    journeyTests,
    interactionTests,
    exceptionSimulations,
    pageDomNodes: pageModel.stats.domNodes
  });
  const regressionPlan = buildRegressionPlan({
    targetUrl: redactUrl(config.target.url),
    sourceRoot: sourceAnalysis.root,
    rootCauseGroups,
    fixTasks,
    requirementCoverage,
    journeyTests,
    interactionTests,
    sourceHealth,
    artifactIntegrity: initialArtifactIntegrity,
    environment,
    pageProfile,
    pageModel,
    permissionChecks,
    testData,
    qualityGate,
    qaSignoff,
    defectProof
  });
  const professionalSummary = buildProfessionalSummary({
    rootCauseGroups,
    issueDisposition,
    requirementCoverage,
    qualityGate,
    qaSignoff,
    regressionPlan,
    defectProof
  });
  const claimGuard = buildClaimGuard({
    qaSignoff,
    qualityGate,
    requirementCoverage,
    environment,
    scopeReview,
    sourceRuntimeCorrelation,
    artifactIntegrity: initialArtifactIntegrity,
    sourceHealth,
    rootCauseGroups,
    issueDisposition,
    defectProof,
    p2,
    security,
    artifacts,
    journeyTests
  });
  const qaIntake: QaIntakeResult = buildQaIntake({
    claimGuard,
    scopeReview,
    qaSignoff,
    qualityGate,
    requirementCoverage,
    environment,
    sourceAnalysis,
    sourceRuntimeCorrelation,
    sourceHealth,
    artifactIntegrity: initialArtifactIntegrity,
    testData,
    regressionPlan,
    defectProof,
    rootCauseGroups,
    issueDisposition,
    artifacts
  });
  const summary = applyAdjustedScore(
    buildSummary({
      url: redactUrl(config.target.url),
      title: pageModel.title,
      issues,
      testedAt,
      browser: config.browser.name,
      viewport: config.browser.viewport
    }),
    issues,
    issueDisposition,
    defectProof
  );
  const qaPlan = buildQaExecutionPlan({
    summary,
    requirementCoverage,
    journeyTests,
    interactionTests,
    rootCauseGroups,
    defectProof,
    regressionPlan,
    professionalSummary,
    claimGuard,
    qaIntake,
    qaSignoff,
    environment,
    pageProfile,
    pageModel,
    permissionChecks,
    scopeReview,
    sourceAnalysis,
    sourceHealth,
    testData,
    artifactIntegrity: initialArtifactIntegrity,
    artifacts
  });
  const qaCoverage = buildQaCoverageMatrix({
    pageModel,
    network: {
      requests: networkCollector.list(),
      failedRequests: analysis.network.failedRequests,
      slowRequests: analysis.network.slowRequests,
      duplicatedRequests: analysis.network.duplicatedRequests,
      suspiciousRequests: analysis.network.suspiciousRequests
    },
    console: {
      messages: consoleCollector.getMessages(),
      errors: analysis.console.errors,
      warnings: analysis.console.warnings,
      pageErrors: consoleCollector.getPageErrors()
    },
    requirementCoverage,
    journeyTests,
    interactionTests,
    exceptionSimulations,
    apiContract,
    realtime,
    sourceAnalysis,
    sourceRuntimeCorrelation,
    sourceHealth,
    accessibilityChecks,
    responsiveChecks,
    coverage,
    p2,
    security,
    environment,
    pageProfile,
    scopeReview,
    testData,
    artifactIntegrity: initialArtifactIntegrity,
    issueDisposition,
    rootCauseGroups,
    defectProof,
    qaSignoff
  });
  const assertionSuggestions = buildAssertionSuggestions({
    pageModel,
    network: {
      requests: networkCollector.list(),
      failedRequests: analysis.network.failedRequests,
      slowRequests: analysis.network.slowRequests,
      duplicatedRequests: analysis.network.duplicatedRequests,
      suspiciousRequests: analysis.network.suspiciousRequests
    },
    requirementCoverage,
    journeyTests,
    journeyAssertionAudit
  });
  const testCases = buildTestCaseMatrix({
    summary,
    requirementCoverage,
    journeyTests,
    journeyAssertionAudit,
    interactionTests,
    exceptionSimulations,
    accessibilityChecks,
    responsiveChecks,
    apiContract,
    coverage,
    p2,
    security,
    sourceHealth,
    testData,
    artifactIntegrity: initialArtifactIntegrity,
    qaCoverage,
    issueDisposition,
    defectProof
  });
  const riskRegister = buildRiskRegister({
    professionalSummary,
    qaSignoff,
    qaCoverage,
    qaPlan,
    regressionPlan,
    environment,
    sourceHealth,
    testData,
    artifactIntegrity: initialArtifactIntegrity
  });

  const riskAcceptance = buildRiskAcceptance({ riskRegister });
  const defectTickets = buildDefectTickets({
    rootCauseGroups,
    issues,
    defectProof,
    requirementCoverage
  });
  const traceability = buildTraceabilityMatrix({
    requirementCoverage,
    testCases,
    rootCauseGroups,
    defectTickets,
    riskRegister,
    qaSignoff
  });
  const automationSpecs = buildAutomationSpecs({
    summary,
    requirementCoverage,
    testCases,
    journeyTests,
    assertionSuggestions,
    traceability,
    qaSignoff
  });

  const result: QaResult = {
    summary,
    pageModel,
    issues,
    network: {
      requests: networkCollector.list(),
      failedRequests: analysis.network.failedRequests,
      slowRequests: analysis.network.slowRequests,
      duplicatedRequests: analysis.network.duplicatedRequests,
      suspiciousRequests: analysis.network.suspiciousRequests
    },
    console: {
      messages: consoleCollector.getMessages(),
      errors: analysis.console.errors,
      warnings: analysis.console.warnings,
      pageErrors: consoleCollector.getPageErrors()
    },
    resources: {
      entries: resourceRecords,
      failed: analysis.resources.failed,
      slow: analysis.resources.slow,
      large: analysis.resources.large,
      duplicated: analysis.resources.duplicated
    },
    performance: performanceMetrics,
    coverage,
    apiContract,
    realtime,
    interactionTests,
    journeyTests,
    accessibilityChecks,
    permissionChecks,
    responsiveChecks,
    exceptionSimulations,
    security,
    requirementCoverage,
    sourceAnalysis,
    sourceRuntimeCorrelation,
    sourceHealth,
    environment,
    pageProfile,
    scopeReview,
    testData,
    p2,
    artifactIntegrity: initialArtifactIntegrity,
    rootCauseGroups,
    issueDisposition,
    fixTasks,
    regressionPlan,
    qaPlan,
    qaCoverage,
    testCases,
    riskRegister,
    riskAcceptance,
    defectTickets,
    traceability,
    automationSpecs,
    reportContentAudit: createSkippedReportContentAudit(resultConfig.report.profile),
    journeyAssertionAudit,
    assertionSuggestions,
    professionalSummary,
    defectProof,
    claimGuard,
    qaIntake,
    qualityGate,
    qaSignoff,
    aiAnalysis,
    artifacts,
    metadata: {
      config: resultConfig,
      durationMs: Date.now() - started,
      version: VERSION,
      schemaVersion: RESULT_SCHEMA_VERSION,
      phaseErrors
    }
  };

  return writeReports(result);
}
