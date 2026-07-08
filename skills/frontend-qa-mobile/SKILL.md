---
name: frontend-qa-mobile
description: "Run FrontLens mobile/responsive QA only when the user explicitly asks for mobile, tablet, H5, responsive layout, touch targets, viewport matrix, Safari/iOS, Android, or mobile compatibility. Do not use for ordinary PC-first SME frontend QA."
---

# Frontend QA Mobile

Use this specialty for mobile/tablet/responsive validation.

## Scope

- Viewport matrix, responsive layout, touch target usability, mobile navigation, overflow/clipping, mobile-specific browser risks.
- Respect product context: PC-first pages get optional mobile observations unless mobile support is required.

## Workflow

1. Confirm target devices/viewports and whether mobile is required or best-effort.
2. Run FrontLens responsive checks with selected viewports.
3. Read compact responsive summary; avoid full raw DOM unless needed.
4. Return: blocking mobile defects, optional PC-first improvements, unsupported scope, and rerun steps.

## Do not

- Do not treat small tap targets as defects when the page is explicitly PC-first and mobile is out of scope.
- Do not run full mobile matrix for admin/internal pages unless requested.
