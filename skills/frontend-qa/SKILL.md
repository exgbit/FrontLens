---
name: frontend-qa
description: "Run low-token FrontLens SME-standard frontend QA for a live page with source-aware triage and, when PRD/source are provided, Git base-branch change impact plus regression of affected existing business. Use when the user asks to test, QA, audit, inspect, or review a frontend URL/page and wants practical small/mid-size-business output: core regression checklist, release risks, historical/impact regression needs, permission matrix, defect priorities, non-fix decisions, and release acceptability. Default scope excludes deep performance, full security, visual diff, mobile matrix, SEO, realtime, automation, and forensic evidence unless explicitly requested; route those to the dedicated frontend-qa-* specialty skills."
---

# Frontend QA

Run **SME-standard QA** by default: concise, source-aware, release-decision oriented, and low-token.

## Default output: exactly 7 sections

1. Core regression checklist
2. Pre-release risk checklist
3. Historical bug regression checklist
4. Permission matrix
5. Defect priority judgment
6. Non-fix / accepted / out-of-scope explanations
7. Release acceptability: `可上线` / `有风险可上线` / `不建议上线` / `不可上线`

Do not turn this default run into an exhaustive scanner report.

## Module selection before every run

Ask for module selection before running unless the user already chose modules. Prefer UI buttons/multi-select if the client supports them; otherwise show this checklist and state that **SME standard** is preselected:

- [x] SME standard QA (Recommended): page load, fatal console, API summary, exception feedback, source correlation, basic permissions, basic a11y, build/typecheck/lint when available
- [ ] Performance specialty: route to `$frontend-qa-performance`
- [ ] Security specialty: route to `$frontend-qa-security`
- [ ] Visual diff specialty: route to `$frontend-qa-visual`
- [ ] Mobile/responsive specialty: route to `$frontend-qa-mobile`
- [ ] Automation/journey specialty: route to `$frontend-qa-automation`
- [ ] Forensic/full evidence specialty: route to `$frontend-qa-forensics`

Interpret `全选 / all / default` as **SME standard QA only**, not every specialty. Interpret `full / forensic / 深度 / 全量证据` as `$frontend-qa-forensics`.

## Default SME scope

Run only what affects practical release decisions:

- Page reachability, blank screen, route/runtime blocker
- Fatal Console/Page Error
- Network/API summary and obvious failed core requests
- Exception feedback for 500/401/403/404/timeout: distinguish failure from true empty data
- Source correlation when `sourceRoot` is provided: file:line for retained frontend defects
- Basic permission matrix skeleton: unauthenticated / current role / provided roles; mark missing storage states as needs-input
- Basic a11y only: missing accessible names/labels/focus blockers that are cheap and clear
- Build/typecheck/lint when project scripts exist and user allowed local code checks
- Product/requirement gaps: mark as needs-input, not as defects
- Git change impact when PRD + sourceRoot are available: compare with the detected/default base branch, map changed files to directly and transitively affected modules, and include the generated original-business regression targets in the core regression checklist
- Bounded business-data CRUD when the user supplies or grants access to a database explicitly identified as test/staging: create only run-owned records with unique IDs, exercise them through the UI/API where possible, assert persistence, and clean those exact IDs without asking for a second write confirmation

## Default exclusions

Do not run or report these by default:

- SEO for admin/internal pages
- Full browser matrix
- Full mobile/touch matrix
- Visual pixel diff / design-polish checks
- Deep bundle/Coverage/performance budgets
- Full passive/active security audit or deployment header scoring
- Realtime WebSocket/SSE/GraphQL checks
- Download/export validation unless required or allowed
- Automation specs, traceability, evidence bundle, exhaustive test-case matrix
- Full raw evidence appendix drill-down

Keep these capabilities in dedicated skills and invoke them only when explicitly requested.

## Large-file/token rules

Never open large raw artifacts by default:

- Do **not** directly read `result.json`, `network.json`, `page-model.json`, `resources.json`, `coverage.json`, `evidence-report.md`, or large `report.md`.
- Prefer `brief.md`, `qa-review.md`, compact helper commands, or small JSON fields extracted with `node`/`jq`.
- If a file is over ~200KB, inspect only targeted fields or line counts first.
- Cite raw artifact paths without loading them unless the user asks for forensic details.

## Workflow

1. Resolve URL, source path, output directory, requirements/historical bugs, and any declared Git base ref.
2. Ask module selection with SME standard preselected unless modules were specified.
3. If target is local/private and source path is provided, build/start/refresh the local dev or preview server only when needed; do not modify business code.
4. When PRD and sourceRoot are available, generate the requirement and change-impact plan first. Do not hardcode `main`; pass `--base-ref` only when declared, otherwise use automatic remote-default/main/master/develop detection. Current HEAD includes staged, unstaged, and untracked files by default:

   ```bash
   node dist/cli.js test-plan --input "<PRD>" --source-root "<SOURCE>" --project-type auto --output "<REPORT>/plan"
   ```

   Read `test-plan-summary.json` then `change-impact.md`. Put generated `CHANGE-REG-*` cases into the existing **Core regression checklist** rather than adding a noisy report section. Static changed/dependent-file analysis selects scope but never proves that existing business behavior passed.
5. Run FrontLens from the repo root with the safest compact SME profile:

   ```bash
   node dist/cli.js qa --url "<URL>" --output "reports/frontlens/<name>" --report-profile executive --sme --json-summary
   ```

   Add `--source-root <path>` when provided. When step 4 produced a plan, also add `--requirements "<REPORT>/plan/test-plan.json"` so FrontLens can bind PRD requirements and `CHANGE-REG-*` targets to runtime evidence and emit the planned-test report. Add `--source-run-scripts --source-scripts "typecheck,lint"` only when dependencies exist and the user allowed local checks. If an explicitly identified local/private test target fails with `ERR_CERT_AUTHORITY_INVALID`, `ERR_CERT_COMMON_NAME_INVALID`, or an equivalent certificate error, rerun with `--ignore-https-errors`; never use this flag silently for a public/production target. The resulting TLS-bypass warning remains a deployment risk rather than a passed security check. If the installed CLI does not support `--sme` or `--json-summary`, use the fallback flags: `--no-trace --no-security --no-coverage --no-realtime --no-p2 --json`.
6. Use the `--json-summary` stdout first, then read `brief.md` if needed. If missing, use `qa-review.md` or helper output. Read only small targeted fields from `result.json` if needed.
7. Execute new-requirement flows plus impact-selected original business flows and related existing tests. Bind target-specific automation evidence with its generated `CHANGE-REG-*` id; a full build or global green test alone is not proof for every affected module.
   When an explicitly identified test/staging database or its access details are provided, that is authorization for bounded create/query/update/delete of records owned by this run. Prefer UI/API/service entry points; use direct SQL only for setup, assertions, exact cleanup, or when no business entry point exists. This does not authorize migrations, `DROP`, `TRUNCATE`, broad updates/deletes, or changes to pre-existing records.
   For FrontLens UI journeys, convert that authorization into executable but bounded safety config without another permission prompt: mark only the required journey steps `allowMutating=true`, enable only the required `safety.allowCreate` / `allowEdit` / `allowDelete` / `allowSubmit` flags in a temporary report-side config, and keep `blockMutatingRequests=true`. Do not use the broad `--allow-mutating-requests` switch when narrower method/category flags suffice. Register the exact run-owned IDs and cleanup action before enabling the journey; otherwise the case remains `needs-input`, never `passed`.
8. Combine runtime evidence, source evidence, product/requirement context, and review calibration. Do not promote style/product assumptions, dev-server artifacts, deployment headers, skipped modules, or weak API/UI mismatch into must-fix.
9. Return the 7-section SME report. In Core regression checklist distinguish passed/failed/not-run impact targets and state the base/head used. Keep selector-level/raw network detail out of the final answer unless requested.
10. Keep every retained report/generated-data directory user-owned and removable. On Windows, never leave a sandbox-only ACL; FrontLens performs an automatic ACL-inheritance handoff, and `node dist/cli.js permissions repair --output <generated-directory>` may repair an older retained output. Apply it only to generated roots, never a drive, home directory, or source repository. Stop only processes/containers created by this run and remove only disposable test data whose exact IDs were registered by this run; never restart or clean a reused shared environment broadly.

## Triage rules

- With no requirements: validate obvious functionality and risks, but do not invent product expectations such as export, pagination, refresh, SEO, mobile support, or exact style.
- With basic requirements: test only explicit or strongly implied requirements; vague text becomes needs-input.
- API/UI data mismatch requires four-part proof before becoming a defect: explicit requirement, exact list response/path/count, visible empty target UI, and source API/state/render binding.
- Dev server metrics, Vite HMR/WebSocket, `/src/*`, and `/@vite/client` are environment noise for production performance/security.
- Security headers/TLS/server fingerprint are deployment checklist items unless this repo owns deployment config. An invalid-certificate bypass may unblock functional QA, but it must remain visible in the report with low security trust; recommend a trusted internal CA and SAN matching the accessed hostname/IP.
- Login is not a standalone default section; treat auth as setup and permissions matrix evidence.
- Count work by proof-ready root cause, not raw issue IDs.

## Specialty routing

When the user asks for a specialty, invoke the dedicated skill instead of expanding this one:

- `$frontend-qa-performance`: slow page, bundle, Coverage, Core Web Vitals, P2 budgets
- `$frontend-qa-security`: CSP/HTTPS/Cookie/sensitive data/security checklist
- `$frontend-qa-visual`: design baseline, pixel diff, UI regression
- `$frontend-qa-mobile`: mobile/tablet/responsive/touch matrix
- `$frontend-qa-automation`: journey record/replay, Playwright specs, regression automation
- `$frontend-qa-forensics`: full/deep/incident evidence, raw network, exhaustive artifacts
