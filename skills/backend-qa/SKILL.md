---
name: backend-qa
description: "Run requirement-driven QA for pure backend/API/service repositories from only a PRD and source path. Use when Codex must inspect a backend project, automatically deploy its isolated test dependencies and service, discover the API address/OpenAPI/health/auth, generate P0-P3 backend/API/database/source cases, execute real code and HTTP tests, locate defects with reproduction evidence, write Markdown reports, and clean up only resources created by the run. Do not use for browser/UI testing."
---

# Backend QA

Test a backend repository end to end without asking the user for a pre-existing API URL. Treat the requirement document and source root as the normal inputs; credentials or write authorization are optional inputs only when genuinely required.

## Non-negotiable rules

- Do not run browser, DOM, visual, responsive, or frontend checks.
- Never infer `passed` from a plan, source inspection, process exit alone, or another layer's evidence. Use `needs-input`, `not-run`, or `blocked` when evidence is absent.
- Never connect to production or reuse a production database. Refuse a discovered production endpoint by selecting an isolated local/test deployment instead.
- Do not modify business source to make deployment or tests pass. Temporary config belongs in the report/temp directory and secrets must be redacted.
- Track every PID, container/Compose project, network, volume, temp file, and test record created by this run. Clean only those resources; never stop an existing service or run broad Docker/system cleanup.

## Workflow

1. **Read minimally.** Read the PRD, then inspect only deployment/build manifests and small targeted source files: README, Docker/Compose, Makefile/Taskfile, package metadata, lockfiles, framework config, migrations, route/OpenAPI definitions, and existing test config. Do not load whole repositories or large logs.
2. **Classify the stack.** Identify language/framework, package manager, build/test/lint commands, dependency services, migrations, seed mechanism, startup command, configuration keys, and likely health/OpenAPI/auth paths. Record confidence and unresolved inputs.
3. **Generate the plan.** From the FrontLens repository run:

   ```bash
   node dist/cli.js test-plan --input "<PRD>" --source-root "<SOURCE>" --project-type backend --output "<REPORT>/plan"
   ```

   Confirm the plan has no `frontend` points/cases. Give development only P0 blockers; QA receives all P0-P3 cases. Cover startup/readiness, core flow, authentication/authorization, migrations/compatibility, data integrity/transactions, validation/boundaries, idempotency/concurrency, timeout/retry, dependency failure, API contract, and source checks when applicable.
4. **Deploy automatically.** Prefer the repository's supported path in this order: test harness/Testcontainers; Docker Compose with a unique project name; Make/Task target; documented test/start script; package-manager framework command. Install missing dependencies only through the project's lockfile-aware package manager. Use isolated databases/queues/caches and a free port when supported. If a fixed port is occupied, do not kill its owner—select another supported port or mark deployment blocked.
5. **Initialize and verify.** Run migrations and minimal reversible seed data. Capture commands, redacted environment keys, owned resource IDs, exit codes, and bounded log tails. Wait for readiness using declared health/readiness first, then listening socket/log evidence. A running process without a successful readiness/API check is not deployed.
6. **Discover the API.** Derive the base URL from actual bound ports/container mappings and logs; discover OpenAPI from config/source and common endpoints only as fallback. Derive routes and auth from OpenAPI/source/test fixtures. Do not ask for an API address unless all repository-based deployment and discovery paths are exhausted; explain each failed path if blocked.
7. **Execute evidence by layer.** Run native format/lint/typecheck/build/unit/integration commands, then real HTTP requests. Validate method/path, status, schema/content type, error contract, auth, side effects, persistence, rollback, and cleanup. Bind backend test evidence in `.frontlens/test-evidence.json` with `requirementIds`, `layer`, `scenarios`, and `scriptNames`; global green tests do not close every requirement.
8. **Triage defects.** For every retained defect include requirement/case, priority, request and redacted payload, response/status, data side effect, exact reproduction steps, expected/actual, relevant log excerpt, and source `file:line` when supported. Separate implementation defects from environment blockers and missing product input.
9. **Report with low token use.** Read `test-plan-summary.json` and `developer-test-cases.md` first; open only failed/blocked case detail. Write `<REPORT>/test-report.md` with deployment summary, requirement verdicts, P0 gate, executed command/API evidence, defects, blocked/not-run items, cleanup result, and release recommendation. Keep full logs and raw responses as referenced artifacts, not inline prose.
10. **Clean and hand off.** In a `finally`-equivalent path delete test records, stop only recorded PIDs/Compose project/containers, and remove only disposable volumes/networks/temp config created by this run. Preserve reports. On Windows ensure retained generated roots inherit the parent ACL; if needed run `node dist/cli.js permissions repair --output "<REPORT>"`. Never target a drive root, home directory, or source repository.

## Deployment failure contract

Try all safe, source-supported alternatives before requesting input. If deployment remains blocked, still deliver the plan and Markdown report with attempted commands, concise error evidence, missing prerequisite, and exact next action. Do not invent a base URL or mark API/backend cases passed.
