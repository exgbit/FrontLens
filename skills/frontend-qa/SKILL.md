---
name: frontend-qa
description: "Run low-token FrontLens SME-standard frontend QA for a live page with source-aware triage. Use when the user asks to test, QA, audit, inspect, or review a frontend URL/page and wants practical small/mid-size-business output: core regression checklist, release risks, historical-bug regression needs, permission matrix, defect priorities, non-fix decisions, and release acceptability. Default scope excludes deep performance, full security, visual diff, mobile matrix, SEO, realtime, automation, and forensic evidence unless explicitly requested; route those to the dedicated frontend-qa-* specialty skills."
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

1. Resolve URL, source path, output directory, and whether requirements or historical bugs were provided.
2. Ask module selection with SME standard preselected unless modules were specified.
3. If target is local/private and source path is provided, build/start/refresh the local dev or preview server only when needed; do not modify business code.
4. Run FrontLens from the repo root with the safest compact SME profile:

   ```bash
   node dist/cli.js qa --url "<URL>" --output "reports/frontlens/<name>" --report-profile executive --sme --json-summary
   ```

   Add `--source-root <path>` when provided. Add `--source-run-scripts --source-scripts "typecheck,lint"` only when dependencies exist and the user allowed local checks. If the installed CLI does not support `--sme` or `--json-summary`, use the fallback flags: `--no-trace --no-security --no-coverage --no-realtime --no-p2 --json`.
5. Use the `--json-summary` stdout first, then read `brief.md` if needed. If missing, use `qa-review.md` or helper output. Read only small targeted fields from `result.json` if needed.
6. Combine runtime evidence, source evidence, product/requirement context, and review calibration. Do not promote style/product assumptions, dev-server artifacts, deployment headers, skipped modules, or weak API/UI mismatch into must-fix.
7. Return the 7-section SME report. Keep selector-level/raw network detail out of the final answer unless requested.

## Triage rules

- With no requirements: validate obvious functionality and risks, but do not invent product expectations such as export, pagination, refresh, SEO, mobile support, or exact style.
- With basic requirements: test only explicit or strongly implied requirements; vague text becomes needs-input.
- API/UI data mismatch requires four-part proof before becoming a defect: explicit requirement, exact list response/path/count, visible empty target UI, and source API/state/render binding.
- Dev server metrics, Vite HMR/WebSocket, `/src/*`, and `/@vite/client` are environment noise for production performance/security.
- Security headers/TLS/server fingerprint are deployment checklist items unless this repo owns deployment config.
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
