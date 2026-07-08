# FrontLens Reporting Reference

Use this reference when preparing the final user-facing summary after a `frontend-qa` run. Keep `SKILL.md` concise; keep the detailed reporting checklist here.

## Contents

- [Reporting Back](#reporting-back)

## Reporting Back

Default to a concise, decision-oriented answer. In FrontLens 1.73+, treat `brief.md` as the maximum default shape. In FrontLens 1.74+, include `qa-intake.config.json` in next steps when missing inputs block professional sign-off. In FrontLens 1.75+, treat `frontlens suggestions` as proof-aware implementation guidance and use `--all` only for raw audit. In FrontLens 1.76+, prefer the helper commands `claim-guard`, `defect-proof`, `report-content-audit`, and `journey-assertion-audit` when another Agent needs guardrail fields without parsing full Markdown. In FrontLens 1.78+, use `defect-tickets.md/json` or `frontlens defect-tickets` as the bug-filing queue because it excludes needs-evidence/product/deployment/tool observations. In FrontLens 1.79+, use `traceability.md/json` or `frontlens traceability` to verify PRD → test case → runtime evidence → defect ticket linkage before business-validation claims. In FrontLens 1.80+, use `automation-specs.md/json`, `automation/frontlens.spec.ts`, or `frontlens automation-specs` as a review-only Playwright regression draft package; do not treat generated drafts as passed evidence until reviewed and executed. Respect `report.profile`: executive is the default shortest decision brief, professional is a fuller QA-lead decision report, and full is for exhaustive audits only. The normal user-facing summary should lead with proof-ready fixes and QA sign-off, then bucket non-defects/coverage gaps. Do not enumerate every style/touch-target/optional-feature selector unless the user asks for exhaustive polish detail.

Do not report “API has data but UI is empty” as an implementation defect unless the four-part data-binding proof gate passes: explicit requirement, exact list-like Network response, visible empty UI/DOM/screenshot for the target region, and source API/state/render binding. Missing any part is a QA evidence gap or scope question. For schema 1.75+ results, raw data-mismatch should already require explicit provided requirement + medium/high source-runtime binding; if reviewing older reports, apply that stricter gate manually.

Summarize:

- professionalSummary headline/status and must-fix/non-defect counts;
- qaIntake status, top questions, `qa-intake.md` path, and `qa-intake.config.json` rerun pack when PRD/product/source/test-data inputs are missing;
- assertionSuggestions status, concrete suggestion count, weak/path-only journey count, `assertion-suggestions.md` path, and how to upgrade journeys with expect* steps;
- testCases status, total/passed/failed/blocked/needs-input counts, `test-cases.md` path, and whether failures are runtime defects or manual-required coverage gaps;
- riskRegister status, release-blocking count, top high/critical risks, `risk-register.md` path, riskAcceptance status, must-mitigate/needs-acceptance counts, and `risk-acceptance.md` path; if blocked/at-risk, report it before raw issue totals;
- defectTickets status/count, `defect-tickets.md` path, and whether any needs-evidence root causes were intentionally suppressed from bug filing;
- traceability status, `traceability.md` path, high-priority requirement gaps, and orphan proof-ready defects not mapped to requirements;
- automationSpecs status, ready/needs-input/blocked draft counts, `automation-specs.md` and `automation/frontlens.spec.ts` paths, and whether the drafts require QA review before execution;
- adjusted score, raw score, and issue counts;
- in FrontLens 1.45+, lead with adjusted score/proof-ready root causes and mention raw score only as scanner trend context;
- critical/high issues first;
- security score and any failed security checks;
- top frontend fixes;
- top backend/API fixes;
- API contract / GraphQL / WebSocket / SSE findings;
- machine-executable fix task count and important task IDs; regressionPlan status, blocked/needs-input counts, riskRegister status/release-blocking count, riskAcceptance status/must-mitigate count, and top rerun commands;
- generated artifact paths and artifact integrity status; in FrontLens 1.35+ expect report.md/report.html to reflect the final artifactIntegrity snapshot, not an early pre-human-report snapshot; env-compare artifact path when dev/preview dual-run was used; role-matrix artifact path when multi-role runs were used; test-data lifecycle status when write/data-changing flows are in scope;
- professional-audit status and `professional-audit.md` path; if it is `failed`, report the blocker before trusting any must-fix list or business/sign-off claim;
- report-content-audit status and `report-content-audit.md` path; if it is `failed`, do not echo the generated conclusion until forbidden wording/raw-evidence leakage/profile-depth issues are fixed or explicitly scoped; if it is `warning` because the selected profile is too long/table-heavy, summarize from `brief.md`/`qa-review.md` and send selector-level detail to `evidence-report.md`;
- journey-assertion-audit status and `journey-assertion-audit.md` path; distinguish runtime-verified, weakly asserted, and path-only journeys before discussing business validation;
- triage buckets: real frontend, backend/API, deployment/security config, product decision, false positive/tool limitation; include pageProfile/scopeReview questions when product scope is inferred rather than configured;
- claimGuard status, forbidden claims, and required inputs; avoid forbidden wording in the final answer;
- qaIntake status, top questions, and missing inputs; ask these before turning product/design assumptions into defects;
- defectProof status and needs-evidence root causes; confirm they are excluded from must-fix/fixTasks and list evidence-collection next steps;
- defectTickets status and `defect-tickets.md` path; use tickets for Jira/Linear filing and keep raw issues as evidence appendix only;
- traceability status and `traceability.md` path; use it to state whether business coverage is requirement-backed or still conditional;
- automation specs status and paths; present them as tester-reviewed regression starters, not proof that tests passed;
- adjustedScore plus raw score and confidence/adjusted-risk note when raw score is distorted by skipped/synthetic/deployment-only findings;
- raw issue count separated from implementation root-cause count;
- requirement coverage / business-validation confidence when the user asks for acceptance or professional QA;
- QA sign-off status (`pass`, `pass-with-risks`, `blocked`, or `fail`) when using professional QA mode;
- scopeReview status/questions and `scope-review.md` path; if `needs-input`, state which findings remain product/PRD-dependent instead of must-fix;
- product-context suggestion paths (`product-context.md` and, in schema 1.53+, `product-context.config.json`) when product/style/device scope is inferred; say the config must be reviewed/confirmed before being used as a triage contract or rerun input;
- claimGuard status and `claim-guard.md` path; if `limited` or `blocked`, state which broad conclusions are forbidden;
- qaIntake status and `qa-intake.md` path; if `needs-input` or `blocked`, list topQuestions and keep linked conclusions conditional;
- defectProof status and `defect-proof.md` path; if root causes are `needs-evidence`, list missing evidence and next steps and do not count them as implementation fixes;
- regression plan status/items from `result.json.regressionPlan` for repair verification;
- for before/after comparisons, summarize `diff.professional.interpretation`, adjustedScore delta, qaSignoff transition, business-validation transition, and added/resolved proof-ready fixes before raw issue deltas;
- QA execution plan status/items from `result.json.qaPlan` and `qa-plan.md` so follow-up work is a tester worklist, not a raw issue dump;
- if `qaPlan.items[]` or `regressionPlan.items[]` contains `type=role-matrix`, report it as a permission sign-off input gap until role storage states and expected allowed/forbidden contracts are provided;
- if `qaPlan.items[]` or `regressionPlan.items[]` contains `type=source-health` for detected-but-unexecuted package scripts, report it as a source/CI sign-off gap until build/typecheck/test/e2e/lint evidence is attached or explicitly scoped out;
- QA coverage matrix status/items from `result.json.qaCoverage` and `qa-coverage.md`; skipped and needs-input rows must be phrased as coverage gaps, not passes;
- formal test case matrix from `result.json.testCases` and `test-cases.md`; use it to say which cases actually passed/failed/blocked/need input, and do not turn manual-required rows into code bugs unless `defectProof` and source/runtime evidence support it;
- release-risk matrix from `result.json.riskRegister` and `risk-register.md`; separate implementation defects, coverage gaps, environment/source/test-data/artifact risks, and accepted product risks.
- risk-acceptance checklist from `result.json.riskAcceptance` and `risk-acceptance.md`; blocked must-mitigate items are not releasable, while needs-acceptance items require named Product/QA/Release approval and evidence before they can be treated as accepted risk.
- generated-report content audit from `result.json.reportContentAudit` and `report-content-audit.md`; blockers mean the report text itself overclaims or violates the selected depth profile; compactness warnings mean the report should be summarized rather than copied into the final answer;
- journey assertion audit from `result.json.journeyAssertionAudit` and `journey-assertion-audit.md`; path-only click/fill journeys are coverage gaps, not business passes;
- assertion suggestions from `result.json.assertionSuggestions`, `assertion-suggestions.md`, and `qa-intake.config.json._frontlensQaIntake.draftAssertionSteps[]`; suggestions are draft test improvements, not passed evidence until copied into journey/requirements config and rerun;
- automation specs from `result.json.automationSpecs`, `automation-specs.md`, and `automation/frontlens.spec.ts`; generated specs need selector/test-data/auth review and an actual run before they become regression evidence;
- skipped interaction/coverage caveats when IT-* or journeys are mostly skipped;
- for each retained critical/high issue: issue id, severity, category, evidence reference, reproduction step summary, and suggested owner/fix.

Do not paste the whole Markdown report unless the user asks; provide the path, key findings, and explicit false-positive/downgrade decisions. If a claim depends on missing PRD, product scope, role, test data, artifact, or source/runtime binding, phrase it as "needs evidence / scope decision" instead of a bug.
