#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { runQa } from './runner.js';
import { runCompatibility } from './matrix.js';
import { saveAuthState } from './auth.js';
import { startMcpServer } from './mcpServer.js';
import type { BrowserName, Issue, QaResult, QaRunInput, Severity } from './types.js';
import { normalizeResult } from './resultNormalizer.js';
import { createResultDiff, writeResultDiff } from './diff/resultDiff.js';

const CLI_VERSION = '0.1.0';
const COMMANDS = new Set(['qa', 'auth', 'matrix', 'mcp', 'inspect', 'issues', 'root-causes', 'network', 'coverage', 'security', 'fix-tasks', 'diff', 'suggestions', 'help', '--help', '-h', '--version', '-v']);

function printHelp(): void {
  console.log(`FrontLens - AI-oriented frontend QA analyzer

Usage:
  frontlens qa --url <url> [options]
  frontlens --url <url> [options]
  frontlens auth save --url <login-url> --output <storage-state-path>
  frontlens matrix --url <url> --browsers chromium,firefox,webkit
  frontlens mcp
  frontlens inspect --report <result.json>
  frontlens issues --report <result.json> [--severity high]
  frontlens root-causes --report <result.json>
  frontlens network --report <result.json>
  frontlens coverage --report <result.json>
  frontlens security --report <result.json>
  frontlens fix-tasks --report <result.json>
  frontlens diff --before <old/result.json> --after <new/result.json> [--output <dir>]
  frontlens suggestions --report <result.json>

Options:
  --url <url>                 Target page URL.
  --config <path>             Optional config file (.json/.js/.mjs).
  --requirements <path>       Optional requirements/acceptance criteria JSON file.
  --output <dir>              Output report directory.
  --browser <name>            chromium | firefox | webkit. Default: chromium.
  --headed                    Run headed browser.
  --headless                  Run headless browser.
  --storage-state <path>      Playwright storageState file.
  --session-storage-state <path>
                              FrontLens sessionStorage sidecar file.
  --browsers <list>           Browser list for matrix command.
  --report <path>             Existing result.json for inspect/issues/network/coverage/security/fix-tasks/suggestions.
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
  --fail-on <severity>        Exit non-zero if issues at severity or above exist.
  --min-score <number>        Exit non-zero if final score is lower than this number.
  --fail-on-browser-failure   Matrix: exit non-zero when any browser run fails.
  -h, --help                  Show help.

Auth options:
  --wait-ms <ms>              Non-TTY wait time before saving storage state. Default: 300000.

Examples:
  frontlens qa --url https://example.com
  frontlens qa --url https://example.com/admin --headed --output reports/admin
  frontlens qa --url https://example.com/admin --storage-state .frontlens/auth/admin.json
  frontlens auth save --url https://example.com/login --output .frontlens/auth/admin.json
  frontlens matrix --url https://example.com --browsers chromium,firefox,webkit --output reports/compat
  frontlens mcp
  frontlens issues --report reports/frontlens/users/result.json --severity high
  frontlens root-causes --report reports/frontlens/users/result.json
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
  return normalizeResult(JSON.parse(await readFile(reportPath, 'utf8')));
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

function printMcpHelp(): void {
  console.log(`FrontLens MCP server

Usage:
  frontlens mcp

Stdio MCP command:
  node dist/cli.js mcp

Exposed tools:
  frontlens_qa
  frontlens_matrix
  frontlens_inspect
  frontlens_issues
  frontlens_root_causes
  frontlens_network
  frontlens_coverage
  frontlens_security
  frontlens_fix_tasks
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

async function handleResultCommand(command: 'inspect' | 'issues' | 'root-causes' | 'network' | 'coverage' | 'security' | 'fix-tasks' | 'suggestions', args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      report: { type: 'string' },
      severity: { type: 'string' },
      json: { type: 'boolean' },
      full: { type: 'boolean' },
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
          requirementCoverage: result.requirementCoverage,
          artifactIntegrity: result.artifactIntegrity,
          rootCauseGroups: {
            total: result.rootCauseGroups.length,
            actionable: result.rootCauseGroups.filter((group) => group.status === 'actionable').length,
            reference: result.rootCauseGroups.filter((group) => group.status === 'reference').length
          },
          qualityGate: result.qualityGate
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

  const suggestions = result.issues
    .filter((issue: Issue) => issue.suggestion.frontend || issue.suggestion.backend || issue.suggestion.test || issue.suggestion.product)
    .map((issue) => ({
      id: issue.id,
      title: issue.title,
      severity: issue.severity,
      category: issue.category,
      suggestion: issue.suggestion
    }));
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

  if (argv[0] === 'inspect' || argv[0] === 'issues' || argv[0] === 'root-causes' || argv[0] === 'network' || argv[0] === 'coverage' || argv[0] === 'security' || argv[0] === 'fix-tasks' || argv[0] === 'suggestions') {
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

  if (argv[0] === 'matrix') {
    const parsed = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        url: { type: 'string' },
        config: { type: 'string' },
        requirements: { type: 'string' },
        output: { type: 'string' },
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
    const matrixFailOn = requireSeverity(parsed.values['fail-on'], '--fail-on');
    const matrixMinScore = parsed.values['min-score'] === undefined ? undefined : Number(parsed.values['min-score']);
    if (matrixMinScore !== undefined && (!Number.isFinite(matrixMinScore) || matrixMinScore < 0 || matrixMinScore > 100)) {
      throw new Error(`Invalid --min-score: ${parsed.values['min-score']}. Expected a number between 0 and 100.`);
    }
    const result = await runCompatibility({
      url,
      configPath: parsed.values.config,
      requirementsPath: parsed.values.requirements,
      outputDir: parsed.values.output,
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
    const scoreFailure = matrixMinScore !== undefined ? result.browsers.some((item) => item.success && (item.score ?? 0) < matrixMinScore) : false;
    const severityFailure = matrixFailOn
      ? result.browsers.some((item) => {
          const counts: Record<Severity, number> = {
            critical: item.criticalCount ?? 0,
            high: item.highCount ?? 0,
            medium: item.mediumCount ?? 0,
            low: item.lowCount ?? 0,
            info: item.infoCount ?? 0
          };
          return (Object.keys(counts) as Severity[]).some((severity) => severityRank(severity) <= severityRank(matrixFailOn) && counts[severity] > 0);
        })
      : false;
    if (parsed.values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Compatibility QA completed: ${result.outputDir}`);
      for (const item of result.browsers) {
        console.log(`${item.browser}: ${item.success ? `${item.score}/100, ${item.issueCount} issues` : `failed: ${item.error}`}`);
      }
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
      output: { type: 'string' },
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
  const failOn = requireSeverity(parsed.values['fail-on'], '--fail-on');
  const minScore = parsed.values['min-score'] === undefined ? undefined : Number(parsed.values['min-score']);
  if (minScore !== undefined && (!Number.isFinite(minScore) || minScore < 0 || minScore > 100)) {
    throw new Error(`Invalid --min-score: ${parsed.values['min-score']}. Expected a number between 0 and 100.`);
  }

  const input: QaRunInput = {
    url,
    configPath: parsed.values.config,
    requirementsPath: parsed.values.requirements,
    outputDir: parsed.values.output,
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
  const failedBySeverity = failOn ? result.issues.some((issue) => severityRank(issue.severity) <= severityRank(failOn)) : false;
  const failedByScore = minScore !== undefined ? result.summary.score < minScore : false;
  const exitStatus = failedBySeverity || failedByScore ? 'failed' : 'passed';
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
          artifactIntegrity: result.artifactIntegrity,
          rootCauseGroups: {
            total: result.rootCauseGroups.length,
            actionable: result.rootCauseGroups.filter((group) => group.status === 'actionable').length,
            reference: result.rootCauseGroups.filter((group) => group.status === 'reference').length
          },
          fixTaskCount: result.fixTasks.length,
          qualityGate: result.qualityGate,
          exitStatus,
          failOn,
          minScore
        },
        null,
        2
      )
    );
  } else {
    console.log(`\nFrontLens QA completed`);
    console.log(`Score: ${result.summary.score}/100`);
    console.log(`Security: ${result.security.status}, ${result.security.score}/100 (${result.security.summary.failedCount} failed, ${result.security.summary.warningCount} warnings)`);
    console.log(`API Contract: ${result.apiContract.summary.endpointCount} endpoints, ${result.apiContract.summary.schemaMismatchCount + result.apiContract.summary.statusMismatchCount + result.apiContract.summary.undocumentedCount} findings`);
    console.log(`Realtime: ${result.realtime.summary.graphqlOperationCount} GraphQL, ${result.realtime.summary.webSocketCount} WS, ${result.realtime.summary.sseCount} SSE`);
    console.log(`Requirement coverage: ${result.requirementCoverage.summary.passedCount}/${result.requirementCoverage.summary.requirementCount} passed, ${result.requirementCoverage.summary.highPriorityGapCount} high-priority gaps`);
    console.log(`Artifact Integrity: ${result.artifactIntegrity.status}, missing ${result.artifactIntegrity.missingCount}`);
    console.log(`Root causes: ${result.rootCauseGroups.filter((group) => group.status === 'actionable').length} actionable / ${result.rootCauseGroups.length} total`);
    console.log(`Fix tasks: ${result.fixTasks.length}`);
    console.log(`QA Gate: ${result.qualityGate.status}, confidence ${result.qualityGate.confidence}`);
    console.log(`Issues: ${result.summary.issueCount} (critical ${result.summary.criticalCount}, high ${result.summary.highCount}, medium ${result.summary.mediumCount}, low ${result.summary.lowCount})`);
    console.log(`Markdown: ${result.artifacts.markdownReport ?? '(disabled)'}`);
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
