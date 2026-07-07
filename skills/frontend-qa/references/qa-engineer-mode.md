# QA engineer mode

Use this reference when the user asks FrontLens/frontend-qa to replace or emulate a professional test engineer, perform full QA/sign-off, validate business functionality, or review whether the testing skill itself is sufficient.

## Operating principle

FrontLens is the evidence engine; the skill is the QA engineer. Do not present raw scanner output as the answer. Produce a risk-based test review that separates proven defects, unverified coverage, product decisions, and tooling limitations.

A professional-test-engineer answer must include:

1. **Scope and assumptions**: target URL, route/page, sourceRoot, environment, auth role, selected modules, allowed/destructive actions, known missing inputs.
2. **Requirement coverage matrix**: business requirement / evidence / confidence / result / gaps. If no PRD or acceptance criteria was provided, infer only obvious page capabilities and mark them `inferred`, not `confirmed requirement`.
3. **Execution evidence**: report-relative screenshot/DOM/network/console/download/source file references that exist; treat `artifactIntegrity.status === failed` as a report-quality defect.
4. **Defect triage**: core defects by root cause, severity, owner, reproduction, and fix surface. Do not list every raw issue as a separate bug.
5. **Non-defect observations**: product decisions, style/design suggestions, skipped checks, environment/deployment tasks.
6. **Regression pack**: exact FrontLens rerun command, any journey config needed, and focused verification steps after fixes.
7. **Sign-off status**: one of `pass`, `pass-with-risks`, `blocked`, or `fail`, with confidence (`high`, `medium`, `low`) and explicit blockers.

Use `result.json.qualityGate` plus `result.json.requirementCoverage` and `result.json.artifactIntegrity` as the first machine-readable gate, then adjust them with requirement/source context. For example, a raw `pass` can only become business `pass` when requirements, role, test data, and relevant journeys are actually verified; otherwise report `pass-with-risks` or `blocked` for acceptance.

## Inputs a human QA would ask for

If missing, continue with best effort but mark coverage gaps:

- PRD / user stories / acceptance criteria. If available, encode them as `--requirements requirements.json` so FrontLens can produce machine-readable `requirementCoverage`.
- Login state and role matrix, including admin/normal/readonly/unauthorized when relevant.
- Test data requirements and whether create/edit/delete/download/upload are allowed.
- API contract/OpenAPI or backend envelope conventions.
- Supported browsers/devices and performance budgets.
- Release context: smoke check, regression, production readiness, PR review, or bug verification.

## Test-design checklist

Use these categories to design/triage, but only retain findings with evidence:

- **Navigation and route health**: direct URL load, refresh, login redirects, empty/error/loading states.
- **Core business flows**: search/filter/sort/pagination/detail/modal/export/import/create/edit/delete only when present and safe/authorized.
- **Data correctness**: bind one exact API response to one exact UI region; verify totals, rows/cards, field formatting, permissions, and stale refresh behavior.
- **Negative/resilience**: 401/403/404/500/timeout/offline, but classify synthetic probes separately from real backend behavior.
- **Forms**: validation, required fields, boundary values, duplicate submit, success/failure feedback.
- **Permissions**: visible/disabled dangerous actions, unauthorized API status, role-specific visibility.
- **Accessibility**: accessible names, labels, keyboard/focus, contrast. Treat hard a11y evidence as real defects; treat touch-size tradeoffs as product/device scope unless mobile is in scope.
- **Performance**: use production build/preview for bundle/security conclusions; use dev server only for function/source correlation.
- **Security passive checks**: separate frontend code issues from deployment headers/TLS/gateway work.
- **Regression stability**: compare against previous result fingerprints and flag added/resolved/persistent issues.

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

## Anti-overclaim rules

- No `100% business validation` without PRD + runtime evidence for all listed requirements.
- No “API has data but UI empty” unless the exact list response is bound to the exact UI by DOM/source/E2E evidence.
- No style/design bug unless it violates an explicit design/ADR/accessibility requirement or blocks a task.
- No production performance/security conclusion from Vite dev server artifacts.
- No backend contract failure from FrontLens exception mocks.
- No missing export/refresh/pagination defect unless the requirement or page type demands it.
- No release sign-off solely from `summary.score`; use `qualityGate`, `requirementCoverage`, requirement/source context, and evidence.

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

## Core defects by root cause
| Priority | Root cause | Evidence | Owner | Fix | Verify |
| --- | --- | --- | --- | --- | --- |

## Non-defect observations
| Type | Item | Decision |
| --- | --- | --- |

## Raw findings disposition
| Bucket | Count | Notes |
| --- | --- | --- |

## Regression commands
```bash
node dist/cli.js qa ...
```
```
