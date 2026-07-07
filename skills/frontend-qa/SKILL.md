---
name: frontend-qa
description: Run FrontLens Playwright QA for live webpage testing/auditing and evidence-backed Markdown/JSON reports covering UI/interaction, user journeys, Console, Network/API, contract drift, realtime, data mismatch, performance/P2, accessibility, passive security, root-cause grouping, raw-finding disposition/actionability, scope review, claim guard, QA intake/follow-up questions, defect proof, professional summary, regression plan, artifact integrity, source-code correlation when a repo path is provided, optional local build/serve, and fix suggestions. Use when the user asks to QA, test, audit, inspect, debug, security-check, compare runs, or generate frontend/UI/API/a11y/performance/security findings for a URL, or when another skill needs FrontLens result.json/professionalSummary/claimGuard/qaIntake/defectProof/scopeReview/issueDisposition/rootCauseGroups/fixTasks/regressionPlan to drive fixes. Do not use for generic URL summarization or browsing unless QA/testing is requested.
---

# Frontend QA

Use FrontLens to analyze a target webpage end-to-end and return eight primary artifacts:

- `report.md`: default decision-oriented professional QA report for humans.
- `qa-review.md`: concise professional-QA review focused on sign-off, root causes, non-defect buckets, and next actions.
- `evidence-report.md`: full raw evidence appendix with issue details, screenshots/DOM/network references, and module sections for drill-down.
- `scope-review.md`: product/PRD/ADR/device/a11y confirmation checklist plus a suggested `productContext` config snippet.
- `claim-guard.md`: explicit allowed/forbidden wording for business validation, release, production performance/security, API/UI binding, download/export, and source-health claims.
- `qa-intake.md`: professional tester follow-up questions for missing PRD/product scope, roles, test data, source/runtime binding, environment, artifacts, and regression inputs; use it to ask instead of guessing.
- `defect-proof.md`: proof-strength table for each root cause; FrontLens uses it to keep needs-evidence observations out of fixTasks, must-fix/should-fix, adjustedScore, and professional CI gates until confirmed.
- `result.json`: machine-readable contract for other skills to consume and act on.

## Mandatory module selection and subagent isolation

For every target-page QA run:

1. Ask the user to choose analysis modules before running FrontLens, unless the user already provided a module set or explicitly said "全选 / all / default".
2. Do not run target-page QA in the main session. Spawn a fresh worker subagent with `fork_context=false` and let it run the CLI, read `qa-review.md` and `result.json.professionalSummary` first, then `report.md` as needed, and return a concise Markdown summary plus artifact paths. The main session should only coordinate module selection and return the subagent summary to avoid context pollution.
3. Keep the "core safe scan" mandatory: page load, screenshot/DOM snapshot, page model, Console, Network collection, non-destructive interaction discovery, JSON/Markdown report, issueDisposition, rootCauseGroups, defectProof, proof-aware fixTasks, and safety blocking. Destructive actions remain disabled unless explicitly authorized.
4. Read `references/module-options.md` when preparing the module checklist or translating selected modules into CLI flags/config.
5. After the run, read `references/triage-guidelines.md` and calibrate raw findings before reporting. Do not treat raw score or raw issue count as the final truth when findings are synthetic, skipped, deployment-only, or page-type mismatches.
6. When the user provides a frontend source path, or when a known source mapping exists, source-aware triage is mandatory. Read `references/source-code-correlation.md`, pass the `sourceRoot` to the worker as `--source-root`, inspect `result.json.sourceAnalysis`, `result.json.sourceRuntimeCorrelation`, `result.json.sourceHealth`, `result.json.defectProof`, and `result.json.pageProfile`, and require file:line plus runtime/source-health evidence for every retained frontend defect. Also inspect `result.json.scopeReview`, `result.json.claimGuard`, and `result.json.qaIntake` when product scope is inferred, claims could overreach, or missing inputs should be asked instead of guessed; do not promote style/product assumptions or defectProof.needs-evidence items to must-fix while scope/proof questions remain unanswered, and do not use claimGuard forbidden wording. For professional sign-off, enable controlled source script checks (`--source-run-scripts`, default scripts `typecheck,lint`) when dependencies exist and the user allowed a full local QA run.
7. When the target URL is local/private and the source path is available, the worker may build/start/refresh the local dev or preview server before running QA if the page is unreachable, stale, or the user asks to deploy first. Keep the server non-destructive and do not modify business code.
8. When the user asks for professional-QA replacement, full acceptance, release sign-off, business validation, or skill quality review, read `references/qa-engineer-mode.md` and require a QA sign-off, requirement coverage matrix, defect root-cause table, non-defect observations, `result.json.professionalSummary`, `result.json.claimGuard`, `result.json.qaIntake`, `result.json.defectProof`, and `result.json.regressionPlan` regression commands/items. Never claim full business pass without requirements and runtime evidence.
9. When PRD/acceptance criteria are provided as Markdown or natural language, first run `frontlens requirements synthesize` to create a reviewable draft, read the generated Markdown questions, then pass the reviewed JSON as `--requirements`. If the user already provided structured JSON, use it directly. Encode explicit `selectors`, `expectedTexts`, `apiPatterns`, and/or safe `journeySteps` whenever possible. FrontLens turns those fields into generated requirement journeys and links runtime evidence back to `requirementCoverage`; free-text requirements without explicit assertions remain coverage gaps, not inferred passes.
10. When product scope, ADRs, supported devices, or “this is designed this way” feedback is available, encode it in `productContext` before rerunning or triaging. Use `deviceScope`, `requiredFeatures`, `optionalFeatures`, `outOfScopeFeatures`, `decisions[]`, and `adrRefs[]` so style, export, pagination, refresh, and touch-target findings are classified by product scope rather than guesswork.
11. When multiple login roles/storage states are provided, or when the page has permission-sensitive actions, run `frontlens role-matrix` after the baseline QA. Treat role differences as permission-review evidence; only call them defects when they violate explicit requirements, expected allowed/forbidden text contracts, or source/runtime permission guards.
12. When requirements or journeys include create/edit/delete/upload/import/submit flows, require `testData` context before claiming business validation: isolated records, setup steps, cleanup/rollback steps, environment, and production-write authorization. Missing cleanup or production mutation risk must be reported as QA sign-off risk/blocker.
13. When the user asks for business-flow validation but no executable journey/requirements exist, offer `frontlens journey record` as the first way to capture the real manual path. Recorded journeys are replay scaffolds: require explicit `expectVisible`/`expectText`/`expectUrl`/`expectRequest`, role state, and test-data lifecycle before claiming runtime-verified business pass.

Recommended checklist to show the user:

- API / Network / Contract / frontend-backend consistency
- Security passive scan
- Performance / Coverage / P2 visual pixel diff + budget + network profiles
- Accessibility / Responsive / optional SEO
- User journeys / recorded business flows
- Exception simulation
- Realtime GraphQL / WebSocket / SSE
- Heuristic AI comprehensive analysis
- Browser compatibility matrix
- Role / permission matrix when storage states are available
- Test data lifecycle for create/edit/delete/upload/import/submit flows

If the user selects "all/default", run the full default QA command. If the user deselects modules, create a per-run config JSON in the output directory and pass it with `--config`.

## Workflow

1. Resolve the target URL and output directory.
   - Default output: `reports/frontlens/<timestamp>/`.
   - Prefer a task-specific output directory when the user names a page or feature.
2. Complete module selection and prepare a subagent prompt.
   - Include URL, selected modules, output directory, safety requirements, exact command/config, known `sourceRoot`/deployment URL, any requirements/acceptance criteria file, and required Markdown summary fields.
   - Tell the worker not to modify business code.
3. Ensure the CLI is available inside the worker.
   - In the FrontLens repo: run `npm ci` when dependencies are missing, then `npm run build`; use `node dist/cli.js ...` only from the repo root.
   - Outside the repo: prefer `frontlens ...` on PATH, or ask for the FrontLens repo/CLI path.
4. Run QA with the safest default mode:

   ```bash
   node dist/cli.js qa --url "<URL>" --output "reports/frontlens/<name>-<timestamp>" --no-trace --json

   # When PRD/acceptance criteria are natural-language Markdown/text, draft a requirements file first:
   node dist/cli.js requirements synthesize --input "docs/prd.md" --output "reports/frontlens/<name>-<timestamp>/requirements.json"

   # Then pass reviewed requirements JSON:
   # --requirements "path/to/requirements.json"

   # When frontend source is available, add:
   # --source-root "/path/to/frontend"

   # For professional QA/sign-off with sourceRoot, also add when safe:
   # --source-run-scripts --source-scripts "typecheck,lint"
   ```

   Requirements JSON supports executable assertions:

   ```json
   [
     {
       "id": "REQ-LIST-VISIBLE",
       "title": "列表页展示主体内容",
       "priority": "P1",
       "selectors": ["body"],
       "expectedTexts": ["列表"],
       "apiPatterns": ["/api/list"],
       "journeySteps": [{ "action": "waitForLoad" }]
     }
   ]
   ```

   Use `selectors`/`expectedTexts` for read-only UI assertions, `apiPatterns` for `expectRequest` API assertions, and `journeySteps` for explicit safe flows. Do not translate vague product wishes into clicks or defects unless the requirement says so.

   Product/ADR context can be added in the same config to avoid reporting deliberate design choices as bugs:

   ```json
   {
     "productContext": {
       "enabled": true,
       "pageType": "credential",
       "deviceScope": "desktop-first",
       "accessibilityTarget": "basic",
       "requiredFeatures": ["error-state"],
       "optionalFeatures": ["mobile-touch-target"],
       "outOfScopeFeatures": ["export"],
       "decisions": [
         {
           "id": "ADR-0001",
           "title": "PC 为主，移动端自适应降级；凭证页不提供导出",
           "appliesTo": ["mobile-touch-target", "export"]
         }
       ],
       "adrRefs": ["docs/adr/0001-pc-first.md"]
     }
   }
   ```

   Test data lifecycle can be added when write/data-changing flows are in scope:

   ```json
   {
     "testData": {
       "enabled": true,
       "environment": "staging",
       "allowProductionWrites": false,
       "records": [
         {
           "id": "user-seed-001",
           "title": "可删除的测试用户",
           "state": "seeded",
           "requiredFor": ["REQ-DELETE-USER"],
           "cleanupOperationId": "cleanup-user"
         }
       ],
       "setupSteps": [
         { "id": "seed-user", "title": "创建测试用户", "type": "api", "method": "POST", "endpoint": "/api/users", "destructive": true, "rollbackOperationId": "cleanup-user" }
       ],
       "cleanupSteps": [
         { "id": "cleanup-user", "title": "删除测试用户", "type": "api", "method": "DELETE", "endpoint": "/api/users/{id}" }
       ],
       "notes": ["仅在 staging 运行写操作"]
     }
   }
   ```

   Default config blocks mutating `POST` / `PUT` / `PATCH` / `DELETE` requests unless the matching `allow*` safety switch is enabled. Read-only GraphQL `query` / `subscription` POSTs are allowed so contract/realtime capture remains useful; GraphQL `mutation` is still blocked by default. Use `--allow-mutating-requests` only for authorized integration tests.
   Passive security scanning, API contract inference, GraphQL/WebSocket/SSE capture, stable fingerprints, fix task generation, default safe smoke journey, P2 visual capture/pixel baseline diff/budget/network checks, exception simulation, and heuristic AI analysis are enabled by default. Use `--no-security`, `--no-contract`, `--no-realtime`, `--no-p2`, `--no-journeys`, `--no-exceptions`, or `--no-ai` only when explicitly speed-testing.

5. If browser binaries are missing, run:

   ```bash
   npx playwright install chromium
   ```

6. If the sandbox blocks Chromium launch on macOS, rerun the same QA command with escalated execution.
7. If source-aware analysis is enabled, the worker first verifies the target page is reachable from the intended deployment URL. If not, it follows `references/source-code-correlation.md` to build/start the local app, then reruns the reachability check before QA.
8. The worker reads `qa-review.md` / `report.md` for the calibrated professional summary, `result.json` for structured findings, and `evidence-report.md` only when raw evidence drill-down is needed; then reads `references/triage-guidelines.md` for post-run calibration, `scope-review.md` for pending product/PRD questions, `claim-guard.md` for allowed/forbidden conclusion wording, `qa-intake.md` for professional follow-up questions, `defect-proof.md` for root-cause proof strength, and `references/source-code-correlation.md` when a source root is available. Inspect `result.json.environment` before performance/security/realtime/release claims, `result.json.pageProfile` before product/design/scope claims, and `result.json.scopeReview` / `scope-review.md` / `result.json.qaIntake` before turning style, pagination, export, refresh, responsive, visual-density, or API/UI mismatch observations into defects. If the target is local-dev and the user asked for production-readiness, build/start preview and run `env-compare` whenever practical. Dev-source mode is valid for functional/source correlation but not production bundle/security conclusions; heuristic pageProfile is a prompt for scope questions, not confirmed PRD. If `sourceAnalysis.status=passed`, use its route/import/API/state-signal/ui-accessibility/error-state-gap indexes as the first source map before manually grepping files; if `sourceRuntimeCorrelation.status=passed`, use its `links[]` as the guard for API/UI binding claims and prefer medium/high linked source matches that are rolled into `rootCauseGroups[].sourceLocations` in FrontLens 1.36+; if `sourceHealth.status=failed`, treat syntax errors and failed/timed-out source script checks as source-confirmed blockers before interpreting runtime symptoms.
9. The worker must bucket findings into real frontend fixes, backend/API fixes, deployment/security config, product decisions, and false positives/tool limitations. For real frontend fixes, include source file paths and line numbers that confirm the defect and the likely fix surface; in FrontLens 1.34+ prefer `rootCauseGroups[].sourceLocations` as the normalized source fix surface before drilling into raw issue details, in FrontLens 1.36+ treat frontend root causes with enabled sourceRoot but weak/missing source binding as `defectProof=needs-evidence` rather than must-fix, in FrontLens 1.37+ use `sourceAnalysis.findings[kind=ui-accessibility]` to bind runtime a11y findings such as icon buttons without names back to component file:line, and in FrontLens 1.38+ use `sourceAnalysis.findings[kind=error-state-gap]` to bind exception no-feedback findings back to views that track errors but only render empty states; in FrontLens 1.39+ this covers Vue, Svelte, and JSX/TSX render blocks. Source-aware triage must also retain source-discovered defects even when the raw browser finding was downgraded as dev-mode/synthetic noise; for example, a dev-server request-count finding may be false as a production metric but still reveal a real eager route import/code-splitting problem.
10. Before returning fixes, read `professionalSummary` first for the human-facing answer, read `claimGuard` second to remove overclaims and use allowed wording, read `qaIntake` third to surface missing-input questions instead of guessing, read `defectProof` fourth to verify that implementation work is proof-ready, then read `issueDisposition` to separate actionable, conditional, and non-actionable raw findings, then read `scopeReview` to keep PRD/product gaps conditional, then group actionable/conditional raw issues by implementation root cause. `fixTasks[]` is already proof-aware in FrontLens 1.32+, but still do not treat raw issue count, heuristic AI issue count, or `fixTasks[]` length as workload; use proof-ready root causes and defectProof gaps separately. In FrontLens 1.33+, exception no-feedback issues from 500/401/403/404/timeout simulations are retained as frontend error-state/retry root-cause candidates when runtime evidence is reproducible, while the synthetic status codes remain excluded from backend contract findings; with sourceRoot in FrontLens 1.36+, keep them out of proof-ready scheduling until the root cause has file:line or medium/high source-runtime binding. If an auto-generated suggestion does not match its evidence/category, call it template noise and replace it with an evidence-specific suggestion.
11. Apply the professional QA actionability gate: a bug needs user impact, evidence, reproducibility, and an owner/fix surface. Move style/product choices and single-signal guesses to non-defect observations.
12. Prefer `result.json.qaSignoff` for release/sign-off wording and `result.json.regressionPlan` for post-fix verification; it may downgrade a raw `qualityGate.pass` to `pass-with-risks` when PRD, auth/role state, or runtime journeys are missing.
13. Return the report path, JSON path, professionalSummary headline/status, adjusted score, raw score, raw issue count, raw-finding disposition counts, proof-ready root-cause fix count from `professionalSummary.counts.proofReadyRootCauseCount` plus raw actionable count and source-location count from `rootCauseGroups`, adjusted triage counts, selected modules, source-code correlation status, pageProfile status/questions, scopeReview status/question count/path, claimGuard status/forbidden count/path, qaIntake status/top-question count/path, defectProof status/needs-evidence count/path, deployment/serve action taken, skipped-coverage caveats, requirement/business-validation confidence, QA sign-off status when applicable, regressionPlan status/item count, and the highest-priority fixes.

## Safety Rules

- Keep default non-destructive behavior.
- Do not enable create/edit/delete/upload/submit actions unless the user explicitly requests destructive testing.
- Do not click download/export unless the user explicitly allows it or sets `safety.allowDownload=true`. When allowed, require a saved `downloadPath`, non-zero size, hash, content summary (`downloadContent`), and passing `artifactIntegrity` before calling export/download runtime-verified.
- Keep `safety.blockMutatingRequests=true` for production or unknown URLs. If a report shows safety-blocked writes, treat them as evidence of potential side effects, not backend failures.
- Treat successful `POST`, `PUT`, `PATCH`, or `DELETE` requests during page load as suspicious unless known to be analytics/heartbeat.
- Keep `security.mode=passive` by default. Enable `security.mode=active` and `security.activeProbing=true` only for explicitly authorized security regression tests.
- Every issue must have evidence: screenshot, DOM selector, network request id, console id, `evidence.details`, phase error, or artifact path.

## Common Commands

Run a normal QA scan:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --output "reports/frontlens/users" \
  --no-trace \
  --json
```

Run with source-code indexing:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --source-root "/path/to/frontend" \
  --source-run-scripts \
  --source-scripts "typecheck,lint" \
  --output "reports/frontlens/users-source" \
  --no-trace \
  --json
```

Draft requirements from PRD/acceptance text before a professional QA run:

```bash
node dist/cli.js requirements synthesize \
  --input "docs/prd.md" \
  --output "reports/frontlens/users/requirements.json" \
  --prefix "REQ-USERS"
```

Review the generated `.md` questions; do not treat low-confidence draft items as confirmed business passes until selectors/text/API/journey or role/test-data gaps are resolved.

Only enable `--trace` when the user explicitly asks for debugging artifacts.

Use login state:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --storage-state ".frontlens/auth/admin.json" \
  --session-storage-state ".frontlens/auth/admin.json.session-storage.json" \
  --output "reports/frontlens/users-auth"
```

Save login state first. This writes Playwright cookies/localStorage to the output path and writes sessionStorage to `<output>.session-storage.json`.
`auth save` launches a headed browser and may wait for manual login. In sandboxed CLI environments, request escalated/GUI execution when needed. If non-interactive, set `--wait-ms` deliberately or ask the user to provide an existing storage state.

```bash
node dist/cli.js auth save \
  --url "https://example.com/login" \
  --output ".frontlens/auth/admin.json"
```

Record a real manual business path into a replayable journey config:

```bash
node dist/cli.js journey record \
  --url "https://example.com/admin/users" \
  --storage-state ".frontlens/auth/admin.json" \
  --session-storage-state ".frontlens/auth/admin.json.session-storage.json" \
  --output "journeys/users-smoke.json" \
  --name "Users smoke"
```

Then edit the generated JSON to add `expectVisible`/`expectText`/`expectUrl`/`expectRequest` assertions and run it with QA:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --config "journeys/users-smoke.json" \
  --journeys \
  --output "reports/frontlens/users-recorded" \
  --no-trace \
  --json
```

Do not treat a recorded click/fill path alone as business validation. It is runtime-partial until success assertions, role/auth state, and test data setup/cleanup are present. FrontLens 1.24+ exposes `qaSignoff.scope.passedAssertionStepCount` / `assertionStepCount` to enforce this.

Run headed for debugging:

```bash
node dist/cli.js qa --url "https://example.com" --headed --output "reports/frontlens/debug"
```

Compare dev vs build/preview when dev-server noise affects performance/security conclusions:

```bash
node dist/cli.js env-compare \
  --dev-url "http://127.0.0.1:5173/admin/users" \
  --preview-url "http://127.0.0.1:4173/admin/users" \
  --source-root "/path/to/frontend" \
  --output "reports/frontlens/users-env" \
  --no-trace \
  --json
```

Run browser compatibility matrix:

```bash
node dist/cli.js matrix \
  --url "https://example.com/admin/users" \
  --browsers chromium,firefox,webkit \
  --output "reports/frontlens/compat-users"
```

Run role/permission matrix when multiple auth states are available:

```bash
node dist/cli.js role-matrix \
  --url "https://example.com/admin/users" \
  --role admin=".frontlens/auth/admin.json" \
  --role viewer=".frontlens/auth/viewer.json" \
  --role guest= \
  --output "reports/frontlens/roles-users"
```

Use `--roles roles.json` when each role has `expectedAllowedTexts` / `expectedForbiddenTexts`. Role-specific buttons/issues are review evidence, not defects, until mapped to explicit permission requirements.

Run exception simulations explicitly (already enabled by default):

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --simulate-exceptions \
  --output "reports/frontlens/users-exceptions"
```

Run configured user journeys explicitly (a safe smoke journey is already enabled by default):

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --config "frontlens.config.example.json" \
  --journeys \
  --output "reports/frontlens/users-journey"
```

Run as a CI quality gate:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --output "reports/frontlens/users-ci" \
  --no-trace \
  --json \
  --fail-on high \
  --min-score 80
```

CI gate defaults to `--gate-mode professional`: `--min-score` uses proof-aware `summary.adjustedScore`, and `--fail-on` counts only findings linked to `issueDisposition.actionability=actionable` plus `defectProof=proven|probable`. Use `--gate-mode raw` only when you intentionally want legacy scanner behavior where deployment/product/tool/no-evidence findings can fail CI.

Use an explicit config:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --config "frontlens.config.example.json" \
  --output "reports/frontlens/users-configured" \
  --no-trace
```

Run heuristic AI analysis explicitly (already enabled by default):

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --ai \
  --output "reports/frontlens/users-ai"
```

Disable Chromium Coverage when speed matters:

```bash
node dist/cli.js qa --url "https://example.com/admin/users" --no-coverage
```

Disable or inspect security scanning:

```bash
node dist/cli.js qa --url "https://example.com/admin/users" --no-security
node dist/cli.js security --report "reports/frontlens/users/result.json"
```

Inspect machine-readable fix tasks or compare two reports:

```bash
node dist/cli.js disposition --report "reports/frontlens/users/result.json"
node dist/cli.js root-causes --report "reports/frontlens/users/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/users/result.json"
node dist/cli.js diff --before "reports/frontlens/old/result.json" --after "reports/frontlens/new/result.json" --output "reports/frontlens/diff"
node dist/cli.js env-compare --dev-url "http://127.0.0.1:5173/users" --preview-url "http://127.0.0.1:4173/users" --output "reports/frontlens/users-env"
```

Enable upload testing only when explicitly allowed:

```json
{
  "safety": {
    "allowUpload": true,
    "allowDownload": true
  }
}
```

Use Analyzer/Reporter/Rule plugins:

```json
{
  "plugins": {
    "analyzers": ["examples/plugins/custom-analyzer.mjs"],
    "reporters": ["examples/plugins/custom-reporter.mjs"],
    "rules": []
  }
}
```

Start MCP server for other tools/skills:

```bash
node dist/cli.js mcp
```

## Output Contract for Other Skills

Read `references/result-schema.md` when another skill needs to consume `result.json`, filter issues, or perform code/backend fixes from QA findings.

Minimum stable fields:

- `summary.score`
- `summary.issueCount`
- `issues[]`
- `issues[].category`
- `issues[].severity`
- `issues[].evidence`
- `issues[].suggestion.frontend`
- `issues[].suggestion.backend`
- `network.requests[]`
- `apiContract`
- `realtime`
- `console.errors[]`
- `pageModel.components[]`
- `interactionTests[]`
- `journeyTests[]`
- `accessibilityChecks[]`
- `permissionChecks[]`
- `security`
- `responsiveChecks[]`
- `exceptionSimulations[]`
- `performance`
- `coverage`
- `p2`
- `requirementCoverage`
- `environment`
- `pageProfile`
- `scopeReview`
- `claimGuard`
- `qaIntake`
- `defectProof`
- `testData`
- `sourceAnalysis`
- `sourceRuntimeCorrelation`
- `sourceHealth`
- `artifactIntegrity`
- `issueDisposition`
- `rootCauseGroups[]`
- `fixTasks[]`
- `professionalSummary`
- `qualityGate`
- `qaSignoff`
- `regressionPlan`
- `aiAnalysis`
- `artifacts.markdownReport` / `artifacts.qaReview` / `artifacts.evidenceReport` / `artifacts.scopeReview` / `artifacts.scopeReviewLog` / `artifacts.claimGuard` / `artifacts.claimGuardLog` / `artifacts.qaIntake` / `artifacts.qaIntakeLog` / `artifacts.defectProof` / `artifacts.defectProofLog`
- custom plugin outputs under `artifacts`

Read `references/ci-mcp.md` when the user asks for GitHub Action, CI, or MCP integration.

Stable result-consumption commands for other skills:

```bash
node dist/cli.js inspect --report "reports/frontlens/users/result.json"
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high --full
node dist/cli.js network --report "reports/frontlens/users/result.json"
node dist/cli.js coverage --report "reports/frontlens/users/result.json"
node dist/cli.js security --report "reports/frontlens/users/result.json"
node dist/cli.js disposition --report "reports/frontlens/users/result.json"
node dist/cli.js root-causes --report "reports/frontlens/users/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/users/result.json"
node dist/cli.js diff --before "reports/frontlens/old/result.json" --after "reports/frontlens/new/result.json"
node dist/cli.js env-compare --dev-url "http://127.0.0.1:5173/users" --preview-url "http://127.0.0.1:4173/users"
node dist/cli.js requirements synthesize --input "docs/prd.md" --output "reports/frontlens/users/requirements.json"
node dist/cli.js role-matrix --url "http://127.0.0.1:5173/users" --role admin=".frontlens/auth/admin.json" --role viewer=".frontlens/auth/viewer.json"
node dist/cli.js journey record --url "http://127.0.0.1:5173/users" --output "journeys/users-smoke.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json"
```

`--severity high` returns high and above (`critical` + `high`), not only exact high.

## Reporting Back

Summarize:

- professionalSummary headline/status and must-fix/non-defect counts;
- adjusted score, raw score, and issue counts;
- critical/high issues first;
- security score and any failed security checks;
- top frontend fixes;
- top backend/API fixes;
- API contract / GraphQL / WebSocket / SSE findings;
- machine-executable fix task count and important task IDs; regressionPlan status, blocked/needs-input counts, and top rerun commands;
- generated artifact paths and artifact integrity status; in FrontLens 1.35+ expect report.md/report.html to reflect the final artifactIntegrity snapshot, not an early pre-human-report snapshot; env-compare artifact path when dev/preview dual-run was used; role-matrix artifact path when multi-role runs were used; test-data lifecycle status when write/data-changing flows are in scope;
- triage buckets: real frontend, backend/API, deployment/security config, product decision, false positive/tool limitation; include pageProfile/scopeReview questions when product scope is inferred rather than configured;
- claimGuard status, forbidden claims, and required inputs; avoid forbidden wording in the final answer;
- qaIntake status, top questions, and missing inputs; ask these before turning product/design assumptions into defects;
- defectProof status and needs-evidence root causes; confirm they are excluded from must-fix/fixTasks and list evidence-collection next steps;
- adjustedScore plus raw score and confidence/adjusted-risk note when raw score is distorted by skipped/synthetic/deployment-only findings;
- raw issue count separated from implementation root-cause count;
- requirement coverage / business-validation confidence when the user asks for acceptance or professional QA;
- QA sign-off status (`pass`, `pass-with-risks`, `blocked`, or `fail`) when using professional QA mode;
- scopeReview status/questions and `scope-review.md` path; if `needs-input`, state which findings remain product/PRD-dependent instead of must-fix;
- claimGuard status and `claim-guard.md` path; if `limited` or `blocked`, state which broad conclusions are forbidden;
- qaIntake status and `qa-intake.md` path; if `needs-input` or `blocked`, list topQuestions and keep linked conclusions conditional;
- defectProof status and `defect-proof.md` path; if root causes are `needs-evidence`, list missing evidence and next steps and do not count them as implementation fixes;
- regression plan status/items from `result.json.regressionPlan` for repair verification;
- skipped interaction/coverage caveats when IT-* or journeys are mostly skipped;
- for each retained critical/high issue: issue id, severity, category, evidence reference, reproduction step summary, and suggested owner/fix.

Do not paste the whole Markdown report unless the user asks; provide the path, key findings, and explicit false-positive/downgrade decisions.
