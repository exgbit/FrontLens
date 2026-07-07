# Source-code correlation and local deploy-before-QA

Use this reference whenever a FrontLens run has a frontend repository path, a known project mapping, or a local/private deployment URL. The live report is only the first pass; final triage must combine browser evidence with implementation evidence.

## Inputs to carry into the worker

- `targetUrl`: URL that FrontLens should test.
- `sourceRoot`: frontend repository path if provided or known.
- `deployUrl`: local/preview URL to use when it differs from `targetUrl`.
- `routePath`: path under test, e.g. `/credentials`.
- `outputDir`: FrontLens artifact directory.

Known current mapping:

- `sourceRoot`: `/Users/justin/work/sunrise-web`
- credentials page local deployment: `http://127.0.0.1:5173/credentials`
- route path: `/credentials`

## Auto deploy / serve before QA

When `sourceRoot` exists and the user asks to deploy first, or the page is unreachable/stale:

1. Check reachability:
   - `curl -I --max-time 5 "<deployUrl>"`
   - For SPAs, a 200/304 HTML response is enough for reachability; API failures are handled during QA.
2. Inspect the app scripts without changing business code:
   - `cat package.json`
   - prefer existing `dev`, `build`, and `preview` scripts.
   - For professional QA/sign-off runs, also list available `lint`, `typecheck`, `test`, `e2e`, and `coverage` scripts. Run non-destructive source-health commands when they are fast and dependencies exist; otherwise report them as coverage gaps.
3. Install dependencies only if required:
   - If `node_modules` is missing, run the package-manager install command implied by the lockfile (`npm install`, `pnpm install`, or `yarn install`).
4. Start the local server in the source repo:
   - For Vite dev URL like `127.0.0.1:5173`, prefer `npm run dev -- --host 127.0.0.1 --port 5173`.
   - For built preview URL, run `npm run build`, then `npm run preview -- --host 127.0.0.1 --port <port>`.
   - Keep the server session alive while running FrontLens.
5. Recheck `deployUrl`. If still unreachable, report the server log and stop before issuing a misleading QA report.
6. Never edit the business repo while doing QA unless the user explicitly asks for code fixes.

### Source-health pass

When the user provides `sourceRoot`, a professional QA pass should include source-health status:

- package manager and lockfile detected
- build/typecheck/lint/unit/e2e scripts discovered
- commands run, pass/fail/skipped, and log excerpts; prefer `--source-run-scripts --source-scripts "typecheck,lint"` for professional sign-off so the evidence lands in `result.json.sourceHealth.scriptChecks`
- whether the tested URL appears to match the inspected source branch/build
- `result.json.sourceAnalysis.status`, route/import findings, API call index, and loading/error/empty/retry state signals
- `result.json.sourceRuntimeCorrelation.status`, `links[]`, link confidence, source matches, component ids, and list-response hints
- `result.json.environment.kind` / `environment.trust` before performance/security/release claims, and `result.json.pageProfile.status` / `pageProfile.questions` before product/design-scope claims
- `result.json.sourceHealth.status`, package scripts, scriptChecks, syntax findings, and source-health issue IDs

Do not mark business functionality as passed just because source-health commands pass. Treat them as one layer of evidence.

Use `sourceAnalysis` before manual grep:

1. If `sourceAnalysis.status=passed`, inspect `sourceAnalysis.findings[]` for route-level eager imports, heavy dependencies, `ui-accessibility`, and `error-state-gap` evidence.
2. Use `sourceRuntimeCorrelation.links[]` first when available. For “接口有数据但页面为空/表格为空”类结论，只有相关 `networkRequestId` 的 `confidence` 达到 `medium/high` 才能保留为缺陷候选；`none` 代表全局 Network 响应没有证明绑定到当前页面源码/UI，`low` 代表弱关键词匹配，证据不足。
3. If `sourceHealth.status=failed`, inspect `sourceHealth.findings[]` and `sourceHealth.scriptChecks[]` first. Syntax errors and failed/timed-out typecheck/build/test script checks are source-confirmed blockers and may explain broken runtime routes; do not bury them under secondary UI symptoms.
4. Use `sourceAnalysis.apiCalls[]` to map network endpoints to source files before claiming API/UI binding issues.
5. Use `sourceAnalysis.stateSignals[]` as a starting map for loading/error/empty/retry triage; use `sourceAnalysis.findings[kind=error-state-gap]` to bind exception no-feedback issues to a concrete view only when runtime exception evidence also shows a false empty/no-feedback state.
6. If `sourceAnalysis.status=skipped`, mention that no source root was provided or indexing was disabled.

If an existing server is already healthy, do not restart it unless the user asked for a fresh deployment or assets are clearly stale versus the source under review.

### Dev server vs production-preview selection

When the reachable URL is a Vite dev server (`@vite/client`, `/src/*.vue`, `/node_modules/.vite/`, or HMR WebSocket) and the selected modules include performance, coverage, resource, security, or realtime:

1. Keep the dev-server run only for functional/source correlation if it was explicitly requested or already running.
2. Do **not** use dev-server request count, transfer size, debug/source leak, or HMR WebSocket as final performance/security/realtime defects.
3. If `sourceRoot` is available, run an additional production-like pass:
   - `npm/pnpm/yarn run build`
   - `npm/pnpm/yarn run preview -- --host 127.0.0.1 --port <free-port>`
   - FrontLens QA against the preview URL for performance/security/bundle conclusions.
4. If preview cannot be started, state that performance/security scores are low-confidence and require build/preview validation.
5. Dev-mode downgrade is **not** deletion. If the dev module graph includes unrelated route views, feature-only editors, charts, admin pages, or other non-current-route modules, inspect source imports and keep a source-discovered code-splitting finding when source confirms eager imports.

## Source mapping workflow

1. Map route to source:
   - inspect router files such as `src/router/index.ts`, `src/router/**/*.ts`, or framework route folders.
   - map the route component/view, then follow imports to composables, stores, API clients, and child components relevant to each issue.
2. Check route-level code splitting for every source-aware run, not only when raw performance issues exist:
   - Vue Router: route records should prefer `component: () => import('...')` for non-trivial views; top-level `import FooView from ...` for many sibling routes usually means eager route bundling.
   - React Router / Next / Nuxt / SvelteKit / Angular: check the framework-equivalent lazy route, dynamic import, page chunk, or standalone route module mechanism.
   - Use dev module graph (`/src/views/*`, `/src/pages/*`, feature components) as a clue only. The retained defect must be based on source evidence such as static route imports, a barrel file importing many pages, or a shared layout eagerly importing feature-only modules.
   - If source confirms eager imports of unrelated pages or large feature-only dependencies, add/retain a `source-discovered` frontend performance finding even if the raw dev request-count/transfer issue is downgraded.
   - Severity guide: P2 when unrelated heavy features or editor/chart/code/highlight libraries enter the current route's initial bundle; P3 when only a few lightweight sibling pages are eager; no issue for intentionally tiny apps or framework-required shared layouts.
3. Gather line-number evidence:
   - use `rg -n "<symbol|text>" <sourceRoot>/src`
   - use `nl -ba <file> | sed -n '<start>,<end>p'`
4. For each raw issue or source-discovered issue, assign one final status:
   - `confirmed-by-code`
   - `contradicted-by-code`
   - `deployment-only`
   - `product-or-ADR-tradeoff`
   - `synthetic-or-tool-limitation`
   - `insufficient-source-coverage`
   - `source-discovered`
5. Retain a frontend issue only when browser evidence and source evidence agree, or when source evidence reveals the real bug behind a noisy raw finding. Do not require a surviving raw issue for source-confirmed problems. In FrontLens 1.34+, prefer `rootCauseGroups[].sourceLocations` for the normalized file:line fix surface, then drill into `sourceAnalysis`, `sourceRuntimeCorrelation`, or raw issue `evidence.details` only when the group lacks locations or needs deeper proof. In FrontLens 1.36+, medium/high `sourceRuntimeCorrelation.links[]` are rolled into `rootCauseGroups[].sourceLocations`; if sourceRoot is enabled and a frontend root cause still has no strong source binding, keep it as `defectProof=needs-evidence`. In FrontLens 1.37+, `sourceAnalysis.findings[kind=ui-accessibility]` can bind runtime a11y button-name findings to component file:line; in FrontLens 1.38+, `sourceAnalysis.findings[kind=error-state-gap]` can bind exception no-feedback findings to the view that tracks errors but only renders an empty state; in FrontLens 1.39+ this error-state binding applies across Vue, Svelte, and JSX/TSX render blocks; in FrontLens 1.40+ the a11y binding includes multi-line Vue/Svelte/JSX icon-button tags.
6. Apply an actionability gate:
   - Core fix: route/runtime error, failed core journey, missing error/retry state for real API failures, hard a11y violation, confirmed data binding mismatch, source-confirmed bundle/performance issue.
   - Product/reference: style hierarchy, visual density, primary-button count, optional refresh/export/pagination, SEO for non-public admin pages, mobile tap target tradeoffs under PC-first ADR.
   - Insufficient evidence: any conclusion based on only one signal, such as a global Network array without DOM/source binding.

Minimum source sweep for any page:

- Route/page entry for the target URL (`src/router`, `src/routes`, `src/pages`, framework route files).
- The matched view/page component plus directly rendered child components.
- Composable/store/query files that load the page data and expose loading/error/empty/retry state.
- API client/module and shared HTTP/error wrapper used by that page.
- Shared layout/shell only when evidence comes from shell elements or eager imports.
- Build/config files such as `vite.config.ts`, `webpack.config.*`, `next.config.*`, or framework equivalents for bundle/performance findings.
- ADR/docs/PRD files when a finding depends on design tradeoffs, device scope, accessibility target, or feature requirements.

For a credentials-like page, additionally inspect credential-specific files such as `src/views/CredentialsView.vue`, `src/composables/useCredentials.ts`, `src/api/credentials.ts`, and `src/components/**/Cred*.vue`. Treat these as examples only; derive the actual files from the target route and source index for other pages.

## Calibration rules learned from recent QA reviews

- **Synthetic exception traffic**: status codes injected by `exceptionSimulations[]` or request ids listed under EX-* are scanner traffic. Do not report them as backend contract violations.
- **Native non-2xx console noise**: Chromium `Failed to load resource` for 401/403/404/500 is browser-native. Treat it as app-console noise only if app code logs it or the UI mishandles the error. Prefer fixing visible error state/retry.
- **Error state vs empty state**: if a composable/store captures `error` but the view renders only loading/list/empty states, classify API failure as a real frontend bug. Require a user-visible error state and retry path.
- **Duplicate requests**: reloads from responsive, P2, journey, exception, and matrix phases are not duplicate-fetch bugs. Confirm a real duplicate only inside one page state or one user action, and verify watchers/effects in source.
- **Card layouts are not tables**: do not require pagination/export/table row counts for master-detail cards, grids, dashboards, trees, or credential/security pages.
- **API data but empty UI is high-risk for speculation**: retain only when one specific response body contains list-like object rows, the current visible UI is empty, and source/E2E proves that response feeds that UI. Generic `{ data: [...] }` from unrelated endpoints such as platform/options/menu dictionaries is not enough.
- **Business path words are not leaks**: `/credentials`, `/auth`, `/token`, `/secret` or similar words in a URL path/module name are not sensitive-data exposure by themselves. Require real secrets in query/body/DOM/storage/logs.
- **Deployment security headers**: CSP, `nosniff`, clickjacking headers, Referrer-Policy, COOP/CORP, HSTS/HTTPS, and `Server` fingerprint are deployment/gateway work unless the repo owns deploy config.
- **PC-first ADRs / productContext**: if `metadata.config.productContext.deviceScope` or an ADR declares PC-first with mobile as adaptive/degraded, small inline icon buttons can be downgraded to optional/mobile-breakpoint work unless they block core mobile use. If `productContext.requiredFeatures` includes `mobile-touch-target`, keep the same finding as a real fix candidate.
- **Bundle bloat**: verify router/component lazy loading and large feature imports before blaming UI libraries. For Vue/Vite, static route imports can pull feature-only dependencies into the main chunk.
- **Eager route imports survive dev-noise downgrade**: if request-count/transfer/security findings are downgraded because the page is Vite dev server, still inspect router/page imports. Static imports of unrelated route views, or eager imports of heavy feature-only libraries through inactive routes, should remain as a source-discovered P2/P3 code-splitting issue.
- **Element Plus CSS**: if `vite.config.ts` uses resolver/on-demand imports, do not recommend generic CSS purge unless verified safe; Element Plus dynamic classes are easy to break.
- **Vite dev server is not a production artifact**: when evidence URLs include `@vite/client`, `/src/*.vue`, `/src/*.ts`, `/node_modules/.vite/`, or HMR WebSocket, downgrade raw request-count/transfer/security-leak/realtime findings as dev-mode artifacts. Still use the loaded module graph to prove eager imports, then rerun `build + preview` for production bundle evidence.
- **Exception feedback must be semantically visible**: do not accept KPI text such as `异常项 0`, empty states such as `暂无匹配凭证`, or generic page words as API-error feedback. A pass requires a user-visible failure/permission/timeout/network message and preferably a retry path.

## Required source-aware output

Add a section titled `源码关联复核` with a compact table:

| Raw issue / Source check | Final status | Source evidence | Browser evidence | Decision |
| --- | --- | --- | --- | --- |

For every retained frontend fix, include:

- file path and line range
- component/composable/API chain
- why the raw finding is valid or how the true root cause differs from the scanner wording
- minimal fix suggestion
- verification/rerun command

For every retained or passed business requirement, include a confidence label:

- `runtime-verified`: include exact screenshot/DOM selector/network request IDs and source lines.
- `runtime-partial`: include what was verified and what was blocked.
- `static-source-only`: include source/chunk evidence and state that runtime behavior/data/export was not proven.
- `not-verified`: include the blocker, such as login state, missing storageState, branch mismatch, download not allowed, or target route not reached.

Never report "business function validation passed with 100% confidence" from static source/chunk inspection alone. Runtime business validation requires the target page state, relevant API response, visible UI result, and any export/download artifact when export is part of the requirement.

Before listing fixes, group raw browser issues by implementation root cause. For example, if `useXxx()` captures `error` but the page never renders it, group api-500/api-401/api-403/api-404/timeout no-feedback findings under one frontend fix and list the raw issue IDs / exception IDs as supporting evidence. Keep scenario-specific severity in evidence, but present one actionable fix unless separate source paths prove separate causes.

When the source reveals the same unhandled-state pattern may exist on adjacent pages that share a composable, report it as "adjacent risk / optional sweep" unless the current route or user request covers those pages. This keeps page-specific findings compatible with future runs on different pages.

For false positives, include the raw issue id and the exact contradiction: source line, exception simulation id, scan phase, ADR, or deployment ownership.

For artifact evidence, cite report-relative paths and only cite files that exist. If a report generated on another OS uses absolute paths such as `D:\...` or `/tmp/...`, rewrite them to report-relative paths when possible; otherwise mark them as non-portable artifact references.


## Dev vs preview comparison

When a run targets Vite/dev-source mode and the user needs production-readiness, run `env-compare` after starting a build/preview server. Treat persistent findings as higher confidence, preview-only findings as production-build/deployment candidates, and dev-only findings as likely dev artifacts unless source/runtime evidence confirms an implementation defect.
