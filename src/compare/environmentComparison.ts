import path from 'node:path';
import { createDefaultConfig } from '../defaultConfig.js';
import { createResultDiff } from '../diff/resultDiff.js';
import { runQa } from '../runner.js';
import type { BrowserName, EnvironmentComparisonResult, QaResult, QaRunInput, Severity } from '../types.js';
import { ensureDir, resolveOutputDir, writeJson, writeText } from '../utils/fs.js';
import { markdownEscape } from '../utils/text.js';

export interface EnvironmentComparisonRunInput {
  devUrl: string;
  previewUrl: string;
  outputDir?: string;
  configPath?: string;
  requirementsPath?: string;
  sourceRoot?: string;
  sourceRunScripts?: boolean;
  sourceScripts?: string[];
  sourceScriptTimeoutMs?: number;
  browser?: BrowserName;
  headless?: boolean;
  storageState?: string;
  sessionStorageState?: string;
  trace?: boolean;
  video?: boolean;
  screenshot?: boolean;
  simulateExceptions?: boolean;
  coverage?: boolean;
  ai?: boolean;
  blockMutatingRequests?: boolean;
  security?: boolean;
  journeys?: boolean;
  contract?: boolean;
  realtime?: boolean;
  p2?: boolean;
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolveOutputDir(path.join(createDefaultConfig().report.outputDir, '..', 'frontlens-env-compare', stamp));
}

function severityRank(severity: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity];
}

function summary(result: QaResult): EnvironmentComparisonResult['dev'] {
  return {
    url: result.summary.url,
    environmentKind: result.environment.kind,
    performanceTrust: result.environment.trust.performance,
    securityTrust: result.environment.trust.security,
    score: result.summary.score,
    issueCount: result.summary.issueCount,
    qaSignoffStatus: result.qaSignoff.status,
    qaSignoffConfidence: result.qaSignoff.confidence,
    reportPath: result.artifacts.markdownReport,
    jsonPath: result.artifacts.jsonReport
  };
}

function isDevArtifact(issue: QaResult['issues'][number]): boolean {
  const text = `${issue.title} ${issue.category} ${issue.description} ${issue.reason} ${issue.evidence.resourceUrl ?? ''} ${JSON.stringify(issue.evidence.details ?? {})}`.toLowerCase();
  return /vite|@vite\/client|\/src\/|node_modules\/\.vite|hmr|dev server|source-module|source module/.test(text);
}

function productionReadiness(dev: QaResult, preview: QaResult): EnvironmentComparisonResult['interpretation']['productionReadiness'] {
  if (preview.environment.isViteDevServer || preview.environment.kind === 'local-dev' || preview.environment.kind === 'file') return 'invalid-preview';
  if (preview.qaSignoff.status === 'blocked' || dev.qaSignoff.status === 'blocked') return 'blocked';
  if (preview.environment.trust.performance === 'high' && preview.environment.trust.security === 'high') return 'production-evidence';
  return 'pre-production-evidence';
}

function recommendations(dev: QaResult, preview: QaResult, result: EnvironmentComparisonResult): string[] {
  const items: string[] = [];
  if (dev.environment.isViteDevServer) {
    items.push('Dev run is Vite/source-module mode: use it for functional/source correlation, not production request count, transfer size, HMR/WebSocket, or source-path security conclusions.');
  }
  if (preview.environment.isViteDevServer || preview.environment.kind === 'local-dev') {
    items.push('Preview URL is still a dev server; run build + preview/static hosting before production performance/security sign-off.');
  } else if (preview.environment.trust.performance !== 'high' || preview.environment.trust.security !== 'high') {
    items.push('Preview is not production-equivalent for performance/security; rerun against HTTPS staging/production-like domain before release sign-off.');
  }
  if (result.interpretation.persistentIssueCount > 0) {
    items.push('Persistent issues across dev and preview have higher confidence; prioritize persistent Critical/High and source-confirmed findings first.');
  }
  if (result.interpretation.previewOnlyIssueCount > 0) {
    items.push('Preview-only findings are production-build/deployment candidates; inspect bundle, routing, security headers, CDN, and static asset behavior.');
  }
  if (result.interpretation.devOnlyIssueCount > 0) {
    items.push('Dev-only findings should be downgraded unless source analysis confirms a real implementation problem such as eager route imports or missing error handling.');
  }
  if (preview.qaSignoff.status === 'fail' || preview.qaSignoff.status === 'blocked') {
    items.push(`Preview QA sign-off is ${preview.qaSignoff.status}; resolve preview blockers before release.`);
  }
  return [...new Set(items)];
}

function markdown(result: EnvironmentComparisonResult): string {
  const persistentRows = result.diff.persistentIssues.slice(0, 30).map((item) => `| ${item.after.severity} | ${markdownEscape(item.after.category)} | ${markdownEscape(item.after.title)} | ${markdownEscape(item.after.fingerprint ?? '-')} |`);
  const previewOnlyRows = result.diff.addedIssues.slice(0, 30).map((issue) => `| ${issue.severity} | ${markdownEscape(issue.category)} | ${markdownEscape(issue.title)} | ${markdownEscape(issue.fingerprint ?? '-')} |`);
  const devOnlyRows = result.diff.resolvedIssues.slice(0, 30).map((issue) => `| ${issue.severity} | ${markdownEscape(issue.category)} | ${markdownEscape(issue.title)} | ${markdownEscape(issue.fingerprint ?? '-')} |`);
  return `# FrontLens Environment Comparison

This report separates dev/source-module evidence from build/preview evidence. Use preview for production bundle/security/performance conclusions and dev for source correlation unless a finding persists in both.

## Summary

| Run | URL | Env | Perf trust | Security trust | Score | Issues | QA Sign-off | Report |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dev | ${markdownEscape(result.dev.url)} | ${result.dev.environmentKind} | ${result.dev.performanceTrust} | ${result.dev.securityTrust} | ${result.dev.score} | ${result.dev.issueCount} | ${result.dev.qaSignoffStatus}/${result.dev.qaSignoffConfidence} | ${result.dev.reportPath ? `\`${markdownEscape(result.dev.reportPath)}\`` : '-'} |
| Preview | ${markdownEscape(result.preview.url)} | ${result.preview.environmentKind} | ${result.preview.performanceTrust} | ${result.preview.securityTrust} | ${result.preview.score} | ${result.preview.issueCount} | ${result.preview.qaSignoffStatus}/${result.preview.qaSignoffConfidence} | ${result.preview.reportPath ? `\`${markdownEscape(result.preview.reportPath)}\`` : '-'} |

- Production readiness: **${result.interpretation.productionReadiness}**
- Persistent / Dev-only / Preview-only issues: ${result.interpretation.persistentIssueCount} / ${result.interpretation.devOnlyIssueCount} / ${result.interpretation.previewOnlyIssueCount}
- High-confidence issue candidates: ${result.interpretation.highConfidenceIssueCount}
- Dev artifact candidates: ${result.interpretation.devArtifactIssueCount}
- Score delta (preview - dev): ${result.diff.scoreDelta}
- Security score delta: ${result.diff.securityScoreDelta ?? '-'}
- Transfer delta bytes: ${result.diff.performance.transferDeltaBytes ?? '-'}

## Recommendations

${result.recommendations.map((item) => `- ${markdownEscape(item)}`).join('\n') || '- None.'}

## Persistent Issues

${persistentRows.length ? ['| Severity | Category | Title | Fingerprint |', '| --- | --- | --- | --- |', ...persistentRows].join('\n') : 'None.'}

## Preview-only Issues

${previewOnlyRows.length ? ['| Severity | Category | Title | Fingerprint |', '| --- | --- | --- | --- |', ...previewOnlyRows].join('\n') : 'None.'}

## Dev-only Issues

${devOnlyRows.length ? ['| Severity | Category | Title | Fingerprint |', '| --- | --- | --- | --- |', ...devOnlyRows].join('\n') : 'None.'}
`;
}

export function createEnvironmentComparison(dev: QaResult, preview: QaResult, outputDir: string): EnvironmentComparisonResult {
  const diff = createResultDiff(dev, preview);
  const persistentHigh = diff.persistentIssues.filter((item) => severityRank(item.after.severity) <= severityRank('high')).length;
  const previewHigh = diff.addedIssues.filter((issue) => severityRank(issue.severity) <= severityRank('high')).length;
  const base: EnvironmentComparisonResult = {
    checkedAt: new Date().toISOString(),
    outputDir,
    dev: summary(dev),
    preview: summary(preview),
    diff,
    interpretation: {
      productionReadiness: 'pre-production-evidence',
      persistentIssueCount: diff.persistentIssues.length,
      devOnlyIssueCount: diff.resolvedIssues.length,
      previewOnlyIssueCount: diff.addedIssues.length,
      highConfidenceIssueCount: persistentHigh + previewHigh,
      devArtifactIssueCount: diff.resolvedIssues.filter(isDevArtifact).length
    },
    recommendations: [],
    artifacts: {
      json: path.join(outputDir, 'environment-comparison.json'),
      markdown: path.join(outputDir, 'environment-comparison.md'),
      devResult: dev.artifacts.jsonReport,
      previewResult: preview.artifacts.jsonReport
    }
  };
  base.interpretation.productionReadiness = productionReadiness(dev, preview);
  base.recommendations = recommendations(dev, preview, base);
  return base;
}

export async function writeEnvironmentComparison(result: EnvironmentComparisonResult): Promise<EnvironmentComparisonResult> {
  await ensureDir(result.outputDir);
  await writeJson(result.artifacts.json, result);
  await writeText(result.artifacts.markdown, markdown(result));
  return result;
}

function qaInput(input: EnvironmentComparisonRunInput, url: string, outputDir: string): QaRunInput {
  return {
    url,
    configPath: input.configPath,
    requirementsPath: input.requirementsPath,
    sourceRoot: input.sourceRoot,
    sourceRunScripts: input.sourceRunScripts,
    sourceScripts: input.sourceScripts,
    sourceScriptTimeoutMs: input.sourceScriptTimeoutMs,
    outputDir,
    browser: input.browser,
    headless: input.headless,
    storageState: input.storageState,
    sessionStorageState: input.sessionStorageState,
    trace: input.trace,
    video: input.video,
    screenshot: input.screenshot,
    simulateExceptions: input.simulateExceptions,
    coverage: input.coverage,
    ai: input.ai,
    blockMutatingRequests: input.blockMutatingRequests,
    security: input.security,
    journeys: input.journeys,
    contract: input.contract,
    realtime: input.realtime,
    p2: input.p2
  };
}

export async function runEnvironmentComparison(input: EnvironmentComparisonRunInput): Promise<EnvironmentComparisonResult> {
  const outputDir = input.outputDir ? resolveOutputDir(input.outputDir) : defaultOutputDir();
  await ensureDir(outputDir);
  const dev = await runQa(qaInput(input, input.devUrl, path.join(outputDir, 'dev')));
  const preview = await runQa(qaInput(input, input.previewUrl, path.join(outputDir, 'preview')));
  return writeEnvironmentComparison(createEnvironmentComparison(dev, preview, outputDir));
}
