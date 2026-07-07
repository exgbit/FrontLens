# FrontLens triage guidelines

Use this reference after every QA run before reporting findings. The raw report is evidence, not the final truth. Calibrate issues against the page model, screenshots, network timeline, and source code when available. When a source root is provided or known, also read `source-code-correlation.md` and make source-aware triage mandatory.

## Mandatory post-run triage

Create a concise triage table with these buckets:

- **Real frontend fix**: reproducible UI/state/accessibility/interaction defect in app code.
- **Backend/API fix**: API status/schema/latency/contract issue not caused by the scanner.
- **Deployment/security config**: headers, TLS, server fingerprint, CDN/nginx/cache config.
- **Product decision**: optional capability such as export, pagination, SEO, or manual refresh.
- **Tool limitation / false positive**: scanner heuristic mismatch, synthetic traffic, unsupported page type.

Report raw score separately from adjusted risk. If many findings are skipped, synthetic, or deployment-only, say the score is low-confidence and prioritize the triaged fix list instead of repeating every issue.

Use `qaSignoff`, `environment`, and `pageProfile` before final sign-off wording. If `qaSignoff.businessValidationConfidence` is not `runtime-verified`, or `environment.trust.performance/security` is not high for release claims, do not describe business validation or production readiness as fully passed even when `qualityGate.status=pass`.

Use `defectProof` before scheduling fixes: if a root cause is `needs-evidence`, list the missing evidence and do not call it must-fix until confirmed. Use `claimGuard` before final wording: if `claimGuard.status=limited|blocked`, remove or explicitly negate every `forbiddenClaims[]` phrase and use `items[].allowedWording` instead. Use `qaIntake` before turning uncertainty into conclusions: if `qaIntake.status=needs-input|blocked`, list `topQuestions[]` and keep linked claims conditional until answered. Use `scopeReview` before product/design conclusions. If `scopeReview.status=needs-input`, answer the questions in `scope-review.md` or copy the confirmed `configSnippet.productContext` into the next run before promoting style, pagination, export, refresh, responsive, visual-density, or device-scope findings to must-fix defects.

Apply an **actionability gate** before presenting final findings:

- Keep as **core fixes** only defects with direct user impact and evidence: runtime error, broken route, failed core journey, API failure with missing visible error state, a11y violation with selectors, confirmed data binding mismatch, or source-confirmed performance/bundle issue.
- Move to **reference/product decision** instead of fixes: visual density, color/style preference, number of primary buttons, manual refresh/export/pagination expectations, optional SEO on admin pages, small tap targets on PC-first products, or any feature that depends on product requirements.
- Suppress repeated detail: summarize reference items in one row/table and do not expand them into per-selector fix tasks unless the user explicitly asks for design/a11y polish.
- Keep the final answer terse and decision-oriented: for style/product-scope observations, report the bucket and count, not every selector. Only expand selector-level evidence for retained core defects or when the user explicitly requests polish details.
- For API/UI data-mismatch claims, require four aligned evidence layers before calling it a real frontend defect: exact `networkRequestId`, visible DOM/screenshot state, source API/state/rendering file:line, and product requirement that the UI should render that data. Missing any layer means **conditional / insufficient evidence**, not a fix.

Also add a **root-cause grouping** before the final fix list:

- Group multiple raw issue IDs that point to the same implementation defect, such as 500/401/403/404/timeout all rendering the same false empty state.
- Count implementation work by proof-ready root cause, not by raw issue IDs. `fixTasks[]` is proof-aware in FrontLens 1.32+ but remains machine-oriented; `defectProof.needs-evidence` items are evidence-collection work, not implementation defects. In FrontLens 1.34+, use `rootCauseGroups[].sourceLocations` to report the normalized file:line fix surface instead of re-deriving it from each raw issue; in FrontLens 1.36+ this field also includes medium/high source-runtime links, in FrontLens 1.37+ it can include source ui-accessibility findings for runtime a11y roots, in FrontLens 1.38+ it can include source error-state-gap findings for exception no-feedback roots, and weak/missing source-bound frontend root causes stay needs-evidence.
- In FrontLens 1.33+, reproducible exception no-feedback findings retain their EX/network/console/page-error evidence and can become proof-ready root-cause candidates. Keep them as frontend error-state/retry defects when the user impact is visible; still do not reinterpret the synthetic status code as a backend contract failure.
- If a generated suggestion does not match the issue category or evidence, mark it as template noise and replace it with a source/evidence-specific fix.

Add an **evidence confidence** label to any business-function conclusion:

- `runtime-verified`: the browser reached the target state and FrontLens captured DOM/screenshot/network/console evidence for that exact behavior.
- `runtime-partial`: the page booted but login, permissions, downloads, destructive safety policy, or missing data prevented full verification.
- `static-source-only`: conclusion is based only on source/chunk/code inspection; useful for syntax/import/config issues, but not enough to say the user-facing business flow passed.
- `not-verified`: the runtime path was not reached. Do not say business validation passed or use 100% confidence.
- `source-health-failed`: sourceHealth found syntax errors or failed/timed-out explicitly enabled source script checks; treat as source-confirmed blocker, but still avoid claiming which runtime business flow is broken unless runtime evidence reaches it.

For product/design/style findings, default to **Product decision / optional** unless there is evidence that the style blocks a core task, violates an explicit ADR/accessibility requirement, or causes measurable usability failure. Avoid turning subjective visual density or color hierarchy into mandatory defects.

For role/permission findings, default role-specific UI differences to **permission review evidence**, not bugs. Promote to a real defect only when a PRD/role matrix says the role must or must not see the action, `role-matrix` reports expected allowed/forbidden text violations, or source/runtime guards confirm a permission leak.

For test-data lifecycle findings, separate **test environment/data readiness** from frontend bugs. Missing fixtures, missing cleanup, sensitive fixture usage, or unapproved production writes are QA blockers/risks owned by test data or environment setup unless source/runtime evidence shows the frontend mishandles data.

If the project supplies `metadata.config.productContext`, use it as the source of truth before classifying product-scope findings. If not, use `pageProfile.questions` to report missing scope instead of inventing a requirement:

- `requiredFeatures`: keep matching findings as real fix candidates or source-confirmation gaps.
- `optionalFeatures`: keep matching findings as product decisions, not mandatory defects.
- `outOfScopeFeatures`: mark matching findings as non-actionable observations.
- `deviceScope`: downgrade mobile/touch-target findings for `desktop-only` / `desktop-first`; keep them in scope for `mobile-first` and stricter accessibility targets.
- `decisions[]` / `adrRefs[]`: cite the matching ADR/product decision in the reason.

If `result.json.scopeReview.questions[]` contains relevant unanswered items, include a short "待产品/PRD 确认" row in the final answer and keep the matching raw findings conditional/non-actionable. Do not expand every selector-level style/touch target issue into a fix list unless productContext says the capability is required or the issue blocks a core task.

## Common false positives and downgrades

1. **Synthetic network profiles**
   - Requests from P2 offline/slow-3g or exception simulation may show `ERR_INTERNET_DISCONNECTED`, timeouts, or repeated page loads.
   - Do not call these backend failures unless the same API fails in the normal initial page load or a user journey.
   - If SPA HTML never boots in offline mode, classify offline feedback findings as tool limitation, not app missing feedback.

2. **Repeated requests caused by scan phases**
   - Responsive, P2, matrix, exception, and journey modules intentionally reload the page.
   - Repeated document/static/API requests across reload phases are not duplicate-fetch bugs.
   - Treat as real only when the same API fires in a burst during one page state or one user action.

3. **Table/list heuristic mismatch**
   - Do not require pagination, export, table empty states, or table row counts for card grids, master-detail layouts, kanban/cards, trees, dashboards, or credential/security pages.
   - If `pageModel.tables[]` points at a `div` with card/grid class and no real table headers/rows, treat table issues as false positives.
   - Export/download is product-specific and can be a security anti-pattern on sensitive pages.
   - If a scanner says "API has data but table/page is empty", keep it only when the exact API response is a list-like object array (`records`/`rows`/`list`/`items`/`results`, or `data` from a list-like endpoint), the visible DOM is genuinely empty, and source code or E2E evidence binds that API to that UI. When `sourceRuntimeCorrelation.status=passed`, require the relevant link `confidence` to be `medium/high`; otherwise classify as insufficient evidence or false positive.

4. **Sensitive data keyword matches**
   - URL paths like `/credentials`, `/auth`, or redacted path segments are not leaks by themselves.
   - Require evidence in URL query, request/response body, Console, DOM, or storage with real sensitive keys/values such as `access_token`, `refresh_token`, `password`, `client_secret`, `api_key`, or cookies.

5. **Security headers and HTTPS**
   - CSP, `nosniff`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy`, HTTPS, HSTS, and `Server` fingerprint are usually deployment/gateway tasks.
   - For localhost/private VPN/staging, mark as pre-production deployment risk unless the user asked for production readiness.
   - For sensitive admin/credential pages, still keep HTTPS + CSP + nosniff + clickjacking protection as release blockers.

6. **Vite dev server artifacts**
   - If the target loads `@vite/client`, `/src/*.vue`, `/src/*.ts`, `/src/styles/*.css`, `/node_modules/.vite/`, or Vite HMR WebSocket, the page is running in dev-source mode.
   - Do not count dev-mode request count, transfer size, `node_modules/.vite/deps/*` chunk size, source-module debug/path matches, or HMR WebSocket as production performance/security/realtime defects.
   - Use dev-mode module graph only as source evidence for static route imports or eager feature imports; validate real bundle/coverage conclusions on `build + preview` or deployed assets.
   - Do not let the downgrade hide a real source problem. If the module graph or source shows unrelated route views/heavy feature dependencies are eagerly imported, keep a separate source-discovered code-splitting issue.

7. **Skipped interactions**
   - Skipped tests mean no safe target was found or the action was disabled by safety policy.
   - Do not convert skipped interactions to defects. Mention coverage gaps only when the user asked for journey coverage.
   - If all or most IT-* checks are skipped, explicitly state that search/forms/drawers/table actions were not covered by automation; do not imply the interaction layer is fully verified.

8. **Artifact links and copied reports**
   - Before citing a screenshot/video/trace path, verify that the file exists in the report directory.
   - Prefer paths relative to the report directory, for example `screenshots/page-full.png`, so reports remain usable after being copied between machines.
   - If a referenced artifact is missing, mark it as a tool/reporting issue and do not use it as evidence. In FrontLens 1.35+, prefer `result.json.artifactIntegrity` plus the rewritten `report.md`/`report.html`; if they disagree, trust result.json and report a reporter-staleness bug. In FrontLens 1.36+, when sourceRoot is enabled, do not schedule a frontend fix whose defectProof remains needs-evidence because source binding is weak/missing.

## Source-code cross-check pattern

When the repository or source files are available, verify high-impact findings against implementation before finalizing issue status. Do not retain a frontend-code defect solely from browser heuristics when source evidence contradicts it.

- Error handling: does the composable/store keep an `error` state, and does the view render it with retry?
- Loading/empty distinction: can users distinguish loading, empty, permission denied, and failed API states?
- Shared error-handling pattern: if the same composable/http/store pattern is reused by sibling pages, mention it as an adjacent-risk sweep, but do not file it as a defect for the current page without source evidence.
- Business requirement validation: distinguish runtime proof from source-only proof. Static source/chunk evidence can detect syntax errors, missing imports, missing columns, or unreachable code, but it cannot prove API data correctness, export file contents, permissions, or full business workflow success.
- Source health: if `sourceHealth.status=failed`, put syntax errors and failed/timed-out `sourceHealth.scriptChecks[]` near the top of the core defect list as source-confirmed blockers. If it passed, report it as source-health evidence only, not as business-function pass.
- Accessibility: do icon-only buttons have `aria-label` or visible text? Are tap targets large enough on mobile?
- API calls: is `load()` triggered once per mount, or repeated by watchers/effects? Are retries/debounces intentional?
- API/UI binding: if `sourceRuntimeCorrelation.links[]` exists, cite the specific link id and confidence. Do not retain “接口有数据但页面空” when the link is missing or `confidence=none/low`.
- Bundle size: check router lazy loading, route/component dynamic imports, UI library import style, and CSS theme inclusion before blaming one page. When raw dev-server performance issues are false, still retain source-confirmed eager routing or heavy feature import problems as source-discovered issues.
- Exception simulations: are 401/403/404/500 request ids from `exceptionSimulations[]` rather than real backend behavior?
- Native browser console entries: is the console error app-generated, or just Chromium logging a non-2xx resource?
- Deployment ownership: does the frontend repo include nginx/CDN/server config for reported headers/TLS, or is it outside the app?

Use final statuses: `confirmed-by-code`, `source-discovered`, `contradicted-by-code`, `deployment-only`, `product-or-ADR-tradeoff`, `synthetic-or-tool-limitation`, or `insufficient-source-coverage`.

For every retained frontend issue, include file paths and line numbers. For every rejected issue, include the contradiction source: source file, scan phase, exception id, ADR, or deployment ownership.

Avoid speculative wording. Use "confirmed", "source-discovered", "not verified", or "requires runtime/auth rerun" instead of assuming hidden backend data, product intent, or user behavior. If the scanner says "API has data but page empty", verify the exact network response, DOM state, screenshot, and source rendering branch before retaining it.

## Final report format

Return:

1. Raw artifact paths and raw score.
2. Adjusted triage summary: counts by bucket and confidence.
3. Top real fixes, ordered by P1/P2/P3.
4. Deployment/security tasks separately from app-code tasks.
5. False positives/tool limitations with issue IDs and reason.
6. Verification commands and rerun plan.


## Dev vs preview comparison

When a run targets Vite/dev-source mode and the user needs production-readiness, run `env-compare` after starting a build/preview server. Treat persistent findings as higher confidence, preview-only findings as production-build/deployment candidates, and dev-only findings as likely dev artifacts unless source/runtime evidence confirms an implementation defect.
