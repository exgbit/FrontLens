---
name: frontend-qa-visual
description: "Run FrontLens visual/UI regression QA only when the user explicitly asks for visual diff, design baseline comparison, pixel diff, screenshot comparison, UI regression, design acceptance, layout polish, or P2 visual checks. Do not use for ordinary SME frontend QA."
---

# Frontend QA Visual

Use this specialty for design/baseline visual validation.

## Scope

- Screenshot capture and pixel diff against an approved baseline.
- Layout breakage, obvious clipping/overlap, design acceptance checks when a baseline or explicit design rule exists.
- Responsive visual checks only when requested or paired with `$frontend-qa-mobile`.

## Workflow

1. Ask for baseline screenshot/design reference or confirm that this is exploratory visual review.
2. Run FrontLens P2 visual checks with executive/compact reporting.
3. Read visual summary and artifact paths; inspect images only when necessary.
4. Return: true visual regressions, baseline gaps, non-defect design choices, and recommended rerun command.

## Do not

- Do not turn subjective style preferences into must-fix without product/design confirmation.
- Do not run pixel diff by default without baseline/reference.
- Do not list every minor spacing/color issue unless requested.
