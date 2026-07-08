---
name: frontend-qa-security
description: "Run FrontLens frontend security QA only when the user explicitly asks for security, CSP, HTTPS, cookies, sensitive information exposure, passive security scan, active security regression, headers, permissions, auth leakage, or deployment security checklist. Do not use for ordinary SME frontend QA."
---

# Frontend QA Security

Use this specialty for security-focused review. Default to passive, non-destructive checks.

## Scope

- Sensitive data in URL, storage, DOM, responses, console, and downloads.
- Cookie flags, HTTPS/mixed content, CSP, nosniff, frame/Referrer/HSTS/COOP/CORP headers.
- Permission/auth leakage and frontend-owned security defects.
- Separate frontend code issues from deployment/nginx/CDN/gateway checklist items.

## Workflow

1. Confirm authorization and whether passive or active security mode is requested. Use passive by default.
2. Run FrontLens with security-focused config and executive profile.
3. Read compact security summary/helper output first; inspect only targeted evidence snippets.
4. Return: frontend-code security defects, deployment checklist items, needs-input items, and release impact.

## Do not

- Do not treat missing security headers on local/dev server as frontend code defects.
- Do not run active probing unless explicitly authorized.
- Do not dump secrets or full response bodies into the final answer.
