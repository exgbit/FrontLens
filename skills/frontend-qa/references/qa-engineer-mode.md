# QA engineer mode

Use this reference when the user asks FrontLens/frontend-qa to replace or emulate a professional test engineer, perform full QA/sign-off, validate business functionality, or review whether the testing skill itself is sufficient.

## Operating principle

FrontLens is the evidence engine; the skill is the QA engineer. Do not present raw scanner output as the answer. Produce a risk-based test review that separates proven defects, unverified coverage, product decisions, and tooling limitations.

Replacing a professional tester means reducing false positives and unsupported certainty, not maximizing issue volume. Treat style preferences, device-scope tradeoffs, optional features, and unbound API/UI guesses as scope questions or coverage gaps until PRD/productContext/runtime-source evidence proves otherwise. If PRD/acceptance criteria or product/page scope is missing, lead with intake-first wording (`QA intake needed`) and the blocking questions before listing implementation work.

A professional-test-engineer answer must include:

1. **Scope and assumptions**: target URL, route/page, sourceRoot, environment, pageProfile/scopeReview/product scope, claimGuard wording limits, qaIntake top questions, defectProof proof gaps, auth role, selected modules, allowed/destructive actions, known missing inputs.
2. **Requirement coverage matrix**: business requirement / evidence / confidence / result / gaps. If no PRD or acceptance criteria was provided, infer only obvious page capabilities and mark them `inferred`, not `confirmed requirement`.
3. **Execution evidence**: report-relative screenshot/DOM/network/console/download/source file references that exist; treat `artifactIntegrity.status === failed` as a report-quality defect.
4. **Defect triage**: core defects by root cause, raw-finding disposition, severity, owner, reproduction, fix surface, and merged raw issue IDs. Do not list every raw issue as a separate bug.
5. **Non-defect observations**: product decisions, style/design suggestions, skipped checks, environment/deployment tasks.
6. **Assertion improvement pack**: summarize `result.json.assertionSuggestions` / `assertion-suggestions.md` and the review-only `qa-intake.config.json._frontlensQaIntake.draftAssertionSteps[]`, especially concrete expect* suggestions for path-only or weak journeys. Make clear these are draft assertions to add and rerun, not passed evidence.
7. **Formal test case matrix**: summarize `result.json.testCases` / `test-cases.md`, especially runtime-verified passed cases, failed/blocked cases, manual-required/needs-input rows, and high-priority open cases. Treat it as the execution ledger: it can prove scoped checks passed, but it cannot by itself prove 100% business validation without PRD, runtime assertions, roles, and test data.
8. **Release risk register and acceptance**: summarize `result.json.riskRegister` / `risk-register.md` and `result.json.riskAcceptance` / `risk-acceptance.md`, especially release-blocking risks, must-mitigate items, acceptance-required items, required approvers, mitigation, and verification; do not confuse risk acceptance with defect closure.
9. **Execution / regression pack**: use `result.json.qaPlan` first as the professional tester worklist, then `result.json.regressionPlan` for detailed repair verification; include exact FrontLens rerun commands, blocked/needs-input items, journey/requirement/download/environment checks, and focused verification steps after fixes.
10. **Sign-off status**: one of `pass`, `pass-with-risks`, `blocked`, or `fail`, with confidence (`high`, `medium`, `low`) and explicit blockers.

Use `result.json.professionalSummary` as the first human-facing triage summary, `professional-audit.md/json` as the report-contract, disposition-quality, and coverage-boundary self-check, `report-content-audit.md/json` as the generated Markdown wording/depth self-check, `result.json.qaIntake` / `qa-intake.md` / `qa-intake.config.json` as the professional follow-up question and rerun-input pack, `journey-assertion-audit.md/json` as the business-flow assertion-quality self-check, `result.json.qaPlan` as the professional execution/acceptance worklist, `result.json.qaCoverage` as the coverage boundary, `result.json.testCases` as the formal test-case execution matrix, `result.json.riskRegister` as the release risk register, `result.json.riskAcceptance` as the risk-acceptance/must-mitigate gate, `result.json.claimGuard` as the anti-overclaim wording gate, `result.json.defectProof` as the root-cause proof-strength gate, and `result.json.qaSignoff` as the first machine-readable professional sign-off, then inspect `regressionPlan`, `qualityGate`, `requirementCoverage`, `environment`, `pageProfile`, `scopeReview`, `claimGuard`, `defectProof`, `riskRegister`, `riskAcceptance`, `reportContentAudit`, `journeyAssertionAudit`, `sourceAnalysis`, `sourceRuntimeCorrelation`, `sourceHealth`, `artifactIntegrity`, `issueDisposition`, and `rootCauseGroups` for the supporting evidence. For example, a raw `qualityGate.pass` can still be `qaSignoff.pass-with-risks` when requirements, role, test data, non-production environment, scope questions, or relevant journeys are missing.

## Inputs a human QA would ask for

If missing, continue with best effort but mark coverage gaps:

- PRD / user stories / acceptance criteria. If available, encode them as `--requirements requirements.json` so FrontLens can produce machine-readable `requirementCoverage`.
- If PRD/user stories are only Markdown or natural language, run `node dist/cli.js requirements synthesize --input <prd.md> --output <output>/requirements.json` first, review the generated `.md` questions, and keep `needsReview` or low-confidence items as coverage gaps rather than confirmed requirements.
- For each acceptance criterion, prefer explicit runtime assertions: `selectors`, `expectedTexts`, and safe `journeySteps`. These generate `journeyTests[].source = requirement-generated` and allow high-confidence coverage. Criteria that are only free text remain coverage gaps unless other runtime evidence proves them.
- If no executable business flow exists, record the real manual path with `node dist/cli.js journey record --url <url> --output <journey.json> --name <flow>` and then review the generated `.md`. Treat the raw recording as a scaffold; add success assertions and test data before sign-off.
- Product scope/ADR context. Inspect `pageProfile` and `scopeReview`; if scope is inferred or `scopeReview.status=needs-input`, answer its questions before promoting style/product findings. Encode supported devices, page type, required/optional/out-of-scope features, and ADR references as `productContext` so intentional design choices do not become defects.
- Login state and role matrix, including admin/normal/readonly/unauthorized when relevant; if `qaPlan` or `regressionPlan` contains a `role-matrix` item, treat permission sign-off as needs-input until role expectations and storage states are supplied.
- When multiple storage states are available, run `node dist/cli.js role-matrix --url <url> --roles roles.json --output <output>-roles` and include the generated `role-matrix.md` in the evidence set.
- Project-owned automated gates. If `sourceHealth.packageScripts` detects build/typecheck/test/e2e/lint scripts and `qaPlan` or `regressionPlan` contains a `source-health` item, treat source-health/release sign-off as needs-input until those scripts pass, fail with owned follow-up, or Product/QA explicitly accepts them out of scope for this run.
- Test data requirements and whether create/edit/delete/download/upload are allowed.
- Test data lifecycle: isolated records, fixture/seed source, setup steps, cleanup/rollback steps, environment, sensitive-data handling, and whether production writes are explicitly prohibited or approved.
- API contract/OpenAPI or backend envelope conventions.
- Supported browsers/devices and performance budgets.
- Release context: smoke check, regression, production readiness, PR review, or bug verification.

## Test-design checklist

Use these categories to design/triage, but only retain findings with evidence:

- **Navigation and route health**: direct URL load, refresh, login redirects, empty/error/loading states.
- **Source health**: package scripts, syntax parse errors, optional controlled `typecheck/lint` script checks, and build/typecheck/test/e2e/lint availability. Syntax errors and failed/timed-out typecheck/build/test/e2e checks are source-confirmed blockers; detected-but-unexecuted project scripts are sign-off gaps, not passes; passing source health is not business validation.
- **Core business flows**: search/filter/sort/pagination/detail/modal/export/import/create/edit/delete only when present and safe/authorized.
- **Recorded journeys**: convert human-executed business paths into reusable journey configs; require explicit assertions because click/fill replay alone only proves the path did not crash. Generic body/html/#app checks or `expectText body OK` are weak and cannot prove requirement-bound success.
- **Export/download evidence**: when export/download is in scope, require `safety.allowDownload=true`, `interactionTests[].observations.downloadPath` or `journeyTests[].steps[].downloadPath`, non-zero `downloadSizeBytes`, `downloadSha256`, `downloadContent` parse summary, and `artifactIntegrity` coverage before marking it runtime-verified.
- **Test data lifecycle**: for create/edit/delete/upload/import/submit flows, verify `testData.records`, setup, cleanup, and environment authorization before claiming runtime-verified business validation.
- **Data correctness**: bind one exact API response to one exact UI region; verify totals, rows/cards, field formatting, permissions, and stale refresh behavior. For API/UI empty-data claims, require the four-part gate: explicit requirement, exact list response, visible empty target region, and source API/state/render binding. In FrontLens 1.75+, raw data-mismatch creation already requires explicit provided requirement plus medium/high source-runtime binding; if either is missing, ask for QA intake/source binding instead of implementation work. Prefer `sourceRuntimeCorrelation.links[]` as the API↔source↔UI binding evidence when available.
- **Negative/resilience**: 401/403/404/500/timeout/offline, but classify synthetic probes separately from real backend behavior.
- **Forms**: validation, required fields, boundary values, duplicate submit, success/failure feedback.
- **Permissions**: visible/disabled dangerous actions, unauthorized API status, role-specific visibility.
- **Role matrix**: compare admin/normal/readonly/anonymous runs. Treat role-specific UI and issues as review evidence; promote only expected-forbidden visible text, missing expected-allowed text, or source/runtime-confirmed permission leaks to defects.
- **Accessibility**: accessible names, labels, keyboard/focus, contrast. Treat hard a11y evidence as real defects; treat touch-size tradeoffs as product/device scope unless mobile is in scope.
- **Page profile / scope review**: inspect `pageProfile.status/pageType` and `scopeReview.questions[]`; use them to frame product questions, not as confirmed PRD.
- **Environment**: inspect `environment.kind` and `environment.trust`; use dev server only for function/source correlation, local/private preview for pre-production checks, and production-like HTTPS for release security/performance sign-off.
- **Performance**: use production build/preview for bundle/security conclusions; use dev server only for function/source correlation.
- **Security passive checks**: separate frontend code issues from deployment headers/TLS/gateway work.
- **Assertion suggestions**: inspect `assertionSuggestions.status`, `summary.totalCount`, suggested `exampleStep` values, and `qa-intake.config.json._frontlensQaIntake.draftAssertionSteps[]`. Use them to update journeys/requirements and rerun; never count them as passed evidence before rerun.
- **Formal test cases**: inspect `testCases.status`, `summary.failedCount`, `summary.blockedCount`, `summary.needsInputCount`, `summary.runtimeVerifiedCount`, and high-priority open cases. Use failed/blocked cases to focus QA reproduction; use needs-input/manual-required cases as scope/test-data/requirement follow-ups, not automatic implementation defects.
- **Release risk register**: inspect `riskRegister.status`, `summary.releaseBlockingCount`, and high/critical items. Treat blocked release risks and `riskAcceptance.status=blocked` must-mitigate items as sign-off blockers even when raw issue count looks small. If `riskAcceptance.status=needs-acceptance`, list required Product/QA/Release approvers and do not present the risk as fixed.
- **Regression stability**: compare against previous reports with `frontlens diff`; use its Professional QA Diff (`adjustedScore`, `qaSignoff`, business-validation confidence, proof-ready fix workload) before raw added/resolved/persistent issues.

## Evidence thresholds

Use these labels consistently:

- `runtime-verified`: browser reached target state and evidence proves behavior.
- `runtime-partial`: runtime executed, but auth/data/download/destructive policy blocked full proof.
- `source-confirmed`: source code proves root cause; runtime evidence is supporting or unavailable.
- `static-source-only`: useful for syntax/import/config checks; not enough for business pass.
- `not-verified`: no runtime/source proof.

Do not claim a business function passed unless it is `runtime-verified` or explicitly `source-confirmed` for static-only concerns. If `requirementCoverage.source === 'inferred'`, treat it as page-capability coverage, not confirmed PRD coverage.

## Defect acceptance gate

A finding is a **bug** only if it meets all four:

1. User impact: blocks, misleads, loses data, exposes risk, violates explicit requirement, or breaks accessibility/security/performance budget.
2. Evidence: at least two aligned signals when possible (runtime + source, network + DOM, screenshot + selector, console + stack).
3. Reproducibility: clear steps or a deterministic source path.
4. Ownership: actionable fix surface exists (frontend, backend/API, deployment/security, or test data).

Otherwise classify as `product decision`, `coverage gap`, `reference observation`, or `tool limitation`.

## Output compression gate

Default final answers should fit in one decision screen unless the user asks for exhaustive evidence:

- List at most the top proof-ready P0/P1/P2 root causes first; merge duplicated raw findings by implementation cause.
- Summarize product/style/device-scope observations as bucket counts plus one representative example, not per-selector tasks.
- Never restate every raw issue when `issueDisposition`, `professionalSummary`, or `qa-review.md` already downgraded it.
- If `reportContentAudit` raises a profile-depth/compactness warning, use `brief.md` or `qa-review.md` as the answer shape and link to `evidence-report.md` for raw selector/network detail.
- If there are no proof-ready defects, say that explicitly and provide the missing inputs needed to turn conditional observations into defects. In FrontLens 1.72+, prefer the intake-first `professionalSummary.headline` when PRD/product scope is missing. In FrontLens 1.73+, treat `brief.md` as the maximum default answer shape; do not expand selector/module detail unless the user asks. In FrontLens 1.74+, prefer `qa-intake.config.json` as the editable answer sheet for missing PRD/product/test-data/source inputs before rerun. In FrontLens 1.75+, use proof-aware `suggestions` for implementation queues and `suggestions --all` only for auditing suppressed raw suggestions. In FrontLens 1.76+, use `claim-guard`, `defect-proof`, `report-content-audit`, and `journey-assertion-audit` helpers before writing final conclusions or fix queues.
- Expand raw evidence only for retained core defects or when the user explicitly requests deep drill-down.

## Anti-overclaim rules

- No `100% business validation` without PRD + runtime evidence for all listed requirements.
- No “业务功能验证通过可信度 100%” from generated requirement drafts alone; synthesized requirements are a checklist starter and must be reviewed/grounded in runtime evidence.
- No business pass solely from `sourceHealth.status=passed`; it only means parsed source files had no syntax errors and any explicitly enabled source script checks passed.
- No source-health/release sign-off while `qaPlan` or `regressionPlan` contains unresolved `source-health` follow-ups for detected-but-unexecuted build/typecheck/test/e2e/lint scripts.
- No “API has data but UI empty” unless the exact list response is required by PRD/product scope, bound to the exact UI by DOM/source/E2E evidence, and the target table/list/card is visibly empty; if `sourceRuntimeCorrelation.status=passed`, missing link or `confidence=none/low` means not a defect. For schema 1.75+ or newer, absence of a provided requirement or medium/high source-runtime binding means no raw implementation defect should be emitted.
- No style/design bug unless it violates an explicit design/ADR/accessibility requirement or blocks a task.
- No product-scope assumption becomes must-fix while `scopeReview.status=needs-input`; keep it as a scope question or product decision unless direct user impact is proven.
- No production performance/security conclusion from Vite dev server artifacts.
- No backend contract failure from FrontLens exception mocks.
- No missing export/refresh/pagination defect unless the requirement or page type demands it.
- No export/download pass unless the saved file artifact exists, is non-empty, and has a usable content summary; a network request alone is runtime-partial.
- No permission defect from role differences alone; require role requirements, expected allowed/forbidden contracts, or source/runtime confirmation.
- No destructive-flow business pass without isolated test data and cleanup/rollback evidence; production writes without explicit authorization are release blockers.
- No business pass from a recorded journey that only contains `click`/`fill`/`press`; add `expectVisible`/`expectText`/`expectUrl`/`expectRequest` or requirement evidence first. `assertionSuggestions` can propose candidates, but they are not evidence until executed.
- No release sign-off solely from `summary.score` or `testCases.status=passed`; use `riskRegister`, `riskAcceptance`, `claimGuard`, `qaSignoff`, `qualityGate`, `requirementCoverage`, requirement/source context, and evidence.
- No final answer may use a phrase listed in `claimGuard.forbiddenClaims[]` as a positive conclusion.
- No final answer may ignore `reportContentAudit.status=failed`; fix or explicitly scope the generated wording/depth problem before presenting it as a professional QA conclusion.
- No final answer may treat `journeyAssertionAudit` path-only or weakly-asserted journeys as business validation; only meaningful passed `expect*` assertions can support runtime-verified business claims.
- No product/design/style/API-data mismatch uncertainty should be promoted to a must-fix bug while `qaIntake.topQuestions[]` still blocks the linked claim.
- No root cause with `defectProof.status=needs-evidence` should be scheduled as must-fix or counted as a fixTask until missing runtime/source/requirement/product/repro/owner evidence is supplied or the item is downgraded. With sourceRoot enabled, weak/missing source binding for a frontend-owned root cause is a proof gap, not a must-fix.

## Output template

```md
## QA sign-off
- Status: pass | pass-with-risks | blocked | fail
- Confidence: high | medium | low
- Scope: ...
- Main blockers/gaps: ...

## Requirement coverage matrix
| Requirement / capability | Evidence | Confidence | Result | Gap/next step |
| --- | --- | --- | --- | --- |

## Assertion suggestions
- Status: ready | needs-input | skipped
- Concrete expect* suggestions / weak journeys: ...
| ID | Priority | Action | Target/value | Journey/requirement | Confidence | Example step |
| --- | --- | --- | --- | --- | --- | --- |

## Test case matrix
- Status: passed | failed | partial | blocked | skipped | needs-input
- Runtime-verified / manual-required / high-priority open: ...
| ID | Priority | Kind | Status | Expected | Actual | Evidence / next step |
| --- | --- | --- | --- | --- | --- | --- |

## Professional summary
- Headline: ...
- Claim guard: clear | limited | blocked; forbidden claims: ...
- Must-fix / should-fix / non-defect / coverage gaps: ...

## Release risk register
- Status: clear | monitor | at-risk | blocked
- Release-blocking risks: ...
- Top mitigations / verification: ...

## Risk acceptance / must-mitigate
- Status: not-needed | needs-acceptance | blocked
- Must-mitigate risks: ...
- Needs-acceptance risks and approvers: ...

## Core defects by root cause
| Priority | Root cause | Evidence | Owner | Raw issues | Fix | Verify |
| --- | --- | --- | --- | --- | --- | --- |

## Non-defect observations
| Type | Item | Decision |
| --- | --- | --- |

## Raw findings disposition
| Disposition / bucket | Count | Notes |
| --- | --- | --- |

## Regression plan
- Status: ready | partial | blocked
- QA execution plan: qaPlan.status, top requirements/journeys/product-context/environment/test-data/root-cause items
- QA coverage matrix: qaCoverage.status, skipped/needs-input/failed areas
- Assertion suggestions: assertionSuggestions.status, total suggestion count, weak journey count
- Test cases: testCases.status, failed/blocked/needs-input/manual-required counts
- Risk register: riskRegister.status, release-blocking count, top owner/mitigation
- Risk acceptance: riskAcceptance.status, must-mitigate count, needs-acceptance count
- Top commands:
```bash
node dist/cli.js qa ...
```
- Blocking / needs-input items: ...
```


## Dev vs preview comparison

When a run targets Vite/dev-source mode and the user needs production-readiness, run `env-compare` after starting a build/preview server. Treat persistent findings as higher confidence, preview-only findings as production-build/deployment candidates, and dev-only findings as likely dev artifacts unless source/runtime evidence confirms an implementation defect.
