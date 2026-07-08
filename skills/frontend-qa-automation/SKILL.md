---
name: frontend-qa-automation
description: "Create or review FrontLens/Playwright automation only when the user asks for journey recording, replayable business flows, regression scripts, Playwright specs, assertion suggestions, traceability-to-automation, or automated test generation. Do not use for ordinary manual-style SME QA."
---

# Frontend QA Automation

Use this specialty to turn known flows into reviewable automation, not to claim unexecuted drafts as passed evidence.

## Scope

- `frontlens journey record` / replay configs.
- Meaningful `expectVisible`, `expectText`, `expectUrl`, `expectRequest` assertions.
- Playwright draft specs, regression commands, and test-data lifecycle notes.
- Requirement-to-test traceability when requirements are provided.

## Workflow

1. Confirm the business flow, role/auth state, test data, and whether mutations are allowed.
2. Record or synthesize journey configs; redact secrets.
3. Add assertions; path-only click/fill scripts are not business proof.
4. Generate/review automation specs and return how to run them.

## Do not

- Do not enable create/edit/delete/upload/submit without explicit authorization and cleanup plan.
- Do not call generated specs passed until they are reviewed and executed.
