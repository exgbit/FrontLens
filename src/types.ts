export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type KnownIssueCategory =
  | 'frontend-ui'
  | 'frontend-interaction'
  | 'frontend-state'
  | 'frontend-form'
  | 'frontend-table'
  | 'frontend-routing'
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

export type JourneyStepAction = 'goto' | 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck' | 'expectVisible' | 'expectText' | 'expectUrl' | 'waitForLoad' | 'waitMs';

export interface JourneyStepConfig {
  action: JourneyStepAction;
  target?: string;
  value?: string;
  timeoutMs?: number;
  allowMutating?: boolean;
  description?: string;
}

export interface JourneyConfig {
  name: string;
  startUrl?: string;
  steps: JourneyStepConfig[];
  enabled?: boolean;
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
  interactionKinds?: InteractionTestKind[];
  apiPatterns?: string[];
}

export interface RequirementCoverageConfig {
  enabled: boolean;
  inferFromPage: boolean;
  items: RequirementConfigItem[];
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

export interface ReportConfig {
  formats: Array<'json' | 'markdown' | 'html'>;
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
}

export interface JourneyTestResult {
  id: string;
  name: string;
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
    diffRatio?: number;
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
  markdownReport?: string;
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
  score: number;
  issueCount: number;
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
  p2: P2TestResult;
  artifactIntegrity: ArtifactIntegrityResult;
  rootCauseGroups: RootCauseGroup[];
  issueDisposition: IssueDispositionResult;
  fixTasks: FixTask[];
  qualityGate: QaQualityGate;
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
  p2: P2TestResult;
  artifactIntegrity?: ArtifactIntegrityResult;
  analysisExclusions?: {
    networkRequestIds?: string[];
    consoleIds?: string[];
    pageErrorIds?: string[];
    reason?: string;
  };
}
