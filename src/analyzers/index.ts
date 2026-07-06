import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { analyzeConsole } from './consoleAnalyzer.js';
import { analyzeIntegration } from './integrationAnalyzer.js';
import { analyzeNetwork, type NetworkAnalysisResult } from './networkAnalyzer.js';
import { analyzePageQuality } from './pageAnalyzer.js';
import { analyzeResources } from './resourceAnalyzer.js';
import { analyzeInteractions } from './interactionAnalyzer.js';
import { analyzeCompleteness } from './completenessAnalyzer.js';
import { analyzeApiContracts } from './apiContractAnalyzer.js';
import { analyzeResponsive } from './responsiveAnalyzer.js';
import { analyzeExceptions } from './exceptionAnalyzer.js';
import { analyzeAccessibility } from './accessibilityAnalyzer.js';
import { analyzePerformance } from './performanceAnalyzer.js';
import { analyzePermissions } from './permissionAnalyzer.js';
import { analyzeCoverage } from './coverageAnalyzer.js';
import { analyzeJourneys } from './journeyAnalyzer.js';
import { analyzeRealtime } from './realtimeAnalyzer.js';

export interface AnalysisBundle {
  issues: Issue[];
  network: NetworkAnalysisResult;
  console: ReturnType<typeof analyzeConsole>;
  resources: ReturnType<typeof analyzeResources>;
}

export function analyzeAll(context: AnalyzerContext): AnalysisBundle {
  const factory = new IssueFactory();
  const expectedNetworkIds = new Set([
    ...(context.analysisExclusions?.networkRequestIds ?? []),
    ...context.journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.networkRequestIds ?? [])),
    ...context.exceptionSimulations.flatMap((item) => item.observations.networkRequestIds ?? [])
  ]);
  const expectedConsoleIds = new Set([
    ...(context.analysisExclusions?.consoleIds ?? []),
    ...context.journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.consoleIds ?? [])),
    ...context.exceptionSimulations.flatMap((item) => item.observations.consoleIds ?? [])
  ]);
  const expectedPageErrorIds = new Set([
    ...(context.analysisExclusions?.pageErrorIds ?? []),
    ...context.journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.pageErrorIds ?? [])),
    ...context.exceptionSimulations.flatMap((item) => item.observations.pageErrorIds ?? [])
  ]);
  const baseContext: AnalyzerContext = {
    ...context,
    networkRecords: context.networkRecords.filter((record) => !expectedNetworkIds.has(record.id)),
    consoleRecords: context.consoleRecords.filter((record) => !expectedConsoleIds.has(record.id)),
    pageErrors: context.pageErrors.filter((record) => !expectedPageErrorIds.has(record.id))
  };
  const network = context.config.analysis.network
    ? analyzeNetwork(baseContext, factory)
    : {
        issues: [],
        failedRequests: [],
        slowRequests: [],
        duplicatedRequests: [],
        suspiciousRequests: []
      };
  const console = context.config.analysis.console
    ? analyzeConsole(baseContext, factory)
    : {
        issues: [],
        errors: [],
        warnings: []
      };
  const resources = context.config.analysis.resource
    ? analyzeResources(baseContext, factory)
    : {
        issues: [],
        failed: [],
        slow: [],
        large: [],
        duplicated: []
      };
  const page = analyzePageQuality(baseContext, factory);
  const integration = context.config.analysis.integration ? analyzeIntegration(baseContext, factory) : [];
  const interactions = analyzeInteractions(baseContext, factory);
  const completeness = analyzeCompleteness(baseContext, factory);
  const apiContracts = analyzeApiContracts(baseContext, factory);
  const responsive = analyzeResponsive(baseContext, factory);
  const exceptions = analyzeExceptions(context, factory);
  const accessibility = analyzeAccessibility(baseContext, factory);
  const performance = analyzePerformance(baseContext, factory);
  const permissions = analyzePermissions(baseContext, factory);
  const coverage = analyzeCoverage(baseContext, factory);
  const journeys = analyzeJourneys(baseContext, factory);
  const realtime = analyzeRealtime(baseContext, factory);

  return {
    issues: [...network.issues, ...console.issues, ...resources.issues, ...page, ...integration, ...interactions, ...completeness, ...apiContracts, ...responsive, ...accessibility, ...performance, ...permissions, ...coverage, ...journeys, ...realtime, ...exceptions],
    network,
    console,
    resources
  };
}
