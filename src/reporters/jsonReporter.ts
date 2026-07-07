import path from 'node:path';
import type { QaResult } from '../types.js';
import { writeJson } from '../utils/fs.js';

export function assignJsonArtifactPaths(result: QaResult): void {
  const outputDir = result.artifacts.outputDir;
  result.artifacts.jsonReport = path.join(outputDir, 'result.json');
  result.artifacts.pageModel = path.join(outputDir, 'page-model.json');
  result.artifacts.networkLog = path.join(outputDir, 'network.json');
  result.artifacts.consoleLog = path.join(outputDir, 'console.json');
  result.artifacts.resourcesLog = path.join(outputDir, 'resources.json');
  result.artifacts.coverageLog = path.join(outputDir, 'coverage.json');
  result.artifacts.realtimeLog = path.join(outputDir, 'realtime.json');
  result.artifacts.apiContractLog = path.join(outputDir, 'api-contract.json');
  result.artifacts.p2Log = path.join(outputDir, 'p2.json');
  result.artifacts.testDataLog = path.join(outputDir, 'test-data.json');
  result.artifacts.professionalSummaryLog = path.join(outputDir, 'professional-summary.json');
  result.artifacts.regressionPlanLog = path.join(outputDir, 'regression-plan.json');
  result.artifacts.scopeReviewLog = path.join(outputDir, 'scope-review.json');
  result.artifacts.claimGuardLog = path.join(outputDir, 'claim-guard.json');
  result.artifacts.sourceAnalysisLog = path.join(outputDir, 'source-analysis.json');
  result.artifacts.sourceRuntimeLog = path.join(outputDir, 'source-runtime-correlation.json');
  result.artifacts.sourceHealthLog = path.join(outputDir, 'source-health.json');
}

export async function writeJsonReports(result: QaResult): Promise<void> {
  assignJsonArtifactPaths(result);
  const artifacts = result.artifacts as QaResult['artifacts'] & {
    jsonReport: string;
    pageModel: string;
    networkLog: string;
    consoleLog: string;
    resourcesLog: string;
    coverageLog: string;
    realtimeLog: string;
    apiContractLog: string;
    p2Log: string;
    testDataLog: string;
    professionalSummaryLog: string;
    regressionPlanLog: string;
    scopeReviewLog: string;
    claimGuardLog: string;
    sourceAnalysisLog: string;
    sourceRuntimeLog: string;
    sourceHealthLog: string;
  };
  await writeJson(artifacts.pageModel, result.pageModel);
  await writeJson(artifacts.networkLog, result.network.requests);
  await writeJson(artifacts.consoleLog, result.console);
  await writeJson(artifacts.resourcesLog, result.resources);
  await writeJson(artifacts.coverageLog, result.coverage);
  await writeJson(artifacts.realtimeLog, result.realtime);
  await writeJson(artifacts.apiContractLog, result.apiContract);
  await writeJson(artifacts.p2Log, result.p2);
  await writeJson(artifacts.testDataLog, result.testData);
  await writeJson(artifacts.professionalSummaryLog, result.professionalSummary);
  await writeJson(artifacts.regressionPlanLog, result.regressionPlan);
  await writeJson(artifacts.scopeReviewLog, result.scopeReview);
  await writeJson(artifacts.claimGuardLog, result.claimGuard);
  await writeJson(artifacts.sourceAnalysisLog, result.sourceAnalysis);
  await writeJson(artifacts.sourceRuntimeLog, result.sourceRuntimeCorrelation);
  await writeJson(artifacts.sourceHealthLog, result.sourceHealth);
  await writeJson(artifacts.jsonReport, result);
}
