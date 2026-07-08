#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runQa } from './runner.js';
import { runCompatibility } from './matrix.js';
import { saveAuthState } from './auth.js';
import { startMcpServer } from './mcpServer.js';
import { runEnvironmentComparison } from './compare/environmentComparison.js';
import { synthesizeRequirements } from './requirements/requirementWizard.js';
import { loadRoleMatrixRoles, parseRoleSpec, runRoleMatrix } from './roles/roleMatrix.js';
import { recordJourney } from './journeys/journeyRecorder.js';
import type { BrowserName, QaResult, QaRunInput, ReportProfile, RoleMatrixRoleConfig, Severity } from './types.js';
import { normalizeResult } from './resultNormalizer.js';
import { createResultDiff, writeResultDiff } from './diff/resultDiff.js';
import { evaluateMatrixItemCiGate, evaluateQaCiGate, type CiGateMode } from './gates/ciGate.js';
import { formatProfessionalBrief } from './reporters/briefReporter.js';
import { formatProfessionalAudit, runProfessionalAudit } from './audit/professionalAudit.js';
import { buildProductContextSuggestion, formatProductContextSuggestion } from './product/productContextSuggestion.js';
import { buildQaExecutionPlan, formatQaExecutionPlan } from './plan/qaExecutionPlan.js';
import { buildQaCoverageMatrix, formatQaCoverageMatrix } from './coverage/qaCoverageMatrix.js';
import { buildTestCaseMatrix, formatTestCaseMatrix } from './cases/testCases.js';
import { buildAssertionSuggestions, formatAssertionSuggestions } from './journeys/assertionSuggestions.js';
import { buildQaIntakeConfig } from './intake/qaIntakeConfig.js';
import { formatQaIntake } from './intake/qaIntakeReport.js';
import { buildRiskRegister, formatRiskRegister } from './risk/riskRegister.js';
import { buildRiskAcceptance, formatRiskAcceptance } from './risk/riskAcceptance.js';
import { buildProfessionalSuggestions } from './review/professionalSuggestions.js';
import { buildArtifactIntegrity } from './artifacts/artifactIntegrity.js';
import { formatClaimGuard } from './claims/claimGuardReport.js';
import { formatDefectProof } from './proof/defectProofReport.js';
import { formatReportContentAudit } from './audit/reportContentAudit.js';
import { formatJourneyAssertionAudit } from './journeys/journeyAssertionAudit.js';
import { buildDefectTickets, formatDefectTickets } from './tickets/defectTickets.js';
import { buildTraceabilityMatrix, formatTraceabilityMatrix } from './traceability/traceabilityMatrix.js';
import { buildAutomationSpecs, formatAutomationSpecs } from './automation/automationSpecs.js';

const CLI_VERSION = '0.1.0';
const COMMANDS = new Set(['qa', 'auth', 'journey', 'matrix', 'role-matrix', 'env-compare', 'requirements', 'mcp', 'brief', 'audit', 'product-context', 'claim-guard', 'qa-intake', 'defect-proof', 'defect-tickets', 'traceability', 'automation-specs', 'report-content-audit', 'journey-assertion-audit', 'qa-plan', 'qa-coverage', 'assertion-suggestions', 'test-cases', 'risk-register', 'risk-acceptance', 'artifact-integrity', 'inspect', 'issues', 'root-causes', 'disposition', 'network', 'coverage', 'security', 'fix-tasks', 'diff', 'suggestions', 'help', '--help', '-h', '--version', '-v']);

function printHelp(): void {
  console.log(`FrontLens - AI-oriented frontend QA analyzer

Usage:
  frontlens qa --url <url> [options]
  frontlens --url <url> [options]
  frontlens auth save --url <login-url> --output <storage-state-path>
  frontlens journey record --url <url> --output <journey-config.json>
  frontlens requirements synthesize --input <prd.md> --output <requirements.json>
  frontlens matrix --url <url> --browsers chromium,firefox,webkit
  frontlens role-matrix --url <url> --role admin=.auth/admin.json --role viewer=.auth/viewer.json
  frontlens env-compare --dev-url <vite-dev-url> --preview-url <build-preview-url>
  frontlens mcp
  frontlens brief --report <result.json>
  frontlens audit --report <result.json>
  frontlens product-context --report <result.json>
  frontlens claim-guard --report <result.json>
  frontlens qa-intake --report <result.json>
  frontlens defect-proof --report <result.json>
  frontlens defect-tickets --report <result.json>
  frontlens traceability --report <result.json>
  frontlens automation-specs --report <result.json>
  frontlens report-content-audit --report <result.json>
  frontlens journey-assertion-audit --report <result.json>
  frontlens qa-plan --report <result.json>
  frontlens qa-coverage --report <result.json>
  frontlens assertion-suggestions --report <result.json>
  frontlens test-cases --report <result.json>
  frontlens risk-register --report <result.json>
  frontlens risk-acceptance --report <result.json>
  frontlens artifact-integrity --report <result.json>
  frontlens inspect --report <result.json>
  frontlens issues --report <result.json> [--severity high]
  frontlens root-causes --report <result.json>
  frontlens disposition --report <result.json>
  frontlens network --report <result.json>
  frontlens coverage --report <result.json>
  frontlens security --report <result.json>
  frontlens fix-tasks --report <result.json>
  frontlens diff --before <old/result.json> --after <new/result.json> [--output <dir>]
  frontlens suggestions --report <result.json>

Options:
  --url <url>                 Target page URL.
  --dev-url <url>             Dev/source-module URL for env-compare.
  --preview-url <url>         Build/preview URL for env-compare.
  --input <path>              Requirements synthesize input Markdown/text file.
  --text <text>               Inline PRD/acceptance text for requirements synthesize.
  --config <path>             Optional config file (.json/.js/.mjs).
  --requirements <path>       Optional requirements/acceptance criteria JSON file.
  --source-root <path>        Optional frontend source repository root for static source correlation.
  --source-run-scripts        Run selected non-destructive source scripts during source health.
  --source-scripts <list>     Comma-separated package.json scripts to run when --source-run-scripts is enabled. Default: typecheck,lint.
  --source-script-timeout-ms <ms>
                              Timeout per source script. Default: 120000.
  --output <dir>              Output report directory.
  --report-profile <profile>  Primary report.md depth: executive | professional | full. Default: executive.
  --name <name>               Journey name for journey record.
  --browser <name>            chromium | firefox | webkit. Default: chromium.
  --headed                    Run headed browser.
  --headless                  Run headless browser.
  --storage-state <path>      Playwright storageState file.
  --session-storage-state <path>
                              FrontLens sessionStorage sidecar file.
  --browsers <list>           Browser list for matrix command.
  --role <name=storageState[|sessionStorageState]>
                              Role matrix entry. Use name= for anonymous/no storage. Repeatable.
  --roles <path>              Role matrix JSON file: [{name, storageState, sessionStorageState, expectedAllowedTexts, expectedForbiddenTexts}].
  --report <path>             Existing result.json for inspect/issues/network/coverage/security/fix-tasks/audit/product-context/claim-guard/qa-intake/defect-proof/defect-tickets/traceability/automation-specs/report-content-audit/journey-assertion-audit/qa-plan/qa-coverage/assertion-suggestions/test-cases/risk-register/risk-acceptance/artifact-integrity/suggestions.
  --severity <level>          Filter issues by severity.
  --trace                     Enable Playwright trace.
  --no-trace                  Disable Playwright trace.
  --video                     Enable video recording.
  --screenshot                Enable full-page screenshot.
  --simulate-exceptions       Enable 500/404/timeout/offline/refresh simulations. Default: enabled.
  --no-exceptions             Disable exception simulations.
  --ai                        Enable AI/heuristic analysis. Default: enabled.
  --no-ai                     Disable AI/heuristic analysis.
  --coverage                  Enable Chromium JS/CSS coverage.
  --no-coverage               Disable Chromium JS/CSS coverage.
  --security                  Enable passive security scan. Default: enabled.
  --no-security               Disable security scan.
  --journeys                  Enable user journey tests. Default: enabled with a safe smoke journey.
  --no-journeys               Disable user journey tests.
  --contract                  Enable API contract/schema analysis. Default: enabled.
  --no-contract               Disable API contract/schema analysis.
  --realtime                  Enable GraphQL/WebSocket/SSE capture. Default: enabled.
  --no-realtime               Disable realtime capture.
  --p2                        Enable P2 visual/budget/network tests. Default: enabled.
  --no-p2                     Disable P2 tests.
  --block-mutating-requests   Abort POST/PUT/PATCH/DELETE unless corresponding allow* is enabled.
  --allow-mutating-requests   Do not abort mutating requests; report successful writes as suspicious instead.
  --json                      Print machine-readable JSON summary.
  --full                      For issues command, print full Issue objects.
  --all                       For suggestions command, include raw suppressed product/style/deployment/needs-evidence suggestions.
  --gate-mode <mode>          CI gate mode: professional (default) | raw.
  --fail-on <severity>        Exit non-zero if issues at severity or above exist. In professional mode, only actionable + defectProof proven/probable findings count, and report/sign-off contract blockers also fail.
  --min-score <number>        Exit non-zero if score is lower. In professional mode, uses adjustedScore.
  --fail-on-browser-failure   Matrix: exit non-zero when any browser run fails.
  --timeout-ms <ms>           Journey record maximum wait time. Default: 300000.
  --max-steps <n>             Journey record maximum generated steps. Default: 80.
  --allow-mutating-steps      Journey record: mark dangerous recorded steps allowMutating=true.
  -h, --help                  Show help.

Auth options:
  --wait-ms <ms>              Non-TTY wait time before saving storage state. Default: 300000.

Examples:
  frontlens qa --url https://example.com
  frontlens qa --url https://example.com/admin --headed --output reports/admin
  frontlens qa --url https://example.com/admin --report-profile executive
  frontlens qa --url https://example.com/admin --storage-state .frontlens/auth/admin.json
  frontlens auth save --url https://example.com/login --output .frontlens/auth/admin.json
  frontlens journey record --url https://example.com/admin/users --output journeys/users-smoke.json --name "Users smoke"
  frontlens requirements synthesize --input docs/prd.md --output requirements.json
  frontlens matrix --url https://example.com --browsers chromium,firefox,webkit --output reports/compat
  frontlens role-matrix --url https://example.com/admin --role admin=.frontlens/auth/admin.json --role viewer=.frontlens/auth/viewer.json --output reports/roles
  frontlens env-compare --dev-url http://127.0.0.1:5173/users --preview-url http://127.0.0.1:4173/users --output reports/env-users
  frontlens mcp
  frontlens brief --report reports/frontlens/users/result.json
  frontlens audit --report reports/frontlens/users/result.json
  frontlens product-context --report reports/frontlens/users/result.json
  frontlens claim-guard --report reports/frontlens/users/result.json
  frontlens qa-intake --report reports/frontlens/users/result.json
  frontlens defect-proof --report reports/frontlens/users/result.json
  frontlens defect-tickets --report reports/frontlens/users/result.json
  frontlens traceability --report reports/frontlens/users/result.json
  frontlens automation-specs --report reports/frontlens/users/result.json
  frontlens report-content-audit --report reports/frontlens/users/result.json
  frontlens journey-assertion-audit --report reports/frontlens/users/result.json
  frontlens qa-plan --report reports/frontlens/users/result.json
  frontlens qa-coverage --report reports/frontlens/users/result.json
  frontlens risk-register --report reports/frontlens/users/result.json
  frontlens risk-acceptance --report reports/frontlens/users/result.json
  frontlens issues --report reports/frontlens/users/result.json --severity high
  frontlens root-causes --report reports/frontlens/users/result.json
  frontlens disposition --report reports/frontlens/users/result.json
  frontlens coverage --report reports/frontlens/users/result.json
  frontlens security --report reports/frontlens/users/result.json
  frontlens diff --before reports/frontlens/old/result.json --after reports/frontlens/new/result.json --output reports/frontlens/diff
`);
}

function normalizeBrowser(value: unknown): BrowserName | undefined {
  if (value === 'chromium' || value === 'firefox' || value === 'webkit') {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  throw new Error(`Unsupported browser: ${String(value)}. Expected chromium, firefox, or webkit.`);
}

async function readResult(reportPath: string): Promise<QaResult> {
  const raw = JSON.parse(await readFile(reportPath, 'utf8')) as unknown;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const artifacts = record.artifacts && typeof record.artifacts === 'object' && !Array.isArray(record.artifacts)
      ? record.artifacts as Record<string, unknown>
      : {};
    if (typeof artifacts.outputDir !== 'string' || artifacts.outputDir.length === 0) {
      record.artifacts = { ...artifacts, outputDir: path.dirname(reportPath) };
    }
  }
  return normalizeResult(raw);
}

function severityRank(severity: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity];
}

function normalizeSeverity(value: unknown): Severity | undefined {
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') {
    return value;
  }
  return undefined;
}

function requireSeverity(value: unknown, optionName: string): Severity | undefined {
  if (value === undefined) {
    return undefined;
  }
  const severity = normalizeSeverity(value);
  if (!severity) {
    throw new Error(`Invalid ${optionName}: ${String(value)}. Expected critical, high, medium, low, or info.`);
  }
  return severity;
}

function normalizeGateMode(value: unknown): CiGateMode {
  if (value === undefined || value === 'professional') return 'professional';
  if (value === 'raw') return 'raw';
  throw new Error(`Invalid --gate-mode: ${String(value)}. Expected professional or raw.`);
}

function normalizeReportProfile(value: unknown): ReportProfile | undefined {
  if (value === undefined) return undefined;
  if (value === 'executive' || value === 'professional' || value === 'full') return value;
  throw new Error(`Invalid --report-profile: ${String(value)}. Expected executive, professional, or full.`);
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (typeof value !== 'string') return undefined;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function normalizePositiveNumber(value: unknown, optionName: string): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${optionName}: ${String(value)}. Expected a positive number.`);
  }
  return numeric;
}

function collectRoleSpecs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

async function resolveRoleMatrixRoles(roleSpecs: unknown, rolesPath?: string): Promise<RoleMatrixRoleConfig[]> {
  const roles: RoleMatrixRoleConfig[] = [];
  if (rolesPath) roles.push(...(await loadRoleMatrixRoles(rolesPath)));
  roles.push(...collectRoleSpecs(roleSpecs).map(parseRoleSpec));
  const unique = new Map<string, RoleMatrixRoleConfig>();
  for (const role of roles) {
    if (!role.name.trim()) throw new Error('Role matrix role name cannot be empty.');
    unique.set(role.name, role);
  }
  return [...unique.values()];
}

function printMcpHelp(): void {
  console.log(`FrontLens MCP server

Usage:
  frontlens mcp

Stdio MCP command:
  node dist/cli.js mcp

Exposed tools:
  frontlens_qa
  frontlens_requirements_synthesize
  frontlens_matrix
  frontlens_role_matrix
  frontlens_env_compare
  frontlens_inspect
  frontlens_issues
  frontlens_root_causes
  frontlens_disposition
  frontlens_network
  frontlens_coverage
  frontlens_security
  frontlens_fix_tasks
  frontlens_audit
  frontlens_product_context
  frontlens_claim_guard
  frontlens_qa_intake
  frontlens_defect_proof
  frontlens_defect_tickets
  frontlens_traceability
  frontlens_automation_specs
  frontlens_report_content_audit
  frontlens_journey_assertion_audit
  frontlens_qa_plan
  frontlens_qa_coverage
  frontlens_assertion_suggestions
  frontlens_test_cases
  frontlens_risk_register
  frontlens_risk_acceptance
  frontlens_artifact_integrity
  frontlens_diff
  frontlens_suggestions
`);
}

function ensureKnownCommand(argv: string[]): void {
  const first = argv[0];
  if (!first || first.startsWith('-') || COMMANDS.has(first)) {
    return;
  }
  throw new Error(`Unsupported command: ${first}. Run frontlens --help for usage.`);
}

async function handleResultCommand(command: 'brief' | 'audit' | 'product-context' | 'claim-guard' | 'qa-intake' | 'defect-proof' | 'defect-tickets' | 'traceability' | 'automation-specs' | 'report-content-audit' | 'journey-assertion-audit' | 'qa-plan' | 'qa-coverage' | 'assertion-suggestions' | 'test-cases' | 'risk-register' | 'risk-acceptance' | 'artifact-integrity' | 'inspect' | 'issues' | 'root-causes' | 'disposition' | 'network' | 'coverage' | 'security' | 'fix-tasks' | 'suggestions', args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      report: { type: 'string' },
      severity: { type: 'string' },
      json: { type: 'boolean' },
      full: { type: 'boolean' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const reportPath = parsed.values.report ?? parsed.positionals[0];
  if (!reportPath) {
    throw new Error(`Missing required ${command} --report <result.json>.`);
  }

  const requestedSeverity = requireSeverity(parsed.values.severity, '--severity');
  const result = await readResult(reportPath);
  if (command === 'brief') {
    if (parsed.values.json) {
      console.log(
        JSON.stringify(
          {
            summary: result.summary,
            professionalSummary: result.professionalSummary,
            qaPlan: result.qaPlan,
            qaCoverage: result.qaCoverage,
            assertionSuggestions: result.assertionSuggestions,
            testCases: result.testCases,
            defectTickets: result.defectTickets,
            traceability: result.traceability,
            automationSpecs: result.automationSpecs,
            qaSignoff: result.qaSignoff,
            claimGuard: result.claimGuard,
            defectProof: result.defectProof,
            issueDisposition: result.issueDisposition.summary,
            artifacts: result.artifacts
          },
          null,
          2
        )
      );
    } else {
      console.log(formatProfessionalBrief(result));
    }
    return;
  }
  if (command === 'audit') {
    const audit = runProfessionalAudit(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      console.log(formatProfessionalAudit(audit));
    }
    return;
  }
  if (command === 'product-context') {
    const suggestion = buildProductContextSuggestion(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(suggestion, null, 2));
    } else {
      console.log(formatProductContextSuggestion(suggestion));
    }
    return;
  }
  if (command === 'claim-guard') {
    if (parsed.values.json) {
      console.log(JSON.stringify(result.claimGuard, null, 2));
    } else {
      console.log(formatClaimGuard(result));
    }
    return;
  }
  if (command === 'qa-intake') {
    if (parsed.values.json) {
      console.log(
        JSON.stringify(
          {
            qaIntake: result.qaIntake,
            qaIntakeConfig: buildQaIntakeConfig(result),
            artifacts: {
              qaIntake: result.artifacts.qaIntake,
              qaIntakeConfig: result.artifacts.qaIntakeConfig,
              productContext: result.artifacts.productContext,
              qaPlan: result.artifacts.qaPlan
            }
          },
          null,
          2
        )
      );
    } else {
      console.log(formatQaIntake(result));
    }
    return;
  }
  if (command === 'defect-proof') {
    if (parsed.values.json) {
      console.log(JSON.stringify(result.defectProof, null, 2));
    } else {
      console.log(formatDefectProof(result));
    }
    return;
  }
  if (command === 'defect-tickets') {
    const tickets = buildDefectTickets(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(tickets, null, 2));
    } else {
      console.log(formatDefectTickets(tickets));
    }
    return;
  }
  if (command === 'traceability') {
    const traceability = buildTraceabilityMatrix(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(traceability, null, 2));
    } else {
      console.log(formatTraceabilityMatrix(traceability));
    }
    return;
  }
  if (command === 'automation-specs') {
    const specs = buildAutomationSpecs(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(specs, null, 2));
    } else {
      console.log(formatAutomationSpecs(specs));
    }
    return;
  }
  if (command === 'report-content-audit') {
    if (parsed.values.json) {
      console.log(JSON.stringify(result.reportContentAudit, null, 2));
    } else {
      console.log(formatReportContentAudit(result.reportContentAudit));
    }
    return;
  }
  if (command === 'journey-assertion-audit') {
    if (parsed.values.json) {
      console.log(JSON.stringify(result.journeyAssertionAudit, null, 2));
    } else {
      console.log(formatJourneyAssertionAudit(result.journeyAssertionAudit));
    }
    return;
  }
  if (command === 'qa-plan') {
    const plan = buildQaExecutionPlan(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(formatQaExecutionPlan(plan));
    }
    return;
  }
  if (command === 'qa-coverage') {
    const matrix = buildQaCoverageMatrix(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(matrix, null, 2));
    } else {
      console.log(formatQaCoverageMatrix(matrix));
    }
    return;
  }
  if (command === 'assertion-suggestions') {
    const suggestions = buildAssertionSuggestions(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(suggestions, null, 2));
    } else {
      console.log(formatAssertionSuggestions(suggestions));
    }
    return;
  }
  if (command === 'test-cases') {
    const cases = buildTestCaseMatrix(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(cases, null, 2));
    } else {
      console.log(formatTestCaseMatrix(cases));
    }
    return;
  }
  if (command === 'risk-register') {
    const riskRegister = buildRiskRegister(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(riskRegister, null, 2));
    } else {
      console.log(formatRiskRegister(riskRegister));
    }
    return;
  }
  if (command === 'risk-acceptance') {
    const riskAcceptance = buildRiskAcceptance({ riskRegister: buildRiskRegister(result) });
    if (parsed.values.json) {
      console.log(JSON.stringify(riskAcceptance, null, 2));
    } else {
      console.log(formatRiskAcceptance(riskAcceptance));
    }
    return;
  }
  if (command === 'artifact-integrity') {
    const artifactIntegrity = await buildArtifactIntegrity(result);
    if (parsed.values.json) {
      console.log(JSON.stringify(artifactIntegrity, null, 2));
    } else {
      const missingRows = artifactIntegrity.missing.slice(0, 30).map((entry) => `| ${entry.source} | ${entry.kind} | ${entry.path} | ${entry.message ?? '-'} |`);
      const skippedRows = artifactIntegrity.entries
        .filter((entry) => !entry.expected || !entry.absolutePath)
        .slice(0, 30)
        .map((entry) => `| ${entry.source} | ${entry.kind} | ${entry.path} | ${entry.message ?? '-'} |`);
      console.log(`# FrontLens Artifact Integrity

- Status: **${artifactIntegrity.status}**
- Present / Missing / Skipped: ${artifactIntegrity.presentCount} / ${artifactIntegrity.missingCount} / ${artifactIntegrity.skippedCount}
- Summary: ${artifactIntegrity.summary}

## Missing

${missingRows.length ? ['| Source | Kind | Path | Message |', '| --- | --- | --- | --- |', ...missingRows].join('\n') : 'No missing local artifacts.'}

## Skipped / non-portable

${skippedRows.length ? ['| Source | Kind | Path | Message |', '| --- | --- | --- | --- |', ...skippedRows].join('\n') : 'No unchecked or non-portable artifact paths.'}
`);
    }
    return;
  }
  if (command === 'inspect') {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          artifacts: result.artifacts,
          metadata: {
            version: result.metadata.version,
            schemaVersion: result.metadata.schemaVersion,
            durationMs: result.metadata.durationMs,
            phaseErrors: result.metadata.phaseErrors
          },
          issueBreakdown: {
            critical: result.summary.criticalCount,
            high: result.summary.highCount,
            medium: result.summary.mediumCount,
            low: result.summary.lowCount,
            info: result.summary.infoCount
          },
          security: {
            status: result.security.status,
            score: result.security.score,
            summary: result.security.summary
          },
          environment: result.environment,
          pageProfile: result.pageProfile,
          testData: result.testData,
          requirementCoverage: result.requirementCoverage,
          sourceHealth: result.sourceHealth,
          artifactIntegrity: result.artifactIntegrity,
          rootCauseGroups: {
            total: result.rootCauseGroups.length,
            actionable: result.rootCauseGroups.filter((group) => group.status === 'actionable').length,
            reference: result.rootCauseGroups.filter((group) => group.status === 'reference').length
          },
          issueDisposition: result.issueDisposition.summary,
          professionalSummary: result.professionalSummary,
          qaPlan: result.qaPlan,
          qaCoverage: result.qaCoverage,
          assertionSuggestions: result.assertionSuggestions,
          testCases: result.testCases,
          defectTickets: result.defectTickets,
          traceability: result.traceability,
          automationSpecs: result.automationSpecs,
          regressionPlan: result.regressionPlan,
          qualityGate: result.qualityGate,
          qaSignoff: result.qaSignoff
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'root-causes') {
    console.log(JSON.stringify(result.rootCauseGroups, null, 2));
    return;
  }

  if (command === 'disposition') {
    console.log(JSON.stringify(result.issueDisposition, null, 2));
    return;
  }

  if (command === 'issues') {
    const severity = requestedSeverity;
    const issues = result.issues
      .filter((issue) => (severity ? severityRank(issue.severity) <= severityRank(severity) : true))
      .map((issue) =>
        parsed.values.full
          ? issue
          : {
              id: issue.id,
              fingerprint: issue.fingerprint,
              severity: issue.severity,
              category: issue.category,
              title: issue.title,
              confidence: issue.confidence,
              priority: issue.suggestion.priority,
              frontend: issue.suggestion.frontend,
              backend: issue.suggestion.backend,
              product: issue.suggestion.product,
              test: issue.suggestion.test,
              disposition: result.issueDisposition.items.find((item) => item.issueId === issue.id),
              reproduceSteps: issue.reproduceSteps,
              evidence: issue.evidence
            }
      );
    console.log(JSON.stringify(issues, null, 2));
    return;
  }

  if (command === 'network') {
    console.log(
      JSON.stringify(
        {
          requests: result.network.requests,
          failedRequests: result.network.failedRequests,
          slowRequests: result.network.slowRequests,
          duplicatedRequests: result.network.duplicatedRequests,
          suspiciousRequests: result.network.suspiciousRequests
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'coverage') {
    console.log(
      JSON.stringify(
        {
          status: result.coverage?.status ?? 'missing',
          message: result.coverage?.message,
          totals: result.coverage?.totals,
          topUnused: result.coverage?.topUnused ?? []
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'security') {
    console.log(
      JSON.stringify(
        {
          security: result.security,
          securityIssues: result.issues.filter((issue) => issue.category === 'security')
        },
        null,
        2
      )
    );
    return;
  }

  if (command === 'fix-tasks') {
    console.log(JSON.stringify(result.fixTasks, null, 2));
    return;
  }

  const suggestions = buildProfessionalSuggestions(result, { includeAll: Boolean(parsed.values.all) });
  console.log(JSON.stringify(suggestions, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  ensureKnownCommand(argv);

  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    if (argv[1] === 'mcp') {
      printMcpHelp();
    } else {
      printHelp();
    }
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    console.log(CLI_VERSION);
    return;
  }

  if (argv[0] === 'mcp') {
    if (argv.includes('--help') || argv.includes('-h')) {
      printMcpHelp();
      return;
    }
    await startMcpServer();
    return;
  }

  if (argv[0] === 'brief' || argv[0] === 'audit' || argv[0] === 'product-context' || argv[0] === 'claim-guard' || argv[0] === 'qa-intake' || argv[0] === 'defect-proof' || argv[0] === 'defect-tickets' || argv[0] === 'traceability' || argv[0] === 'automation-specs' || argv[0] === 'report-content-audit' || argv[0] === 'journey-assertion-audit' || argv[0] === 'qa-plan' || argv[0] === 'qa-coverage' || argv[0] === 'assertion-suggestions' || argv[0] === 'test-cases' || argv[0] === 'risk-register' || argv[0] === 'risk-acceptance' || argv[0] === 'artifact-integrity' || argv[0] === 'inspect' || argv[0] === 'issues' || argv[0] === 'root-causes' || argv[0] === 'disposition' || argv[0] === 'network' || argv[0] === 'coverage' || argv[0] === 'security' || argv[0] === 'fix-tasks' || argv[0] === 'suggestions') {
    await handleResultCommand(argv[0], argv.slice(1));
    return;
  }

  if (argv[0] === 'diff') {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        before: { type: 'string' },
        after: { type: 'string' },
        output: { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });
    if (parsed.values.help) {
      printHelp();
      return;
    }
    const beforePath = parsed.values.before ?? parsed.positionals[0];
    const afterPath = parsed.values.after ?? parsed.positionals[1];
    if (!beforePath || !afterPath) {
      throw new Error('Missing required diff --before <old/result.json> --after <new/result.json>.');
    }
    const diff = createResultDiff(await readResult(beforePath), await readResult(afterPath));
    const artifacts = parsed.values.output ? await writeResultDiff(diff, parsed.values.output) : undefined;
    console.log(JSON.stringify({ ...diff, artifacts }, null, 2));
    return;
  }

  if (argv[0] === 'auth' && argv[1] === 'save') {
    const parsed = parseArgs({
      args: argv.slice(2),
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        output: { type: 'string', short: 'o' },
        browser: { type: 'string' },
        'wait-ms': { type: 'string' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });

    if (parsed.values.help) {
      printHelp();
      return;
    }

    const url = parsed.values.url ?? parsed.positionals[0];
    const outputPath = parsed.values.output ?? parsed.positionals[1];
    if (!url || !outputPath) {
      printHelp();
      throw new Error('Missing required auth save --url <login-url> --output <storage-state-path>.');
    }

    const waitMs = Number(parsed.values['wait-ms'] ?? 300_000);
    if (!Number.isFinite(waitMs) || waitMs < 0) {
      throw new Error(`Invalid --wait-ms: ${parsed.values['wait-ms']}. Expected a finite number >= 0.`);
    }

    const savedPath = await saveAuthState({
      url,
      outputPath,
      browser: normalizeBrowser(parsed.values.browser) ?? 'chromium',
      waitMs
    });
    if (parsed.values.json) {
      console.log(JSON.stringify({ storageState: savedPath, sessionStorageState: `${savedPath}.session-storage.json` }, null, 2));
    } else {
      console.log(`Storage state saved: ${savedPath}`);
    }
    return;
  }

  if (argv[0] === 'auth') {
    throw new Error(`Unsupported auth command: ${argv[1] ?? '(missing)'}. Expected: frontlens auth save --url <login-url> --output <storage-state-path>.`);
  }

  if (argv[0] === 'journey') {
    const subcommand = argv[1];
    if (subcommand !== 'record') {
      printHelp();
      throw new Error(`Unsupported journey command: ${subcommand ?? '(missing)'}. Expected: frontlens journey record --url <url> --output <journey-config.json>.`);
    }
    const parsed = parseArgs({
      args: argv.slice(2),
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        output: { type: 'string', short: 'o' },
        name: { type: 'string' },
        browser: { type: 'string' },
        headed: { type: 'boolean' },
        headless: { type: 'boolean' },
        'storage-state': { type: 'string' },
        'session-storage-state': { type: 'string' },
        'timeout-ms': { type: 'string' },
        'max-steps': { type: 'string' },
        'allow-mutating-steps': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });

    if (parsed.values.help) {
      printHelp();
      return;
    }

    const url = parsed.values.url ?? parsed.positionals[0];
    const outputPath = parsed.values.output ?? parsed.positionals[1];
    if (!url || !outputPath) {
      printHelp();
      throw new Error('Missing required journey record --url <url> --output <journey-config.json>.');
    }

    const result = await recordJourney({
      url,
      outputPath,
      name: parsed.values.name,
      browser: normalizeBrowser(parsed.values.browser) ?? 'chromium',
      headless: parsed.values.headless ? true : parsed.values.headed ? false : undefined,
      storageState: parsed.values['storage-state'],
      sessionStorageState: parsed.values['session-storage-state'],
      timeoutMs: normalizePositiveNumber(parsed.values['timeout-ms'], '--timeout-ms'),
      maxSteps: normalizePositiveNumber(parsed.values['max-steps'], '--max-steps'),
      allowMutatingSteps: parsed.values['allow-mutating-steps']
    });

    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Journey recorded: ${result.outputPath}`);
      console.log(`Review: ${result.reviewPath}`);
      console.log(`Events/steps: ${result.eventCount}/${result.stepCount}; dangerous ${result.dangerousStepCount}; redacted ${result.redactedValueCount}`);
      console.log(`Replay: node dist/cli.js qa --url ${JSON.stringify(url)} --config ${JSON.stringify(result.outputPath)} --journeys --output "reports/frontlens/recorded-journey" --no-trace --json`);
    }
    return;
  }

  if (argv[0] === 'requirements') {
    const subcommand = argv[1];
    if (subcommand !== 'synthesize') {
      printHelp();
      throw new Error(`Unsupported requirements command: ${subcommand ?? '(missing)'}. Expected: frontlens requirements synthesize --input <prd.md> --output <requirements.json>.`);
    }
    const parsed = parseArgs({
      args: argv.slice(2),
      allowPositionals: true,
      options: {
        input: { type: 'string' },
        text: { type: 'string' },
        output: { type: 'string' },
        prefix: { type: 'string' },
        'infer-from-page': { type: 'boolean' },
        'no-infer-from-page': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });
    if (parsed.values.help) {
      printHelp();
      return;
    }
    const inputPath = parsed.values.input ?? parsed.positionals[0];
    const inlineText = parsed.values.text;
    if (!inputPath && !inlineText) {
      throw new Error('Missing requirements synthesize --input <prd.md> or --text <acceptance text>.');
    }
    const result = await synthesizeRequirements({
      inputPath,
      text: inlineText,
      outputPath: parsed.values.output,
      prefix: parsed.values.prefix,
      inferFromPage: parsed.values['no-infer-from-page'] ? false : parsed.values['infer-from-page']
    });
    if (parsed.values.json || !parsed.values.output) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Requirements synthesized: ${parsed.values.output}`);
      console.log(`Requirements: ${result.requirementCount}, executable signals: ${result.executableAssertionCount}, needs review: ${result.needsReviewCount}`);
      console.log(`Review notes: ${result.questions.length} question(s)`);
    }
    return;
  }

  if (argv[0] === 'env-compare') {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        'dev-url': { type: 'string' },
        'preview-url': { type: 'string' },
        config: { type: 'string' },
        requirements: { type: 'string' },
        'source-root': { type: 'string' },
        'source-run-scripts': { type: 'boolean' },
        'source-scripts': { type: 'string' },
        'source-script-timeout-ms': { type: 'string' },
        output: { type: 'string' },
        'report-profile': { type: 'string' },
        browser: { type: 'string' },
        headed: { type: 'boolean' },
        headless: { type: 'boolean' },
        'storage-state': { type: 'string' },
        'session-storage-state': { type: 'string' },
        trace: { type: 'boolean' },
        'no-trace': { type: 'boolean' },
        video: { type: 'boolean' },
        screenshot: { type: 'boolean' },
        'simulate-exceptions': { type: 'boolean' },
        'no-exceptions': { type: 'boolean' },
        ai: { type: 'boolean' },
        'no-ai': { type: 'boolean' },
        coverage: { type: 'boolean' },
        'no-coverage': { type: 'boolean' },
        security: { type: 'boolean' },
        'no-security': { type: 'boolean' },
        journeys: { type: 'boolean' },
        'no-journeys': { type: 'boolean' },
        contract: { type: 'boolean' },
        'no-contract': { type: 'boolean' },
        realtime: { type: 'boolean' },
        'no-realtime': { type: 'boolean' },
        p2: { type: 'boolean' },
        'no-p2': { type: 'boolean' },
        'block-mutating-requests': { type: 'boolean' },
        'allow-mutating-requests': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });

    if (parsed.values.help) {
      printHelp();
      return;
    }

    const devUrl = parsed.values['dev-url'] ?? parsed.positionals[0];
    const previewUrl = parsed.values['preview-url'] ?? parsed.positionals[1];
    if (!devUrl || !previewUrl) {
      printHelp();
      throw new Error('Missing required env-compare --dev-url <url> --preview-url <url>.');
    }
    const result = await runEnvironmentComparison({
      devUrl,
      previewUrl,
      configPath: parsed.values.config,
      requirementsPath: parsed.values.requirements,
      sourceRoot: parsed.values['source-root'],
      sourceRunScripts: parsed.values['source-run-scripts'],
      sourceScripts: normalizeStringList(parsed.values['source-scripts']),
      sourceScriptTimeoutMs: normalizePositiveNumber(parsed.values['source-script-timeout-ms'], '--source-script-timeout-ms'),
      outputDir: parsed.values.output,
      reportProfile: normalizeReportProfile(parsed.values['report-profile']),
      browser: normalizeBrowser(parsed.values.browser),
      headless: parsed.values.headed ? false : parsed.values.headless,
      storageState: parsed.values['storage-state'],
      sessionStorageState: parsed.values['session-storage-state'],
      trace: parsed.values['no-trace'] ? false : parsed.values.trace,
      video: parsed.values.video,
      screenshot: parsed.values.screenshot,
      simulateExceptions: parsed.values['no-exceptions'] ? false : parsed.values['simulate-exceptions'],
      ai: parsed.values['no-ai'] ? false : parsed.values.ai,
      coverage: parsed.values['no-coverage'] ? false : parsed.values.coverage,
      security: parsed.values['no-security'] ? false : parsed.values.security,
      journeys: parsed.values['no-journeys'] ? false : parsed.values.journeys,
      contract: parsed.values['no-contract'] ? false : parsed.values.contract,
      realtime: parsed.values['no-realtime'] ? false : parsed.values.realtime,
      p2: parsed.values['no-p2'] ? false : parsed.values.p2,
      blockMutatingRequests: parsed.values['allow-mutating-requests'] ? false : parsed.values['block-mutating-requests']
    });
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Environment comparison completed: ${result.outputDir}`);
      console.log(`Production readiness: ${result.interpretation.productionReadiness}`);
      console.log(`Persistent/dev-only/preview-only issues: ${result.interpretation.persistentIssueCount}/${result.interpretation.devOnlyIssueCount}/${result.interpretation.previewOnlyIssueCount}`);
      console.log(`Markdown: ${result.artifacts.markdown}`);
      console.log(`JSON: ${result.artifacts.json}`);
    }
    return;
  }

  if (argv[0] === 'role-matrix') {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        config: { type: 'string' },
        requirements: { type: 'string' },
        'source-root': { type: 'string' },
        'source-run-scripts': { type: 'boolean' },
        'source-scripts': { type: 'string' },
        'source-script-timeout-ms': { type: 'string' },
        output: { type: 'string' },
        'report-profile': { type: 'string' },
        browser: { type: 'string' },
        headed: { type: 'boolean' },
        headless: { type: 'boolean' },
        role: { type: 'string', multiple: true },
        roles: { type: 'string' },
        trace: { type: 'boolean' },
        'no-trace': { type: 'boolean' },
        video: { type: 'boolean' },
        screenshot: { type: 'boolean' },
        'simulate-exceptions': { type: 'boolean' },
        'no-exceptions': { type: 'boolean' },
        ai: { type: 'boolean' },
        'no-ai': { type: 'boolean' },
        coverage: { type: 'boolean' },
        'no-coverage': { type: 'boolean' },
        security: { type: 'boolean' },
        'no-security': { type: 'boolean' },
        journeys: { type: 'boolean' },
        'no-journeys': { type: 'boolean' },
        contract: { type: 'boolean' },
        'no-contract': { type: 'boolean' },
        realtime: { type: 'boolean' },
        'no-realtime': { type: 'boolean' },
        p2: { type: 'boolean' },
        'no-p2': { type: 'boolean' },
        'block-mutating-requests': { type: 'boolean' },
        'allow-mutating-requests': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' }
      }
    });

    if (parsed.values.help) {
      printHelp();
      return;
    }

    const url = parsed.values.url ?? parsed.positionals[0];
    if (!url) {
      printHelp();
      throw new Error('Missing required role-matrix --url <url>.');
    }
    const roles = await resolveRoleMatrixRoles(parsed.values.role, parsed.values.roles);
    if (roles.length === 0) {
      throw new Error('Missing role matrix roles. Use --role admin=.auth/admin.json, --role viewer=.auth/viewer.json, or --roles roles.json.');
    }
    const result = await runRoleMatrix({
      url,
      configPath: parsed.values.config,
      requirementsPath: parsed.values.requirements,
      sourceRoot: parsed.values['source-root'],
      sourceRunScripts: parsed.values['source-run-scripts'],
      sourceScripts: normalizeStringList(parsed.values['source-scripts']),
      sourceScriptTimeoutMs: normalizePositiveNumber(parsed.values['source-script-timeout-ms'], '--source-script-timeout-ms'),
      outputDir: parsed.values.output,
      reportProfile: normalizeReportProfile(parsed.values['report-profile']),
      browser: normalizeBrowser(parsed.values.browser),
      headless: parsed.values.headed ? false : parsed.values.headless,
      roles,
      trace: parsed.values['no-trace'] ? false : parsed.values.trace,
      video: parsed.values.video,
      screenshot: parsed.values.screenshot,
      simulateExceptions: parsed.values['no-exceptions'] ? false : parsed.values['simulate-exceptions'],
      ai: parsed.values['no-ai'] ? false : parsed.values.ai,
      coverage: parsed.values['no-coverage'] ? false : parsed.values.coverage,
      security: parsed.values['no-security'] ? false : parsed.values.security,
      journeys: parsed.values['no-journeys'] ? false : parsed.values.journeys,
      contract: parsed.values['no-contract'] ? false : parsed.values.contract,
      realtime: parsed.values['no-realtime'] ? false : parsed.values.realtime,
      p2: parsed.values['no-p2'] ? false : parsed.values.p2,
      blockMutatingRequests: parsed.values['allow-mutating-requests'] ? false : parsed.values['block-mutating-requests']
    });
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Role matrix QA completed: ${result.outputDir}`);
      console.log(`Roles success/failed: ${result.comparison.successfulRoleCount}/${result.comparison.failedRoleCount}`);
      console.log(`Permission risk candidates: ${result.comparison.permissionRiskCount}`);
      console.log(`Markdown: ${result.artifacts.markdown}`);
      console.log(`JSON: ${result.artifacts.json}`);
    }
    return;
  }

  if (argv[0] === 'matrix') {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        config: { type: 'string' },
        requirements: { type: 'string' },
        'source-root': { type: 'string' },
        output: { type: 'string' },
        'report-profile': { type: 'string' },
        browsers: { type: 'string' },
        headed: { type: 'boolean' },
        headless: { type: 'boolean' },
        'storage-state': { type: 'string' },
        'session-storage-state': { type: 'string' },
        trace: { type: 'boolean' },
        'no-trace': { type: 'boolean' },
        video: { type: 'boolean' },
        screenshot: { type: 'boolean' },
        'simulate-exceptions': { type: 'boolean' },
        'no-exceptions': { type: 'boolean' },
        ai: { type: 'boolean' },
        'no-ai': { type: 'boolean' },
        coverage: { type: 'boolean' },
        'no-coverage': { type: 'boolean' },
        security: { type: 'boolean' },
        'no-security': { type: 'boolean' },
        journeys: { type: 'boolean' },
        'no-journeys': { type: 'boolean' },
        contract: { type: 'boolean' },
        'no-contract': { type: 'boolean' },
        realtime: { type: 'boolean' },
        'no-realtime': { type: 'boolean' },
        p2: { type: 'boolean' },
        'no-p2': { type: 'boolean' },
        'block-mutating-requests': { type: 'boolean' },
        'allow-mutating-requests': { type: 'boolean' },
        json: { type: 'boolean' },
        'fail-on-browser-failure': { type: 'boolean' },
        'gate-mode': { type: 'string' },
        'fail-on': { type: 'string' },
        'min-score': { type: 'string' },
        help: { type: 'boolean', short: 'h' }
      }
    });

    if (parsed.values.help) {
      printHelp();
      return;
    }

    const url = parsed.values.url ?? parsed.positionals[0];
    if (!url) {
      printHelp();
      throw new Error('Missing required matrix --url <url>.');
    }
    const browsers = (parsed.values.browsers ?? 'chromium,firefox,webkit')
      .split(',')
      .map((item) => normalizeBrowser(item.trim()))
      .filter((item): item is BrowserName => Boolean(item));
    if (browsers.length === 0) {
      throw new Error('Invalid --browsers: expected at least one of chromium, firefox, webkit.');
    }
    const uniqueBrowsers = [...new Set(browsers)];
    const matrixGateMode = normalizeGateMode(parsed.values['gate-mode']);
    const matrixFailOn = requireSeverity(parsed.values['fail-on'], '--fail-on');
    const matrixMinScore = parsed.values['min-score'] === undefined ? undefined : Number(parsed.values['min-score']);
    if (matrixMinScore !== undefined && (!Number.isFinite(matrixMinScore) || matrixMinScore < 0 || matrixMinScore > 100)) {
      throw new Error(`Invalid --min-score: ${parsed.values['min-score']}. Expected a number between 0 and 100.`);
    }
    const result = await runCompatibility({
      url,
      configPath: parsed.values.config,
      requirementsPath: parsed.values.requirements,
      sourceRoot: parsed.values['source-root'],
      outputDir: parsed.values.output,
      reportProfile: normalizeReportProfile(parsed.values['report-profile']),
      browsers: uniqueBrowsers,
      headless: parsed.values.headed ? false : parsed.values.headless,
      storageState: parsed.values['storage-state'],
      sessionStorageState: parsed.values['session-storage-state'],
      trace: parsed.values['no-trace'] ? false : parsed.values.trace,
      video: parsed.values.video,
      screenshot: parsed.values.screenshot,
      simulateExceptions: parsed.values['no-exceptions'] ? false : parsed.values['simulate-exceptions'],
      ai: parsed.values['no-ai'] ? false : parsed.values.ai,
      coverage: parsed.values['no-coverage'] ? false : parsed.values.coverage,
      security: parsed.values['no-security'] ? false : parsed.values.security,
      journeys: parsed.values['no-journeys'] ? false : parsed.values.journeys,
      contract: parsed.values['no-contract'] ? false : parsed.values.contract,
      realtime: parsed.values['no-realtime'] ? false : parsed.values.realtime,
      p2: parsed.values['no-p2'] ? false : parsed.values.p2,
      blockMutatingRequests: parsed.values['allow-mutating-requests'] ? false : parsed.values['block-mutating-requests']
    });
    const browserFailure = parsed.values['fail-on-browser-failure'] ? result.browsers.some((item) => !item.success) : result.browsers.every((item) => !item.success);
    const matrixGateEvaluations = result.browsers.map((item) => ({ browser: item.browser, ...evaluateMatrixItemCiGate({ item, failOn: matrixFailOn, minScore: matrixMinScore, mode: matrixGateMode }) }));
    const scoreFailure = matrixGateEvaluations.some((item) => item.failedByScore);
    const severityFailure = matrixGateEvaluations.some((item) => item.failedBySeverity);
    const matrixCiGate = {
      mode: matrixGateMode,
      status: browserFailure || scoreFailure || severityFailure ? 'failed' : 'passed',
      failedByBrowser: browserFailure,
      failedByScore: scoreFailure,
      failedBySeverity: severityFailure,
      failOn: matrixFailOn,
      minScore: matrixMinScore,
      browsers: matrixGateEvaluations
    };
    if (parsed.values.json) {
      console.log(JSON.stringify({ ...result, ciGate: matrixCiGate }, null, 2));
    } else {
      console.log(`Compatibility QA completed: ${result.outputDir}`);
      for (const item of result.browsers) {
        console.log(`${item.browser}: ${item.success ? `${item.adjustedScore ?? item.score}/100 adjusted, raw ${item.score}/100, ${item.issueCount} issues` : `failed: ${item.error}`}`);
      }
      console.log(`Gate: ${matrixCiGate.status} (${matrixGateMode})`);
    }
    if (browserFailure || scoreFailure || severityFailure) {
      process.exitCode = 2;
    }
    return;
  }

  const command = argv[0] === 'qa' ? 'qa' : 'qa';
  const args = argv[0] === 'qa' ? argv.slice(1) : argv;

  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      config: { type: 'string' },
      requirements: { type: 'string' },
      'source-root': { type: 'string' },
      'source-run-scripts': { type: 'boolean' },
      'source-scripts': { type: 'string' },
      'source-script-timeout-ms': { type: 'string' },
      output: { type: 'string' },
      'report-profile': { type: 'string' },
      browser: { type: 'string' },
      headed: { type: 'boolean' },
      headless: { type: 'boolean' },
      'storage-state': { type: 'string' },
      'session-storage-state': { type: 'string' },
      trace: { type: 'boolean' },
      'no-trace': { type: 'boolean' },
      video: { type: 'boolean' },
      screenshot: { type: 'boolean' },
      'simulate-exceptions': { type: 'boolean' },
      'no-exceptions': { type: 'boolean' },
      ai: { type: 'boolean' },
      'no-ai': { type: 'boolean' },
      coverage: { type: 'boolean' },
      'no-coverage': { type: 'boolean' },
      security: { type: 'boolean' },
      'no-security': { type: 'boolean' },
      journeys: { type: 'boolean' },
      'no-journeys': { type: 'boolean' },
      contract: { type: 'boolean' },
      'no-contract': { type: 'boolean' },
      realtime: { type: 'boolean' },
      'no-realtime': { type: 'boolean' },
      p2: { type: 'boolean' },
      'no-p2': { type: 'boolean' },
      'block-mutating-requests': { type: 'boolean' },
      'allow-mutating-requests': { type: 'boolean' },
      json: { type: 'boolean' },
      'gate-mode': { type: 'string' },
      'fail-on': { type: 'string' },
      'min-score': { type: 'string' },
      help: { type: 'boolean', short: 'h' }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  if (command !== 'qa') {
    throw new Error(`Unsupported command: ${command}`);
  }

  const url = parsed.values.url ?? parsed.positionals[0];
  if (!url) {
    printHelp();
    throw new Error('Missing required --url <url>.');
  }
  const gateMode = normalizeGateMode(parsed.values['gate-mode']);
  const failOn = requireSeverity(parsed.values['fail-on'], '--fail-on');
  const minScore = parsed.values['min-score'] === undefined ? undefined : Number(parsed.values['min-score']);
  if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) {
    throw new Error(`Invalid --min-score: ${parsed.values['min-score']}. Expected a number between 0 and 100.`);
  }

  const input: QaRunInput = {
    url,
    configPath: parsed.values.config,
    requirementsPath: parsed.values.requirements,
    sourceRoot: parsed.values['source-root'],
    sourceRunScripts: parsed.values['source-run-scripts'],
    sourceScripts: normalizeStringList(parsed.values['source-scripts']),
    sourceScriptTimeoutMs: normalizePositiveNumber(parsed.values['source-script-timeout-ms'], '--source-script-timeout-ms'),
    outputDir: parsed.values.output,
    reportProfile: normalizeReportProfile(parsed.values['report-profile']),
    browser: normalizeBrowser(parsed.values.browser),
    headless: parsed.values.headed ? false : parsed.values.headless,
    storageState: parsed.values['storage-state'],
    sessionStorageState: parsed.values['session-storage-state'],
    trace: parsed.values['no-trace'] ? false : parsed.values.trace,
    video: parsed.values.video,
    screenshot: parsed.values.screenshot,
    simulateExceptions: parsed.values['no-exceptions'] ? false : parsed.values['simulate-exceptions'],
    ai: parsed.values['no-ai'] ? false : parsed.values.ai,
    coverage: parsed.values['no-coverage'] ? false : parsed.values.coverage,
    security: parsed.values['no-security'] ? false : parsed.values.security,
    journeys: parsed.values['no-journeys'] ? false : parsed.values.journeys,
    contract: parsed.values['no-contract'] ? false : parsed.values.contract,
    realtime: parsed.values['no-realtime'] ? false : parsed.values.realtime,
    p2: parsed.values['no-p2'] ? false : parsed.values.p2,
    blockMutatingRequests: parsed.values['allow-mutating-requests'] ? false : parsed.values['block-mutating-requests']
  };

  const result = await runQa(input);
  const ciGate = evaluateQaCiGate({ result, failOn, minScore, mode: gateMode });
  const exitStatus = ciGate.status;
  if (parsed.values.json) {
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          artifacts: result.artifacts,
          security: {
            status: result.security.status,
            score: result.security.score,
            summary: result.security.summary
          },
          apiContract: result.apiContract.summary,
          realtime: result.realtime.summary,
          requirementCoverage: result.requirementCoverage.summary,
          environment: {
            kind: result.environment.kind,
            confidence: result.environment.confidence,
            trust: result.environment.trust,
            isViteDevServer: result.environment.isViteDevServer,
            isLocalOrPrivate: result.environment.isLocalOrPrivate
          },
          pageProfile: {
            status: result.pageProfile.status,
            pageType: result.pageProfile.pageType,
            confidence: result.pageProfile.confidence,
            source: result.pageProfile.source,
            questions: result.pageProfile.questions
          },
          scopeReview: {
            status: result.scopeReview.status,
            confidence: result.scopeReview.confidence,
            questionCount: result.scopeReview.questions.length,
            summary: result.scopeReview.summary
          },
          claimGuard: {
            status: result.claimGuard.status,
            forbiddenCount: result.claimGuard.forbiddenClaims.length,
            requiredInputCount: result.claimGuard.requiredInputs.length,
            summary: result.claimGuard.summary
          },
          qaIntake: {
            status: result.qaIntake.status,
            questionCount: result.qaIntake.questions.length,
            topQuestionCount: result.qaIntake.topQuestions.length,
            summary: result.qaIntake.summary,
            topQuestions: result.qaIntake.topQuestions.map((item) => ({ id: item.id, priority: item.priority, category: item.category, question: item.question }))
          },
          defectProof: {
            status: result.defectProof.status,
            counts: result.defectProof.counts,
            summary: result.defectProof.summary
          },
          reportContentAudit: {
            status: result.reportContentAudit.status,
            profile: result.reportContentAudit.profile,
            summary: result.reportContentAudit.summary
          },
          journeyAssertionAudit: {
            status: result.journeyAssertionAudit.status,
            summary: result.journeyAssertionAudit.summary
          },
          testData: {
            status: result.testData.status,
            environment: result.testData.environment,
            summary: result.testData.summary,
            findingCount: result.testData.findings.length
          },
          sourceHealth: {
            status: result.sourceHealth.status,
            syntaxErrorCount: result.sourceHealth.syntaxErrorCount,
            parsedFiles: result.sourceHealth.parsedFiles,
            scriptChecks: result.sourceHealth.scriptChecks.map((check) => ({ id: check.id, scriptName: check.scriptName, status: check.status, category: check.category, durationMs: check.durationMs }))
          },
          artifactIntegrity: result.artifactIntegrity,
          rootCauseGroups: {
            total: result.rootCauseGroups.length,
            actionable: result.rootCauseGroups.filter((group) => group.status === 'actionable').length,
            reference: result.rootCauseGroups.filter((group) => group.status === 'reference').length
          },
          issueDisposition: result.issueDisposition.summary,
          fixTaskCount: result.fixTasks.length,
          professionalSummary: {
            status: result.professionalSummary.status,
            headline: result.professionalSummary.headline,
            counts: result.professionalSummary.counts
          },
          assertionSuggestions: {
            status: result.assertionSuggestions.status,
            summary: result.assertionSuggestions.summary
          },
          testCases: {
            status: result.testCases.status,
            summary: result.testCases.summary
          },
          defectTickets: {
            status: result.defectTickets.status,
            counts: result.defectTickets.counts
          },
          traceability: {
            status: result.traceability.status,
            summary: result.traceability.summary
          },
          automationSpecs: {
            status: result.automationSpecs.status,
            summary: result.automationSpecs.summary
          },
          regressionPlan: {
            status: result.regressionPlan.status,
            summary: result.regressionPlan.summary
          },
          qualityGate: result.qualityGate,
          qaSignoff: result.qaSignoff,
          ciGate,
          exitStatus,
          gateMode,
          failOn,
          minScore
        },
        null,
        2
      )
    );
  } else {
    console.log(`\nFrontLens QA completed`);
    console.log(`Adjusted score: ${result.summary.adjustedScore}/100 (${result.summary.adjustedIssueCount} ${result.summary.scoreBasis} findings)`);
    console.log(`Raw score: ${result.summary.score}/100 (${result.summary.issueCount} raw findings)`);
    console.log(`CI Gate: ${ciGate.status} (${ciGate.mode}, score field ${ciGate.scoreField})`);
    console.log(`Security: ${result.security.status}, ${result.security.score}/100 (${result.security.summary.failedCount} failed, ${result.security.summary.warningCount} warnings)`);
    console.log(`API Contract: ${result.apiContract.summary.endpointCount} endpoints, ${result.apiContract.summary.schemaMismatchCount + result.apiContract.summary.statusMismatchCount + result.apiContract.summary.undocumentedCount} findings`);
    console.log(`Realtime: ${result.realtime.summary.graphqlOperationCount} GraphQL, ${result.realtime.summary.webSocketCount} WS, ${result.realtime.summary.sseCount} SSE`);
    console.log(`Requirement coverage: ${result.requirementCoverage.summary.passedCount}/${result.requirementCoverage.summary.requirementCount} passed, ${result.requirementCoverage.summary.highPriorityGapCount} high-priority gaps`);
    console.log(`Test Data: ${result.testData.status}, env ${result.testData.environment}, records ${result.testData.summary.recordCount}, cleanup gaps ${result.testData.summary.missingCleanupCount}`);
    console.log(`Environment: ${result.environment.kind}, trust perf/security ${result.environment.trust.performance}/${result.environment.trust.security}`);
    console.log(`Page profile: ${result.pageProfile.status}/${result.pageProfile.pageType} (${result.pageProfile.confidence})`);
    console.log(`Scope Review: ${result.scopeReview.status}, questions ${result.scopeReview.questions.length}`);
    console.log(`Claim Guard: ${result.claimGuard.status}, forbidden ${result.claimGuard.forbiddenClaims.length}, required inputs ${result.claimGuard.requiredInputs.length}`);
    console.log(`QA Intake: ${result.qaIntake.status}, questions ${result.qaIntake.questions.length}, top ${result.qaIntake.topQuestions.length}`);
    console.log(`Defect Proof: ${result.defectProof.status}, proven ${result.defectProof.counts.proven}, needs-evidence ${result.defectProof.counts.needsEvidence}`);
    console.log(`Report Content Audit: ${result.reportContentAudit.status}, blockers ${result.reportContentAudit.summary.blockerCount}, warnings ${result.reportContentAudit.summary.warningCount}`);
    console.log(`Journey Assertion Audit: ${result.journeyAssertionAudit.status}, runtime-verified ${result.journeyAssertionAudit.summary.runtimeVerifiedJourneyCount}, path-only ${result.journeyAssertionAudit.summary.pathOnlyJourneyCount}, weak ${result.journeyAssertionAudit.summary.weaklyAssertedJourneyCount}`);
    const failedScriptChecks = result.sourceHealth.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out').length;
    console.log(`Source Health: ${result.sourceHealth.status}, syntax errors ${result.sourceHealth.syntaxErrorCount}, script checks ${result.sourceHealth.scriptChecks.length} (${failedScriptChecks} failed/timed-out)`);
    console.log(`Artifact Integrity: ${result.artifactIntegrity.status}, missing ${result.artifactIntegrity.missingCount}`);
    console.log(`Root causes: ${result.professionalSummary.counts.proofReadyRootCauseCount} proof-ready / ${result.rootCauseGroups.filter((group) => group.status === 'actionable').length} actionable / ${result.rootCauseGroups.length} total`);
    console.log(`Disposition: ${result.issueDisposition.summary.actionableCount} actionable, ${result.issueDisposition.summary.conditionalCount} conditional, ${result.issueDisposition.summary.nonActionableCount} non-actionable`);
    console.log(`Fix tasks: ${result.fixTasks.length}`);
    console.log(`Professional Summary: ${result.professionalSummary.status}, must-fix ${result.professionalSummary.mustFix.length}, non-defect buckets ${result.professionalSummary.nonDefectObservations.length}`);
    console.log(`Regression Plan: ${result.regressionPlan.status}, items ${result.regressionPlan.summary.itemCount}, blocked ${result.regressionPlan.summary.blockedCount}`);
    console.log(`Assertion Suggestions: ${result.assertionSuggestions.status}, suggestions ${result.assertionSuggestions.summary.totalCount}, weak journeys ${result.assertionSuggestions.summary.weakJourneyCount}`);
    console.log(`Test Cases: ${result.testCases.status}, total ${result.testCases.summary.totalCount}, failed+blocked ${result.testCases.summary.failedCount + result.testCases.summary.blockedCount}, needs-input ${result.testCases.summary.needsInputCount}`);
    console.log(`Defect Tickets: ${result.defectTickets.status}, tickets ${result.defectTickets.counts.total}, suppressed needs-evidence ${result.defectTickets.counts.suppressedNeedsEvidence}`);
    console.log(`Traceability: ${result.traceability.status}, requirements ${result.traceability.summary.requirementCount}, high-priority gaps ${result.traceability.summary.highPriorityGapCount}`);
    console.log(`Automation Specs: ${result.automationSpecs.status}, drafts ${result.automationSpecs.summary.draftCount}, ready ${result.automationSpecs.summary.readyCount}, needs-input ${result.automationSpecs.summary.needsInputCount}`);
    console.log(`Risk Register: ${result.riskRegister.status}, risks ${result.riskRegister.summary.totalCount}, release-blocking ${result.riskRegister.summary.releaseBlockingCount}`);
    console.log(`Risk Acceptance: ${result.riskAcceptance.status}, must-mitigate ${result.riskAcceptance.summary.mustMitigateCount}, needs-acceptance ${result.riskAcceptance.summary.acceptanceRequiredCount}`);
    console.log(`QA Gate: ${result.qualityGate.status}, confidence ${result.qualityGate.confidence}`);
    console.log(`QA Sign-off: ${result.qaSignoff.status}, confidence ${result.qaSignoff.confidence}, business ${result.qaSignoff.businessValidationConfidence}`);
    console.log(`Issues: ${result.summary.issueCount} (critical ${result.summary.criticalCount}, high ${result.summary.highCount}, medium ${result.summary.mediumCount}, low ${result.summary.lowCount})`);
    console.log(`Markdown: ${result.artifacts.markdownReport ?? '(disabled)'}`);
    console.log(`QA Review: ${result.artifacts.qaReview ?? '(disabled)'}`);
    console.log(`Scope Review: ${result.artifacts.scopeReview ?? '(disabled)'}`);
    console.log(`Claim Guard: ${result.artifacts.claimGuard ?? '(disabled)'}`);
    console.log(`QA Intake: ${result.artifacts.qaIntake ?? '(disabled)'}`);
    console.log(`Defect Proof: ${result.artifacts.defectProof ?? '(disabled)'}`);
    console.log(`Report Content Audit: ${result.artifacts.reportContentAudit ?? '(disabled)'}`);
    console.log(`Journey Assertion Audit: ${result.artifacts.journeyAssertionAudit ?? '(disabled)'}`);
    console.log(`Assertion Suggestions: ${result.artifacts.assertionSuggestions ?? '(disabled)'}`);
    console.log(`Test Cases: ${result.artifacts.testCases ?? '(disabled)'}`);
    console.log(`Risk Register: ${result.artifacts.riskRegister ?? '(disabled)'}`);
    console.log(`Risk Acceptance: ${result.artifacts.riskAcceptance ?? '(disabled)'}`);
    console.log(`Defect Tickets: ${result.artifacts.defectTickets ?? '(disabled)'}`);
    console.log(`Traceability: ${result.artifacts.traceability ?? '(disabled)'}`);
    console.log(`Automation Specs: ${result.artifacts.automationSpecs ?? '(disabled)'}`);
    console.log(`Automation Spec File: ${result.artifacts.automationSpecFile ?? '(disabled)'}`);
    console.log(`JSON: ${result.artifacts.jsonReport ?? '(disabled)'}`);
    if (result.artifacts.htmlReport) {
      console.log(`HTML: ${result.artifacts.htmlReport}`);
    }
  }
  if (exitStatus === 'failed') {
    process.exitCode = 2;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
