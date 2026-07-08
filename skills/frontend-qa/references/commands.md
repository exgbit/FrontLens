# FrontLens Commands Reference

Use this reference when exact CLI syntax is needed after `frontend-qa` has selected modules, source mode, auth, journey, CI, or result-consumption tasks. Keep `SKILL.md` focused on workflow and triage; keep concrete command variants here.

## Contents

- [Common Commands](#common-commands)
- [Config Snippets](#config-snippets)
- [Stable Result-Consumption Commands](#stable-result-consumption-commands)

## Common Commands

Run a normal QA scan:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --output "reports/frontlens/users" \
  --no-trace \
  --json
```

Choose the primary human report depth when stakeholders need a shorter or exhaustive `report.md`:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --report-profile executive
```

`executive` is the default shortest decision brief, `professional` is the fuller QA-lead report, and `full` appends the evidence appendix into `report.md`. `evidence-report.md` is always written.

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

Do not treat a recorded click/fill path alone as business validation. It is runtime-partial until meaningful success assertions, role/auth state, and test data setup/cleanup are present. FrontLens 1.24+ exposes `qaSignoff.scope.passedAssertionStepCount` / `assertionStepCount`; FrontLens 1.71+ also exposes `runtimeVerifiedJourneyCount`, `requirementBoundRuntimeVerifiedJourneyCount`, `weaklyAssertedJourneyCount`, `pathOnlyJourneyCount`, and `meaningfulAssertionStepCount` so generic body/html/#app assertions cannot masquerade as business proof.

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

CI gate defaults to `--gate-mode professional`: `--min-score` uses proof-aware `summary.adjustedScore`, and `--fail-on` counts only findings linked to `issueDisposition.actionability=actionable` plus `defectProof=proven|probable`. Professional mode also fails on report/sign-off contract blockers: `reportContentAudit=failed`, `journeyAssertionAudit=failed`, `qaSignoff=fail|blocked`, `qualityGate=fail|blocked`, `artifactIntegrity=failed`, `claimGuard=blocked`, `qaIntake=blocked`, blocked `testCases`, `riskRegister=blocked`, `riskAcceptance=blocked`, or failed/insufficient `qaCoverage`. Use `--gate-mode raw` only when you intentionally want legacy scanner behavior where deployment/product/tool/no-evidence findings can fail CI and report-contract blockers do not apply.

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
node dist/cli.js brief --report "reports/frontlens/users/result.json"
node dist/cli.js audit --report "reports/frontlens/users/result.json"
node dist/cli.js product-context --report "reports/frontlens/users/result.json"
node dist/cli.js claim-guard --report "reports/frontlens/users/result.json"
node dist/cli.js qa-intake --report "reports/frontlens/users/result.json"
node dist/cli.js defect-proof --report "reports/frontlens/users/result.json"
node dist/cli.js defect-tickets --report "reports/frontlens/users/result.json"
node dist/cli.js traceability --report "reports/frontlens/users/result.json"
node dist/cli.js automation-specs --report "reports/frontlens/users/result.json"
node dist/cli.js evidence-bundle --report "reports/frontlens/users/result.json"
node dist/cli.js test-strategy --report "reports/frontlens/users/result.json"
node dist/cli.js report-content-audit --report "reports/frontlens/users/result.json"
node dist/cli.js journey-assertion-audit --report "reports/frontlens/users/result.json"
node dist/cli.js qa-plan --report "reports/frontlens/users/result.json"
node dist/cli.js qa-coverage --report "reports/frontlens/users/result.json"
node dist/cli.js assertion-suggestions --report "reports/frontlens/users/result.json"
node dist/cli.js business-journeys --report "reports/frontlens/users/result.json"
node dist/cli.js test-cases --report "reports/frontlens/users/result.json"
node dist/cli.js risk-register --report "reports/frontlens/users/result.json"
node dist/cli.js risk-acceptance --report "reports/frontlens/users/result.json"
node dist/cli.js artifact-integrity --report "reports/frontlens/users/result.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json" --all
# claim-guard.md/json, qa-intake.md/config, defect-proof.md/json, defect-tickets.md/json, traceability.md/json, automation-specs.md/json plus automation/frontlens.spec.ts, evidence-bundle.md/json, test-strategy.md/json, report-content-audit.md/json, journey-assertion-audit.md/json, assertion-suggestions.md/json, business-journeys.md/json, test-cases.md/json, risk-register.md/json, risk-acceptance.md/json, and artifact-integrity output are written by qa or available through helpers; read result.json.claimGuard/qaIntake/defectProof/defectTickets/traceability/automationSpecs/evidenceBundle/qaStrategy/reportContentAudit/journeyAssertionAudit/assertionSuggestions/businessJourneys/testCases/riskRegister/riskAcceptance/artifactIntegrity before formal sign-off
node dist/cli.js disposition --report "reports/frontlens/users/result.json"
node dist/cli.js root-causes --report "reports/frontlens/users/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/users/result.json"
node dist/cli.js diff --before "reports/frontlens/old/result.json" --after "reports/frontlens/new/result.json" --output "reports/frontlens/diff"
node dist/cli.js env-compare --dev-url "http://127.0.0.1:5173/users" --preview-url "http://127.0.0.1:4173/users" --output "reports/frontlens/users-env"
```

`diff` output leads with `professional`: adjusted score delta, QA sign-off transition, business-validation confidence transition, proof-ready root-cause delta, regression blocked/needs-input delta, and added/resolved must-fix/should-fix workload. Use raw added/resolved issues only as scanner trend context.

In schema 1.51+, normal `qa` runs also write `professional-audit.md` and `professional-audit.json`; use the `audit` command for older reports or for a fresh self-check after manual report edits. In schema 1.52+, normal `qa` runs also write `product-context.md` and `product-context.json`; use `product-context` for older reports. In schema 1.53+, normal `qa` runs also write `product-context.config.json`, a direct `--config` file containing the suggested `productContext`; review/edit it with Product/QA, then rerun. In schema 1.54+, normal `qa` runs also write `qa-plan.md` and `qa-plan.json`; use `qa-plan` to turn a scan into a professional tester worklist. In schema 1.55+, normal `qa` runs also write `qa-coverage.md` and `qa-coverage.json`; use `qa-coverage` to report covered/partial/skipped/needs-input/failed QA dimensions. In schema 1.58+, normal `qa` runs also write `report-content-audit.md` and `report-content-audit.json`; read it before echoing report conclusions because it checks forbidden wording, raw-evidence leakage into concise report profiles, missing raw-score caveats, hidden coverage gaps, and missing artifact warnings. In schema 1.59+, normal `qa` runs also write `journey-assertion-audit.md` and `journey-assertion-audit.json`; read it before using journeys for business validation because it separates meaningful assertion-backed journeys from path-only replay. In schema 1.60+, `professional-audit.md/json` also audits disposition quality and blocks weak high-severity actionable findings, actionable API/UI mismatch guesses, contradictory disposition/actionability pairs, and product/style-sensitive findings promoted without confirmed productContext. In schema 1.61+, `report-content-audit.md/json` also warns when executive/professional report.md becomes too long, table-heavy, or scanner-like. In schema 1.62+, permission-sensitive pages, dangerous action buttons, permission-check warnings, or explicit role/auth requirements automatically add `role-matrix` follow-up items to `regressionPlan` / `qaPlan` before permission sign-off. In schema 1.63+, existing project-owned build/typecheck/test/e2e/lint scripts that were detected but not executed become source-health follow-up items, so professional sign-off does not rely only on browser scanning; in schema 1.64+, normal `qa` runs also write `risk-register.md` and `risk-register.json`, and `result.json.riskRegister` converts proof-ready defects, coverage gaps, environment/source/test-data/artifact problems, and sign-off blockers into a release-risk matrix; in schema 1.65+, normal `qa` runs also write `risk-acceptance.md` and `risk-acceptance.json`, and `result.json.riskAcceptance` separates must-mitigate risks from risks that need explicit acceptance; in schema 1.66+, normal `qa` runs also write `test-cases.md` / `test-cases.json`, and `result.json.testCases` turns requirements, journeys, interactions, exception simulations, a11y/responsive/performance/security/source/test-data/artifact checks into a formal professional test case execution matrix. In schema 1.67+, normal `qa` runs also write `assertion-suggestions.md` / `assertion-suggestions.json`, and `result.json.assertionSuggestions` proposes concrete expect* steps for weak/path-only journeys. In schema 1.69+, API/UI data-mismatch cannot become actionable unless explicit requirement, exact list response, visible empty target UI, and source API/state/render binding are all present. In schema 1.70+, empty-state and pagination-parameter observations without PRD/productContext proof are QA/test evidence gaps, not frontend-owned fixes. In schema 1.71+, generic `expectText body OK`-style assertions are weak and cannot prove requirement-bound business success. In schema 1.72+, missing PRD/acceptance criteria or unconfirmed product/page scope makes `professionalSummary.headline` intake-first (`QA intake needed`) and raises those coverage gaps to P1 tester input. In schema 1.73+, `brief.md`/executive reports are intentionally more compact, and `report-content-audit` uses tighter depth thresholds to keep selector/module detail in sidecar artifacts. In schema 1.74+, normal `qa` runs also write `qa-intake.config.json`; review/edit it with Product/QA to answer PRD/productContext/journey/testData/source inputs, then rerun with `--config`. In schema 1.75+, `qa-intake`, `risk-register`, `risk-acceptance`, and `artifact-integrity` helper commands are first-class, `suggestions` is proof-aware by default (`--all` is raw-audit mode), and API/UI data-mismatch raw issues require explicit requirement + medium/high source-runtime binding. In schema 1.76+, `claim-guard`, `defect-proof`, `report-content-audit`, and `journey-assertion-audit` are also first-class helper commands so other skills can consume anti-overclaim, proof-strength, report-content, and journey-assertion gates without parsing full Markdown. In schema 1.77+, `qa-intake.config.json` includes review-only `_frontlensQaIntake.draftAssertionSteps[]` derived from assertion suggestions; copy confirmed expect* steps into requirements/journeys and rerun before using them as evidence. In schema 1.78+, normal `qa` runs write `defect-tickets.md/json` and expose `defect-tickets`; use it as the bug-filing queue because it only includes defectProof proven/probable root causes. In schema 1.79+, normal `qa` runs write `traceability.md/json` and expose `traceability`; use it to link PRD/requirements to test cases, journeys/interactions, defect tickets, and release risks before business validation claims. In schema 1.80+, normal `qa` runs write `automation-specs.md/json` and `automation/frontlens.spec.ts`, and expose `automation-specs`; use it as a review-only Playwright regression starter generated from requirements, journeys, assertion suggestions, and test cases. In schema 1.81+, normal `qa` runs write `evidence-bundle.md/json`, expose `evidence-bundle`, and populate `result.json.evidenceBundle`; use it as the shareable handoff manifest and block citing paths when `missingArtifactCount > 0`. In schema 1.82+, normal `qa` runs write `test-strategy.md/json`, expose `test-strategy`, and populate `result.json.qaStrategy`; use it to decide which QA modules are run, deferred until input, out-of-scope, blocked, or already covered. In schema 1.83+, normal `qa` runs write `business-journeys.md/json`, expose `business-journeys`, and populate `result.json.businessJourneys`; use it to turn requirements, journeys, assertion drafts, role needs, and test-data gaps into rerunnable business scenarios without treating them as passed evidence. Read `claimGuard`, `qaIntake`, `defectProof`, `defectTickets`, `traceability`, `automationSpecs`, `evidenceBundle`, `qaStrategy`, `reportContentAudit`, `journeyAssertionAudit`, `assertionSuggestions`, `businessJourneys`, `testCases`, `riskRegister`, `riskAcceptance`, and `artifactIntegrity` before release-style summaries or CI decisions:

```bash
node dist/cli.js qa --url "https://example.com/admin/users" --config "reports/frontlens/users/product-context.config.json" --output "reports/frontlens/users-rerun" --no-trace --json
node dist/cli.js claim-guard --report "reports/frontlens/users/result.json"
node dist/cli.js qa-intake --report "reports/frontlens/users/result.json"
node dist/cli.js defect-proof --report "reports/frontlens/users/result.json"
node dist/cli.js defect-tickets --report "reports/frontlens/users/result.json"
node dist/cli.js traceability --report "reports/frontlens/users/result.json"
node dist/cli.js automation-specs --report "reports/frontlens/users/result.json"
node dist/cli.js evidence-bundle --report "reports/frontlens/users/result.json"
node dist/cli.js test-strategy --report "reports/frontlens/users/result.json"
node dist/cli.js report-content-audit --report "reports/frontlens/users/result.json"
node dist/cli.js journey-assertion-audit --report "reports/frontlens/users/result.json"
node dist/cli.js qa-plan --report "reports/frontlens/users/result.json"
node dist/cli.js qa-coverage --report "reports/frontlens/users/result.json"
node dist/cli.js assertion-suggestions --report "reports/frontlens/users/result.json"
node dist/cli.js business-journeys --report "reports/frontlens/users/result.json"
node dist/cli.js test-cases --report "reports/frontlens/users/result.json"
node dist/cli.js risk-register --report "reports/frontlens/users/result.json"
node dist/cli.js risk-acceptance --report "reports/frontlens/users/result.json"
node dist/cli.js artifact-integrity --report "reports/frontlens/users/result.json"
# then inspect qa-intake.config.json, claim-guard.md, defect-proof.md, defect-tickets.md, traceability.md, automation-specs.md, evidence-bundle.md, test-strategy.md, report-content-audit.md, journey-assertion-audit.md, assertion-suggestions.md, business-journeys.md, test-cases.md, risk-register.md, risk-acceptance.md, or result.json claimGuard/qaIntake/defectProof/defectTickets/traceability/automationSpecs/evidenceBundle/qaStrategy/reportContentAudit/journeyAssertionAudit/assertionSuggestions/businessJourneys/testCases/riskRegister/riskAcceptance/artifactIntegrity
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


## Config Snippets

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

## Stable Result-Consumption Commands

Stable result-consumption commands for other skills:

```bash
node dist/cli.js inspect --report "reports/frontlens/users/result.json"
node dist/cli.js brief --report "reports/frontlens/users/result.json"
node dist/cli.js audit --report "reports/frontlens/users/result.json"
node dist/cli.js product-context --report "reports/frontlens/users/result.json"
node dist/cli.js claim-guard --report "reports/frontlens/users/result.json"
node dist/cli.js qa-intake --report "reports/frontlens/users/result.json"
node dist/cli.js defect-proof --report "reports/frontlens/users/result.json"
node dist/cli.js report-content-audit --report "reports/frontlens/users/result.json"
node dist/cli.js journey-assertion-audit --report "reports/frontlens/users/result.json"
node dist/cli.js qa-plan --report "reports/frontlens/users/result.json"
node dist/cli.js qa-coverage --report "reports/frontlens/users/result.json"
node dist/cli.js assertion-suggestions --report "reports/frontlens/users/result.json"
node dist/cli.js business-journeys --report "reports/frontlens/users/result.json"
node dist/cli.js test-cases --report "reports/frontlens/users/result.json"
node dist/cli.js risk-register --report "reports/frontlens/users/result.json"
node dist/cli.js risk-acceptance --report "reports/frontlens/users/result.json"
node dist/cli.js artifact-integrity --report "reports/frontlens/users/result.json"
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high --full
node dist/cli.js network --report "reports/frontlens/users/result.json"
node dist/cli.js coverage --report "reports/frontlens/users/result.json"
node dist/cli.js security --report "reports/frontlens/users/result.json"
node dist/cli.js disposition --report "reports/frontlens/users/result.json"
node dist/cli.js root-causes --report "reports/frontlens/users/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/users/result.json"
node dist/cli.js diff --before "reports/frontlens/old/result.json" --after "reports/frontlens/new/result.json"
# read diff.professional before raw issue deltas when judging fix/regression outcome
node dist/cli.js env-compare --dev-url "http://127.0.0.1:5173/users" --preview-url "http://127.0.0.1:4173/users"
node dist/cli.js requirements synthesize --input "docs/prd.md" --output "reports/frontlens/users/requirements.json"
node dist/cli.js role-matrix --url "http://127.0.0.1:5173/users" --role admin=".frontlens/auth/admin.json" --role viewer=".frontlens/auth/viewer.json"
node dist/cli.js journey record --url "http://127.0.0.1:5173/users" --output "journeys/users-smoke.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json" --all
```

`brief` is the default one-page human/LLM summary. `audit` is the report-contract self-check; a failed audit should block trusting must-fix/fixTasks or broad sign-off claims until the report is corrected or downgraded. `defect-tickets` is the human bug-filing queue; it excludes needs-evidence/product/deployment/tool observations. `traceability` is the PRD-to-test-to-defect matrix for sign-off; high-priority gaps or orphan defects mean business validation remains conditional. `automation-specs` returns review-only Playwright draft tests and must not be counted as passed evidence until a tester reviews and runs them. `evidence-bundle` returns the shareable handoff manifest and must be clear of missing-artifact items before citing local screenshots/videos/downloads as evidence. `business-journeys` returns the scenario planning pack; ready scenarios still require rerun before they become pass evidence. `suggestions` returns only proof-ready/actionable work by default; use `--all` only when auditing suppressed product/style/deployment/tool/needs-evidence suggestions.

`--severity high` returns high and above (`critical` + `high`), not only exact high.

Report depth: pass `--report-profile executive|professional|full` or set `report.profile` in config. Default `executive` keeps `report.md` as the shortest decision brief; use `professional` for a fuller QA-lead review; `full` appends the evidence appendix into `report.md`. `evidence-report.md` is always written.
