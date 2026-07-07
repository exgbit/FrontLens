---
name: frontend-qa
description: Run FrontLens Playwright QA for live webpage testing/auditing and evidence-backed Markdown/JSON reports covering UI/interaction, user journeys, Console, Network/API, contract drift, realtime GraphQL/WebSocket/SSE, data mismatch, performance/P2, accessibility, permissions, passive security, root-cause grouping, raw-finding disposition/actionability, fix tasks, diff/baseline, download/export artifact content validation, artifact integrity, source-code correlation when a repo path is provided, optional local build/serve, and fix suggestions. Use when the user asks to QA, test, audit, inspect, debug, security-check, compare runs, or generate frontend/UI/API/accessibility/performance/security findings for a URL, or when another skill needs FrontLens result.json/issueDisposition/rootCauseGroups/fixTasks to drive fixes. Do not use for generic URL summarization or browsing unless QA/testing is requested.
---

# Frontend QA

Use FrontLens to analyze a target webpage end-to-end and return three primary artifacts:

- `report.md`: human-readable QA report with issues, evidence, reproduction steps, and fix suggestions.
- `qa-review.md`: concise professional-QA review focused on sign-off, root causes, non-defect buckets, and next actions.
- `result.json`: machine-readable contract for other skills to consume and act on.

## Mandatory module selection and subagent isolation

For every target-page QA run:

1. Ask the user to choose analysis modules before running FrontLens, unless the user already provided a module set or explicitly said "全选 / all / default".
2. Do not run target-page QA in the main session. Spawn a fresh worker subagent with `fork_context=false` and let it run the CLI, read `qa-review.md` first, then `result.json` and `report.md` as needed, and return a concise Markdown summary plus artifact paths. The main session should only coordinate module selection and return the subagent summary to avoid context pollution.
3. Keep the "core safe scan" mandatory: page load, screenshot/DOM snapshot, page model, Console, Network collection, non-destructive interaction discovery, JSON/Markdown report, issueDisposition, rootCauseGroups, fixTasks, and safety blocking. Destructive actions remain disabled unless explicitly authorized.
4. Read `references/module-options.md` when preparing the module checklist or translating selected modules into CLI flags/config.
5. After the run, read `references/triage-guidelines.md` and calibrate raw findings before reporting. Do not treat raw score or raw issue count as the final truth when findings are synthetic, skipped, deployment-only, or page-type mismatches.
6. When the user provides a frontend source path, or when a known source mapping exists, source-aware triage is mandatory. Read `references/source-code-correlation.md`, pass the `sourceRoot` to the worker as `--source-root`, inspect `result.json.sourceAnalysis`, `result.json.sourceRuntimeCorrelation`, `result.json.sourceHealth`, and `result.json.pageProfile`, and require file:line plus runtime/source-health evidence for every retained frontend defect. For professional sign-off, enable controlled source script checks (`--source-run-scripts`, default scripts `typecheck,lint`) when dependencies exist and the user allowed a full local QA run.
7. When the target URL is local/private and the source path is available, the worker may build/start/refresh the local dev or preview server before running QA if the page is unreachable, stale, or the user asks to deploy first. Keep the server non-destructive and do not modify business code.
8. When the user asks for professional-QA replacement, full acceptance, release sign-off, business validation, or skill quality review, read `references/qa-engineer-mode.md` and require a QA sign-off, requirement coverage matrix, defect root-cause table, non-defect observations, and regression commands. Never claim full business pass without requirements and runtime evidence.
9. When PRD/acceptance criteria are provided as Markdown or natural language, first run `frontlens requirements synthesize` to create a reviewable draft, read the generated Markdown questions, then pass the reviewed JSON as `--requirements`. If the user already provided structured JSON, use it directly. Encode explicit `selectors`, `expectedTexts`, `apiPatterns`, and/or safe `journeySteps` whenever possible. FrontLens turns those fields into generated requirement journeys and links runtime evidence back to `requirementCoverage`; free-text requirements without explicit assertions remain coverage gaps, not inferred passes.
10. When product scope, ADRs, supported devices, or “this is designed this way” feedback is available, encode it in `productContext` before rerunning or triaging. Use `deviceScope`, `requiredFeatures`, `optionalFeatures`, `outOfScopeFeatures`, `decisions[]`, and `adrRefs[]` so style, export, pagination, refresh, and touch-target findings are classified by product scope rather than guesswork.
11. When multiple login roles/storage states are provided, or when the page has permission-sensitive actions, run `frontlens role-matrix` after the baseline QA. Treat role differences as permission-review evidence; only call them defects when they violate explicit requirements, expected allowed/forbidden text contracts, or source/runtime permission guards.
12. When requirements or journeys include create/edit/delete/upload/import/submit flows, require `testData` context before claiming business validation: isolated records, setup steps, cleanup/rollback steps, environment, and production-write authorization. Missing cleanup or production mutation risk must be reported as QA sign-off risk/blocker.

Recommended checklist to show the user:

- API / Network / Contract / frontend-backend consistency
- Security passive scan
- Performance / Coverage / P2 visual+budget+network profiles
- Accessibility / Responsive / optional SEO
- User journeys
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
       "journeySteps": [{ "action": "waitForLoad" }]
     }
   ]
   ```

   Use `selectors`/`expectedTexts` for read-only assertions and `journeySteps` for explicit safe flows. Do not translate vague product wishes into clicks or defects unless the requirement says so.

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
   Passive security scanning, API contract inference, GraphQL/WebSocket/SSE capture, stable fingerprints, fix task generation, default safe smoke journey, P2 visual capture/budget/network checks, exception simulation, and heuristic AI analysis are enabled by default. Use `--no-security`, `--no-contract`, `--no-realtime`, `--no-p2`, `--no-journeys`, `--no-exceptions`, or `--no-ai` only when explicitly speed-testing.

5. If browser binaries are missing, run:

   ```bash
   npx playwright install chromium
   ```

6. If the sandbox blocks Chromium launch on macOS, rerun the same QA command with escalated execution.
7. If source-aware analysis is enabled, the worker first verifies the target page is reachable from the intended deployment URL. If not, it follows `references/source-code-correlation.md` to build/start the local app, then reruns the reachability check before QA.
8. The worker reads `qa-review.md` for the calibrated professional summary, `result.json` for structured findings, `report.md` for detailed narrative evidence, `references/triage-guidelines.md` for post-run calibration, and `references/source-code-correlation.md` when a source root is available. Inspect `result.json.environment` before performance/security/realtime/release claims and `result.json.pageProfile` before product/design/scope claims. If the target is local-dev and the user asked for production-readiness, build/start preview and run `env-compare` whenever practical. Dev-source mode is valid for functional/source correlation but not production bundle/security conclusions; heuristic pageProfile is a prompt for scope questions, not confirmed PRD. If `sourceAnalysis.status=passed`, use its route/import/API/state-signal indexes as the first source map before manually grepping files; if `sourceRuntimeCorrelation.status=passed`, use its `links[]` as the guard for API/UI binding claims; if `sourceHealth.status=failed`, treat syntax errors and failed/timed-out source script checks as source-confirmed blockers before interpreting runtime symptoms.
9. The worker must bucket findings into real frontend fixes, backend/API fixes, deployment/security config, product decisions, and false positives/tool limitations. For real frontend fixes, include source file paths and line numbers that confirm the defect and the likely fix surface. Source-aware triage must also retain source-discovered defects even when the raw browser finding was downgraded as dev-mode/synthetic noise; for example, a dev-server request-count finding may be false as a production metric but still reveal a real eager route import/code-splitting problem.
10. Before returning fixes, read `issueDisposition` to separate actionable, conditional, and non-actionable raw findings, then group actionable/conditional raw issues by implementation root cause. Do not treat raw issue count, heuristic AI issue count, or `fixTasks[]` length as workload. If an auto-generated suggestion does not match its evidence/category, call it template noise and replace it with an evidence-specific suggestion.
11. Apply the professional QA actionability gate: a bug needs user impact, evidence, reproducibility, and an owner/fix surface. Move style/product choices and single-signal guesses to non-defect observations.
12. Prefer `result.json.qaSignoff` for release/sign-off wording; it may downgrade a raw `qualityGate.pass` to `pass-with-risks` when PRD, auth/role state, or runtime journeys are missing.
13. Return the report path, JSON path, raw score, raw issue count, raw-finding disposition counts, root-cause fix count from `rootCauseGroups`, adjusted triage counts, selected modules, source-code correlation status, pageProfile status/questions, deployment/serve action taken, skipped-coverage caveats, requirement/business-validation confidence, QA sign-off status when applicable, and the highest-priority fixes.

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
- `testData`
- `sourceAnalysis`
- `sourceRuntimeCorrelation`
- `sourceHealth`
- `artifactIntegrity`
- `issueDisposition`
- `rootCauseGroups[]`
- `fixTasks[]`
- `qualityGate`
- `qaSignoff`
- `aiAnalysis`
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
node dist/cli.js suggestions --report "reports/frontlens/users/result.json"
```

`--severity high` returns high and above (`critical` + `high`), not only exact high.

## Reporting Back

Summarize:

- score and issue counts;
- critical/high issues first;
- security score and any failed security checks;
- top frontend fixes;
- top backend/API fixes;
- API contract / GraphQL / WebSocket / SSE findings;
- machine-executable fix task count and important task IDs;
- generated artifact paths and artifact integrity status; env-compare artifact path when dev/preview dual-run was used; role-matrix artifact path when multi-role runs were used; test-data lifecycle status when write/data-changing flows are in scope;
- triage buckets: real frontend, backend/API, deployment/security config, product decision, false positive/tool limitation; include pageProfile questions when product scope is inferred rather than configured;
- raw score plus confidence/adjusted-risk note when score is distorted by skipped/synthetic/deployment-only findings;
- raw issue count separated from implementation root-cause count;
- requirement coverage / business-validation confidence when the user asks for acceptance or professional QA;
- QA sign-off status (`pass`, `pass-with-risks`, `blocked`, or `fail`) when using professional QA mode;
- skipped interaction/coverage caveats when IT-* or journeys are mostly skipped;
- for each retained critical/high issue: issue id, severity, category, evidence reference, reproduction step summary, and suggested owner/fix.

Do not paste the whole Markdown report unless the user asks; provide the path, key findings, and explicit false-positive/downgrade decisions.
