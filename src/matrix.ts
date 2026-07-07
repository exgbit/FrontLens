import path from 'node:path';
import { createDefaultConfig } from './defaultConfig.js';
import { runQa } from './runner.js';
import type { BrowserName, QaResult } from './types.js';
import { ensureDir, resolveOutputDir, writeJson, writeText } from './utils/fs.js';
import { markdownEscape } from './utils/text.js';

export interface CompatibilityRunInput {
  url: string;
  outputDir?: string;
  configPath?: string;
  requirementsPath?: string;
  browsers: BrowserName[];
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

export interface CompatibilityRunItem {
  browser: BrowserName;
  success: boolean;
  outputDir: string;
  score?: number;
  issueCount?: number;
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  infoCount?: number;
  title?: string;
  componentCount?: number;
  screenshot?: string;
  jsonReport?: string;
  markdownReport?: string;
  error?: string;
}

export interface CompatibilityResult {
  url: string;
  testedAt: string;
  outputDir: string;
  browsers: CompatibilityRunItem[];
  differences: {
    titleMismatch: boolean;
    componentCountSpread: number;
    uniqueIssueTitlesByBrowser: Record<string, string[]>;
  };
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolveOutputDir(path.join(createDefaultConfig().report.outputDir, '..', 'frontlens-compatibility', stamp));
}

function issueTitles(result: QaResult): string[] {
  return result.issues.map((issue) => issue.title);
}

function buildDifferences(results: Array<{ browser: BrowserName; result?: QaResult }>): CompatibilityResult['differences'] {
  const successful = results.filter((item): item is { browser: BrowserName; result: QaResult } => Boolean(item.result));
  const titles = new Set(successful.map((item) => item.result.summary.title));
  const counts = successful.map((item) => item.result.pageModel.components.length);
  const allIssueTitles = new Set(successful.flatMap((item) => issueTitles(item.result)));
  const uniqueIssueTitlesByBrowser: Record<string, string[]> = {};

  for (const item of successful) {
    const own = new Set(issueTitles(item.result));
    uniqueIssueTitlesByBrowser[item.browser] = [...own].filter((title) => {
      const appearsElsewhere = successful.some((other) => other.browser !== item.browser && issueTitles(other.result).includes(title));
      return !appearsElsewhere;
    });
  }

  return {
    titleMismatch: titles.size > 1,
    componentCountSpread: counts.length ? Math.max(...counts) - Math.min(...counts) : 0,
    uniqueIssueTitlesByBrowser: Object.keys(uniqueIssueTitlesByBrowser).length ? uniqueIssueTitlesByBrowser : Object.fromEntries([...allIssueTitles].map((title) => [title, []]))
  };
}

function markdown(result: CompatibilityResult): string {
  const rows = result.browsers.map((item) => `| ${item.browser} | ${item.success ? 'success' : 'failed'} | ${item.score ?? '-'} | ${item.issueCount ?? '-'} | ${item.componentCount ?? '-'} | ${item.markdownReport ? `\`${markdownEscape(item.markdownReport)}\`` : '-'} | ${markdownEscape(item.error ?? '-')} |`);
  const diffRows = Object.entries(result.differences.uniqueIssueTitlesByBrowser).flatMap(([browser, titles]) => titles.map((title) => `| ${markdownEscape(browser)} | ${markdownEscape(title)} |`));
  return `# FrontLens Compatibility Report

- URL: ${markdownEscape(result.url)}
- Tested at: ${result.testedAt}
- Title mismatch: ${result.differences.titleMismatch ? 'yes' : 'no'}
- Component count spread: ${result.differences.componentCountSpread}

## Browser Runs

| Browser | Status | Score | Issues | Components | Report | Error |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Browser-specific Issues

${diffRows.length ? ['| Browser | Issue title |', '| --- | --- |', ...diffRows].join('\n') : 'No browser-specific issues detected.'}
`;
}

export async function runCompatibility(input: CompatibilityRunInput): Promise<CompatibilityResult> {
  const outputDir = input.outputDir ? resolveOutputDir(input.outputDir) : defaultOutputDir();
  await ensureDir(outputDir);
  const runResults: Array<{ browser: BrowserName; result?: QaResult }> = [];
  const items: CompatibilityRunItem[] = [];

  for (const browser of input.browsers) {
    const browserOutput = path.join(outputDir, browser);
    try {
      const result = await runQa({
        url: input.url,
        configPath: input.configPath,
        requirementsPath: input.requirementsPath,
        outputDir: browserOutput,
        browser,
        headless: input.headless,
        storageState: input.storageState,
        sessionStorageState: input.sessionStorageState,
        trace: input.trace ?? false,
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
      });
      runResults.push({ browser, result });
      items.push({
        browser,
        success: true,
        outputDir: browserOutput,
        score: result.summary.score,
        issueCount: result.summary.issueCount,
        criticalCount: result.summary.criticalCount,
        highCount: result.summary.highCount,
        mediumCount: result.summary.mediumCount,
        lowCount: result.summary.lowCount,
        infoCount: result.summary.infoCount,
        title: result.summary.title,
        componentCount: result.pageModel.components.length,
        screenshot: result.artifacts.screenshot,
        jsonReport: result.artifacts.jsonReport,
        markdownReport: result.artifacts.markdownReport
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      runResults.push({ browser });
      items.push({
        browser,
        success: false,
        outputDir: browserOutput,
        error: message
      });
    }
  }

  const result: CompatibilityResult = {
    url: input.url,
    testedAt: new Date().toISOString(),
    outputDir,
    browsers: items,
    differences: buildDifferences(runResults)
  };

  await writeJson(path.join(outputDir, 'compatibility-summary.json'), result);
  await writeText(path.join(outputDir, 'compatibility-report.md'), markdown(result));
  return result;
}
