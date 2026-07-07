# FrontLens Commands Reference

Use this reference when exact CLI syntax is needed after `frontend-qa` has selected modules, source mode, auth, journey, CI, or result-consumption tasks. Keep `SKILL.md` focused on workflow and triage; keep concrete command variants here.

## Contents

- [Common Commands](#common-commands)
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

## Stable Result-Consumption Commands

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
