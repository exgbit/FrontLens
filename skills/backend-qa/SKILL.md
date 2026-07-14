---
name: backend-qa
description: "Run requirement-driven QA for pure backend/API/service repositories from a PRD and source path, reusing an authorized deployed test environment when available or automatically deploying one when needed. Use when Codex must inspect a backend project, resolve local/remote test-environment hints, discover the API/OpenAPI/health/auth without requiring a pre-supplied URL, generate P0-P3 backend/API/database/source cases, execute real code and HTTP tests, locate defects with reproduction evidence, write Markdown reports, and clean up only resources created by the run. Do not use for browser/UI testing."
---

# Backend QA

Test a backend repository end to end without asking the user for a pre-existing API URL. Treat the requirement document and source root as the normal inputs. Treat an existing test environment, SSH alias, remote `.env` path, deployment directory, Compose project, or environment name as useful discovery hints rather than reasons to stop.

## Non-negotiable rules

- Do not run browser, DOM, visual, responsive, or frontend checks.
- Never infer `passed` from a plan, source inspection, process exit alone, or another layer's evidence. Use `needs-input`, `not-run`, or `blocked` when evidence is absent.
- Never test or mutate production. A non-local/remote host is not automatically production: honor an environment explicitly identified as test/staging, verify its environment markers, and ask only if classification remains ambiguous.
- Do not modify business source to make deployment or tests pass. Temporary config belongs in the report/temp directory and secrets must be redacted.
- Track every PID, container/Compose project, network, volume, temp file, and test record created by this run. Clean only those resources; never stop an existing service or run broad Docker/system cleanup.

## Environment selection

Choose the least disruptive usable mode instead of always redeploying:

1. **Existing authorized test environment**: when the user says it is already deployed or directly connectable, resolve and health-check it first. Do not start a duplicate stack and do not stop its shared services afterward.
2. **Requested deployment/update**: when the user explicitly asks to deploy or refresh, use the repository's documented local or remote deployment path, then verify readiness. Reuse a healthy existing deployment when “自动部署” means “ensure deployed,” unless a clean isolated redeploy is required by the test.
3. **Local isolated deployment**: when no usable test environment exists, start isolated dependencies and the service locally.
4. **Blocked/code-only**: only after the safe repository-supported paths fail; still generate the plan, run available source tests, and report exact missing inputs.

Resolve remote hints without demanding an API URL: inspect project deployment docs/config, approved SSH config aliases, Compose/proxy/service config, environment variable names, CI deployment files, and bounded remote logs. A path such as `/var/www/app/.env` is remote when paired with an environment/host hint; access it through the user's existing authorized connection, read only required keys, and never print or copy secrets into reports. Do not scan networks or guess unmentioned hosts.

For an SSH-backed environment, resolve only the exact alias named by the user or repository inventory. In the declared deployment directory, inspect allowlisted discovery keys (`API_URL`, `BASE_URL`, `PUBLIC_URL`, `HOST`, `PORT`, `SERVER_PORT`), exact Compose port mappings, reverse-proxy/ingress config, and a bounded log tail. Never `cat` an entire remote `.env`, enumerate unrelated hosts/containers, or assume an internal container address is client-reachable. Validate every candidate URL with health/readiness or an OpenAPI request. If the healthy service is bound only to remote loopback, use an authorized ephemeral SSH tunnel when appropriate, track only the tunnel PID, and leave the remote service untouched.

## Workflow

1. **Read minimally.** Read the PRD, then inspect only deployment/build manifests and small targeted source files: README, Docker/Compose, Makefile/Taskfile, package metadata, lockfiles, framework config, migrations, route/OpenAPI definitions, and existing test config. Do not load whole repositories or large logs.
2. **Classify the stack and environment.** Identify language/framework, package manager, build/test/lint commands, dependency services, migrations, seed mechanism, startup command, configuration keys, and likely health/OpenAPI/auth paths. Resolve whether the user supplied an existing local/remote test environment, a deployment target, or only source. Record confidence and unresolved inputs.
3. **Generate the plan.** From the FrontLens repository run:

   ```bash
   node dist/cli.js test-plan --input "<PRD>" --source-root "<SOURCE>" --project-type backend --output "<REPORT>/plan"
   ```

   Confirm the plan has no `frontend` points/cases. Give development only P0 blockers; QA receives all P0-P3 cases. Cover startup/readiness, core flow, authentication/authorization, migrations/compatibility, data integrity/transactions, validation/boundaries, idempotency/concurrency, timeout/retry, dependency failure, API contract, and source checks when applicable.
4. **Resolve or deploy automatically.** If an authorized test environment is already deployed, verify and reuse it first. Otherwise prefer the repository's supported path in this order: test harness/Testcontainers; Docker Compose with a unique project name; Make/Task target; documented local start script; package-manager framework command. Run a remote deploy/update only when the user explicitly requested it or the repository provides a dedicated per-run isolated namespace—never redeploy a shared environment merely because health discovery failed. Install missing dependencies only through the project's lockfile-aware package manager. Use isolated databases/queues/caches and a free port when supported. If a fixed port is occupied, do not kill its owner—select another supported port or mark deployment blocked.
5. **Initialize and verify.** For a new isolated deployment, run migrations and minimal reversible seed data. For an existing shared test environment, do not rerun migrations, restart services, or replace data unless explicitly authorized; create uniquely tagged test records instead. Capture commands, redacted environment-key names, owned resource IDs, exit codes, and bounded log tails. Wait for readiness using declared health/readiness first, then listening socket/log evidence. A process/container alone is not readiness proof.
6. **Discover the API.** Derive the base URL from environment variables such as `API_URL`, `BASE_URL`, `PUBLIC_URL`, `HOST`, `PORT`, `SERVER_PORT`, proxy/ingress config, actual bound ports/container mappings, deployment logs, health endpoints, OpenAPI and route source. Remote test environments follow the same discovery process through their authorized connection. Do not ask for an API address until repository/environment discovery is exhausted; explain each failed path if blocked. Keep TLS verification enabled by default; for an explicitly identified private test environment with an invalid certificate, use only a request-scoped client bypass, record it as a deployment/security risk, and never call TLS/security passed.
7. **Execute evidence by layer.** Run native format/lint/typecheck/build/unit/integration commands, then real HTTP requests. Validate method/path, status, schema/content type, error contract, auth, side effects, persistence, rollback, and cleanup. Bind backend test evidence in `.frontlens/test-evidence.json` with `requirementIds`, `layer`, `scenarios`, and `scriptNames`; global green tests do not close every requirement.
8. **Triage defects.** For every retained defect include requirement/case, priority, request and redacted payload, response/status, data side effect, exact reproduction steps, expected/actual, relevant log excerpt, and source `file:line` when supported. Separate implementation defects from environment blockers and missing product input.
9. **Report with low token use.** Read `test-plan-summary.json` and `developer-test-cases.md` first; open only failed/blocked case detail. Write `<REPORT>/test-report.md` with environment mode (`reused`/`new-local`/`new-remote`/`code-only`), discovery evidence, requirement verdicts, P0 gate, executed command/API evidence, defects, blocked/not-run items, cleanup result, and release recommendation. Keep full logs and raw responses as referenced artifacts, not inline prose.
10. **Clean and hand off.** Allocate a run ID before the first write and include it in every created record; register the exact cleanup operation before creation. In a `finally`-equivalent path delete only IDs created by this run—never broad-delete by date/name prefix. If shared-environment write permission was not explicit, keep mutation cases `needs-input`. Stop/remove only PIDs, Compose projects, containers, volumes, networks and temp config created by this run. Never stop, restart, migrate, or remove a reused test environment. A cleanup failure remains visible as a release risk/blocker. Preserve reports. On Windows ensure retained generated roots inherit the parent ACL; if needed run `node dist/cli.js permissions repair --output "<REPORT>"`. Never target a drive root, home directory, or source repository.

## Deployment failure contract

Try the authorized existing test environment, documented deployment paths, and safe local isolation before requesting input. If access/deployment remains blocked, still deliver the plan and Markdown report with attempted commands, concise error evidence, missing prerequisite, and exact next action. Do not invent a base URL or mark API/backend cases passed.
