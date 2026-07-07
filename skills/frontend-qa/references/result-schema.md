# FrontLens `result.json` Contract

Use this reference when consuming QA results from another skill.

## Contents

- Top-level shape and schema version
- Summary, page model, artifacts
- Network, console, resources
- Interactions, journeys, responsive, accessibility, permission, exceptions
- API Contract, Realtime, Performance, Coverage, P2 tests, Security, Requirement Coverage, Environment, Page Profile, Source Analysis, Source Runtime Correlation, Source Health, Artifact Integrity, Root Cause Groups, Issue Disposition, Fix Tasks, QA Gate, QA Sign-off, AI
- Issues, categories, severity, consumption pattern
- Plugin contracts

## Top-level shape and schema version

`metadata.schemaVersion` is the machine-readable result contract version. Reports before `1.2.0` may miss journey/API/realtime/P2/fixTasks fields; reports before `1.3.0` may miss `qualityGate`; reports before `1.4.0` may miss `requirementCoverage`; reports before `1.5.0` may miss `artifactIntegrity`; reports before `1.6.0` may miss `rootCauseGroups`; reports before `1.7.0` may miss `issueDisposition`; reports before `1.8.0` may miss generated requirement-journey metadata; reports before `1.9.0` may miss `productContext`-aware disposition; reports before `1.10.0` may miss `sourceAnalysis`; reports before `1.11.0` may miss `sourceRuntimeCorrelation`; reports before `1.12.0` may miss `sourceHealth`; reports before `1.13.0` may miss `qaSignoff`; reports before `1.14.0` may miss `sourceHealth.scriptChecks[]`; reports before `1.15.0` may miss `environment`; reports before `1.16.0` may miss `pageProfile`. CLI/MCP helper commands normalize common missing sections to safe defaults, synthesize `fixTasks[]`, `qualityGate`, `qaSignoff`, `requirementCoverage`, `rootCauseGroups[]`, and `issueDisposition` from normalized evidence, and expose safe defaults for `artifactIntegrity` / source correlation / source health / environment / pageProfile when older reports do not contain them.

Default QA runs enable the safe smoke journey, requirement/ability coverage inference, passive security scan, API contract inference, realtime capture, Chromium Coverage, P2 visual capture/performance budgets/offline+slow-3g profiles, exception simulations, responsive checks, accessibility checks, and heuristic AI analysis. Sections may still be `skipped` only when the browser/platform cannot support a probe or the caller explicitly passes a `--no-*` flag / disabled config.

```ts
interface QaResult {
  summary: QaSummary;
  pageModel: PageModel;
  issues: Issue[];
  interactionTests: InteractionTestResult[];
  journeyTests: JourneyTestResult[];
  responsiveChecks: ResponsiveCheckResult[];
  accessibilityChecks: AccessibilityCheckResult[];
  permissionChecks: PermissionCheckResult[];
  exceptionSimulations: ExceptionSimulationResult[]; // always present; empty unless enabled
  network: NetworkSection;
  console: ConsoleSection;
  resources: ResourceSection;
  performance: PerformanceMetrics;
  coverage: CoverageResult;
  apiContract: ApiContractResult;
  realtime: RealtimeResult;
  security: SecurityScanResult; // always present; skipped when disabled
  requirementCoverage: RequirementCoverageResult;
  sourceAnalysis: SourceAnalysisResult;
  sourceRuntimeCorrelation: SourceRuntimeCorrelationResult;
  sourceHealth: SourceHealthResult;
  environment: EnvironmentAssessment;
  pageProfile: PageProfileAssessment;
  p2: P2TestResult;
  artifactIntegrity: ArtifactIntegrityResult;
  rootCauseGroups: RootCauseGroup[];
  issueDisposition: IssueDispositionResult;
  fixTasks: FixTask[];
  qualityGate: QaQualityGate;
  qaSignoff: QaSignoffResult;
  aiAnalysis: AiAnalysisResult; // always present; skipped when disabled
  artifacts: ArtifactIndex;
  metadata: {
    config: FrontLensConfig;
    durationMs: number;
    version: string;
    schemaVersion: string;
    phaseErrors: PhaseError[];
  };
}

interface PhaseError {
  phase: string;
  message: string;
  stack?: string;
  timestamp: string;
}
```

## Summary, page model, artifacts

`summary.score` is a heuristic quality score. Modern FrontLens versions weight issue severity by confidence and cap broad category penalties so one noisy rule family cannot reduce the score to zero. Still treat it as a prioritization hint; use `issues[]`, evidence, skipped/synthetic context, and triage guidelines for final decisions.


```ts
interface QaSummary {
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
  browser: 'chromium' | 'firefox' | 'webkit';
  viewport: { width: number; height: number };
}

interface PageModel {
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
  stats: { domNodes: number; visibleTextLength: number; bodyTextSample: string };
}

interface ComponentRecord {
  id: string;
  type: string;
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
  boundingBox?: { x: number; y: number; width: number; height: number };
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

interface ArtifactIndex {
  [key: string]: unknown; // plugins may add custom artifact paths or metadata
  outputDir: string;
  markdownReport?: string;
  qaReview?: string;      // concise professional-QA review for humans
  jsonReport?: string;
  htmlReport?: string;
  screenshot?: string;
  trace?: string;
  videoDir?: string;
  videoFiles?: string[];
  domSnapshot?: string;
  htmlSnapshot?: string;
  networkLog?: string;   // raw request log sidecar
  consoleLog?: string;
  resourcesLog?: string;
  coverageLog?: string;
  realtimeLog?: string;
  apiContractLog?: string;
  p2Log?: string;
  sourceAnalysisLog?: string;
  sourceRuntimeLog?: string;
  sourceHealthLog?: string;
  pageModel?: string;
}
```

## Network, console, resources

Sensitive headers and common secret-like query/body fields are redacted in generated reports.

```ts
interface NetworkRecord {
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
  sse?: { detected: boolean };
}

interface NetworkSection {
  requests: NetworkRecord[];
  failedRequests: NetworkRecord[];
  slowRequests: NetworkRecord[];
  duplicatedRequests: Array<{ signature: string; count: number; requestIds: string[]; urls: string[] }>;
  suspiciousRequests: NetworkRecord[];
}

interface ConsoleRecord {
  id: string;
  type: string;
  text: string;
  location?: { url?: string; lineNumber?: number; columnNumber?: number };
  timestamp: string;
  argsPreview?: string[];
}

interface PageErrorRecord {
  id: string;
  name?: string;
  message: string;
  stack?: string;
  timestamp: string;
}

interface ConsoleSection {
  messages: ConsoleRecord[];
  errors: ConsoleRecord[];
  warnings: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
}

interface ResourceRecord {
  name: string;
  initiatorType: string;
  durationMs: number;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  startTime?: number;
}

interface ResourceSection {
  entries: ResourceRecord[];
  failed: NetworkRecord[];
  slow: ResourceRecord[];
  large: ResourceRecord[];
  duplicated: Array<{ url: string; count: number; totalTransferSize?: number }>;
}
```

## Safe interaction tests

`interactionTests[]` records non-destructive browser operations executed during the scan. Upload and download/export are skipped unless allowed in `safety` config. `skipped` means the scanner did not find a safe applicable target or safety policy blocked the action; do not treat skipped interactions as defects.

```ts
interface InteractionTestResult {
  id: string;
  kind: 'search' | 'reset' | 'pagination' | 'dialog' | 'tab' | 'table-sort' | 'table-selection' | 'refresh' | 'download' | 'rapid-click' | 'upload' | 'form-validation';
  target: string;
  selector?: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
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
    requestParamChecks?: Array<{ requestId: string; expected: string; matched: boolean; reason: string }>;
    error?: string;
    details?: unknown;
  };
  issue?: string;
  suggestion?: Issue['suggestion'];
}
```

## Responsive, Accessibility, Permission, Exceptions

```ts
interface ResponsiveCheckResult {
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

interface AccessibilityCheckResult {
  id: string;
  rule: 'image-alt' | 'form-label' | 'button-name' | 'link-name' | 'positive-tabindex' | 'dialog-name' | 'color-contrast' | 'focusability';
  status: 'passed' | 'warning' | 'failed';
  severity: Issue['severity'];
  title: string;
  description: string;
  count: number;
  nodes: Array<{ selector: string; text?: string; tagName?: string; details?: unknown }>;
  suggestion: Issue['suggestion'];
}

interface PermissionCheckResult {
  id: string;
  rule: 'api-auth' | 'permission-markers' | 'visible-danger' | 'disabled-actions' | 'page-permission';
  status: 'passed' | 'warning' | 'failed';
  severity: Issue['severity'];
  title: string;
  description: string;
  count: number;
  evidence: Array<{ selector?: string; componentId?: string; networkRequestId?: string; text?: string; details?: unknown }>;
  suggestion: Issue['suggestion'];
}

interface ExceptionSimulationResult {
  id: string;
  kind: 'api-500' | 'api-404' | 'api-401' | 'api-403' | 'api-timeout' | 'offline' | 'page-refresh';
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
  suggestion?: Issue['suggestion'];
}
```

## API Contract, Realtime, Requirement Coverage, Product Context, Source Analysis, Source Runtime Correlation, Source Health, P2, Root Cause Groups, Issue Disposition, Fix Tasks, QA Sign-off, Diff

`metadata.schemaVersion >= 1.2.0` includes user journeys, API contract inference/OpenAPI checks, GraphQL/WebSocket/SSE capture, P2 visual/budget/network checks, and machine-executable fix tasks. `metadata.schemaVersion >= 1.3.0` includes `qualityGate`; `metadata.schemaVersion >= 1.4.0` includes `requirementCoverage`; `metadata.schemaVersion >= 1.5.0` includes `artifactIntegrity`; `metadata.schemaVersion >= 1.6.0` includes `rootCauseGroups`; `metadata.schemaVersion >= 1.7.0` includes `issueDisposition`; `metadata.schemaVersion >= 1.8.0` links generated journeys to provided requirements; `metadata.schemaVersion >= 1.9.0` lets `productContext` drive product/ADR disposition; `metadata.schemaVersion >= 1.10.0` includes static `sourceAnalysis` when `--source-root`/`source.root` is provided; `metadata.schemaVersion >= 1.11.0` includes `sourceRuntimeCorrelation`; `metadata.schemaVersion >= 1.12.0` includes `sourceHealth`; `metadata.schemaVersion >= 1.13.0` includes `qaSignoff`; `metadata.schemaVersion >= 1.14.0` includes optional source script execution results under `sourceHealth.scriptChecks[]`; `metadata.schemaVersion >= 1.15.0` includes `environment` to classify dev/preview/staging/production trust; `metadata.schemaVersion >= 1.16.0` includes `pageProfile` to make product-scope assumptions explicit.

```ts
interface ApiContractResult {
  enabled: boolean;
  schemaPath?: string;
  checkedAt: string;
  summary: { endpointCount: number; undocumentedCount: number; statusMismatchCount: number; schemaMismatchCount: number; inferredCount: number };
  endpoints: Array<{ method: string; path: string; requestCount: number; statusCodes: number[]; contentTypes: string[]; requestShape?: unknown; responseShape?: unknown; schemaMatched?: boolean; issues: Array<{ rule: string; severity: Issue['severity']; message: string; networkRequestIds: string[] }> }>;
}

interface RealtimeResult {
  enabled: boolean;
  checkedAt: string;
  graphql: Array<{ id: string; networkRequestId: string; operationName?: string; operationType: string; status?: number; hasErrors: boolean; errorPreview?: string; variablesPreview?: string }>;
  webSockets: Array<{ id: string; url: string; openedAt: string; closedAt?: string; framesSent: number; framesReceived: number; errors: string[]; samples: Array<{ direction: 'sent' | 'received'; timestamp: string; payloadPreview: string }> }>;
  sse: Array<{ id: string; networkRequestId: string; url: string; status?: number; contentType?: string; durationMs?: number }>;
  summary: { graphqlOperationCount: number; graphqlErrorCount: number; webSocketCount: number; webSocketErrorCount: number; sseCount: number };
}

interface JourneyTestResult {
  id: string;
  name: string;
  source?: 'configured' | 'requirement-generated' | 'inferred';
  requirementIds?: string[];
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  startUrl: string;
  finalUrl?: string;
  steps: Array<{ index: number; action: string; target?: string; value?: string; status: 'passed' | 'warning' | 'failed' | 'skipped'; startedAt: string; endedAt: string; durationMs: number; networkRequestIds?: string[]; consoleIds?: string[]; pageErrorIds?: string[]; error?: string }>;
  issue?: string;
  suggestion?: Issue['suggestion'];
}

interface P2TestResult {
  enabled: boolean;
  checkedAt: string;
  visual: { enabled: boolean; status: 'passed' | 'warning' | 'failed' | 'skipped'; currentScreenshot?: string; baselinePath?: string; diffRatio?: number; message?: string };
  budgets: Array<{ metric: string; actual: number; budget: number; status: 'passed' | 'failed' | 'skipped'; unit: string }>;
  networkProfiles: Array<{ profile: 'offline' | 'slow-3g'; status: 'passed' | 'warning' | 'failed' | 'skipped'; observations: string[]; screenshot?: string; error?: string }>; // skipped when the SPA did not boot and feedback cannot be assessed
}

interface RequirementCoverageResult {
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

interface RequirementCoverageItem {
  id: string;
  title: string;
  description?: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  source: 'provided' | 'inferred';
  status: 'passed' | 'failed' | 'partial' | 'not-covered' | 'not-applicable';
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

interface ArtifactIntegrityResult {
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  checkedAt: string;
  presentCount: number;
  missingCount: number;
  skippedCount: number;
  entries: ArtifactIntegrityEntry[];
  missing: ArtifactIntegrityEntry[];
  summary: string;
}

interface ArtifactIntegrityEntry {
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

interface RootCauseGroup {
  id: string;                         // RC-001; stable only within a normalized report
  rootCauseKey: string;               // deterministic grouping key
  title: string;
  status: 'actionable' | 'reference'; // use actionable groups as the real fix workload
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  severity: Issue['severity'];
  issueIds: string[];                 // merged raw issue IDs
  issueCount: number;
  categories: string[];
  selectors: string[];
  networkRequestIds: string[];
  consoleIds: string[];
  pageErrorIds: string[];
  resourceUrls: string[];
  summary: string;
  suggestedFix: string;
  verificationCommand: string;
}

interface IssueDispositionResult {
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
    bucketCounts: Record<string, number>;
    statusCounts: Record<string, number>;
  };
  items: IssueDispositionItem[];
}

interface IssueDispositionItem {
  issueId: string;
  fingerprint?: string;
  title: string;
  category: string;
  severity: Issue['severity'];
  status: 'confirmed' | 'needs-source-confirmation' | 'deployment-only' | 'product-decision' | 'tool-limitation' | 'insufficient-evidence' | 'reference';
  bucket: 'real-frontend-fix' | 'backend-api-fix' | 'deployment-security-config' | 'product-decision' | 'tool-limitation' | 'coverage-gap' | 'reference';
  actionability: 'actionable' | 'conditional' | 'non-actionable';
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  evidenceStrength: 'strong' | 'medium' | 'weak';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  nextStep: string;
  rootCauseGroupId?: string;
}

interface FixTask {
  id: string;
  issueIds: string[];
  owner: 'frontend' | 'backend' | 'product' | 'test' | 'security';
  type: string;
  title: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  target?: string;
  expectedChange: string;
  evidence: Issue['evidence'];
  verificationCommand: string;
}

interface QaQualityGate {
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
```

`artifactIntegrity` validates all local artifact paths referenced by the report, including screenshots, DOM snapshots, trace/video, JSON sidecars, responsive/P2 screenshots, and issue evidence paths. Missing referenced files are report-quality defects and should not be used as evidence.

`rootCauseGroups` is the machine-readable triage layer that merges raw scanner findings into implementation-level work items. Use it to avoid overcounting duplicated scenarios (for example api-500/api-404/timeout with the same missing error state), deployment-header families, and repeated selector-level a11y evidence. `issues[]` remains the raw evidence ledger; `rootCauseGroups[]` is the preferred workload and professional QA defect table.

`issueDisposition` is the raw-finding disposition layer. It labels every `issues[]` entry as confirmed, needs-source-confirmation, deployment-only, product-decision, tool-limitation, insufficient-evidence, or reference, and separates `actionable` from `conditional` and `non-actionable`. Use it to prevent style/product choices, dev-server artifacts, deployment headers, and speculative data-mismatch findings from failing QA as app-code bugs. `qualityGate` uses this disposition when available: confirmed actionable Critical/High issues can fail the gate; conditional findings become pass-with-risks/coverage gaps until source, PRD, role, or deployment ownership confirms them.

`requirementCoverage` is the machine-readable requirement/ability coverage matrix. User-provided requirements come from config/`--requirements`; when none are provided, FrontLens only infers obvious page abilities and marks them as `source: inferred`. Inferred coverage is useful for gaps but must not be reported as 100% business validation. P0/P1 uncovered or failed requirements influence `qualityGate`.

When a provided requirement contains `journeySteps`, `selectors`, or `expectedTexts`, FrontLens synthesizes a safe `journeyTests[]` item with `source: "requirement-generated"` and `requirementIds[]`. This makes PRD/acceptance criteria executable without guessing from free text. Free-text requirements without explicit selectors/assertions remain `not-covered` or `partial`; do not convert them into business pass claims.

`metadata.config.productContext` is the machine-readable product/ADR context used by disposition and QA triage:

```ts
interface ProductContextConfig {
  enabled: boolean;
  productName?: string;
  pageName?: string;
  pageType?: string; // e.g. admin, credential, dashboard, public, custom
  deviceScope: 'unknown' | 'desktop-only' | 'desktop-first' | 'responsive' | 'mobile-first';
  accessibilityTarget: 'unknown' | 'basic' | 'wcag-aa' | 'wcag-aaa';
  requiredFeatures: string[];      // matching raw findings stay real-fix/source-confirmation candidates
  optionalFeatures: string[];      // matching raw findings become product decisions unless stronger evidence exists
  outOfScopeFeatures: string[];    // matching raw findings become non-actionable observations
  decisions: Array<{ id?: string; title: string; appliesTo?: string[]; rationale?: string }>;
  adrRefs: string[];
}
```

Use product features such as `export`, `pagination`, `manual-refresh`, `mobile-touch-target`, `seo`, `visual-design`, `empty-state`, `error-state`, `search`, `filter`, or project-specific strings. `issueDisposition` expands common Chinese/English aliases. This is the preferred way to prevent “designed as intended” findings from becoming mandatory defects while still keeping required product capabilities actionable.

`sourceAnalysis` is the machine-readable static source index. It is skipped unless `source.root` or CLI/MCP `sourceRoot` is provided.

```ts
interface SourceAnalysisResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
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
  routes: Array<{ file: string; line: number; path?: string; name?: string; component?: string; lazy: boolean }>;
  imports: Array<{ file: string; line: number; source: string; kind: 'static' | 'dynamic'; isRouteComponent: boolean; isHeavy: boolean }>;
  apiCalls: Array<{ file: string; line: number; method?: string; path?: string; client?: string; expression: string }>;
  stateSignals: Array<{ file: string; line: number; kind: 'loading' | 'error' | 'empty' | 'retry'; text: string }>;
  findings: Array<{ id: string; kind: string; severity: Issue['severity']; title: string; locations: Array<{ file: string; line: number; column?: number }>; details: Record<string, unknown> }>;
}
```

Use `sourceAnalysis` before manual source grep: route/import findings explain code-splitting risks, API calls map endpoints to files, and state signals guide error/loading/empty-state validation. Static source findings are source evidence, not complete business validation by themselves.

`sourceRuntimeCorrelation` binds runtime XHR/Fetch records to static source API calls, state signals, UI component hints, and list-like response paths. It is the primary guard against speculative “Network has data but page is empty” findings.

```ts
interface SourceRuntimeCorrelationResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  summary: {
    networkRequestCount: number;
    linkedRequestCount: number;
    strongLinkCount: number;
    unlinkedRequestCount: number;
    listResponseLinkCount: number;
  };
  links: Array<{
    id: string;
    networkRequestId: string;
    method: string;
    url: string;
    path: string;
    status?: number;
    sourceMatches: SourceAnalysisResult['apiCalls'];
    stateSignals: SourceAnalysisResult['stateSignals'];
    componentIds: string[];
    responseListHints: Array<{ path: string; length: number; sampleKeys: string[] }>;
    confidence: 'high' | 'medium' | 'low' | 'none';
    notes: string[];
  }>;
  gaps: string[];
  error?: string;
}
```

When `sourceRuntimeCorrelation.status=passed`, downstream triage should only treat API/UI data mismatch as a frontend defect when the relevant `networkRequestId` has `medium` or `high` correlation. `high` means source API + UI component + state/list evidence aligned; `medium` means direct source API plus at least one runtime/UI/list signal aligned; `low` means only weak token matching and is not enough for a data-mismatch defect; `none` means the runtime response is not proven to feed the current page.

`environment` classifies whether the evidence came from Vite/dev-source mode, local preview, private/staging, file, or production-like HTTPS. Use it before interpreting performance, security, realtime, and release sign-off conclusions.

```ts
interface EnvironmentAssessment {
  kind: 'production-like' | 'local-dev' | 'local-preview' | 'staging-or-private' | 'file' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  targetUrl: string;
  finalUrl?: string;
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
```

If `environment.kind=local-dev`, do not use request count, transfer size, source-module path leakage, or HMR WebSocket as production findings. If `environment.trust.performance/security` is not `high`, final release sign-off should include a build/preview or production-like HTTPS rerun follow-up.

`pageProfile` classifies the page shape and product-scope uncertainty. It is deliberately a scope prompt, not a confirmed PRD. Use it to ask focused questions and draft `productContext`; do not use an inferred profile alone to downgrade or confirm product/design defects.

```ts
type PageProfileType =
  | 'credential-security'
  | 'admin-data-list'
  | 'admin-dashboard'
  | 'form-flow'
  | 'detail-master'
  | 'auth-login'
  | 'public-content'
  | 'unknown';

interface PageProfileAssessment {
  status: 'configured' | 'inferred' | 'unknown';
  pageType: PageProfileType;
  configuredPageType?: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'productContext' | 'heuristic' | 'none';
  signals: string[];
  suggestedProductContext: {
    pageType?: PageProfileType;
    deviceScope?: ProductContextConfig['deviceScope'];
    accessibilityTarget?: ProductContextConfig['accessibilityTarget'];
    requiredFeatures: string[];
    optionalFeatures: string[];
    outOfScopeFeatures: string[];
    decisions: ProductDecisionConfig[];
  };
  caveats: string[];
  questions: string[];
}
```

If `pageProfile.status=inferred`, final triage should keep style, pagination, export, manual-refresh, and mobile-touch findings conditional unless explicit `productContext`, PRD, ADR, or runtime task evidence confirms them. If `pageProfile.status=configured`, use `metadata.config.productContext` as the source of truth.

`sourceHealth` is a source-health layer. It always detects package-manager/scripts from `package.json` and parses TS/JS/Vue `<script>` blocks for syntax errors. It only runs target-app scripts when explicitly enabled through `source.runScripts=true`, CLI `--source-run-scripts`, or MCP `sourceRunScripts=true`; default script names are `typecheck,lint`, timeout is per script, and output is preview-limited. It can prove build-blocking syntax and type/lint/test problems, but it still does not replace complete business validation.

```ts
interface SourceHealthResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  root?: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  packageScripts: Array<{
    name: string;
    command: string;
    category: 'build' | 'typecheck' | 'lint' | 'test' | 'e2e' | 'coverage' | 'other';
  }>;
  scriptChecks: Array<{
    id: string;
    scriptName: string;
    command: string;
    category: 'build' | 'typecheck' | 'lint' | 'test' | 'e2e' | 'coverage' | 'other';
    status: 'passed' | 'failed' | 'skipped' | 'timed-out';
    durationMs: number;
    exitCode?: number;
    signal?: string;
    stdoutPreview?: string;
    stderrPreview?: string;
    error?: string;
  }>;
  scannedFiles: number;
  parsedFiles: number;
  skippedFiles: number;
  syntaxErrorCount: number;
  findings: Array<{
    id: string;
    kind: 'syntax-error';
    severity: Issue['severity'];
    file: string;
    line?: number;
    column?: number;
    message: string;
    code?: number;
  }>;
  error?: string;
}
```

If `sourceHealth.status=failed`, treat `frontend-source-health` issues as source-confirmed blockers. Syntax errors and failed/timed-out `build`, `typecheck`, `test`, or `e2e` checks are P1/P2 release blockers depending on project policy; lint-only failures are usually P2 unless the team treats lint as blocking. Still do not claim business validation passed solely because `sourceHealth.status=passed`; it only proves parsed source files had no syntax errors and any explicitly enabled script checks passed.

`qualityGate` is the machine-readable professional QA gate. Use it for release/sign-off conversations, but still inspect `issues[]` and evidence before deciding whether to ship:

- `blocked`: target page was not reliably reached or evidence collection is too incomplete for QA.
- `fail`: Critical/High actionable issues or failed core journeys remain.
- `pass-with-risks`: no blockers, but Medium risks, failed exception scenarios, or coverage gaps remain.
- `pass`: no blocking/actionable risks in collected evidence.

`confidence` reflects collection quality, not product/business certainty. Missing PRD, roles, test data, or destructive-action authorization still lowers business-validation confidence at the skill triage layer.

`qaSignoff` is the machine-readable professional testing sign-off. It wraps `qualityGate` with business-validation confidence and explicit follow-ups so raw scores are not mistaken for release approval.

```ts
interface QaSignoffResult {
  status: 'pass' | 'pass-with-risks' | 'fail' | 'blocked';
  confidence: 'high' | 'medium' | 'low';
  businessValidationConfidence: 'runtime-verified' | 'runtime-partial' | 'static-source-only' | 'not-verified';
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
```

Use `qaSignoff.status` for release/sign-off conversations and `qaSignoff.businessValidationConfidence` for business-function claims. A raw `qualityGate.pass` can still become `qaSignoff.pass-with-risks` when no PRD, login/role state, or passed user journey proves the business flow.

For batched GraphQL POSTs, `network.requests[]` keeps one request record while `realtime.graphql[]` expands the batch into one entry per operation. Those entries share the same `networkRequestId` and carry per-operation `operationName`, `operationType`, `variablesPreview`, and `hasErrors` where response batches can be parsed.

Use `node dist/cli.js diff --before old/result.json --after new/result.json` to compare reports by stable fingerprints. The diff returns added, resolved, persistent, and severity-changed issues plus score/security/performance deltas. Use `node dist/cli.js env-compare --dev-url <dev> --preview-url <preview>` when a Vite/dev-source run needs production-build validation; it writes `environment-comparison.json` and `environment-comparison.md`, classifying persistent, dev-only, preview-only, and dev-artifact candidate findings.


`EnvironmentComparisonResult` is emitted by `env-compare` / `frontlens_env_compare` and is separate from a single-page `QaResult`:

```ts
interface EnvironmentComparisonResult {
  checkedAt: string;
  outputDir: string;
  dev: {
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
  };
  preview: EnvironmentComparisonResult['dev'];
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
  artifacts: { json: string; markdown: string; devResult?: string; previewResult?: string };
}
```

Interpretation rule: persistent issues are higher confidence; preview-only issues are production-build/deployment candidates; dev-only issues are downgraded unless source/runtime evidence confirms a real implementation defect.

## Performance metrics

```ts
interface PerformanceMetrics {
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
  paint: { firstPaintMs?: number; firstContentfulPaintMs?: number };
  longTasks: { count: number; totalDurationMs: number; maxDurationMs: number };
  layoutShift: { score: number; count: number };
  resources: {
    count: number;
    totalTransferSize: number;
    totalEncodedBodySize: number;
    slowest: Array<{ name: string; initiatorType: string; durationMs: number }>;
  };
  memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  dom: { nodeCount: number; maxDepth: number };
  mutations?: { count: number };
}
```

## Chromium Coverage / unused resources

`coverage.status` is `passed` only for Chromium when coverage is enabled. Firefox/WebKit runs return `skipped`.

```ts
interface CoverageResult {
  enabled: boolean;
  status: 'passed' | 'skipped' | 'failed';
  browser: 'chromium' | 'firefox' | 'webkit';
  collectedAt: string;
  message?: string;
  totals: {
    js: { totalBytes: number; usedBytes: number; unusedBytes: number; unusedPercent: number };
    css: { totalBytes: number; usedBytes: number; unusedBytes: number; unusedPercent: number };
    all: { totalBytes: number; usedBytes: number; unusedBytes: number; unusedPercent: number };
  };
  entries: CoverageEntry[];
  topUnused: CoverageEntry[];
}

interface CoverageEntry {
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
```

## Security scan

`security` is always present. Default mode is passive and does not submit forms or mutate business data. Checks produce `issues[]` with `category='security'` when failed/warning findings need action.

```ts
type SecurityCheckCategory =
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

interface SecurityCheckResult {
  id: string;
  category: SecurityCheckCategory;
  rule: string;
  status: 'passed' | 'warning' | 'failed' | 'skipped';
  severity: Issue['severity'];
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
  suggestion: Issue['suggestion'];
}

interface SecurityScanResult {
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
```

Primary categories:

- `headers`: CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS, COOP/CORP, clickjacking protection.
- `cookies`: Set-Cookie `HttpOnly`, `Secure`, `SameSite`.
- `sensitive-data`: secret-like URL/body/response/console/DOM/storage signals; values are redacted.
- `mixed-content` / `transport`: HTTP usage and HTTPS pages loading HTTP assets/API.
- `third-party`: third-party JS/CSS/font, SRI absence, source map exposure.
- `xss-passive`: inline scripts, inline event handlers, `javascript:` links, `iframe[srcdoc]`.
- `csrf`: mutating Cookie-based requests without obvious CSRF/auth signals.
- `api-leak`: debug stack trace, SQL/internal path leaks, Server/X-Powered-By fingerprints.
- `active-probing`: skipped unless active mode is explicitly enabled.

## AI analysis

`aiAnalysis` is always present. When disabled, it has `enabled=false` and `status='skipped'`.

```ts
interface AiAnalysisResult {
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
```

## Issue categories

Frontend: `frontend-ui`, `frontend-interaction`, `frontend-state`, `frontend-form`, `frontend-table`, `frontend-routing`, `frontend-source-health`, `frontend-permission`, `frontend-accessibility`, `frontend-performance`, `frontend-visual`.

Backend/API: `backend-api-status`, `backend-api-params`, `backend-api-response`, `backend-api-performance`, `backend-api-auth`, `backend-api-consistency`, `backend-api-contract`, `backend-realtime`.

Frontend-backend integration: `integration-data-mismatch`, `integration-no-feedback`, `integration-stale-view`, `integration-pagination-mismatch`, `integration-filter-mismatch`, `integration-journey`.

Other: `resource-loading`, `resource-performance`, `console-error`, `seo`, `security`, `unknown`.

## Severity and priority mapping

- `critical`: page unavailable, runtime crash, blocking failure. Fix first.
- `high`: core flow failure, auth/API failure, dangerous interaction. Fix in current iteration.
- `medium`: visible UX/API/performance issue. Plan and fix soon.
- `low`: polish, accessibility, minor performance, optional improvement.
- `info`: observation only.

Use `issues[].suggestion.priority` when present: `P0`, `P1`, `P2`, `P3`.

## Stable issue shape

```ts
type IssueCategory = string; // known categories listed above; plugins may add custom categories.

interface Issue {
  id: string; // run-local display id
  fingerprint?: string; // stable-ish dedupe key derived from category/title/stable evidence; ids are run-local
  affectedUrl?: string;
  ownerHint?: 'frontend' | 'backend' | 'product' | 'test';
  title: string;
  category: IssueCategory;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  confidence: number;
  description: string;
  evidence: {
    screenshot?: string;
    dom?: string;
    networkRequestId?: string;
    consoleId?: string;
    pageErrorId?: string;
    pageErrorIds?: string[];
    selector?: string;
    componentId?: string;
    resourceUrl?: string;
    details?: unknown; // stable structured evidence for rule/plugin/AI-specific context
  };
  reproduceSteps: string[];
  reason: string;
  suggestion: {
    frontend?: string;
    backend?: string;
    product?: string;
    test?: string;
    priority?: 'P0' | 'P1' | 'P2' | 'P3';
  };
  source: 'rule' | 'ai' | 'manual';
}
```

## Consumption pattern

1. Read `result.json` or use helper commands.
2. Sort `issues` by severity: critical, high, medium, low, info.
3. Read `qaSignoff`, `qualityGate`, `requirementCoverage`, `environment`, `pageProfile`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `artifactIntegrity`, `rootCauseGroups`, and `issueDisposition` for machine-readable QA status, business-validation confidence, requirement gaps, static/runtime source binding, syntax/source-health status, evidence-path reliability, root-cause workload, and raw-finding actionability; do not use them as a substitute for source/PRD triage.
4. Filter by skill responsibility:
   - frontend fix skill: `category` starts with `frontend`, plus `console-error`, `resource-*`, `integration-*`.
   - backend/API skill: `category` starts with `backend`, plus integration issues with backend suggestions.
   - accessibility skill: `frontend-accessibility` and `accessibilityChecks[]`.
   - permission skill: `frontend-permission`, `backend-api-auth`, and `permissionChecks[]`.
   - security/backend hardening skill: `category === 'security'`, `security.checks[]`, plus backend suggestions on `headers`, `cookies`, `api-leak`, `csrf`.
   - API/realtime skill: `apiContract.endpoints[]`, `realtime.graphql[]`, `realtime.webSockets[]`, `realtime.sse[]`, and `backend-api-contract` / `backend-realtime` issues.
   - downstream fixing skill: prefer `issueDisposition.items[actionability=actionable]` plus `rootCauseGroups[]` for prioritization/workload, and `fixTasks[]` when it needs machine-executable owner/type/expectedChange/verificationCommand records.
5. Use `rootCauseGroups[].issueIds` to gather supporting raw issues, then use `issueDisposition` to decide whether each raw issue is actionable, conditional, or non-actionable before using `evidence.selector`, `evidence.dom`, `networkRequestId`, `consoleId`, `pageErrorId`, or `evidence.details` to locate root cause.
6. Apply code/API changes.
7. Rerun FrontLens. Prefer `issues[].fingerprint`; otherwise compare `category + title + evidence`; treat `issues[].id` as run-local display ID.

## Drift check

When changing `src/types.ts`, update this reference and run:

```bash
npm run check
npm test
npm run build
python /Users/justin/.codex/skills/.system/skill-creator/scripts/quick_validate.py skills/frontend-qa
```

CLI helpers:

```bash
node dist/cli.js inspect --report result.json
node dist/cli.js issues --report result.json --severity high  # critical + high
node dist/cli.js network --report result.json
node dist/cli.js coverage --report result.json
node dist/cli.js security --report result.json
node dist/cli.js fix-tasks --report result.json
node dist/cli.js diff --before old/result.json --after new/result.json
node dist/cli.js suggestions --report result.json
```

## Plugin contracts

Analyzer and rule plugin modules may export either a default function or `analyze(context)`.

```js
export function analyze(context) {
  return [
    {
      id: 'CUSTOM-001',
      title: 'Custom finding',
      category: 'frontend-ui',
      severity: 'low',
      confidence: 0.8,
      description: '...',
      evidence: {},
      reproduceSteps: ['Open page'],
      reason: '...',
      suggestion: { frontend: '...', priority: 'P3' },
      source: 'manual'
    }
  ];
}
```

Reporter plugin modules may export a default function or `report(result)`. Reporter plugins can write extra files to `result.artifacts.outputDir` and attach paths under `result.artifacts`.
