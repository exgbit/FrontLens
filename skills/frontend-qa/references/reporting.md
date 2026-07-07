# FrontLens Reporting Reference

Use this reference when preparing the final user-facing summary after a `frontend-qa` run. Keep `SKILL.md` concise; keep the detailed reporting checklist here.

## Contents

- [Reporting Back](#reporting-back)

## Reporting Back

Default to a concise, decision-oriented answer. The normal user-facing summary should lead with proof-ready fixes and QA sign-off, then bucket non-defects/coverage gaps. Do not enumerate every style/touch-target/optional-feature selector unless the user asks for exhaustive polish detail.

Summarize:

- professionalSummary headline/status and must-fix/non-defect counts;
- adjusted score, raw score, and issue counts;
- in FrontLens 1.45+, lead with adjusted score/proof-ready root causes and mention raw score only as scanner trend context;
- critical/high issues first;
- security score and any failed security checks;
- top frontend fixes;
- top backend/API fixes;
- API contract / GraphQL / WebSocket / SSE findings;
- machine-executable fix task count and important task IDs; regressionPlan status, blocked/needs-input counts, and top rerun commands;
- generated artifact paths and artifact integrity status; in FrontLens 1.35+ expect report.md/report.html to reflect the final artifactIntegrity snapshot, not an early pre-human-report snapshot; env-compare artifact path when dev/preview dual-run was used; role-matrix artifact path when multi-role runs were used; test-data lifecycle status when write/data-changing flows are in scope;
- professional-audit status and `professional-audit.md` path; if it is `failed`, report the blocker before trusting any must-fix list or business/sign-off claim;
- triage buckets: real frontend, backend/API, deployment/security config, product decision, false positive/tool limitation; include pageProfile/scopeReview questions when product scope is inferred rather than configured;
- claimGuard status, forbidden claims, and required inputs; avoid forbidden wording in the final answer;
- qaIntake status, top questions, and missing inputs; ask these before turning product/design assumptions into defects;
- defectProof status and needs-evidence root causes; confirm they are excluded from must-fix/fixTasks and list evidence-collection next steps;
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
- skipped interaction/coverage caveats when IT-* or journeys are mostly skipped;
- for each retained critical/high issue: issue id, severity, category, evidence reference, reproduction step summary, and suggested owner/fix.

Do not paste the whole Markdown report unless the user asks; provide the path, key findings, and explicit false-positive/downgrade decisions. If a claim depends on missing PRD, product scope, role, test data, artifact, or source/runtime binding, phrase it as "needs evidence / scope decision" instead of a bug.
