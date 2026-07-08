---
name: frontend-qa-performance
description: "Run FrontLens performance-focused QA only when the user explicitly asks about performance, slowness, bundle size, Coverage, Core Web Vitals, P2 budgets, load time, resource weight, route lazy loading, or production preview performance. Do not use for ordinary SME frontend QA."
---

# Frontend QA Performance

Use this specialty only for performance questions. Keep output focused and avoid full raw evidence dumps.

## Scope

- Prefer build/preview or production-like URL; dev server metrics are only source hints.
- Check page load timing, large resources, JS/CSS bundle size, unused Coverage summary, slow network impact, and source-confirmed eager imports/heavy dependencies.
- Treat Vite HMR, `/src/*`, and `@vite/client` as dev noise.

## Workflow

1. Confirm target URL, sourceRoot, and whether production preview is available.
2. If only dev URL is provided and source exists, build/preview when allowed; otherwise label results `dev-only`.
3. Run FrontLens QA with performance/P2/Coverage enabled and executive report profile.
4. Read compact summary first; inspect only targeted performance fields from `result.json`, `coverage.json`, or `resources.json` with helper commands or small extracts.
5. Return: top performance risks, source file:line if available, whether production validation is missing, and focused remediation.

## Do not

- Do not file dev-server request counts as production defects.
- Do not read huge raw `network.json` or full `result.json` by default.
- Do not mix visual/style preferences into performance findings.
