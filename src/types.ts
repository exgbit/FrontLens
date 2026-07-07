export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type KnownIssueCategory =
  | 'frontend-ui'
  | 'frontend-interaction'
  | 'frontend-state'
  | 'frontend-form'
  | 'frontend-table'
  | 'frontend-routing'
  | 'frontend-source-health'
  | 'frontend-permission'
  | 'frontend-accessibility'
  | 'frontend-performance'
  | 'backend-api-status'
  | 'backend-api-params'
  | 'backend-api-response'
  | 'backend-api-performance'
  | 'backend-api-auth'
  | 'backend-api-consistency'
  | 'backend-api-contract'
  | 'backend-realtime'
  | 'integration-data-mismatch'
  | 'integration-no-feedback'
  | 'integration-stale-view'
  | 'integration-pagination-mismatch'
  | 'integration-filter-mismatch'
  | 'integration-journey'
  | 'resource-loading'
  | 'resource-performance'
  | 'console-error'
  | 'frontend-visual'
  | 'seo'
  | 'security'
  | 'unknown';

export type IssueCategory = KnownIssueCategory | (string & {});

export interface BrowserConfig {
  name: BrowserName;
  headless: boolean;
  viewport: {
    width: number;
    height: number;
  };
  timeoutMs: number;
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  extraWaitMs: number;
  locale?: string;
  timezoneId?: string;
}

export interface AuthConfig {
  storageState?: string;
  sessionStorageState?: string;
  user?: string;
}

export interface SafetyConfig {
  allowCreate: boolean;
  allowEdit: boolean;
  allowDelete: boolean;
  allowUpload: boolean;
  allowDownload: boolean;
  allowSubmit: boolean;
  blockMutatingRequests: boolean;
  readOnlyPostPatterns?: string[];
}

export interface SecurityConfig {
  enabled: boolean;
  mode: 'passive' | 'active';
  checkHeaders: boolean;
  checkCookies: boolean;
  checkSensitiveData: boolean;
  checkMixedContent: boolean;
  checkThirdPartyResources: boolean;
  checkXssPassive: boolean;
  checkCsrfHints: boolean;
  checkApiLeaks: boolean;
  activeProbing: boolean;
}

export type JourneyStepAction = 'goto' | 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck' | 'expectVisible' | 'expectText' | 'expectUrl' | 'expectRequest' | 'waitForLoad' | 'waitMs';

export interface JourneyStepConfig {
  action: JourneyStepAction;
  target?: string;
  value?: string;
  timeoutMs?: number;
  allowMutating?: boolean;
  description?: string;
}

export type JourneySource = 'configured' | 'requirement-generated' | 'inferred';

export interface JourneyConfig {
  name: string;
  startUrl?: string;
  steps: JourneyStepConfig[];
  enabled?: boolean;
  source?: JourneySource;
  requirementIds?: string[];
}

export interface JourneyTestConfig {
  enabled: boolean;
  continueOnFailure: boolean;
  maxJourneys: number;
  maxStepsPerJourney: number;
  journeys: JourneyConfig[];
}

export type RequirementPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type RequirementSource = 'provided' | 'inferred';

export interface RequirementConfigItem {
  id?: string;
  title: string;
  description?: string;
  priority?: RequirementPriority;
  source?: RequirementSource;
  selectors?: string[];
  journeyNames?: string[];
  journeyStartUrl?: string;
  journeySteps?: JourneyStepConfig[];
  expectedTexts?: string[];
  interactionKinds?: InteractionTestKind[];
  apiPatterns?: string[];
}

export interface RequirementCoverageConfig {
  enabled: boolean;
  inferFromPage: boolean;
  items: RequirementConfigItem[];
}

export interface RequirementWizardCandidate extends RequirementConfigItem {
  confidence: 'high' | 'medium' | 'low';
  sourceText: string;
  rationale: string[];
  needsReview: boolean;
  reviewNotes: string[];
}

export interface RequirementWizardResult {
  generatedAt: string;
  inputPath?: string;
  requirementCount: number;
  executableAssertionCount: number;
  needsReviewCount: number;
  requirements: RequirementCoverageConfig;
  candidates: RequirementWizardCandidate[];
  warnings: string[];
  questions: string[];
}

export type ProductDeviceScope = 'unknown' | 'desktop-only' | 'desktop-first' | 'responsive' | 'mobile-first';
export type ProductAccessibilityTarget = 'unknown' | 'basic' | 'wcag-aa' | 'wcag-aaa';

export interface ProductDecisionConfig {
  id?: string;
  title: string;
  appliesTo?: string[];
  rationale?: string;
}

export interface ProductContextConfig {
  enabled: boolean;
  productName?: string;
  pageName?: string;
  pageType?: string;
  deviceScope: ProductDeviceScope;
  accessibilityTarget: ProductAccessibilityTarget;
  requiredFeatures: string[];
  optionalFeatures: string[];
  outOfScopeFeatures: string[];
  decisions: ProductDecisionConfig[];
  adrRefs: string[];
}

export type TestDataEnvironment = 'unknown' | 'local' | 'staging' | 'production';
export type TestDataRecordState = 'existing' | 'seeded' | 'generated' | 'unknown';
export type TestDataOperationType = 'manual' | 'api' | 'script' | 'sql' | 'fixture';

export interface TestDataRecordConfig {
  id: string;
  title: string;
  state: TestDataRecordState;
  requiredFor?: string[];
  expectedTexts?: string[];
  apiPatterns?: string[];
  cleanupOperationId?: string;
  sensitive?: boolean;
  owner?: string;
}

export interface TestDataOperationConfig {
  id: string;
  title: string;
  type: TestDataOperationType;
  target?: string;
  command?: string;
  endpoint?: string;
  method?: string;
  destructive?: boolean;
  rollbackOperationId?: string;
}

export interface TestDataConfig {
  enabled: boolean;
  environment: TestDataEnvironment;
  allowProductionWrites: boolean;
  records: TestDataRecordConfig[];
  setupSteps: TestDataOperationConfig[];
  cleanupSteps: TestDataOperationConfig[];
  notes: string[];
}

export interface TestDataFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'missing-data' | 'missing-cleanup' | 'production-risk' | 'sensitive-data' | 'authorization-gap' | 'review';
  message: string;
  recordId?: string;
  operationId?: string;
}

export interface TestDataAssessmentResult {
  enabled: boolean;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  checkedAt: string;
  environment: TestDataEnvironment;
  summary: {
    recordCount: number;
    setupStepCount: number;
    cleanupStepCount: number;
    generatedRecordCount: number;
    destructiveRequirementCount: number;
    destructiveOperationCount: number;
    missingCleanupCount: number;
    sensitiveRecordCount: number;
    productionRiskCount: number;
  };
  findings: TestDataFinding[];
  recommendations: string[];
}

export interface SourceAnalysisConfig {
  enabled: boolean;
  root?: string;
  maxFiles: number;
  maxBytesPerFile: number;
  include: string[];
  exclude: string[];
  runScripts: boolean;
  scriptNames: string[];
  scriptTimeoutMs: number;
  maxScriptOutputBytes: number;
}

export interface ContractConfig {
  enabled: boolean;
  schemaPath?: string;
  inferFromTraffic: boolean;
  strict: boolean;
  maxBodyExamples: number;
}

export interface RealtimeConfig {
  enabled: boolean;
  captureWebSocket: boolean;
  captureSse: boolean;
  maxMessages: number;
}

export interface P2TestConfig {
  enabled: boolean;
  visual: {
    enabled: boolean;
    baselineDir?: string;
    diffThresholdRatio: number;
  };
  budgets: {
    enabled: boolean;
    fcpMs?: number;
    loadMs?: number;
    totalTransferKb?: number;
    domNodes?: number;
    longTaskCount?: number;
    cls?: number;
  };
  networkProfiles: {
    enabled: boolean;
    profiles: Array<'offline' | 'slow-3g'>;
  };
}

export interface ExplorationConfig {
  maxDepth: number;
  maxPages: number;
  maxActionsPerPage: number;
  include: string[];
  exclude: string[];
}

export interface AnalysisConfig {
  network: boolean;
  console: boolean;
  resource: boolean;
  coverage: boolean;
  accessibility: boolean;
  seo: boolean;
  performance: boolean;
  integration: boolean;
  responsive: boolean;
  ai: boolean;
  slowRequestMs: number;
  slowResourceMs: number;
  largeResourceBytes: number;
  coverageMinBytes: number;
  coverageUnusedPercent: number;
  maxResponsePreviewBytes: number;
}

export interface ResponsiveViewportConfig {
  name: string;
  width: number;
  height: number;
}

export type ReportProfile = 'executive' | 'professional' | 'full';

export type ReportContentAuditStatus = 'passed' | 'warning' | 'failed' | 'skipped';
export type ReportContentAuditSeverity = 'blocker' | 'warning' | 'info';
export type ReportContentAuditCategory =
  | 'forbidden-wording'
  | 'profile-depth'
  | 'raw-score-caveat'
  | 'coverage-boundary'
  | 'artifact-reference'
  | 'summary-shape';

export interface ReportContentAuditFinding {
  id: string;
  severity: ReportContentAuditSeverity;
  category: ReportContentAuditCategory;
  title: string;
  evidence: string;
  recommendation: string;
}

export interface ReportContentAuditResult {
  status: ReportContentAuditStatus;
  checkedAt: string;
  profile: ReportProfile;
  summary: {
    findingCount: number;
    blockerCount: number;
    warningCount: number;
    infoCount: number;
  };
  findings: ReportContentAuditFinding[];
  notes: string[];
}

export interface ReportConfig {
  formats: Array<'json' | 'markdown' | 'html'>;
  /**
   * Controls the primary human report depth.
   * - executive: shortest decision summary in report.md.
   * - professional: default decision-oriented QA review.
   * - full: append the raw evidence appendix into report.md.
   *
   * Full raw evidence is always written to evidence-report.md regardless of profile.
   */
  profile: ReportProfile;
  outputDir: string;
  trace: boolean;
  screenshot: boolean;
  video: boolean;
  domSnapshot: boolean;
}

export interface FrontLensConfig {
  target: {
    url: string;
  };
  browser: BrowserConfig;
  auth: AuthConfig;
  safety: SafetyConfig;
  security: SecurityConfig;
  journeys: JourneyTestConfig;
  requirements: RequirementCoverageConfig;
  productContext: ProductContextConfig;
  testData: TestDataConfig;
  source: SourceAnalysisConfig;
  contract: ContractConfig;
  realtime: RealtimeConfig;
  p2: P2TestConfig;
  exploration: ExplorationConfig;
  analysis: AnalysisConfig;
  responsive: {
    viewports: ResponsiveViewportConfig[];
  };
  exception: {
    enabled: boolean;
    delayMs: number;
  };
  plugins: {
    analyzers: string[];
    reporters: string[];
    rules: string[];
  };
  ai: {
    provider: 'heuristic' | 'command';
    command?: string;
    maxIssues: number;
    maxContextBytes: number;
  };
  report: ReportConfig;
}

export interface QaRunInput {
  url: string;
  configPath?: string;
  outputDir?: string;
  browser?: BrowserName;
  headless?: boolean;
  storageState?: string;
  sessionStorageState?: string;
  trace?: boolean;
  video?: boolean;
  screenshot?: boolean;
  reportProfile?: ReportProfile;
  simulateExceptions?: boolean;
  ai?: boolean;
  coverage?: boolean;
  blockMutatingRequests?: boolean;
  security?: boolean;
  journeys?: boolean;
  contract?: boolean;
  realtime?: boolean;
  p2?: boolean;
  requirementsPath?: string;
  sourceRoot?: string;
  sourceRunScripts?: boolean;
  sourceScripts?: string[];
  sourceScriptTimeoutMs?: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementEvidence {
  selector?: string;
  text?: string;
  role?: string;
  tagName?: string;
  attributes?: Record<string, string>;
}

export interface ComponentRecord {
  id: string;
  type:
    | 'title'
    | 'breadcrumb'
    | 'menu'
    | 'tab'
    | 'card'
    | 'form'
    | 'input'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'datepicker'
    | 'cascader'
    | 'tree'
    | 'upload'
    | 'table'
    | 'list'
    | 'grid'
    | 'pagination'
    | 'button'
    | 'dropdown'
    | 'drawer'
    | 'dialog'
    | 'modal'
    | 'tooltip'
    | 'popconfirm'
    | 'switch'
    | 'badge'
    | 'tag'
    | 'steps'
    | 'timeline'
    | 'image'
    | 'link'
    | 'unknown';
  label?: string;
  text?: string;
  selector?: string;
  role?: string;
  tagName?: string;
  visible: boolean;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  value?: string;
  attributes: Record<string, string>;
  boundingBox?: BoundingBox;
  childrenCount?: number;
  rowCount?: number;
  columnCount?: number;
  headers?: string[];
  hasHorizontalOverflow?: boolean;
  hasOperationColumn?: boolean;
  hasSelection?: boolean;
  emptyStateText?: string;
  confidence: number;
}

export interface PageModel {
  url: string;
  title: string;
  meta: {
    description?: string;
    canonical?: string;
    h1: string[];
    viewport?: string;
    openGraph: Record<string, string>;
  };
  breadcrumbs: string[];
  headings: Array<{ level: number; text: string }>;
  structureTree: string;
  components: ComponentRecord[];
  forms: ComponentRecord[];
  tables: ComponentRecord[];
  buttons: ComponentRecord[];
  inputs: ComponentRecord[];
  images: ComponentRecord[];
  links: ComponentRecord[];
  stats: {
    domNodes: number;
    visibleTextLength: number;
    bodyTextSample: string;
  };
}

export interface NetworkRecord {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string | null;
  status?: number;
  statusText?: string;
  ok?: boolean;
  failed: boolean;
  failureText?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  responseBodyPreview?: string;
  responseBodyTruncated?: boolean;
  contentType?: string;
  encodedBodySize?: number;
  transferSize?: number;
  protocol?: 'rest' | 'graphql' | 'sse' | 'unknown';
  graphql?: {
    operationName?: string;
    operationType?: 'query' | 'mutation' | 'subscription' | 'unknown';
    variablesPreview?: string;
  };
  sse?: {
    detected: boolean;
  };
}

export interface ConsoleRecord {
  id: string;
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  timestamp: string;
  argsPreview?: string[];
}

export interface PageErrorRecord {
  id: string;
  name?: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export interface ResourceRecord {
  name: string;
  initiatorType: string;
  durationMs: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  startTime?: number;
}

export interface PerformanceMetrics {
  collectedAt: string;
  navigation?: {
    startTime: number;
    domContentLoadedMs?: number;
    loadMs?: number;
    responseEndMs?: number;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
  };
  paint: {
    firstPaintMs?: number;
    firstContentfulPaintMs?: number;
  };
  longTasks: {
    count: number;
    totalDurationMs: number;
    maxDurationMs: number;
  };
  layoutShift: {
    score: number;
    count: number;
  };
  resources: {
    count: number;
    totalTransferSize: number;
    totalEncodedBodySize: number;
    slowest: Array<{ name: string; initiatorType: string; durationMs: number }>;
  };
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
  dom: {
    nodeCount: number;
    maxDepth: number;
  };
  mutations?: {
    count: number;
  };
}

export interface CoverageEntry {
  id: string;
  type: 'js' | 'css';
  url: string;
  source: 'network' | 'inline' | 'eval' | 'unknown';
  totalBytes: number;
  usedBytes: number;
  unusedBytes: number;
  unusedPercent: number;
  rangesUsed: number;
  details?: unknown;
}

export interface CoverageResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  browser: BrowserName;
  collectedAt: string;
  message?: string;
  totals: {
    js: {
      totalBytes: number;
      usedBytes: number;
      unusedBytes: number;
      unusedPercent: number;
    };
    css: {
      totalBytes: number;
      usedBytes: number;
      unusedBytes: number;
      unusedPercent: number;
    };
    all: {
      totalBytes: number;
      usedBytes: number;
      unusedBytes: number;
      unusedPercent: number;
    };
  };
  entries: CoverageEntry[];
  topUnused: CoverageEntry[];
}

export type InteractionTestKind =
  | 'search'
  | 'reset'
  | 'pagination'
  | 'dialog'
  | 'tab'
  | 'table-sort'
  | 'table-selection'
  | 'refresh'
  | 'download'
  | 'rapid-click'
  | 'upload'
  | 'form-validation';
export type InteractionTestStatus = 'passed' | 'warning' | 'failed' | 'skipped';

export interface DownloadContentSummary {
  kind: 'empty' | 'text' | 'csv' | 'json' | 'binary' | 'unknown';
  extension?: string;
  mimeGuess?: string;
  parseStatus: 'passed' | 'warning' | 'failed' | 'skipped';
  textPreview?: string;
  lineCount?: number;
  rowCount?: number;
  columnCount?: number;
  headers?: string[];
  jsonTopLevelType?: string;
  issue?: string;
}

export interface InteractionTestResult {
  id: string;
  kind: InteractionTestKind;
  target: string;
  selector?: string;
  status: InteractionTestStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  actions: string[];
  observations: {
    beforeUrl?: string;
    afterUrl?: string;
    beforeValue?: string;
    afterValue?: string;
    networkRequestIds?: string[];
    consoleIds?: string[];
    pageErrorIds?: string[];
    dialogDetected?: boolean;
    downloadSuggestedFilename?: string;
    downloadPath?: string;
    downloadSizeBytes?: number;
    downloadSha256?: string;
    downloadContent?: DownloadContentSummary;
    downloadFailure?: string | null;
    valueChanged?: boolean;
    urlChanged?: boolean;
    bodyTextChanged?: boolean;
    requestParamChecks?: Array<{
      requestId: string;
      expected: string;
      matched: boolean;
      reason: string;
    }>;
    error?: string;
    details?: unknown;
  };
  issue?: string;
  suggestion?: IssueSuggestion;
}

export interface JourneyStepResult {
  index: number;
  action: JourneyStepAction;
  target?: string;
  value?: string;
  status: InteractionTestStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  error?: string;
  networkRequestIds?: string[];
  consoleIds?: string[];
  pageErrorIds?: string[];
  downloadSuggestedFilename?: string;
  downloadPath?: string;
  downloadSizeBytes?: number;
  downloadSha256?: string;
  downloadContent?: DownloadContentSummary;
  downloadFailure?: string | null;
  details?: unknown;
}

export interface JourneyTestResult {
  id: string;
  name: string;
  source?: JourneySource;
  requirementIds?: string[];
  status: InteractionTestStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  startUrl: string;
  finalUrl?: string;
  steps: JourneyStepResult[];
  issue?: string;
  suggestion?: IssueSuggestion;
}

export interface ResponsiveCheckResult {
  name: string;
  width: number;
  height: number;
  screenshot?: string;
  checkedAt: string;
  horizontalOverflow: boolean;
  maxScrollWidth: number;
  viewportWidth: number;
  bodyScrollWidth: number;
  clippedInteractiveCount: number;
  smallTapTargetCount: number;
  fixedElementCount: number;
  tableOverflowCount: number;
  observations: string[];
}

export interface AccessibilityCheckResult {
  id: string;
  rule:
    | 'image-alt'
    | 'form-label'
    | 'button-name'
    | 'link-name'
    | 'positive-tabindex'
    | 'dialog-name'
    | 'color-contrast'
    | 'focusability';
  status: 'passed' | 'warning' | 'failed';
  severity: Severity;
  title: string;
  description: string;
  count: number;
  nodes: Array<{
    selector: string;
    text?: string;
    tagName?: string;
    details?: unknown;
  }>;
  suggestion: IssueSuggestion;
}

export interface PermissionCheckResult {
  id: string;
  rule: 'api-auth' | 'permission-markers' | 'visible-danger' | 'disabled-actions' | 'page-permission';
  status: 'passed' | 'warning' | 'failed';
  severity: Severity;
  title: string;
  description: string;
  count: number;
  evidence: Array<{
    selector?: string;
    componentId?: string;
    networkRequestId?: string;
    text?: string;
    details?: unknown;
  }>;
  suggestion: IssueSuggestion;
}

export type ExceptionSimulationKind = 'api-500' | 'api-404' | 'api-401' | 'api-403' | 'api-timeout' | 'offline' | 'page-refresh';

export interface ExceptionSimulationResult {
  id: string;
  kind: ExceptionSimulationKind;
  target?: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  observations: {
    bodyHasErrorFeedback?: boolean;
    bodyTextSample?: string;
    networkRequestIds?: string[];
    consoleIds?: string[];
    pageErrorIds?: string[];
    error?: string;
    details?: unknown;
  };
  issue?: string;
  suggestion?: IssueSuggestion;
}

export interface AiAnalysisResult {
  enabled: boolean;
  provider: 'heuristic' | 'command';
  status: 'skipped' | 'passed' | 'failed';
  contextPath?: string;
  rawOutputPath?: string;
  summary?: string;
  suggestions: string[];
  issues: Issue[];
  error?: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export interface SourceImportRecord extends SourceLocation {
  source: string;
  kind: 'static' | 'dynamic';
  specifier?: string;
  isRouteComponent: boolean;
  isHeavy: boolean;
}

export interface SourceRouteRecord extends SourceLocation {
  path?: string;
  name?: string;
  component?: string;
  lazy: boolean;
}

export interface SourceApiRecord extends SourceLocation {
  method?: string;
  path?: string;
  client?: string;
  expression: string;
}

export interface SourceStateSignal extends SourceLocation {
  kind: 'loading' | 'error' | 'empty' | 'retry';
  text: string;
}

export interface SourceAnalysisResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  checkedAt: string;
  root?: string;
  error?: string;
  scannedFiles: number;
  scannedBytes: number;
  summary: {
    routeFileCount: number;
    routeCount: number;
    eagerRouteImportCount: number;
    heavyImportCount: number;
    apiCallCount: number;
    errorStateSignalCount: number;
    emptyStateSignalCount: number;
  };
  routeFiles: string[];
  routes: SourceRouteRecord[];
  imports: SourceImportRecord[];
  apiCalls: SourceApiRecord[];
  stateSignals: SourceStateSignal[];
  findings: Array<{
    id: string;
    kind: 'eager-route-imports' | 'heavy-import' | 'api-surface' | 'state-signal' | 'ui-accessibility' | 'error-state-gap';
    severity: Severity;
    title: string;
    locations: SourceLocation[];
    details: Record<string, unknown>;
  }>;
}

export interface SourceRuntimeListHint {
  path: string;
  length: number;
  sampleKeys: string[];
}

export interface SourceRuntimeLink {
  id: string;
  networkRequestId: string;
  method: string;
  url: string;
  path: string;
  status?: number;
  sourceMatches: SourceApiRecord[];
  stateSignals: SourceStateSignal[];
  componentIds: string[];
  responseListHints: SourceRuntimeListHint[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  notes: string[];
}

export interface SourceRuntimeCorrelationResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  checkedAt: string;
  summary: {
    networkRequestCount: number;
    linkedRequestCount: number;
    strongLinkCount: number;
    unlinkedRequestCount: number;
    listResponseLinkCount: number;
  };
  links: SourceRuntimeLink[];
  gaps: string[];
  error?: string;
}

export interface EnvironmentAssessment {
  checkedAt: string;
  targetUrl: string;
  finalUrl?: string;
  origin?: string;
  kind: 'production-like' | 'local-dev' | 'local-preview' | 'staging-or-private' | 'file' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  isLocalOrPrivate: boolean;
  isHttps: boolean;
  isViteDevServer: boolean;
  hasHmr: boolean;
  sameOriginRequestCount: number;
  devModuleRequestCount: number;
  hashedAssetCount: number;
  trust: {
    functional: 'high' | 'medium' | 'low';
    performance: 'high' | 'medium' | 'low';
    security: 'high' | 'medium' | 'low';
    businessSignoff: 'high' | 'medium' | 'low';
  };
  evidence: string[];
  warnings: string[];
  recommendations: string[];
}

export type PageProfileType =
  | 'credential-security'
  | 'admin-data-list'
  | 'admin-dashboard'
  | 'form-flow'
  | 'detail-master'
  | 'auth-login'
  | 'public-content'
  | 'unknown';

export interface PageProfileSuggestion {
  pageType?: PageProfileType;
  deviceScope?: ProductDeviceScope;
  accessibilityTarget?: ProductAccessibilityTarget;
  requiredFeatures: string[];
  optionalFeatures: string[];
  outOfScopeFeatures: string[];
  decisions: ProductDecisionConfig[];
}

export interface PageProfileAssessment {
  checkedAt: string;
  status: 'configured' | 'inferred' | 'unknown';
  pageType: PageProfileType;
  configuredPageType?: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'productContext' | 'heuristic' | 'none';
  signals: string[];
  suggestedProductContext: PageProfileSuggestion;
  caveats: string[];
  questions: string[];
}

export interface ScopeReviewQuestion {
  id: string;
  category: 'requirement' | 'product' | 'device' | 'accessibility' | 'feature' | 'role' | 'test-data' | 'environment';
  question: string;
  impact: string;
  defaultDisposition: string;
}

export interface ScopeReviewResult {
  generatedAt: string;
  status: 'configured' | 'needs-input';
  confidence: 'high' | 'medium' | 'low';
  pageType: PageProfileType;
  summary: string;
  questions: ScopeReviewQuestion[];
  suggestedProductContext: ProductContextConfig;
  configSnippet: {
    productContext: ProductContextConfig;
  };
  notes: string[];
}

export interface ProductContextSuggestionResult {
  generatedAt: string;
  status: ScopeReviewResult['status'];
  confidence: ScopeReviewResult['confidence'];
  pageType: PageProfileType;
  summary: string;
  productContext: ProductContextConfig;
  questions: ScopeReviewQuestion[];
  notes: string[];
  usage: {
    configKey: 'productContext';
    /** Direct FrontLens config file path written by QA runs, when available. */
    configPath?: string;
    configSnippet: {
      productContext: ProductContextConfig;
    };
    rerunCommand: string;
  };
}

export interface SourceHealthScript {
  name: string;
  command: string;
  category: 'build' | 'typecheck' | 'lint' | 'test' | 'e2e' | 'coverage' | 'other';
}

export interface SourceHealthFinding {
  id: string;
  kind: 'syntax-error';
  severity: Severity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: number;
}

export interface SourceScriptCheck {
  id: string;
  scriptName: string;
  command: string;
  category: SourceHealthScript['category'];
  status: 'passed' | 'failed' | 'skipped' | 'timed-out';
  durationMs: number;
  exitCode?: number;
  signal?: string;
  stdoutPreview?: string;
  stderrPreview?: string;
  error?: string;
}

export interface SourceHealthResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  checkedAt: string;
  root?: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  packageScripts: SourceHealthScript[];
  scriptChecks: SourceScriptCheck[];
  scannedFiles: number;
  parsedFiles: number;
  skippedFiles: number;
  syntaxErrorCount: number;
  findings: SourceHealthFinding[];
  error?: string;
}

export type SecurityCheckCategory =
  | 'headers'
  | 'cookies'
  | 'sensitive-data'
  | 'mixed-content'
  | 'third-party'
  | 'xss-passive'
  | 'csrf'
  | 'api-leak'
  | 'transport'
  | 'active-probing';

export interface SecurityCheckResult {
  id: string;
  category: SecurityCheckCategory;
  rule: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  severity: Severity;
  title: string;
  description: string;
  evidence: Array<{
    networkRequestId?: string;
    selector?: string;
    url?: string;
    header?: string;
    cookieName?: string;
    storage?: 'localStorage' | 'sessionStorage';
    key?: string;
    details?: unknown;
  }>;
  suggestion: IssueSuggestion;
}

export interface SecurityScanResult {
  enabled: boolean;
  mode: 'passive' | 'active';
  score: number;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  checkedAt: string;
  summary: {
    checkCount: number;
    failedCount: number;
    warningCount: number;
    passedCount: number;
    skippedCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
  };
  checks: SecurityCheckResult[];
}

export interface ApiEndpointContract {
  method: string;
  path: string;
  requestCount: number;
  statusCodes: number[];
  contentTypes: string[];
  requestShape?: unknown;
  responseShape?: unknown;
  schemaMatched?: boolean;
  issues: Array<{
    rule: string;
    severity: Severity;
    message: string;
    networkRequestIds: string[];
  }>;
}

export interface ApiContractResult {
  enabled: boolean;
  schemaPath?: string;
  checkedAt: string;
  summary: {
    endpointCount: number;
    undocumentedCount: number;
    statusMismatchCount: number;
    schemaMismatchCount: number;
    inferredCount: number;
  };
  endpoints: ApiEndpointContract[];
}

export interface GraphQLRecord {
  id: string;
  networkRequestId: string;
  operationName?: string;
  operationType: 'query' | 'mutation' | 'subscription' | 'unknown';
  status?: number;
  hasErrors: boolean;
  errorPreview?: string;
  variablesPreview?: string;
}

export interface WebSocketRecord {
  id: string;
  url: string;
  openedAt: string;
  closedAt?: string;
  framesSent: number;
  framesReceived: number;
  errors: string[];
  samples: Array<{ direction: 'sent' | 'received'; timestamp: string; payloadPreview: string }>;
}

export interface SseRecord {
  id: string;
  networkRequestId: string;
  url: string;
  status?: number;
  contentType?: string;
  durationMs?: number;
}

export interface RealtimeResult {
  enabled: boolean;
  checkedAt: string;
  graphql: GraphQLRecord[];
  webSockets: WebSocketRecord[];
  sse: SseRecord[];
  summary: {
    graphqlOperationCount: number;
    graphqlErrorCount: number;
    webSocketCount: number;
    webSocketErrorCount: number;
    sseCount: number;
  };
}

export type RequirementCoverageStatus = 'passed' | 'failed' | 'partial' | 'not-covered' | 'not-applicable';

export interface RequirementCoverageItem {
  id: string;
  title: string;
  description?: string;
  priority: RequirementPriority;
  source: RequirementSource;
  status: RequirementCoverageStatus;
  confidence: 'high' | 'medium' | 'low';
  evidence: {
    selectors: string[];
    componentIds: string[];
    journeyIds: string[];
    interactionTestIds: string[];
    networkRequestIds: string[];
    issueIds: string[];
    notes: string[];
  };
  gaps: string[];
}

export interface RequirementCoverageResult {
  enabled: boolean;
  checkedAt: string;
  source: 'provided' | 'inferred' | 'mixed' | 'none';
  summary: {
    requirementCount: number;
    passedCount: number;
    failedCount: number;
    partialCount: number;
    notCoveredCount: number;
    notApplicableCount: number;
    providedCount: number;
    inferredCount: number;
    highPriorityGapCount: number;
  };
  items: RequirementCoverageItem[];
  gaps: string[];
}

export interface P2TestResult {
  enabled: boolean;
  checkedAt: string;
  visual: {
    enabled: boolean;
    status: 'passed' | 'warning' | 'failed' | 'skipped';
    currentScreenshot?: string;
    baselinePath?: string;
    diffScreenshot?: string;
    diffMethod?: 'pixel' | 'byte-fallback';
    diffRatio?: number;
    changedPixelCount?: number;
    totalPixelCount?: number;
    sizeMismatch?: boolean;
    currentSize?: { width: number; height: number };
    baselineSize?: { width: number; height: number };
    diffBoundingBox?: { x: number; y: number; width: number; height: number };
    message?: string;
  };
  budgets: Array<{
    metric: string;
    actual: number;
    budget: number;
    status: 'passed' | 'failed' | 'skipped';
    unit: string;
  }>;
  networkProfiles: Array<{
    profile: 'offline' | 'slow-3g';
    status: InteractionTestStatus;
    observations: string[];
    screenshot?: string;
    error?: string;
  }>;
}

export interface RootCauseGroup {
  id: string;
  rootCauseKey: string;
  title: string;
  status: 'actionable' | 'reference';
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  severity: Severity;
  issueIds: string[];
  issueCount: number;
  categories: IssueCategory[];
  selectors: string[];
  networkRequestIds: string[];
  consoleIds: string[];
  pageErrorIds: string[];
  resourceUrls: string[];
  sourceLocations: SourceLocation[];
  summary: string;
  suggestedFix: string;
  verificationCommand: string;
}

export type IssueDispositionStatus =
  | 'confirmed'
  | 'needs-source-confirmation'
  | 'deployment-only'
  | 'product-decision'
  | 'tool-limitation'
  | 'insufficient-evidence'
  | 'reference';

export type IssueDispositionBucket =
  | 'real-frontend-fix'
  | 'backend-api-fix'
  | 'deployment-security-config'
  | 'product-decision'
  | 'tool-limitation'
  | 'coverage-gap'
  | 'reference';

export interface IssueDispositionItem {
  issueId: string;
  fingerprint?: string;
  title: string;
  category: IssueCategory;
  severity: Severity;
  status: IssueDispositionStatus;
  bucket: IssueDispositionBucket;
  actionability: 'actionable' | 'conditional' | 'non-actionable';
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  evidenceStrength: 'strong' | 'medium' | 'weak';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  nextStep: string;
  rootCauseGroupId?: string;
}

export interface IssueDispositionResult {
  checkedAt: string;
  targetUrl: string;
  summary: {
    totalCount: number;
    actionableCount: number;
    conditionalCount: number;
    nonActionableCount: number;
    confirmedCount: number;
    needsSourceConfirmationCount: number;
    deploymentOnlyCount: number;
    productDecisionCount: number;
    toolLimitationCount: number;
    insufficientEvidenceCount: number;
    referenceCount: number;
    bucketCounts: Record<IssueDispositionBucket, number>;
    statusCounts: Record<IssueDispositionStatus, number>;
  };
  items: IssueDispositionItem[];
}

export interface FixTask {
  id: string;
  issueIds: string[];
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  type: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  target?: string;
  expectedChange: string;
  evidence: IssueEvidence;
  verificationCommand: string;
}

export type RegressionPlanStatus = 'ready' | 'partial' | 'blocked';
export type RegressionPlanItemType =
  | 'full-rerun'
  | 'root-cause'
  | 'requirement'
  | 'journey'
  | 'source-health'
  | 'download'
  | 'environment'
  | 'artifact-integrity'
  | 'defect-proof'
  | 'role-matrix';

export interface RegressionPlanItem {
  id: string;
  type: RegressionPlanItemType;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  title: string;
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  status: 'ready' | 'needs-input' | 'blocked';
  commands: string[];
  steps: string[];
  expected: string[];
  evidenceRefs: string[];
  issueIds?: string[];
  requirementIds?: string[];
  journeyIds?: string[];
  notes?: string[];
}

export interface RegressionPlanResult {
  status: RegressionPlanStatus;
  generatedAt: string;
  summary: {
    itemCount: number;
    commandCount: number;
    blockedCount: number;
    needsInputCount: number;
    highPriorityCount: number;
  };
  commands: string[];
  items: RegressionPlanItem[];
  notes: string[];
}


export type QaCoverageMatrixStatus = 'covered' | 'partial' | 'skipped' | 'needs-input' | 'failed';
export type QaCoverageMatrixArea =
  | 'runtime'
  | 'requirements'
  | 'journey'
  | 'interaction'
  | 'exception'
  | 'api-network'
  | 'source'
  | 'accessibility'
  | 'responsive'
  | 'performance'
  | 'security'
  | 'environment'
  | 'product-scope'
  | 'test-data'
  | 'artifact'
  | 'triage';

export interface QaCoverageMatrixItem {
  id: string;
  area: QaCoverageMatrixArea;
  title: string;
  status: QaCoverageMatrixStatus;
  confidence: 'high' | 'medium' | 'low';
  evidenceRefs: string[];
  covered: string[];
  gaps: string[];
  nextSteps: string[];
}

export interface QaCoverageMatrixResult {
  generatedAt: string;
  status: 'sufficient' | 'partial' | 'insufficient';
  confidence: 'high' | 'medium' | 'low';
  summary: {
    itemCount: number;
    coveredCount: number;
    partialCount: number;
    skippedCount: number;
    needsInputCount: number;
    failedCount: number;
    blockerCount: number;
  };
  items: QaCoverageMatrixItem[];
  notes: string[];
}

export type QaExecutionPlanStatus = 'ready' | 'needs-input' | 'blocked';
export type QaExecutionPlanItemType =
  | 'rerun'
  | 'requirement'
  | 'journey'
  | 'root-cause'
  | 'defect-proof'
  | 'environment'
  | 'product-context'
  | 'test-data'
  | 'artifact-integrity'
  | 'download'
  | 'source-health'
  | 'role-matrix';

export interface QaExecutionPlanItem {
  id: string;
  type: QaExecutionPlanItemType;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  status: 'ready' | 'needs-input' | 'blocked';
  title: string;
  why: string;
  commands: string[];
  steps: string[];
  expected: string[];
  evidenceRefs: string[];
  issueIds?: string[];
  requirementIds?: string[];
  journeyIds?: string[];
  notes?: string[];
}

export interface QaExecutionPlanResult {
  generatedAt: string;
  status: QaExecutionPlanStatus;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  scope: {
    targetUrl: string;
    sourceRoot?: string;
    signoffStatus: QaSignoffResult['status'];
    businessValidationConfidence: BusinessValidationConfidence;
    requirementSource: RequirementCoverageResult['source'];
    environmentKind: EnvironmentAssessment['kind'];
    pageType: PageProfileType;
  };
  commands: {
    fullRerun: string;
    productContextRerun?: string;
    envCompare?: string;
    roleMatrix?: string;
  };
  items: QaExecutionPlanItem[];
  blockers: string[];
  notes: string[];
}

export type ProfessionalSummaryItemKind =
  | 'defect'
  | 'coverage-gap'
  | 'release-risk'
  | 'non-defect'
  | 'deployment'
  | 'product-decision'
  | 'tool-limitation'
  | 'next-action';

export interface ProfessionalSummaryItem {
  id: string;
  kind: ProfessionalSummaryItemKind;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  title: string;
  rationale: string;
  action: string;
  evidenceRefs: string[];
  issueIds?: string[];
  requirementIds?: string[];
  journeyIds?: string[];
  rootCauseGroupId?: string;
}

export interface ProfessionalSummaryResult {
  status: QaSignoffResult['status'];
  confidence: QaSignoffResult['confidence'];
  businessValidationConfidence: BusinessValidationConfidence;
  generatedAt: string;
  headline: string;
  counts: {
    actionableRootCauseCount: number;
    proofReadyRootCauseCount: number;
    p0p1DefectCount: number;
    defectProofNeedsEvidenceCount: number;
    defectProofBlockedCount: number;
    nonDefectFindingCount: number;
    coverageGapCount: number;
    releaseRiskCount: number;
    regressionBlockedCount: number;
    regressionNeedsInputCount: number;
  };
  mustFix: ProfessionalSummaryItem[];
  shouldFix: ProfessionalSummaryItem[];
  nonDefectObservations: ProfessionalSummaryItem[];
  coverageGaps: ProfessionalSummaryItem[];
  releaseRisks: ProfessionalSummaryItem[];
  nextActions: ProfessionalSummaryItem[];
  notes: string[];
}

export type ClaimGuardClaimType =
  | 'business-validation'
  | 'release-signoff'
  | 'production-performance'
  | 'production-security'
  | 'frontend-defect'
  | 'api-ui-data-binding'
  | 'download-export'
  | 'source-health';

export interface ClaimGuardItem {
  id: string;
  claim: ClaimGuardClaimType;
  status: 'allowed' | 'limited' | 'blocked';
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  allowedWording: string;
  forbiddenWording: string[];
  evidenceRefs: string[];
  requiredInputs: string[];
}

export interface ClaimGuardResult {
  generatedAt: string;
  status: 'clear' | 'limited' | 'blocked';
  summary: string;
  items: ClaimGuardItem[];
  forbiddenClaims: string[];
  requiredInputs: string[];
  notes: string[];
}

export type QaIntakeCategory =
  | 'requirements'
  | 'product-scope'
  | 'role-auth'
  | 'test-data'
  | 'environment'
  | 'source-health'
  | 'journey'
  | 'download-export'
  | 'claim-guard'
  | 'artifact-integrity'
  | 'regression';

export interface QaIntakeQuestion {
  id: string;
  category: QaIntakeCategory;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  question: string;
  why: string;
  howToAnswer: string;
  evidenceRefs: string[];
  blocksClaims: ClaimGuardClaimType[];
  configHint?: string;
}

export interface QaIntakeResult {
  generatedAt: string;
  status: 'ready' | 'needs-input' | 'blocked';
  summary: string;
  topQuestions: QaIntakeQuestion[];
  questions: QaIntakeQuestion[];
  readyToProceed: string[];
  configHints: string[];
  notes: string[];
}

export type DefectProofStrength = 'strong' | 'medium' | 'weak' | 'missing' | 'not-needed';

export interface DefectProofDimension {
  strength: DefectProofStrength;
  reason: string;
  evidenceRefs: string[];
}

export interface DefectProofItem {
  id: string;
  rootCauseGroupId: string;
  issueIds: string[];
  title: string;
  owner: RootCauseGroup['owner'];
  priority: RootCauseGroup['priority'];
  status: 'proven' | 'probable' | 'needs-evidence' | 'not-a-defect';
  confidence: 'high' | 'medium' | 'low';
  score: number;
  dimensions: {
    userImpact: DefectProofDimension;
    runtimeEvidence: DefectProofDimension;
    sourceEvidence: DefectProofDimension;
    requirementEvidence: DefectProofDimension;
    productScope: DefectProofDimension;
    reproducibility: DefectProofDimension;
    ownerFixSurface: DefectProofDimension;
  };
  missingEvidence: string[];
  nextSteps: string[];
  evidenceRefs: string[];
}

export interface DefectProofResult {
  generatedAt: string;
  status: 'ready' | 'needs-evidence' | 'blocked';
  summary: string;
  counts: {
    total: number;
    proven: number;
    probable: number;
    needsEvidence: number;
    notDefect: number;
  };
  items: DefectProofItem[];
  notes: string[];
}

export interface QaQualityGate {
  status: 'pass' | 'pass-with-risks' | 'fail' | 'blocked';
  confidence: 'high' | 'medium' | 'low';
  checkedAt: string;
  actionableIssueCount: number;
  referenceIssueCount: number;
  blockingIssueCount: number;
  mediumRiskCount: number;
  coverageGapCount: number;
  coverageGaps: string[];
  reasons: string[];
  summary: string;
}

export type BusinessValidationConfidence = 'runtime-verified' | 'runtime-partial' | 'static-source-only' | 'not-verified';

export interface QaSignoffResult {
  status: 'pass' | 'pass-with-risks' | 'fail' | 'blocked';
  confidence: 'high' | 'medium' | 'low';
  businessValidationConfidence: BusinessValidationConfidence;
  checkedAt: string;
  summary: string;
  scope: {
    targetUrl: string;
    sourceRoot?: string;
    requirementSource: RequirementCoverageResult['source'];
    providedRequirementCount: number;
    inferredRequirementCount: number;
    journeyCount: number;
    passedJourneyCount: number;
    failedJourneyCount: number;
    assertionStepCount: number;
    passedAssertionStepCount: number;
    passedJourneyWithAssertionCount: number;
    passedJourneyWithoutAssertionCount: number;
    interactionCount: number;
    passedInteractionCount: number;
    failedInteractionCount: number;
    exceptionCount: number;
    failedExceptionCount: number;
    authStateProvided: boolean;
    destructiveActionsAllowed: boolean;
    environmentKind: EnvironmentAssessment['kind'];
    environmentConfidence: EnvironmentAssessment['confidence'];
    pageProfileStatus: PageProfileAssessment['status'];
    pageProfileType: PageProfileAssessment['pageType'];
    sourceHealthStatus: SourceHealthResult['status'];
    artifactIntegrityStatus: ArtifactIntegrityResult['status'];
  };
  blockers: string[];
  risks: string[];
  coverageGaps: string[];
  requiredFollowups: string[];
  evidence: string[];
}

export interface ResultDiff {
  before: { url: string; score: number; issueCount: number; testedAt: string };
  after: { url: string; score: number; issueCount: number; testedAt: string };
  scoreDelta: number;
  addedIssues: Issue[];
  resolvedIssues: Issue[];
  persistentIssues: Array<{ before: Issue; after: Issue }>;
  changedSeverity: Array<{ fingerprint: string; before: Severity; after: Severity; title: string }>;
  securityScoreDelta?: number;
  performance: {
    fcpDeltaMs?: number;
    loadDeltaMs?: number;
    transferDeltaBytes?: number;
  };
}

export interface EnvironmentComparisonRunSummary {
  url: string;
  environmentKind: EnvironmentAssessment['kind'];
  performanceTrust: EnvironmentAssessment['trust']['performance'];
  securityTrust: EnvironmentAssessment['trust']['security'];
  score: number;
  issueCount: number;
  qaSignoffStatus: QaSignoffResult['status'];
  qaSignoffConfidence: QaSignoffResult['confidence'];
  reportPath?: string;
  jsonPath?: string;
}

export interface EnvironmentComparisonResult {
  checkedAt: string;
  outputDir: string;
  dev: EnvironmentComparisonRunSummary;
  preview: EnvironmentComparisonRunSummary;
  diff: ResultDiff;
  interpretation: {
    productionReadiness: 'production-evidence' | 'pre-production-evidence' | 'invalid-preview' | 'blocked';
    persistentIssueCount: number;
    devOnlyIssueCount: number;
    previewOnlyIssueCount: number;
    highConfidenceIssueCount: number;
    devArtifactIssueCount: number;
  };
  recommendations: string[];
  artifacts: {
    json: string;
    markdown: string;
    devResult?: string;
    previewResult?: string;
  };
}

export interface RoleMatrixRoleConfig {
  name: string;
  storageState?: string;
  sessionStorageState?: string;
  expectedAllowedTexts?: string[];
  expectedForbiddenTexts?: string[];
}

export interface RoleMatrixRunItem {
  role: string;
  success: boolean;
  outputDir: string;
  storageStateProvided: boolean;
  sessionStorageStateProvided: boolean;
  /** Raw score, kept for scanner trend comparison. */
  score?: number;
  /** Professional/actionability-aware score. */
  adjustedScore?: number;
  issueCount?: number;
  adjustedIssueCount?: number;
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  infoCount?: number;
  qaSignoffStatus?: QaSignoffResult['status'];
  qaSignoffConfidence?: QaSignoffResult['confidence'];
  businessValidationConfidence?: BusinessValidationConfidence;
  title?: string;
  finalUrl?: string;
  componentCount?: number;
  actionLabels?: string[];
  dangerousActionLabels?: string[];
  permissionIssueCount?: number;
  authIssueCount?: number;
  expectedAllowedMissing?: string[];
  expectedForbiddenVisible?: string[];
  screenshot?: string;
  jsonReport?: string;
  markdownReport?: string;
  qaReview?: string;
  error?: string;
}

export interface RoleMatrixResult {
  url: string;
  testedAt: string;
  outputDir: string;
  roles: RoleMatrixRunItem[];
  comparison: {
    successfulRoleCount: number;
    failedRoleCount: number;
    roleSpecificIssueTitles: Record<string, string[]>;
    sharedIssueTitles: string[];
    roleSpecificActionLabels: Record<string, string[]>;
    sharedActionLabels: string[];
    dangerousActionsByRole: Record<string, string[]>;
    lowPrivilegeDangerousActionRoles: string[];
    expectedForbiddenViolations: Record<string, string[]>;
    expectedAllowedGaps: Record<string, string[]>;
    permissionRiskCount: number;
    authRiskCount: number;
  };
  recommendations: string[];
  artifacts: {
    json: string;
    markdown: string;
  };
}

export interface ArtifactIntegrityEntry {
  source: string;
  path: string;
  absolutePath?: string;
  kind: 'file' | 'directory';
  expected: boolean;
  exists: boolean;
  sizeBytes?: number;
  issueId?: string;
  message?: string;
}

export interface ArtifactIntegrityResult {
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  checkedAt: string;
  presentCount: number;
  missingCount: number;
  skippedCount: number;
  entries: ArtifactIntegrityEntry[];
  missing: ArtifactIntegrityEntry[];
  summary: string;
}

export interface ArtifactIndex {
  [key: string]: unknown;
  outputDir: string;
  /** Concise professional report intended as the default human-facing Markdown. */
  markdownReport?: string;
  /** Full raw evidence appendix for drill-down; not the default work queue. */
  evidenceReport?: string;
  /** One-page professional QA brief intended as the default LLM/user answer shape. */
  professionalBrief?: string;
  /** Professional report-contract self-audit Markdown. */
  professionalAudit?: string;
  /** Generated Markdown content self-audit; checks forbidden wording and report depth. */
  reportContentAudit?: string;
  /** Reviewable productContext suggestion Markdown. */
  productContext?: string;
  /** Direct FrontLens config JSON containing the suggested/reviewed productContext snippet. */
  productContextConfig?: string;
  /** Professional QA execution/acceptance plan Markdown. */
  qaPlan?: string;
  /** Professional QA coverage matrix Markdown. */
  qaCoverage?: string;
  qaReview?: string;
  jsonReport?: string;
  htmlReport?: string;
  screenshot?: string;
  trace?: string;
  videoDir?: string;
  videoFiles?: string[];
  domSnapshot?: string;
  htmlSnapshot?: string;
  networkLog?: string;
  consoleLog?: string;
  resourcesLog?: string;
  coverageLog?: string;
  realtimeLog?: string;
  apiContractLog?: string;
  p2Log?: string;
  testDataLog?: string;
  professionalSummaryLog?: string;
  professionalAuditLog?: string;
  reportContentAuditLog?: string;
  productContextLog?: string;
  qaPlanLog?: string;
  qaCoverageLog?: string;
  regressionPlanLog?: string;
  scopeReview?: string;
  scopeReviewLog?: string;
  claimGuard?: string;
  claimGuardLog?: string;
  qaIntake?: string;
  qaIntakeLog?: string;
  defectProof?: string;
  defectProofLog?: string;
  downloadDir?: string;
  downloadedFiles?: string[];
  sourceAnalysisLog?: string;
  sourceRuntimeLog?: string;
  sourceHealthLog?: string;
  pageModel?: string;
}

export interface IssueEvidence {
  screenshot?: string;
  dom?: string;
  networkRequestId?: string;
  consoleId?: string;
  pageErrorId?: string;
  pageErrorIds?: string[];
  selector?: string;
  componentId?: string;
  resourceUrl?: string;
  details?: unknown;
}

export interface IssueSuggestion {
  frontend?: string;
  backend?: string;
  product?: string;
  test?: string;
  priority?: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface Issue {
  id: string;
  fingerprint?: string;
  affectedUrl?: string;
  ownerHint?: 'frontend' | 'backend' | 'product' | 'test';
  title: string;
  category: IssueCategory;
  severity: Severity;
  confidence: number;
  description: string;
  evidence: IssueEvidence;
  reproduceSteps: string[];
  reason: string;
  suggestion: IssueSuggestion;
  source: 'rule' | 'ai' | 'manual';
}

export interface QaSummary {
  url: string;
  title: string;
  /**
   * Raw scanner score based on every raw issue. Keep for backwards compatibility
   * and trend sorting; professional release decisions should prefer adjustedScore,
   * qaSignoff, qualityGate, and professionalSummary.
   */
  score: number;
  /**
   * Actionability-aware score. After issueDisposition is built, this excludes
   * conditional and non-actionable raw findings such as product decisions,
   * deployment-only findings, tool limitations, and insufficient evidence.
   */
  adjustedScore: number;
  issueCount: number;
  adjustedIssueCount: number;
  scoreBasis: 'raw' | 'actionable' | 'actionable+proof';
  scoreNotes: string[];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  testedAt: string;
  browser: BrowserName;
  viewport: {
    width: number;
    height: number;
  };
}

export interface NetworkSection {
  requests: NetworkRecord[];
  failedRequests: NetworkRecord[];
  slowRequests: NetworkRecord[];
  duplicatedRequests: Array<{
    signature: string;
    count: number;
    requestIds: string[];
    urls: string[];
  }>;
  suspiciousRequests: NetworkRecord[];
}

export interface ConsoleSection {
  messages: ConsoleRecord[];
  errors: ConsoleRecord[];
  warnings: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
}

export interface ResourceSection {
  entries: ResourceRecord[];
  failed: NetworkRecord[];
  slow: ResourceRecord[];
  large: ResourceRecord[];
  duplicated: Array<{
    url: string;
    count: number;
    totalTransferSize?: number;
  }>;
}

export interface PhaseError {
  phase: string;
  message: string;
  stack?: string;
  timestamp: string;
}

export interface QaResult {
  summary: QaSummary;
  pageModel: PageModel;
  issues: Issue[];
  network: NetworkSection;
  console: ConsoleSection;
  resources: ResourceSection;
  performance: PerformanceMetrics;
  coverage: CoverageResult;
  apiContract: ApiContractResult;
  realtime: RealtimeResult;
  interactionTests: InteractionTestResult[];
  journeyTests: JourneyTestResult[];
  accessibilityChecks: AccessibilityCheckResult[];
  permissionChecks: PermissionCheckResult[];
  responsiveChecks: ResponsiveCheckResult[];
  exceptionSimulations: ExceptionSimulationResult[];
  security: SecurityScanResult;
  requirementCoverage: RequirementCoverageResult;
  sourceAnalysis: SourceAnalysisResult;
  sourceRuntimeCorrelation: SourceRuntimeCorrelationResult;
  sourceHealth: SourceHealthResult;
  environment: EnvironmentAssessment;
  pageProfile: PageProfileAssessment;
  scopeReview: ScopeReviewResult;
  testData: TestDataAssessmentResult;
  p2: P2TestResult;
  artifactIntegrity: ArtifactIntegrityResult;
  rootCauseGroups: RootCauseGroup[];
  issueDisposition: IssueDispositionResult;
  fixTasks: FixTask[];
  regressionPlan: RegressionPlanResult;
  qaPlan: QaExecutionPlanResult;
  qaCoverage: QaCoverageMatrixResult;
  reportContentAudit: ReportContentAuditResult;
  professionalSummary: ProfessionalSummaryResult;
  defectProof: DefectProofResult;
  claimGuard: ClaimGuardResult;
  qaIntake: QaIntakeResult;
  qualityGate: QaQualityGate;
  qaSignoff: QaSignoffResult;
  aiAnalysis: AiAnalysisResult;
  artifacts: ArtifactIndex;
  metadata: {
    config: FrontLensConfig;
    durationMs: number;
    version: string;
    schemaVersion: string;
    phaseErrors: PhaseError[];
  };
}

export interface AnalyzerContext {
  config: FrontLensConfig;
  artifacts: ArtifactIndex;
  pageModel: PageModel;
  networkRecords: NetworkRecord[];
  consoleRecords: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  resourceRecords: ResourceRecord[];
  performanceMetrics: PerformanceMetrics;
  coverage: CoverageResult;
  apiContract: ApiContractResult;
  realtime: RealtimeResult;
  interactionTests: InteractionTestResult[];
  journeyTests: JourneyTestResult[];
  accessibilityChecks: AccessibilityCheckResult[];
  permissionChecks: PermissionCheckResult[];
  responsiveChecks: ResponsiveCheckResult[];
  exceptionSimulations: ExceptionSimulationResult[];
  security: SecurityScanResult;
  requirementCoverage?: RequirementCoverageResult;
  sourceAnalysis?: SourceAnalysisResult;
  sourceRuntimeCorrelation?: SourceRuntimeCorrelationResult;
  sourceHealth?: SourceHealthResult;
  p2: P2TestResult;
  artifactIntegrity?: ArtifactIntegrityResult;
  analysisExclusions?: {
    networkRequestIds?: string[];
    consoleIds?: string[];
    pageErrorIds?: string[];
    reason?: string;
  };
}
