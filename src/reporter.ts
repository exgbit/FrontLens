import type { QaResult } from './types.js';
import { writeJsonReports } from './reporters/jsonReporter.js';
import { writeMarkdownReport } from './reporters/markdownReporter.js';
import { writeHtmlReport } from './reporters/htmlReporter.js';
import { runReporterPlugins } from './plugins/pluginManager.js';
import { buildSummary } from './summary.js';
import { normalizeIssueLike } from './resultNormalizer.js';
import { generateFixTasks } from './fix/fixTasks.js';
import { buildQualityGate } from './qualityGate.js';
import { buildRequirementCoverage } from './requirements/requirementCoverage.js';

function normalizeAndRebuildSummary(result: QaResult): void {
  result.issues = result.issues.map((issue, index) =>
    normalizeIssueLike({
      ...issue,
      id: `ISSUE-${String(index + 1).padStart(3, '0')}`
    }, index)
  );
  result.summary = buildSummary({
    url: result.summary.url,
    title: result.summary.title,
    issues: result.issues,
    testedAt: result.summary.testedAt,
    browser: result.summary.browser,
    viewport: result.summary.viewport
  });
  result.requirementCoverage = buildRequirementCoverage({
    config: result.metadata.config,
    pageModel: result.pageModel,
    networkRecords: result.network.requests,
    issues: result.issues,
    journeyTests: result.journeyTests,
    interactionTests: result.interactionTests,
    accessibilityChecks: result.accessibilityChecks
  });
  result.qualityGate = buildQualityGate({
    issues: result.issues,
    pageModel: result.pageModel,
    phaseErrors: result.metadata.phaseErrors,
    interactionTests: result.interactionTests,
    journeyTests: result.journeyTests,
    exceptionSimulations: result.exceptionSimulations,
    coverage: result.coverage,
    security: result.security,
    requirementCoverage: result.requirementCoverage
  });
}

export async function writeReports(result: QaResult): Promise<QaResult> {
  const formats = new Set(result.metadata.config.report.formats);
  normalizeAndRebuildSummary(result);
  await writeJsonReports(result);
  if (formats.has('markdown')) {
    await writeMarkdownReport(result);
    // Re-write result.json after markdown path is populated.
    await writeJsonReports(result);
  }
  if (formats.has('html')) {
    await writeHtmlReport(result);
    await writeJsonReports(result);
  }
  const issueCountBeforePlugins = result.issues.length;
  await runReporterPlugins(result);
  if (result.metadata.config.plugins.reporters.length > 0 || result.issues.length !== issueCountBeforePlugins) {
    normalizeAndRebuildSummary(result);
    result.fixTasks = generateFixTasks(result.issues, result.metadata.config);
    if (formats.has('markdown')) {
      await writeMarkdownReport(result);
    }
    if (formats.has('html')) {
      await writeHtmlReport(result);
    }
    await writeJsonReports(result);
  }
  return result;
}
