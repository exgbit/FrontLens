# FrontLens `result.json` Contract

Use this reference when consuming QA results from another skill.

## Contents

- Top-level shape and schema version
- Summary, page model, artifacts
- Network, console, resources
- Interactions, journeys, responsive, accessibility, permission, exceptions
- API Contract, Realtime, Performance, Coverage, P2 tests, Security, Requirement Coverage, Fix Tasks, QA Gate, AI
- Issues, categories, severity, consumption pattern
- Plugin contracts

## Top-level shape and schema version

`metadata.schemaVersion` is the machine-readable result contract version. Reports before `1.2.0` may miss journey/API/realtime/P2/fixTasks fields; reports before `1.3.0` may miss `qualityGate`; reports before `1.4.0` may miss `requirementCoverage`. CLI/MCP helper commands normalize common missing sections to safe defaults and synthesize `fixTasks[]`, `qualityGate`, and `requirementCoverage` from normalized evidence when older reports do not contain them.

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
  p2: P2TestResult;
  fixTasks: FixTask[];
  qualityGate: QaQualityGate;
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

## API Contract, Realtime, Requirement Coverage, P2, Fix Tasks, Diff

`metadata.schemaVersion >= 1.2.0` includes user journeys, API contract inference/OpenAPI checks, GraphQL/WebSocket/SSE capture, P2 visual/budget/network checks, and machine-executable fix tasks. `metadata.schemaVersion >= 1.3.0` includes `qualityGate`; `metadata.schemaVersion >= 1.4.0` includes `requirementCoverage`.

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

`requirementCoverage` is the machine-readable requirement/ability coverage matrix. User-provided requirements come from config/`--requirements`; when none are provided, FrontLens only infers obvious page abilities and marks them as `source: inferred`. Inferred coverage is useful for gaps but must not be reported as 100% business validation. P0/P1 uncovered or failed requirements influence `qualityGate`.

`qualityGate` is the machine-readable professional QA gate. Use it for release/sign-off conversations, but still inspect `issues[]` and evidence before deciding whether to ship:

- `blocked`: target page was not reliably reached or evidence collection is too incomplete for QA.
- `fail`: Critical/High actionable issues or failed core journeys remain.
- `pass-with-risks`: no blockers, but Medium risks, failed exception scenarios, or coverage gaps remain.
- `pass`: no blocking/actionable risks in collected evidence.

`confidence` reflects collection quality, not product/business certainty. Missing PRD, roles, test data, or destructive-action authorization still lowers business-validation confidence at the skill triage layer.

For batched GraphQL POSTs, `network.requests[]` keeps one request record while `realtime.graphql[]` expands the batch into one entry per operation. Those entries share the same `networkRequestId` and carry per-operation `operationName`, `operationType`, `variablesPreview`, and `hasErrors` where response batches can be parsed.

Use `node dist/cli.js diff --before old/result.json --after new/result.json` to compare reports by stable fingerprints. The diff returns added, resolved, persistent, and severity-changed issues plus score/security/performance deltas.

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

Frontend: `frontend-ui`, `frontend-interaction`, `frontend-state`, `frontend-form`, `frontend-table`, `frontend-routing`, `frontend-permission`, `frontend-accessibility`, `frontend-performance`, `frontend-visual`.

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
3. Read `qualityGate` and `requirementCoverage` for machine-readable QA status and requirement gaps, but do not use them as a substitute for source/PRD triage.
4. Filter by skill responsibility:
   - frontend fix skill: `category` starts with `frontend`, plus `console-error`, `resource-*`, `integration-*`.
   - backend/API skill: `category` starts with `backend`, plus integration issues with backend suggestions.
   - accessibility skill: `frontend-accessibility` and `accessibilityChecks[]`.
   - permission skill: `frontend-permission`, `backend-api-auth`, and `permissionChecks[]`.
   - security/backend hardening skill: `category === 'security'`, `security.checks[]`, plus backend suggestions on `headers`, `cookies`, `api-leak`, `csrf`.
   - API/realtime skill: `apiContract.endpoints[]`, `realtime.graphql[]`, `realtime.webSockets[]`, `realtime.sse[]`, and `backend-api-contract` / `backend-realtime` issues.
   - downstream fixing skill: prefer `fixTasks[]` because it maps issues to owner/type/expectedChange/verificationCommand.
5. Use `evidence.selector`, `evidence.dom`, `networkRequestId`, `consoleId`, `pageErrorId`, or `evidence.details` to locate root cause.
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
