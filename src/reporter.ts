import type { QaResult } from './types.js';
import { assignJsonArtifactPaths, writeJsonReports } from './reporters/jsonReporter.js';
import { writeMarkdownReport } from './reporters/markdownReporter.js';
import { writeHtmlReport } from './reporters/htmlReporter.js';
import { runReporterPlugins } from './plugins/pluginManager.js';
import { applyAdjustedScore, buildSummary } from './summary.js';
import { normalizeIssueLike } from './resultNormalizer.js';
import { generateFixTasks } from './fix/fixTasks.js';
import { buildQualityGate } from './qualityGate.js';
import { buildRequirementCoverage } from './requirements/requirementCoverage.js';
import { buildArtifactIntegrity } from './artifacts/artifactIntegrity.js';
import { buildRootCauseGroups } from './rootCause/rootCauseGroups.js';
import { buildIssueDisposition, filterActionableIssues } from './disposition/issueDisposition.js';
import { buildQaSignoff } from './signoff/qaSignoff.js';
import { buildTestDataAssessment } from './testData/testDataAssessment.js';
import { buildRegressionPlan } from './regression/regressionPlan.js';
import { buildProfessionalSummary } from './summary/professionalSummary.js';
import { buildScopeReview } from './product/scopeReview.js';
import { buildClaimGuard } from './claims/claimGuard.js';
import { buildQaIntake } from './intake/qaIntake.js';
import { buildDefectProof } from './proof/defectProof.js';
import { buildQaExecutionPlan } from './plan/qaExecutionPlan.js';
import { buildQaCoverageMatrix } from './coverage/qaCoverageMatrix.js';
import { buildJourneyAssertionAudit } from './journeys/journeyAssertionAudit.js';
import { buildRiskRegister } from './risk/riskRegister.js';
import { buildRiskAcceptance } from './risk/riskAcceptance.js';
import { buildTestCaseMatrix } from './cases/testCases.js';
import { buildAssertionSuggestions } from './journeys/assertionSuggestions.js';
import { buildDefectTickets } from './tickets/defectTickets.js';
import { buildTraceabilityMatrix } from './traceability/traceabilityMatrix.js';
import { buildAutomationSpecs } from './automation/automationSpecs.js';

function rebuildTriageArtifacts(result: QaResult): void {
  const preliminaryDisposition = buildIssueDisposition(result.issues, result.metadata.config, [], { requirementCoverage: result.requirementCoverage });
  result.rootCauseGroups = buildRootCauseGroups(filterActionableIssues(result.issues, preliminaryDisposition), result.metadata.config, result.sourceRuntimeCorrelation, result.sourceAnalysis);
  result.issueDisposition = buildIssueDisposition(result.issues, result.metadata.config, result.rootCauseGroups, { requirementCoverage: result.requirementCoverage });
  result.defectProof = buildDefectProof(result);
  result.fixTasks = generateFixTasks(result.issues, result.metadata.config, result.rootCauseGroups, result.defectProof);
}

async function normalizeAndRebuildSummary(result: QaResult): Promise<void> {
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
  result.journeyAssertionAudit = buildJourneyAssertionAudit({
    journeyTests: result.journeyTests,
    requirementCoverage: result.requirementCoverage
  });
  result.artifactIntegrity = await buildArtifactIntegrity(result);
  result.testData = buildTestDataAssessment(result.metadata.config, result.requirementCoverage);
  result.scopeReview = buildScopeReview({
    config: result.metadata.config,
    pageProfile: result.pageProfile,
    requirementCoverage: result.requirementCoverage,
    title: result.summary.title
  });
  rebuildTriageArtifacts(result);
  applyAdjustedScore(result.summary, result.issues, result.issueDisposition, result.defectProof);
  result.qualityGate = buildQualityGate({
    issues: result.issues,
    pageModel: result.pageModel,
    phaseErrors: result.metadata.phaseErrors,
    interactionTests: result.interactionTests,
    journeyTests: result.journeyTests,
    exceptionSimulations: result.exceptionSimulations,
    coverage: result.coverage,
    security: result.security,
    requirementCoverage: result.requirementCoverage,
    artifactIntegrity: result.artifactIntegrity,
    issueDisposition: result.issueDisposition,
    defectProof: result.defectProof
  });
  result.qaSignoff = buildQaSignoff({
    config: result.metadata.config,
    qualityGate: result.qualityGate,
    requirementCoverage: result.requirementCoverage,
    sourceHealth: result.sourceHealth,
    artifactIntegrity: result.artifactIntegrity,
    journeyAssertionAudit: result.journeyAssertionAudit,
    environment: result.environment,
    pageProfile: result.pageProfile,
    testData: result.testData,
    journeyTests: result.journeyTests,
    interactionTests: result.interactionTests,
    exceptionSimulations: result.exceptionSimulations,
    pageDomNodes: result.pageModel.stats.domNodes
  });
  result.regressionPlan = buildRegressionPlan({
    targetUrl: result.summary.url,
    sourceRoot: result.sourceAnalysis.root,
    rootCauseGroups: result.rootCauseGroups,
    fixTasks: result.fixTasks,
    requirementCoverage: result.requirementCoverage,
    journeyTests: result.journeyTests,
    interactionTests: result.interactionTests,
    sourceHealth: result.sourceHealth,
    artifactIntegrity: result.artifactIntegrity,
    environment: result.environment,
    pageProfile: result.pageProfile,
    pageModel: result.pageModel,
    permissionChecks: result.permissionChecks,
    testData: result.testData,
    qualityGate: result.qualityGate,
    qaSignoff: result.qaSignoff,
    defectProof: result.defectProof
  });
  result.professionalSummary = buildProfessionalSummary({
    rootCauseGroups: result.rootCauseGroups,
    issueDisposition: result.issueDisposition,
    requirementCoverage: result.requirementCoverage,
    qualityGate: result.qualityGate,
    qaSignoff: result.qaSignoff,
    regressionPlan: result.regressionPlan,
    defectProof: result.defectProof
  });
  result.claimGuard = buildClaimGuard(result);
  result.qaIntake = buildQaIntake(result);
  result.qaPlan = buildQaExecutionPlan(result);
  result.qaCoverage = buildQaCoverageMatrix(result);
  result.assertionSuggestions = buildAssertionSuggestions(result);
  result.testCases = buildTestCaseMatrix(result);
  result.riskRegister = buildRiskRegister(result);
  result.riskAcceptance = buildRiskAcceptance(result);
  result.defectTickets = buildDefectTickets(result);
  result.traceability = buildTraceabilityMatrix(result);
  result.automationSpecs = buildAutomationSpecs(result);
}

async function writeHumanReportsWithStableIntegrity(result: QaResult, formats: Set<string>): Promise<void> {
  const shouldWriteMarkdown = formats.has('markdown');
  const shouldWriteHtml = formats.has('html');
  if (!shouldWriteMarkdown && !shouldWriteHtml) return;

  if (shouldWriteMarkdown) await writeMarkdownReport(result);
  if (shouldWriteHtml) await writeHtmlReport(result);
  await normalizeAndRebuildSummary(result);

  // The first human-report write populates markdown/html artifact paths.
  // Rebuild once, then rewrite so report.md / report.html describe the final
  // artifactIntegrity state instead of a pre-human-artifact snapshot.
  if (shouldWriteMarkdown) await writeMarkdownReport(result);
  if (shouldWriteHtml) await writeHtmlReport(result);
  await normalizeAndRebuildSummary(result);
}

export async function writeReports(result: QaResult): Promise<QaResult> {
  const formats = new Set(result.metadata.config.report.formats);
  assignJsonArtifactPaths(result);
  await normalizeAndRebuildSummary(result);
  await writeJsonReports(result);
  await normalizeAndRebuildSummary(result);
  await writeHumanReportsWithStableIntegrity(result, formats);
  await writeJsonReports(result);
  const issueCountBeforePlugins = result.issues.length;
  await runReporterPlugins(result);
  if (result.metadata.config.plugins.reporters.length > 0 || result.issues.length !== issueCountBeforePlugins) {
    await normalizeAndRebuildSummary(result);
    rebuildTriageArtifacts(result);
    result.regressionPlan = buildRegressionPlan({
      targetUrl: result.summary.url,
      sourceRoot: result.sourceAnalysis.root,
      rootCauseGroups: result.rootCauseGroups,
      fixTasks: result.fixTasks,
      requirementCoverage: result.requirementCoverage,
      journeyTests: result.journeyTests,
      interactionTests: result.interactionTests,
      sourceHealth: result.sourceHealth,
      artifactIntegrity: result.artifactIntegrity,
      environment: result.environment,
      pageProfile: result.pageProfile,
      pageModel: result.pageModel,
      permissionChecks: result.permissionChecks,
      testData: result.testData,
      qualityGate: result.qualityGate,
      qaSignoff: result.qaSignoff,
      defectProof: result.defectProof
    });
    result.professionalSummary = buildProfessionalSummary({
      rootCauseGroups: result.rootCauseGroups,
      issueDisposition: result.issueDisposition,
      requirementCoverage: result.requirementCoverage,
      qualityGate: result.qualityGate,
      qaSignoff: result.qaSignoff,
      regressionPlan: result.regressionPlan,
      defectProof: result.defectProof
    });
    result.claimGuard = buildClaimGuard(result);
    result.qaIntake = buildQaIntake(result);
    result.qaPlan = buildQaExecutionPlan(result);
    result.qaCoverage = buildQaCoverageMatrix(result);
    result.assertionSuggestions = buildAssertionSuggestions(result);
    result.testCases = buildTestCaseMatrix(result);
    result.riskRegister = buildRiskRegister(result);
    result.riskAcceptance = buildRiskAcceptance(result);
    result.defectTickets = buildDefectTickets(result);
    result.traceability = buildTraceabilityMatrix(result);
    result.automationSpecs = buildAutomationSpecs(result);
    await writeHumanReportsWithStableIntegrity(result, formats);
    await writeJsonReports(result);
  }
  return result;
}
