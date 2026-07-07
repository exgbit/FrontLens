import type {
  AiAnalysisResult,
  ArtifactIndex,
  BrowserName,
  ConsoleSection,
  CoverageResult,
  FrontLensConfig,
  Issue,
  NetworkSection,
  PageModel,
  QaResult,
  QaSummary,
  ResourceSection,
  Severity,
  InteractionTestResult,
  JourneyTestResult,
  ExceptionSimulationResult,
  PhaseError
} from './types.js';
import { createDefaultConfig } from './defaultConfig.js';
import { createStableFingerprint } from './utils/id.js';
import { generateFixTasks } from './fix/fixTasks.js';
import { calculateScore } from './summary.js';
import { buildQualityGate } from './qualityGate.js';

export const RESULT_SCHEMA_VERSION = '1.3.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBrowser(value: unknown): BrowserName {
  return value === 'firefox' || value === 'webkit' || value === 'chromium' ? value : 'chromium';
}

function asSeverity(value: unknown): Severity {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info' ? value : 'info';
}

export function emptyPageModel(url = ''): PageModel {
  return {
    url,
    title: '',
    meta: {
      h1: [],
      openGraph: {}
    },
    breadcrumbs: [],
    headings: [],
    structureTree: '',
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

export function emptyCoverage(browser: BrowserName = 'chromium'): CoverageResult {
  const empty = { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 };
  return {
    enabled: false,
    status: 'skipped',
    browser,
    collectedAt: new Date().toISOString(),
    message: 'Coverage missing from report.',
    totals: {
      js: { ...empty },
      css: { ...empty },
      all: { ...empty }
    },
    entries: [],
    topUnused: []
  };
}

function normalizeSuggestion(value: unknown): Issue['suggestion'] {
  const suggestion = isRecord(value) ? value : {};
  return {
    frontend: optionalString(suggestion.frontend),
    backend: optionalString(suggestion.backend),
    product: optionalString(suggestion.product),
    test: optionalString(suggestion.test),
    priority: suggestion.priority === 'P0' || suggestion.priority === 'P1' || suggestion.priority === 'P2' || suggestion.priority === 'P3' ? suggestion.priority : undefined
  };
}

function normalizeEvidence(value: unknown): Issue['evidence'] {
  const evidence = isRecord(value) ? value : {};
  return {
    screenshot: optionalString(evidence.screenshot),
    dom: optionalString(evidence.dom),
    networkRequestId: optionalString(evidence.networkRequestId),
    consoleId: optionalString(evidence.consoleId),
    pageErrorId: optionalString(evidence.pageErrorId),
    pageErrorIds: asArray<string>(evidence.pageErrorIds).filter((item) => typeof item === 'string'),
    selector: optionalString(evidence.selector),
    componentId: optionalString(evidence.componentId),
    resourceUrl: optionalString(evidence.resourceUrl),
    details: evidence.details
  };
}

export function fingerprintIssue(value: Pick<Issue, 'category' | 'severity' | 'title' | 'evidence'>): string {
  const details = value.evidence.details && typeof value.evidence.details === 'object' ? (value.evidence.details as Record<string, unknown>) : {};
  return createStableFingerprint([
    value.category,
    value.title.toLowerCase().replace(/\d+/g, '#'),
    value.evidence.selector,
    value.evidence.resourceUrl,
    details.securityCheckId,
    details.accessibilityCheckId,
    details.permissionCheckId,
    details.rule,
    details.endpoint ? JSON.stringify(details.endpoint).slice(0, 300) : undefined,
    details.metric,
    details.interactionTestId,
    details.journeyId
  ]);
}

export function normalizeIssueLike(value: unknown, index = 0): Issue {
  const issue = isRecord(value) ? value : {};
  const evidence = normalizeEvidence(issue.evidence);
  const normalized: Issue = {
    id: asString(issue.id, `ISSUE-${String(index + 1).padStart(3, '0')}`),
    fingerprint: optionalString(issue.fingerprint),
    affectedUrl: optionalString(issue.affectedUrl),
    ownerHint: issue.ownerHint === 'frontend' || issue.ownerHint === 'backend' || issue.ownerHint === 'product' || issue.ownerHint === 'test' ? issue.ownerHint : undefined,
    title: asString(issue.title, 'Untitled issue'),
    category: asString(issue.category, 'unknown') as Issue['category'],
    severity: asSeverity(issue.severity),
    confidence: Math.min(1, Math.max(0, asNumber(issue.confidence, 0.5))),
    description: asString(issue.description),
    evidence,
    reproduceSteps: asArray<string>(issue.reproduceSteps).filter((item) => typeof item === 'string'),
    reason: asString(issue.reason),
    suggestion: normalizeSuggestion(issue.suggestion),
    source: issue.source === 'ai' || issue.source === 'manual' || issue.source === 'rule' ? issue.source : 'rule'
  };
  normalized.fingerprint ??= fingerprintIssue(normalized);
  if (normalized.reproduceSteps.length === 0) {
    normalized.reproduceSteps = ['打开目标页面', '根据证据定位对应页面、接口或 Console 记录'];
  }
  return normalized;
}

function normalizePageModel(value: unknown, url: string): PageModel {
  const raw = isRecord(value) ? value : {};
  const empty = emptyPageModel(url);
  const metaRaw = isRecord(raw.meta) ? raw.meta : {};
  const statsRaw = isRecord(raw.stats) ? raw.stats : {};
  return {
    ...empty,
    ...raw,
    url: asString(raw.url, url),
    title: asString(raw.title),
    meta: {
      description: optionalString(metaRaw.description),
      canonical: optionalString(metaRaw.canonical),
      h1: asArray<string>(metaRaw.h1).filter((item) => typeof item === 'string'),
      viewport: optionalString(metaRaw.viewport),
      openGraph: isRecord(metaRaw.openGraph) ? (Object.fromEntries(Object.entries(metaRaw.openGraph).filter(([, item]) => typeof item === 'string')) as Record<string, string>) : {}
    },
    breadcrumbs: asArray<string>(raw.breadcrumbs).filter((item) => typeof item === 'string'),
    headings: asArray<PageModel['headings'][number]>(raw.headings),
    structureTree: asString(raw.structureTree),
    components: asArray<PageModel['components'][number]>(raw.components),
    forms: asArray<PageModel['forms'][number]>(raw.forms),
    tables: asArray<PageModel['tables'][number]>(raw.tables),
    buttons: asArray<PageModel['buttons'][number]>(raw.buttons),
    inputs: asArray<PageModel['inputs'][number]>(raw.inputs),
    images: asArray<PageModel['images'][number]>(raw.images),
    links: asArray<PageModel['links'][number]>(raw.links),
    stats: {
      domNodes: asNumber(statsRaw.domNodes),
      visibleTextLength: asNumber(statsRaw.visibleTextLength),
      bodyTextSample: asString(statsRaw.bodyTextSample)
    }
  };
}

function emptyPerformance(): QaResult['performance'] {
  return {
    collectedAt: new Date().toISOString(),
    paint: {},
    longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
    layoutShift: { score: 0, count: 0 },
    resources: { count: 0, totalTransferSize: 0, totalEncodedBodySize: 0, slowest: [] },
    dom: { nodeCount: 0, maxDepth: 0 },
    mutations: { count: 0 }
  };
}

function normalizePerformance(rawPerformance: unknown): QaResult['performance'] {
  if (!isRecord(rawPerformance)) return emptyPerformance();
  const empty = emptyPerformance();
  const paint = isRecord(rawPerformance.paint) ? rawPerformance.paint : {};
  const longTasks = isRecord(rawPerformance.longTasks) ? rawPerformance.longTasks : {};
  const layoutShift = isRecord(rawPerformance.layoutShift) ? rawPerformance.layoutShift : {};
  const resources = isRecord(rawPerformance.resources) ? rawPerformance.resources : {};
  const navigation = isRecord(rawPerformance.navigation) ? rawPerformance.navigation : {};
  const memory = isRecord(rawPerformance.memory) ? rawPerformance.memory : undefined;
  const dom = isRecord(rawPerformance.dom) ? rawPerformance.dom : {};
  const mutations = isRecord(rawPerformance.mutations) ? rawPerformance.mutations : {};
  return {
    collectedAt: asString(rawPerformance.collectedAt, empty.collectedAt),
    navigation: isRecord(rawPerformance.navigation)
      ? {
          startTime: asNumber(navigation.startTime),
          domContentLoadedMs: optionalNumber(navigation.domContentLoadedMs),
          loadMs: optionalNumber(navigation.loadMs),
          responseEndMs: optionalNumber(navigation.responseEndMs),
          transferSize: optionalNumber(navigation.transferSize),
          encodedBodySize: optionalNumber(navigation.encodedBodySize),
          decodedBodySize: optionalNumber(navigation.decodedBodySize)
        }
      : undefined,
    paint: {
      firstPaintMs: optionalNumber(paint.firstPaintMs),
      firstContentfulPaintMs: optionalNumber(paint.firstContentfulPaintMs)
    },
    longTasks: {
      count: asNumber(longTasks.count),
      totalDurationMs: asNumber(longTasks.totalDurationMs),
      maxDurationMs: asNumber(longTasks.maxDurationMs)
    },
    layoutShift: {
      score: asNumber(layoutShift.score),
      count: asNumber(layoutShift.count)
    },
    resources: {
      count: asNumber(resources.count),
      totalTransferSize: asNumber(resources.totalTransferSize),
      totalEncodedBodySize: asNumber(resources.totalEncodedBodySize),
      slowest: asArray(resources.slowest)
    },
    memory: memory
      ? {
          usedJSHeapSize: optionalNumber(memory.usedJSHeapSize),
          totalJSHeapSize: optionalNumber(memory.totalJSHeapSize),
          jsHeapSizeLimit: optionalNumber(memory.jsHeapSizeLimit)
        }
      : undefined,
    dom: {
      nodeCount: asNumber(dom.nodeCount),
      maxDepth: asNumber(dom.maxDepth)
    },
    mutations: {
      count: asNumber(mutations.count)
    }
  };
}

function normalizeCoverage(rawCoverage: unknown, browser: BrowserName): CoverageResult {
  if (!isRecord(rawCoverage)) {
    return emptyCoverage(browser);
  }
  const empty = emptyCoverage(browser);
  const totalsRaw = isRecord(rawCoverage.totals) ? rawCoverage.totals : {};
  const normalizeBucket = (value: unknown): CoverageResult['totals']['js'] => {
    const bucket = isRecord(value) ? value : {};
    return {
      totalBytes: asNumber(bucket.totalBytes),
      usedBytes: asNumber(bucket.usedBytes),
      unusedBytes: asNumber(bucket.unusedBytes),
      unusedPercent: asNumber(bucket.unusedPercent)
    };
  };
  return {
    ...empty,
    ...rawCoverage,
    enabled: Boolean(rawCoverage.enabled),
    status: rawCoverage.status === 'passed' || rawCoverage.status === 'failed' || rawCoverage.status === 'skipped' ? rawCoverage.status : 'skipped',
    browser: asBrowser(rawCoverage.browser),
    collectedAt: asString(rawCoverage.collectedAt, new Date().toISOString()),
    message: optionalString(rawCoverage.message),
    totals: {
      js: normalizeBucket(totalsRaw.js),
      css: normalizeBucket(totalsRaw.css),
      all: normalizeBucket(totalsRaw.all)
    },
    entries: asArray(rawCoverage.entries),
    topUnused: asArray(rawCoverage.topUnused)
  };
}

function normalizeSecurity(rawSecurity: unknown): QaResult['security'] {
  if (!isRecord(rawSecurity)) {
    return {
      enabled: false,
      mode: 'passive',
      score: 100,
      status: 'skipped',
      checkedAt: new Date().toISOString(),
      summary: {
        checkCount: 0,
        failedCount: 0,
        warningCount: 0,
        passedCount: 0,
        skippedCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0
      },
      checks: []
    };
  }
  const checks = asArray(rawSecurity.checks).map((value, index): QaResult['security']['checks'][number] => {
    const check = isRecord(value) ? value : {};
    const status =
      check.status === 'passed' || check.status === 'warning' || check.status === 'failed' || check.status === 'skipped'
        ? check.status
        : 'skipped';
    return {
      id: asString(check.id, `SEC-${String(index + 1).padStart(3, '0')}`),
      category: asString(check.category, 'active-probing') as QaResult['security']['checks'][number]['category'],
      rule: asString(check.rule, 'unknown'),
      status,
      severity: asSeverity(check.severity),
      title: asString(check.title, 'Untitled security check'),
      description: asString(check.description),
      evidence: asArray<Record<string, unknown>>(check.evidence)
        .filter(isRecord)
        .map((item) => ({
          networkRequestId: optionalString(item.networkRequestId),
          selector: optionalString(item.selector),
          url: optionalString(item.url),
          header: optionalString(item.header),
          cookieName: optionalString(item.cookieName),
          storage: item.storage === 'localStorage' || item.storage === 'sessionStorage' ? item.storage : undefined,
          key: optionalString(item.key),
          details: item.details
        })),
      suggestion: normalizeSuggestion(check.suggestion)
    };
  });
  const summaryRaw = isRecord(rawSecurity.summary) ? rawSecurity.summary : {};
  const status = rawSecurity.status === 'passed' || rawSecurity.status === 'warning' || rawSecurity.status === 'failed' || rawSecurity.status === 'skipped' ? rawSecurity.status : 'skipped';
  return {
    enabled: Boolean(rawSecurity.enabled),
    mode: rawSecurity.mode === 'active' ? 'active' : 'passive',
    score: status === 'skipped' || rawSecurity.enabled === false ? 100 : Math.max(0, Math.min(100, asNumber(rawSecurity.score, 0))),
    status,
    checkedAt: asString(rawSecurity.checkedAt, new Date().toISOString()),
    summary: {
      checkCount: asNumber(summaryRaw.checkCount, checks.length),
      failedCount: asNumber(summaryRaw.failedCount, checks.filter((check) => check.status === 'failed').length),
      warningCount: asNumber(summaryRaw.warningCount, checks.filter((check) => check.status === 'warning').length),
      passedCount: asNumber(summaryRaw.passedCount, checks.filter((check) => check.status === 'passed').length),
      skippedCount: asNumber(summaryRaw.skippedCount, checks.filter((check) => check.status === 'skipped').length),
      highCount: asNumber(summaryRaw.highCount, checks.filter((check) => check.severity === 'high' && check.status !== 'passed' && check.status !== 'skipped').length),
      mediumCount: asNumber(summaryRaw.mediumCount, checks.filter((check) => check.severity === 'medium' && check.status !== 'passed' && check.status !== 'skipped').length),
      lowCount: asNumber(summaryRaw.lowCount, checks.filter((check) => check.severity === 'low' && check.status !== 'passed' && check.status !== 'skipped').length),
      infoCount: asNumber(summaryRaw.infoCount, checks.filter((check) => check.severity === 'info' && check.status !== 'passed' && check.status !== 'skipped').length)
    },
    checks
  };
}

function emptyApiContract(): QaResult['apiContract'] {
  return {
    enabled: false,
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

function normalizeApiContract(raw: unknown): QaResult['apiContract'] {
  if (!isRecord(raw)) return emptyApiContract();
  const summary = isRecord(raw.summary) ? raw.summary : {};
  return {
    enabled: Boolean(raw.enabled),
    schemaPath: optionalString(raw.schemaPath),
    checkedAt: asString(raw.checkedAt, new Date().toISOString()),
    summary: {
      endpointCount: asNumber(summary.endpointCount),
      undocumentedCount: asNumber(summary.undocumentedCount),
      statusMismatchCount: asNumber(summary.statusMismatchCount),
      schemaMismatchCount: asNumber(summary.schemaMismatchCount),
      inferredCount: asNumber(summary.inferredCount)
    },
    endpoints: asArray(raw.endpoints)
  };
}

function normalizeRealtime(raw: unknown): QaResult['realtime'] {
  if (!isRecord(raw)) {
    return {
      enabled: false,
      checkedAt: new Date().toISOString(),
      graphql: [],
      webSockets: [],
      sse: [],
      summary: {
        graphqlOperationCount: 0,
        graphqlErrorCount: 0,
        webSocketCount: 0,
        webSocketErrorCount: 0,
        sseCount: 0
      }
    };
  }
  const summary = isRecord(raw.summary) ? raw.summary : {};
  return {
    enabled: Boolean(raw.enabled),
    checkedAt: asString(raw.checkedAt, new Date().toISOString()),
    graphql: asArray(raw.graphql),
    webSockets: asArray(raw.webSockets),
    sse: asArray(raw.sse),
    summary: {
      graphqlOperationCount: asNumber(summary.graphqlOperationCount),
      graphqlErrorCount: asNumber(summary.graphqlErrorCount),
      webSocketCount: asNumber(summary.webSocketCount),
      webSocketErrorCount: asNumber(summary.webSocketErrorCount),
      sseCount: asNumber(summary.sseCount)
    }
  };
}

function normalizeP2(raw: unknown): QaResult['p2'] {
  if (!isRecord(raw)) {
    return {
      enabled: false,
      checkedAt: new Date().toISOString(),
      visual: { enabled: false, status: 'skipped' },
      budgets: [],
      networkProfiles: []
    };
  }
  const visual = isRecord(raw.visual) ? raw.visual : {};
  const normalizeBudget = (value: unknown): QaResult['p2']['budgets'][number] => {
    const item = isRecord(value) ? value : {};
    return {
      metric: asString(item.metric, 'unknown'),
      actual: asNumber(item.actual),
      budget: asNumber(item.budget),
      status: item.status === 'passed' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'skipped',
      unit: asString(item.unit)
    };
  };
  const normalizeProfile = (value: unknown): QaResult['p2']['networkProfiles'][number] => {
    const item = isRecord(value) ? value : {};
    return {
      profile: item.profile === 'slow-3g' ? 'slow-3g' : 'offline',
      status: item.status === 'passed' || item.status === 'warning' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'skipped',
      observations: asArray<string>(item.observations).filter((entry) => typeof entry === 'string'),
      screenshot: optionalString(item.screenshot),
      error: optionalString(item.error)
    };
  };
  return {
    enabled: Boolean(raw.enabled),
    checkedAt: asString(raw.checkedAt, new Date().toISOString()),
    visual: {
      enabled: Boolean(visual.enabled),
      status: visual.status === 'passed' || visual.status === 'warning' || visual.status === 'failed' || visual.status === 'skipped' ? visual.status : 'skipped',
      currentScreenshot: optionalString(visual.currentScreenshot),
      baselinePath: optionalString(visual.baselinePath),
      diffRatio: visual.diffRatio === undefined ? undefined : asNumber(visual.diffRatio),
      message: optionalString(visual.message)
    },
    budgets: asArray(raw.budgets).map(normalizeBudget),
    networkProfiles: asArray(raw.networkProfiles).map(normalizeProfile)
  };
}

function normalizeFixTasks(raw: unknown): QaResult['fixTasks'] {
  return asArray(raw).map((value, index): QaResult['fixTasks'][number] => {
    const task = isRecord(value) ? value : {};
    return {
      id: asString(task.id, `FIX-${String(index + 1).padStart(3, '0')}`),
      issueIds: asArray<string>(task.issueIds).filter((item) => typeof item === 'string'),
      owner: task.owner === 'backend' || task.owner === 'product' || task.owner === 'test' || task.owner === 'security' ? task.owner : 'frontend',
      type: asString(task.type, 'fix'),
      title: asString(task.title, 'Untitled fix task'),
      priority: task.priority === 'P0' || task.priority === 'P1' || task.priority === 'P2' || task.priority === 'P3' ? task.priority : 'P2',
      target: optionalString(task.target),
      expectedChange: asString(task.expectedChange),
      evidence: normalizeEvidence(task.evidence),
      verificationCommand: asString(task.verificationCommand)
    };
  });
}

function normalizeQualityGate(raw: unknown, fallback: QaResult['qualityGate']): QaResult['qualityGate'] {
  if (!isRecord(raw)) return fallback;
  const status = raw.status === 'pass' || raw.status === 'pass-with-risks' || raw.status === 'fail' || raw.status === 'blocked' ? raw.status : fallback.status;
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low' ? raw.confidence : fallback.confidence;
  return {
    status,
    confidence,
    checkedAt: asString(raw.checkedAt, fallback.checkedAt),
    actionableIssueCount: asNumber(raw.actionableIssueCount, fallback.actionableIssueCount),
    referenceIssueCount: asNumber(raw.referenceIssueCount, fallback.referenceIssueCount),
    blockingIssueCount: asNumber(raw.blockingIssueCount, fallback.blockingIssueCount),
    mediumRiskCount: asNumber(raw.mediumRiskCount, fallback.mediumRiskCount),
    coverageGapCount: asNumber(raw.coverageGapCount, fallback.coverageGapCount),
    coverageGaps: asArray<string>(raw.coverageGaps).filter((item) => typeof item === 'string'),
    reasons: asArray<string>(raw.reasons).filter((item) => typeof item === 'string'),
    summary: asString(raw.summary, fallback.summary)
  };
}

export function normalizeResult(raw: unknown): QaResult {
  if (!isRecord(raw)) {
    throw new Error('Invalid FrontLens result: expected a JSON object.');
  }

  const summaryRaw = isRecord(raw.summary) ? raw.summary : {};
  const artifactsRaw = isRecord(raw.artifacts) ? raw.artifacts : {};
  const metadataRaw = isRecord(raw.metadata) ? raw.metadata : {};
  const browser = asBrowser(summaryRaw.browser);
  const url = asString(summaryRaw.url, isRecord(raw.pageModel) ? asString(raw.pageModel.url) : '');
  const issues = asArray(raw.issues).map(normalizeIssueLike);
  const rawScore = optionalNumber(summaryRaw.score);

  const summary: QaSummary = {
    url,
    title: asString(summaryRaw.title, isRecord(raw.pageModel) ? asString(raw.pageModel.title) : ''),
    score: rawScore === undefined ? calculateScore(issues) : Math.max(0, Math.min(100, rawScore)),
    issueCount: issues.length,
    criticalCount: issues.filter((issue) => issue.severity === 'critical').length,
    highCount: issues.filter((issue) => issue.severity === 'high').length,
    mediumCount: issues.filter((issue) => issue.severity === 'medium').length,
    lowCount: issues.filter((issue) => issue.severity === 'low').length,
    infoCount: issues.filter((issue) => issue.severity === 'info').length,
    testedAt: asString(summaryRaw.testedAt, new Date().toISOString()),
    browser,
    viewport: isRecord(summaryRaw.viewport)
      ? {
          width: asNumber(summaryRaw.viewport.width, 1440),
          height: asNumber(summaryRaw.viewport.height, 900)
        }
      : { width: 1440, height: 900 }
  };

  const networkRaw = isRecord(raw.network) ? raw.network : {};
  const network: NetworkSection = {
    requests: asArray(networkRaw.requests),
    failedRequests: asArray(networkRaw.failedRequests),
    slowRequests: asArray(networkRaw.slowRequests),
    duplicatedRequests: asArray(networkRaw.duplicatedRequests),
    suspiciousRequests: asArray(networkRaw.suspiciousRequests)
  };

  const consoleRaw = isRecord(raw.console) ? raw.console : {};
  const consoleSection: ConsoleSection = {
    messages: asArray(consoleRaw.messages),
    errors: asArray(consoleRaw.errors),
    warnings: asArray(consoleRaw.warnings),
    pageErrors: asArray(consoleRaw.pageErrors)
  };

  const resourceRaw = isRecord(raw.resources) ? raw.resources : {};
  const resources: ResourceSection = {
    entries: asArray(resourceRaw.entries),
    failed: asArray(resourceRaw.failed),
    slow: asArray(resourceRaw.slow),
    large: asArray(resourceRaw.large),
    duplicated: asArray(resourceRaw.duplicated)
  };

  const aiAnalysis: AiAnalysisResult = isRecord(raw.aiAnalysis)
    ? {
        enabled: Boolean(raw.aiAnalysis.enabled),
        provider: raw.aiAnalysis.provider === 'command' ? 'command' : 'heuristic',
        status: raw.aiAnalysis.status === 'passed' || raw.aiAnalysis.status === 'failed' || raw.aiAnalysis.status === 'skipped' ? raw.aiAnalysis.status : 'skipped',
        contextPath: optionalString(raw.aiAnalysis.contextPath),
        rawOutputPath: optionalString(raw.aiAnalysis.rawOutputPath),
        summary: optionalString(raw.aiAnalysis.summary),
        suggestions: asArray<string>(raw.aiAnalysis.suggestions).filter((item) => typeof item === 'string'),
        issues: asArray(raw.aiAnalysis.issues).map(normalizeIssueLike),
        error: optionalString(raw.aiAnalysis.error)
      }
    : {
        enabled: false,
        provider: 'heuristic',
        status: 'skipped',
        suggestions: [],
        issues: []
      };

  const metadataConfig =
    isRecord(metadataRaw.config) && isRecord(metadataRaw.config.target) && typeof metadataRaw.config.target.url === 'string'
      ? (metadataRaw.config as unknown as FrontLensConfig)
      : createDefaultConfig(url);
  const fixTasks = asArray(raw.fixTasks).length > 0 ? normalizeFixTasks(raw.fixTasks) : generateFixTasks(issues, metadataConfig);
  const pageModel = normalizePageModel(raw.pageModel, url);
  const coverage = normalizeCoverage(raw.coverage, browser);
  const security = normalizeSecurity(raw.security);
  const phaseErrors = asArray<PhaseError>(metadataRaw.phaseErrors);
  const interactionTests = asArray<InteractionTestResult>(raw.interactionTests);
  const journeyTests = asArray<JourneyTestResult>(raw.journeyTests);
  const exceptionSimulations = asArray<ExceptionSimulationResult>(raw.exceptionSimulations);
  const qualityGate = normalizeQualityGate(
    raw.qualityGate,
    buildQualityGate({
      issues,
      pageModel,
      phaseErrors,
      interactionTests,
      journeyTests,
      exceptionSimulations,
      coverage,
      security
    })
  );

  return {
    summary,
    pageModel,
    issues,
    network,
    console: consoleSection,
    resources,
    performance: normalizePerformance(raw.performance),
    coverage,
    apiContract: normalizeApiContract(raw.apiContract),
    realtime: normalizeRealtime(raw.realtime),
    interactionTests,
    journeyTests,
    accessibilityChecks: asArray(raw.accessibilityChecks),
    permissionChecks: asArray(raw.permissionChecks),
    responsiveChecks: asArray(raw.responsiveChecks),
    exceptionSimulations,
    security,
    p2: normalizeP2(raw.p2),
    fixTasks,
    qualityGate,
    aiAnalysis,
    artifacts: {
      ...artifactsRaw,
      outputDir: asString(artifactsRaw.outputDir)
    } as ArtifactIndex,
    metadata: {
      config: metadataConfig,
      durationMs: asNumber(metadataRaw.durationMs, 0),
      version: asString(metadataRaw.version, 'unknown'),
      schemaVersion: asString(metadataRaw.schemaVersion, 'pre-1.1.0'),
      phaseErrors
    }
  };
}
