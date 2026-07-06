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
3. Install dependencies only if required:
   - If `node_modules` is missing, run the package-manager install command implied by the lockfile (`npm install`, `pnpm install`, or `yarn install`).
4. Start the local server in the source repo:
   - For Vite dev URL like `127.0.0.1:5173`, prefer `npm run dev -- --host 127.0.0.1 --port 5173`.
   - For built preview URL, run `npm run build`, then `npm run preview -- --host 127.0.0.1 --port <port>`.
   - Keep the server session alive while running FrontLens.
5. Recheck `deployUrl`. If still unreachable, report the server log and stop before issuing a misleading QA report.
6. Never edit the business repo while doing QA unless the user explicitly asks for code fixes.

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
5. Retain a frontend issue only when browser evidence and source evidence agree, or when source evidence reveals the real bug behind a noisy raw finding. Do not require a surviving raw issue for source-confirmed problems.

Minimum files to inspect for `/credentials` in `sunrise-web`:

- `src/router/index.ts`
- `src/views/CredentialsView.vue`
- `src/composables/useCredentials.ts`
- `src/api/http.ts`
- credential API module(s), commonly `src/api/credentials.ts`
- credential components matching `src/components/**/Cred*.vue`
- especially `CredRegionDetail.vue`, `CredAdsDetail.vue`, `CredShopDetail.vue`, `CredAdsCard.vue`, and `CredDetailMoreMenu.vue`
- `vite.config.ts`
- ADR/docs files when a finding depends on design tradeoffs, e.g. PC-first/mobile behavior or bundle strategy.

## Calibration rules learned from credentials-page reviews

- **Synthetic exception traffic**: status codes injected by `exceptionSimulations[]` or request ids listed under EX-* are scanner traffic. Do not report them as backend contract violations.
- **Native non-2xx console noise**: Chromium `Failed to load resource` for 401/403/404/500 is browser-native. Treat it as app-console noise only if app code logs it or the UI mishandles the error. Prefer fixing visible error state/retry.
- **Error state vs empty state**: if a composable/store captures `error` but the view renders only loading/list/empty states, classify API failure as a real frontend bug. Require a user-visible error state and retry path.
- **Duplicate requests**: reloads from responsive, P2, journey, exception, and matrix phases are not duplicate-fetch bugs. Confirm a real duplicate only inside one page state or one user action, and verify watchers/effects in source.
- **Card layouts are not tables**: do not require pagination/export/table row counts for master-detail cards, grids, dashboards, trees, or credential/security pages.
- **Credential path is not a leak**: `/credentials` in a URL path is not sensitive-data exposure. Require real secrets in query/body/DOM/storage/logs.
- **Deployment security headers**: CSP, `nosniff`, clickjacking headers, Referrer-Policy, COOP/CORP, HSTS/HTTPS, and `Server` fingerprint are deployment/gateway work unless the repo owns deploy config.
- **PC-first ADRs**: if an ADR declares PC-first with mobile as adaptive/degraded, small inline icon buttons can be downgraded to optional/mobile-breakpoint work unless they block core mobile use.
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

Before listing fixes, group raw browser issues by implementation root cause. For example, if `useXxx()` captures `error` but the page never renders it, group api-500/api-401/api-403/api-404/timeout no-feedback findings under one frontend fix and list the raw issue IDs / exception IDs as supporting evidence. Keep scenario-specific severity in evidence, but present one actionable fix unless separate source paths prove separate causes.

When the source reveals the same unhandled-state pattern may exist on adjacent pages that share a composable, report it as "adjacent risk / optional sweep" unless the current route or user request covers those pages. This keeps page-specific findings compatible with future runs on different pages.

For false positives, include the raw issue id and the exact contradiction: source line, exception simulation id, scan phase, ADR, or deployment ownership.
