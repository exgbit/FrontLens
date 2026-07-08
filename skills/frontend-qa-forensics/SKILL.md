---
name: frontend-qa-forensics
description: "Run full/deep FrontLens forensic QA only when the user explicitly asks for full analysis, forensic evidence, incident investigation, exhaustive artifacts, raw network details, complete report, full security/performance/accessibility matrix, or legacy all-modules behavior. This is the high-token mode; do not use for ordinary SME frontend QA."
---

# Frontend QA Forensics

Use this specialty for deliberate high-token, full-evidence investigations.

## Scope

- Legacy full-module FrontLens behavior across UI, API, console, network, performance, a11y, security, responsive, exception simulation, journeys, risks, traceability, evidence bundle, and raw appendix.
- Incident/production issue reproduction where raw evidence matters.
- Before/after deep comparison with `frontlens diff` or environment comparison.

## Workflow

1. Confirm the user wants high-token forensic mode and why.
2. Run full FrontLens QA with explicit output directory and executive/professional/full report profile as requested.
3. Read summaries first, then drill into raw artifacts only for the specific evidence question.
4. For large files, use helper commands, `jq`, `rg`, `head`, or targeted extraction before opening content.
5. Return: timeline/evidence, root causes, proof strength, raw artifact index, and focused next actions.

## High-token warning

This mode may generate and inspect large `result.json`, `network.json`, `page-model.json`, `coverage.json`, screenshots, traces, and evidence reports. Use `$frontend-qa` for normal low-token SME QA.
