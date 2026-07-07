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
   ```

   Add `--source-root`, `--source-run-scripts --source-scripts "typecheck,lint"`, reviewed `--requirements`, storage state, or config files only when the task scope requires them. Read `references/commands.md` for exact command variants and JSON snippets for `requirements`, `productContext`, and `testData`.
5. If browser binaries are missing, run `npx playwright install chromium`; if the sandbox blocks Chromium on macOS, rerun the same QA command with escalated execution.
6. If source-aware analysis is enabled, verify the target page is reachable from the intended deployment URL first. If not, follow `references/source-code-correlation.md` to build/start the local app, then rerun the reachability check before QA.
7. Read outputs in this order: `qa-review.md` / `professionalSummary`, then `claimGuard`, `qaIntake`, `defectProof`, `issueDisposition`, `scopeReview`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `environment`, `artifactIntegrity`, and only then raw `evidence-report.md` details.
8. Apply the professional QA actionability gate from `references/triage-guidelines.md`: retain only proof-ready, user-impacting, reproducible defects with owner/fix surface; move style/product choices, deployment security config, dev-server artifacts, skipped checks, and single-signal guesses to non-defect or needs-evidence buckets.
9. For source-aware triage, use `rootCauseGroups[].sourceLocations`, medium/high `sourceRuntimeCorrelation.links[]`, and source findings (`ui-accessibility`, `error-state-gap`, route/static-import performance) before manual grep. Do not schedule frontend fixes whose `defectProof` remains `needs-evidence`.
10. For API/UI data mismatch, require exact network request, visible DOM/screenshot state, source API/state/render file:line or medium/high link, and a product requirement that the UI should render that data. Otherwise keep it conditional/insufficient-evidence.
11. For production-readiness claims on local/dev targets, run build/preview or `env-compare`; dev-source mode is valid for functional/source correlation but not production bundle/security conclusions.
12. Return a concise summary with report paths, selected modules, QA sign-off, adjusted vs raw score, proof-ready root-cause count, non-defect buckets, skipped coverage caveats, source-correlation status, top fixes, and required follow-ups. Read `references/reporting.md` for the full reporting checklist.

## Safety Rules

- Keep default non-destructive behavior.
- Do not enable create/edit/delete/upload/submit actions unless the user explicitly requests destructive testing.
- Do not click download/export unless the user explicitly allows it or sets `safety.allowDownload=true`. When allowed, require a saved `downloadPath`, non-zero size, hash, content summary (`downloadContent`), and passing `artifactIntegrity` before calling export/download runtime-verified.
- Keep `safety.blockMutatingRequests=true` for production or unknown URLs. If a report shows safety-blocked writes, treat them as evidence of potential side effects, not backend failures.
- Treat successful `POST`, `PUT`, `PATCH`, or `DELETE` requests during page load as suspicious unless known to be analytics/heartbeat.
- Keep `security.mode=passive` by default. Enable `security.mode=active` and `security.activeProbing=true` only for explicitly authorized security regression tests.
- Every issue must have evidence: screenshot, DOM selector, network request id, console id, `evidence.details`, phase error, or artifact path.

## Command Reference

Use the default QA command from the workflow for normal runs. Read `references/commands.md` when exact syntax is needed for auth save, journey record/replay, requirements synthesize, env-compare, matrix, role-matrix, CI gates, security/coverage toggles, result-inspection commands, plugin examples, or MCP startup.

## Output Contract for Other Skills

Read `references/result-schema.md` before consuming `result.json`, filtering issues, or driving code/backend fixes. Prioritize `professionalSummary`, `claimGuard`, `qaIntake`, `defectProof`, `qaSignoff`, `issueDisposition`, `rootCauseGroups`, `regressionPlan`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `environment`, and `artifactIntegrity` over raw issue count. Read `references/ci-mcp.md` for GitHub Action, CI, or MCP integration and `references/commands.md` for stable result-consumption commands.

## Reporting Back

Return the path, key findings, explicit false-positive/downgrade decisions, and next verification steps; do not paste the whole Markdown report unless the user asks. Default to an executive QA answer: proof-ready fixes first, bucket/count product or style observations instead of listing selector-level polish, and keep unsupported API/UI or business claims conditional. Use `references/reporting.md` for the complete summary checklist.
