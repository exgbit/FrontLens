---
name: frontend-qa
description: Run FrontLens Playwright QA for live webpage testing/auditing with evidence-backed Markdown/JSON reports covering UI/interaction, journeys, assertion suggestions, Console, Network/API, contract drift, realtime, data mismatch, performance/P2, accessibility, passive security, root-cause grouping, finding disposition, scope review, QA coverage/test cases, release risk register/acceptance, productContext, claim guard, QA intake, defect proof, professional summary, regression plan, artifact integrity, source-code correlation, local build/serve, and fix suggestions. Use when the user asks to QA, test, audit, inspect, debug, security-check, compare runs, or generate frontend/UI/API/a11y/performance/security findings for a URL, or when another skill needs FrontLens result.json professional QA artifacts to drive fixes. Do not use for generic URL summarization.
---

# Frontend QA

Use FrontLens to analyze a target webpage end-to-end and return primary artifacts:

- `brief.md`: one-page professional QA brief; default shape for final user/LLM answer.
- `report.md`: primary human QA report; default `executive` profile is the shortest decision brief, and `report.profile` / `--report-profile` controls executive, professional, or full depth.
- `professional-audit.md`: report-contract self-audit; flags coverage-boundary violations, overclaims, non-proof-ready fix queue entries, weak-evidence actionable findings, speculative API/UI mismatches, product/style items promoted without scope, weak source evidence, scope gaps, and artifact integrity issues before another Agent trusts the report.
- `report-content-audit.md`: generated-report content self-audit; catches forbidden overclaim wording, raw-evidence leakage or excessive detail in concise profiles, missing raw-score caveats, hidden coverage gaps, and missing artifact warnings before echoing a report conclusion.
- `journey-assertion-audit.md`: business-journey assertion quality audit; separates path-only click/fill replay from runtime-verified journeys with meaningful `expect*` assertions.
- `assertion-suggestions.md`: concrete `expectVisible` / `expectText` / `expectUrl` / `expectRequest` draft steps for weak or path-only journeys; use it to convert replay scaffolds into runtime-verifiable business tests.
- `qa-plan.md`: professional QA execution/acceptance plan; converts findings, scope gaps, journeys, product context, and rerun commands into a tester worklist.
- `qa-coverage.md`: professional coverage matrix; marks runtime/API/source/a11y/responsive/performance/security/journey/requirements as covered, partial, skipped, needs-input, or failed.
- `test-cases.md`: professional test case execution matrix; lists generated requirement/journey/interaction/exception/a11y/responsive/performance/security/source/test-data cases with status, expected/actual, evidence, and next steps.
- `risk-register.md`: release risk register; converts proof-ready defects, coverage gaps, environment/source/test-data/artifact issues, and sign-off blockers into an impact × likelihood matrix with release-blocking status.
- `risk-acceptance.md`: decision checklist for release risks; separates must-mitigate items from risks that need explicit Product/QA/Release acceptance, so accepted risk is not confused with a fixed defect.
- `qa-review.md`: concise professional-QA review focused on sign-off, root causes, non-defect buckets, and next actions.
- `evidence-report.md`: full raw evidence appendix with issue details, screenshots/DOM/network references, and module sections for drill-down.
- `scope-review.md`: product/PRD/ADR/device/a11y confirmation checklist plus a suggested `productContext` config snippet.
- `product-context.md` / `product-context.config.json`: reviewable suggested `productContext` config and scope questions; edit/approve the config only after Product/QA confirms it, then rerun to reduce style/product false positives.
- `claim-guard.md`: explicit allowed/forbidden wording for business validation, release, production performance/security, API/UI binding, download/export, and source-health claims.
- `qa-intake.md`: professional tester follow-up questions for missing PRD/product scope, roles, test data, source/runtime binding, environment, artifacts, and regression inputs; use it to ask instead of guessing.
- `defect-proof.md`: proof-strength table for each root cause; FrontLens uses it to keep needs-evidence observations out of fixTasks, must-fix/should-fix, adjustedScore, and professional CI gates until confirmed.
- `result.json`: machine-readable contract for other skills to consume and act on.

## Mandatory module selection and subagent isolation

For every target-page QA run:

1. Ask the user to choose analysis modules before running FrontLens, unless the user already provided a module set or explicitly said "全选 / all / default".
2. Do not run target-page QA in the main session. Spawn a fresh worker subagent with `fork_context=false` and let it run the CLI, read `brief.md`, `professional-audit.md`, `report-content-audit.md`, `journey-assertion-audit.md`, `assertion-suggestions.md`, `qa-plan.md`, `qa-coverage.md`, `test-cases.md`, `risk-register.md`, `risk-acceptance.md`, `product-context.md`, `product-context.config.json`, `qa-review.md`, and `result.json.professionalSummary` / `result.json.riskRegister` / `result.json.riskAcceptance` first, then `report.md` as needed, and return a concise Markdown summary plus artifact paths. The main session should only coordinate module selection and return the subagent summary to avoid context pollution.
3. Keep the "core safe scan" mandatory: page load, screenshot/DOM snapshot, page model, Console, Network collection, non-destructive interaction discovery, JSON/Markdown report, issueDisposition, rootCauseGroups, defectProof, proof-aware fixTasks, and safety blocking. Destructive actions remain disabled unless explicitly authorized.
4. Read `references/module-options.md` when preparing the module checklist or translating selected modules into CLI flags/config.
5. After the run, read `references/triage-guidelines.md` and calibrate raw findings before reporting. Do not treat raw score or raw issue count as the final truth when findings are synthetic, skipped, deployment-only, or page-type mismatches.
6. When the user provides a frontend source path, or when a known source mapping exists, source-aware triage is mandatory. Read `references/source-code-correlation.md`, pass the `sourceRoot` to the worker as `--source-root`, inspect `result.json.sourceAnalysis`, `result.json.sourceRuntimeCorrelation`, `result.json.sourceHealth`, `result.json.defectProof`, and `result.json.pageProfile`, and require file:line plus runtime/source-health evidence for every retained frontend defect. Also inspect `result.json.scopeReview`, `result.json.claimGuard`, and `result.json.qaIntake` when product scope is inferred, claims could overreach, or missing inputs should be asked instead of guessed; do not promote style/product assumptions or defectProof.needs-evidence items to must-fix while scope/proof questions remain unanswered, and do not use claimGuard forbidden wording. For professional sign-off, enable controlled source script checks (`--source-run-scripts`, default scripts `typecheck,lint`) when dependencies exist and the user allowed a full local QA run. In schema 1.63+, if `sourceHealth.packageScripts` detects project build/typecheck/test/e2e/lint scripts that were not executed, treat generated `qaPlan` / `regressionPlan` `source-health` items as sign-off gaps until those scripts pass or are explicitly accepted out of scope.
7. When the target URL is local/private and the source path is available, the worker may build/start/refresh the local dev or preview server before running QA if the page is unreachable, stale, or the user asks to deploy first. Keep the server non-destructive and do not modify business code.
8. When the user asks for professional-QA replacement, full acceptance, release sign-off, business validation, or skill quality review, read `references/qa-engineer-mode.md` and require a QA sign-off, requirement coverage matrix, defect root-cause table, non-defect observations, `result.json.professionalSummary`, `result.json.reportContentAudit`, `result.json.journeyAssertionAudit`, `result.json.assertionSuggestions`, `result.json.qaPlan`, `result.json.qaCoverage`, `result.json.testCases`, `result.json.riskRegister`, `result.json.riskAcceptance`, `result.json.claimGuard`, `result.json.qaIntake`, `result.json.defectProof`, and `result.json.regressionPlan` regression commands/items. Never claim full business pass without requirements and runtime evidence.
9. When PRD/acceptance criteria are provided as Markdown or natural language, first run `frontlens requirements synthesize` to create a reviewable draft, read the generated Markdown questions, then pass the reviewed JSON as `--requirements`. If the user already provided structured JSON, use it directly. Encode explicit `selectors`, `expectedTexts`, `apiPatterns`, and/or safe `journeySteps` whenever possible. FrontLens turns those fields into generated requirement journeys and links runtime evidence back to `requirementCoverage`; free-text requirements without explicit assertions remain coverage gaps, not inferred passes.
10. When product scope, ADRs, supported devices, or “this is designed this way” feedback is available, encode it in `productContext` before rerunning or triaging. Use `deviceScope`, `requiredFeatures`, `optionalFeatures`, `outOfScopeFeatures`, `decisions[]`, and `adrRefs[]` so style, export, pagination, refresh, and touch-target findings are classified by product scope rather than guesswork. If scope is missing, read `product-context.md` or run `frontlens product-context --report <result.json>` to get a reviewable snippet/questions; if the QA run wrote `product-context.config.json`, edit/approve that file and pass it with `--config` for the rerun. Do not treat the suggestion as confirmed until Product/QA accepts it.
11. When multiple login roles/storage states are provided, or when the page has permission-sensitive actions, run `frontlens role-matrix` after the baseline QA; in schema 1.62+ also honor `qaPlan` / `regressionPlan` `role-matrix` follow-ups that FrontLens creates from credential/security page profiles, dangerous action labels, permission warnings, or explicit role/auth requirements. Treat role differences as permission-review evidence; only call them defects when they violate explicit requirements, expected allowed/forbidden text contracts, or source/runtime permission guards.
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

   Add `--source-root`, `--source-run-scripts --source-scripts "typecheck,lint"`, reviewed `--requirements`, storage state, or config files only when the task scope requires them. If the generated plan asks for unexecuted build/test/e2e scripts, either rerun with an expanded `--source-scripts` list or attach CI evidence before release-style sign-off. Read `references/commands.md` for exact command variants and JSON snippets for `requirements`, `productContext`, and `testData`.
5. If browser binaries are missing, run `npx playwright install chromium`; if the sandbox blocks Chromium on macOS, rerun the same QA command with escalated execution.
6. If source-aware analysis is enabled, verify the target page is reachable from the intended deployment URL first. If not, follow `references/source-code-correlation.md` to build/start the local app, then rerun the reachability check before QA.
7. Read outputs in this order: `brief.md` or `frontlens brief --report <result.json>` (fallback: `qa-review.md` / `professionalSummary`), then `professional-audit.md` or `frontlens audit --report <result.json>` for report-contract/coverage-boundary/disposition-quality self-check, then `report-content-audit.md` / `result.json.reportContentAudit` for generated Markdown wording/depth checks, then `journey-assertion-audit.md` / `result.json.journeyAssertionAudit` for business-flow assertion quality, then `assertion-suggestions.md` / `frontlens assertion-suggestions --report <result.json>` for concrete expect* steps that upgrade weak/path-only journeys, then `qa-plan.md` / `frontlens qa-plan --report <result.json>` for the tester execution worklist, then `qa-coverage.md` / `frontlens qa-coverage --report <result.json>` for covered/skipped/needs-input scope, then `test-cases.md` / `frontlens test-cases --report <result.json>` for formal test cases and expected/actual status, then `risk-register.md` / `result.json.riskRegister` for release-blocking risk exposure, then `risk-acceptance.md` / `result.json.riskAcceptance` for must-mitigate versus accepted-risk decisions, then `product-context.md` / `product-context.config.json` / `frontlens product-context --report <result.json>` for scope suggestions and rerun config, then inspect `claimGuard`, `qaIntake`, `defectProof`, `issueDisposition`, `scopeReview`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `environment`, `artifactIntegrity`, and only then raw `evidence-report.md` details.
8. Apply the professional QA actionability gate from `references/triage-guidelines.md`: retain only proof-ready, user-impacting, reproducible defects with owner/fix surface; move style/product choices, deployment security config, dev-server artifacts, skipped checks, and single-signal guesses to non-defect or needs-evidence buckets.
9. For source-aware triage, use `rootCauseGroups[].sourceLocations`, medium/high `sourceRuntimeCorrelation.links[]`, and source findings (`ui-accessibility`, `error-state-gap`, route/static-import performance) before manual grep. Do not schedule frontend fixes whose `defectProof` remains `needs-evidence`.
10. For API/UI data mismatch, require the four-part data-binding proof gate before calling it a defect: explicit product/PRD requirement, exact list-like Network response (`networkRequestId` + response path/count), visible empty UI/DOM/screenshot state for the target table/list/card region, and source API/state/render binding via file:line or medium/high `sourceRuntimeCorrelation`. Otherwise keep it conditional/insufficient-evidence and assign evidence collection to QA/test, not implementation.
11. For business journey validation, require meaningful assertions. Treat click/fill-only replay, generic body/html/#app visibility, or generic `expectText body OK/Done` checks as weak/path-only evidence; use `assertionSuggestions` to add business-specific text/selector/URL/API assertions and rerun.
12. For production-readiness claims on local/dev targets, run build/preview or `env-compare`; dev-source mode is valid for functional/source correlation but not production bundle/security conclusions.
13. Return a concise summary with report paths, selected modules, report profile, QA sign-off, assertion-suggestion status, test-case status, risk-register/risk-acceptance status, release-blocking/must-mitigate count, adjusted vs raw score, proof-ready root-cause count, non-defect buckets, skipped coverage caveats, source-correlation status, top fixes, and required follow-ups. For before/after runs, lead with `frontlens diff` Professional QA Diff rather than raw issue deltas. Prefer the deterministic `brief` output as the shape, then add only user-requested detail. Read `references/reporting.md` for the full reporting checklist.

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

Read `references/result-schema.md` before consuming `result.json`, filtering issues, or driving code/backend fixes. Prioritize `professional-audit.md` / `professionalAudit`, `report-content-audit.md` / `reportContentAudit`, `journey-assertion-audit.md` / `journeyAssertionAudit`, `assertion-suggestions.md` / `assertionSuggestions`, `qa-plan.md` / `qaPlan`, `qa-coverage.md` / `qaCoverage`, `test-cases.md` / `testCases`, `risk-register.md` / `riskRegister`, `risk-acceptance.md` / `riskAcceptance`, `product-context.md` / `productContext` / `product-context.config.json`, `professionalSummary`, `claimGuard`, `qaIntake`, `defectProof`, `qaSignoff`, `issueDisposition`, `rootCauseGroups`, `regressionPlan`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `environment`, and `artifactIntegrity` over raw issue count. Read `references/ci-mcp.md` for GitHub Action, CI, or MCP integration and `references/commands.md` for stable result-consumption commands.

## Reporting Back

Return the path, key findings, assertion-suggestion status, test-case status, risk-register and risk-acceptance status, release-blocking/must-mitigate items, explicit false-positive/downgrade decisions, and next verification steps; do not paste the whole Markdown report unless the user asks. Default to an executive QA answer: proof-ready fixes first, bucket/count product or style observations instead of listing selector-level polish, and keep unsupported API/UI or business claims conditional. Use `references/reporting.md` for the complete summary checklist.
