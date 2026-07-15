import type { TestPlanExecutionReport, TestPlanResult } from '../types.js';

const SAMPLE_LIMIT = 10;
const REQUIREMENT_SAMPLE_LIMIT = 20;
const REVIEW_QUESTION_SAMPLE_LIMIT = 10;

export function compactTestPlan(plan: TestPlanResult): unknown {
  const p0Cases = plan.testCases.filter((item) => item.priority === 'P0');
  return {
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    status: plan.status,
    source: plan.source,
    summary: plan.summary,
    changeImpact: plan.changeImpact ? {
      status: plan.changeImpact.status,
      baseRef: plan.changeImpact.baseRef,
      baseRefSource: plan.changeImpact.baseRefSource,
      headRef: plan.changeImpact.headRef,
      mergeBase: plan.changeImpact.mergeBase,
      workingTreeIncluded: plan.changeImpact.workingTreeIncluded,
      changedFileCount: plan.changeImpact.changedFileCount,
      impactedModuleCount: plan.changeImpact.modules.length,
      regressionTargetCount: plan.changeImpact.regressionTargets.length,
      impactedModulesSample: plan.changeImpact.modules.slice(0, SAMPLE_LIMIT).map((item) => ({
        name: item.name,
        kinds: item.kinds,
        directFileCount: item.directFiles.length,
        dependentFileCount: item.dependentFiles.length,
        confidence: item.confidence,
        businessFlows: item.businessFlows.slice(0, 5)
      })),
      impactedModulesSampleTruncated: plan.changeImpact.modules.length > SAMPLE_LIMIT,
      warnings: plan.changeImpact.warnings.slice(0, 5)
    } : undefined,
    blockerCoverage: {
      status: plan.blockerCoverage.status,
      coveredCount: plan.blockerCoverage.coveredCount,
      missingCount: plan.blockerCoverage.missingCount,
      notApplicableCount: plan.blockerCoverage.notApplicableCount,
      items: plan.blockerCoverage.items.map((item) => ({
        id: item.id,
        category: item.category,
        status: item.status,
        testCaseCount: item.testCaseIds.length
      }))
    },
    requirementCount: plan.requirements.length,
    requirementsSample: plan.requirements.slice(0, REQUIREMENT_SAMPLE_LIMIT).map((item, index) => ({
      id: item.id ?? `REQ-${index + 1}`,
      title: item.title,
      priority: item.priority,
      needsReview: item.needsReview
    })),
    requirementsSampleTruncated: plan.requirements.length > REQUIREMENT_SAMPLE_LIMIT,
    developerP0Sample: p0Cases.slice(0, SAMPLE_LIMIT).map((item) => ({
      id: item.id,
      title: item.title,
      layer: item.layer,
      scenario: item.scenario,
      executionMode: item.executionMode
    })),
    developerP0SampleTruncated: p0Cases.length > SAMPLE_LIMIT,
    reviewQuestionCount: plan.reviewQuestions.length,
    reviewQuestionsSample: plan.reviewQuestions.slice(0, REVIEW_QUESTION_SAMPLE_LIMIT),
    reviewQuestionsSampleTruncated: plan.reviewQuestions.length > REVIEW_QUESTION_SAMPLE_LIMIT,
    artifacts: plan.artifacts,
    detailHint: 'Samples are bounded. Use output artifacts for a specific requirement/case, or request detail=true explicitly. Do not load test-plan.json into an LLM by default.'
  };
}

export function compactTestPlanExecution(report: TestPlanExecutionReport, plan: TestPlanResult, artifacts?: Record<string, string>): unknown {
  const priorityById = new Map(plan.testCases.map((item) => [item.id, item.priority]));
  const caseById = new Map(plan.testCases.map((item) => [item.id, item]));
  const openP0 = report.executions.filter((item) => priorityById.get(item.testCaseId) === 'P0' && item.status !== 'passed');
  return {
    generatedAt: report.generatedAt,
    status: report.status,
    planStatus: report.planStatus,
    summary: report.summary,
    changeRegression: {
      status: report.changeRegression.status,
      totalCount: report.changeRegression.totalCount,
      passedCount: report.changeRegression.passedCount,
      failedCount: report.changeRegression.failedCount,
      blockedCount: report.changeRegression.blockedCount,
      partialCount: report.changeRegression.partialCount,
      notExecutedCount: report.changeRegression.notExecutedCount,
      itemsSample: report.changeRegression.items.slice(0, SAMPLE_LIMIT).map((item) => ({
        targetId: item.targetId,
        module: item.module,
        priority: item.priority,
        status: item.status,
        testCaseId: item.testCaseId
      })),
      itemsSampleTruncated: report.changeRegression.items.length > SAMPLE_LIMIT
    },
    releaseRecommendation: report.releaseRecommendation,
    requirementCount: report.requirementTraceability.length,
    requirementsSample: report.requirementTraceability.slice(0, REQUIREMENT_SAMPLE_LIMIT).map((item) => ({
      requirementId: item.requirementId,
      title: item.title,
      implementationVerdict: item.implementationVerdict,
      verificationVerdict: item.verificationVerdict,
      statuses: [...new Set(item.statuses)],
      issueIds: item.issueIds
    })),
    requirementsSampleTruncated: report.requirementTraceability.length > REQUIREMENT_SAMPLE_LIMIT,
    openP0Sample: openP0.slice(0, SAMPLE_LIMIT).map((item) => ({
      testCaseId: item.testCaseId,
      title: caseById.get(item.testCaseId)?.title,
      layer: caseById.get(item.testCaseId)?.layer,
      scenario: caseById.get(item.testCaseId)?.scenario,
      status: item.status,
      actual: item.actual
    })),
    openP0SampleTruncated: openP0.length > SAMPLE_LIMIT,
    defectCount: report.defectIds.length,
    defectIdsSample: report.defectIds.slice(0, SAMPLE_LIMIT),
    defectIdsSampleTruncated: report.defectIds.length > SAMPLE_LIMIT,
    artifacts,
    detailHint: 'Read the compact Markdown first; inspect the full execution details only for a specific requirement or failed case.'
  };
}
