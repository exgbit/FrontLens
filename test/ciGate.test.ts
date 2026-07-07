import test from 'node:test';
import assert from 'node:assert/strict';
import type { Issue, IssueDispositionResult, QaSummary } from '../src/types.ts';
import { evaluateMatrixItemCiGate, evaluateQaCiGate } from '../src/gates/ciGate.ts';

function issue(overrides: Partial<Issue> & Pick<Issue, 'id' | 'severity' | 'category' | 'title'>): Issue {
  return {
    confidence: 0.9,
    description: '',
    evidence: {},
    reproduceSteps: [],
    reason: '',
    suggestion: {},
    ...overrides
  };
}

function summary(overrides: Partial<QaSummary>): QaSummary {
  return {
    url: 'https://example.com/admin',
    title: 'Admin',
    score: 52,
    adjustedScore: 100,
    issueCount: 1,
    adjustedIssueCount: 0,
    scoreBasis: 'actionable',
    scoreNotes: [],
    criticalCount: 0,
    highCount: 1,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    testedAt: '2026-01-01T00:00:00.000Z',
    browser: 'chromium',
    viewport: { width: 1440, height: 900 },
    ...overrides
  };
}

function disposition(issues: Issue[], actionabilityByIssueId: Record<string, 'actionable' | 'conditional' | 'non-actionable'>): IssueDispositionResult {
  const entries = issues.map((item) => [item, actionabilityByIssueId[item.id] ?? 'non-actionable'] as const);
  const bucketCounts: IssueDispositionResult['summary']['bucketCounts'] = {
    'real-frontend-fix': 0,
    'backend-api-fix': 0,
    'deployment-security-config': 0,
    'product-decision': 0,
    'tool-limitation': 0,
    'coverage-gap': 0,
    reference: 0
  };
  const statusCounts: IssueDispositionResult['summary']['statusCounts'] = {
    confirmed: 0,
    'needs-source-confirmation': 0,
    'deployment-only': 0,
    'product-decision': 0,
    'tool-limitation': 0,
    'insufficient-evidence': 0,
    reference: 0
  };
  for (const [, actionability] of entries) {
    if (actionability === 'actionable') {
      bucketCounts['real-frontend-fix'] += 1;
      statusCounts.confirmed += 1;
    } else {
      bucketCounts['product-decision'] += 1;
      statusCounts['product-decision'] += 1;
    }
  }
  return {
    checkedAt: '2026-01-01T00:00:00.000Z',
    targetUrl: 'https://example.com/admin',
    summary: {
      totalCount: entries.length,
      actionableCount: entries.filter(([, actionability]) => actionability === 'actionable').length,
      conditionalCount: entries.filter(([, actionability]) => actionability === 'conditional').length,
      nonActionableCount: entries.filter(([, actionability]) => actionability === 'non-actionable').length,
      confirmedCount: entries.filter(([, actionability]) => actionability === 'actionable').length,
      needsSourceConfirmationCount: entries.filter(([, actionability]) => actionability === 'conditional').length,
      deploymentOnlyCount: 0,
      productDecisionCount: entries.filter(([, actionability]) => actionability === 'non-actionable').length,
      toolLimitationCount: 0,
      insufficientEvidenceCount: 0,
      referenceCount: 0,
      bucketCounts,
      statusCounts
    },
    items: entries.map(([item, actionability]) => ({
      issueId: item.id,
      title: item.title,
      category: item.category,
      severity: item.severity,
      status: actionability === 'actionable' ? 'confirmed' : actionability === 'conditional' ? 'needs-source-confirmation' : 'product-decision',
      actionability,
      bucket: actionability === 'actionable' ? 'real-frontend-fix' : 'product-decision',
      owner: actionability === 'actionable' ? 'frontend' : 'product',
      evidenceStrength: actionability === 'actionable' ? 'strong' : 'weak',
      confidence: actionability === 'actionable' ? 'high' : 'medium',
      reason: actionability === 'actionable' ? 'Runtime evidence and source fix surface are present.' : 'Product/deployment/tool-noise finding.',
      nextStep: actionability === 'actionable' ? 'Fix and rerun QA.' : 'Keep as review note unless product scope changes.'
    }))
  };
}

test('professional CI gate ignores non-actionable raw high findings but raw gate keeps legacy behavior', () => {
  const nonActionableHigh = issue({
    id: 'ISSUE-SEC-HEADER',
    title: 'Missing deployment security header',
    category: 'security',
    severity: 'high'
  });
  const result = {
    issues: [nonActionableHigh],
    summary: summary({ score: 52, adjustedScore: 100, issueCount: 1, adjustedIssueCount: 0 }),
    issueDisposition: disposition([nonActionableHigh], { [nonActionableHigh.id]: 'non-actionable' })
  };

  const professionalGate = evaluateQaCiGate({ result, failOn: 'high', minScore: 80, mode: 'professional' });
  const rawGate = evaluateQaCiGate({ result, failOn: 'high', minScore: 80, mode: 'raw' });

  assert.equal(professionalGate.status, 'passed');
  assert.equal(professionalGate.scoreField, 'summary.adjustedScore');
  assert.equal(professionalGate.severityCounts.high, 0);
  assert.equal(rawGate.status, 'failed');
  assert.equal(rawGate.scoreField, 'summary.score');
  assert.equal(rawGate.severityCounts.high, 1);
});

test('professional CI gate fails on actionable high findings', () => {
  const actionableHigh = issue({
    id: 'ISSUE-ERROR-STATE',
    title: 'API failure renders a false empty state',
    category: 'integration-no-feedback',
    severity: 'high'
  });
  const result = {
    issues: [actionableHigh],
    summary: summary({ score: 88, adjustedScore: 88, issueCount: 1, adjustedIssueCount: 1 }),
    issueDisposition: disposition([actionableHigh], { [actionableHigh.id]: 'actionable' })
  };

  const gate = evaluateQaCiGate({ result, failOn: 'high', minScore: 90, mode: 'professional' });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.failedBySeverity, true);
  assert.equal(gate.failedByScore, true);
  assert.equal(gate.severityCounts.high, 1);
});

test('professional CI gate fails on report/sign-off contract blockers while raw mode ignores them', () => {
  const result = {
    issues: [],
    summary: summary({ score: 100, adjustedScore: 100, issueCount: 0, adjustedIssueCount: 0, highCount: 0 }),
    issueDisposition: disposition([], {}),
    reportContentAudit: {
      status: 'failed' as const,
      checkedAt: '2026-01-01T00:00:00.000Z',
      profile: 'professional' as const,
      summary: { findingCount: 1, blockerCount: 1, warningCount: 0, infoCount: 0 },
      findings: [],
      notes: []
    },
    journeyAssertionAudit: {
      status: 'failed' as const,
      checkedAt: '2026-01-01T00:00:00.000Z',
      summary: {
        journeyCount: 1,
        passedJourneyCount: 1,
        pathOnlyJourneyCount: 1,
        weaklyAssertedJourneyCount: 0,
        runtimeVerifiedJourneyCount: 0,
        failedJourneyCount: 0,
        assertionStepCount: 0,
        meaningfulAssertionStepCount: 0,
        findingCount: 1,
        blockerCount: 1,
        warningCount: 0,
        infoCount: 0
      },
      items: [],
      findings: [],
      notes: []
    },
    qaSignoff: {
      status: 'blocked' as const,
      confidence: 'low' as const,
      businessValidationConfidence: 'not-verified' as const,
      checkedAt: '2026-01-01T00:00:00.000Z',
      summary: 'Blocked by report contract.',
      scope: {
        targetUrl: 'https://example.com/admin',
        requirementSource: 'none' as const,
        providedRequirementCount: 0,
        inferredRequirementCount: 0,
        journeyCount: 0,
        passedJourneyCount: 0,
        failedJourneyCount: 0,
        assertionStepCount: 0,
        passedAssertionStepCount: 0,
        passedJourneyWithAssertionCount: 0,
        passedJourneyWithoutAssertionCount: 0,
        interactionCount: 0,
        passedInteractionCount: 0,
        failedInteractionCount: 0,
        exceptionCount: 0,
        failedExceptionCount: 0,
        authStateProvided: false,
        destructiveActionsAllowed: false,
        environmentKind: 'unknown' as const,
        environmentConfidence: 'low' as const,
        pageProfileStatus: 'needs-input' as const,
        pageProfileType: 'unknown' as const,
        sourceHealthStatus: 'skipped' as const,
        artifactIntegrityStatus: 'passed' as const
      },
      blockers: ['Report contract blocker.'],
      risks: [],
      coverageGaps: [],
      requiredFollowups: [],
      evidence: []
    }
  };

  const professionalGate = evaluateQaCiGate({ result, failOn: 'high', minScore: 80, mode: 'professional' });
  const rawGate = evaluateQaCiGate({ result, failOn: 'high', minScore: 80, mode: 'raw' });

  assert.equal(professionalGate.status, 'failed');
  assert.equal(professionalGate.failedByProfessionalContract, true);
  assert.equal(professionalGate.professionalContractFailures.some((item) => item.includes('reportContentAudit failed')), true);
  assert.equal(professionalGate.professionalContractFailures.some((item) => item.includes('journeyAssertionAudit failed')), true);
  assert.equal(professionalGate.professionalContractFailures.some((item) => item.includes('qaSignoff is blocked')), true);
  assert.equal(rawGate.status, 'passed');
  assert.equal(rawGate.failedByProfessionalContract, false);
});



test('professional CI gate fails on blocked risk register', () => {
  const result = {
    issues: [],
    summary: summary({ score: 100, adjustedScore: 100, issueCount: 0, adjustedIssueCount: 0, highCount: 0 }),
    issueDisposition: disposition([], {}),
    riskRegister: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      status: 'blocked' as const,
      summary: {
        totalCount: 1,
        criticalCount: 1,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        openCount: 0,
        blockedCount: 1,
        acceptedCount: 0,
        mitigatedCount: 0,
        releaseBlockingCount: 1
      },
      items: [],
      notes: []
    }
  };

  const gate = evaluateQaCiGate({ result, minScore: 80, mode: 'professional' });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.failedByProfessionalContract, true);
  assert.equal(gate.professionalContractFailures.some((item) => item.includes('riskRegister is blocked')), true);
});

test('professional CI gate fails on blocked risk acceptance checklist', () => {
  const result = {
    issues: [],
    summary: summary({ score: 100, adjustedScore: 100, issueCount: 0, adjustedIssueCount: 0, highCount: 0 }),
    issueDisposition: disposition([], {}),
    riskAcceptance: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      status: 'blocked' as const,
      summary: {
        itemCount: 1,
        mustMitigateCount: 1,
        acceptanceRequiredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        deferredCount: 0,
        releaseBlockingCount: 1
      },
      items: [],
      notes: []
    }
  };

  const gate = evaluateQaCiGate({ result, minScore: 80, mode: 'professional' });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.failedByProfessionalContract, true);
  assert.equal(gate.professionalContractFailures.some((item) => item.includes('riskAcceptance is blocked')), true);
});

test('professional CI gate fails on blocked test cases', () => {
  const result = {
    issues: [],
    summary: summary({ score: 100, adjustedScore: 100, issueCount: 0, adjustedIssueCount: 0, highCount: 0 }),
    issueDisposition: disposition([], {}),
    testCases: {
      generatedAt: '2026-01-01T00:00:00.000Z',
      status: 'blocked' as const,
      confidence: 'low' as const,
      summary: {
        totalCount: 1,
        passedCount: 0,
        failedCount: 0,
        partialCount: 0,
        blockedCount: 1,
        skippedCount: 0,
        needsInputCount: 0,
        runtimeVerifiedCount: 0,
        manualRequiredCount: 0,
        highPriorityOpenCount: 1
      },
      items: [],
      notes: []
    }
  };

  const gate = evaluateQaCiGate({ result, minScore: 80, mode: 'professional' });

  assert.equal(gate.status, 'failed');
  assert.equal(gate.failedByProfessionalContract, true);
  assert.equal(gate.professionalContractFailures.some((item) => item.includes('testCases is blocked')), true);
});

test('matrix CI gate uses actionable counts and adjusted score by default', () => {
  const item = {
    success: true,
    score: 52,
    adjustedScore: 100,
    highCount: 2,
    actionableHighCount: 0,
    issueCount: 2,
    adjustedIssueCount: 0
  };

  const professionalGate = evaluateMatrixItemCiGate({ item, failOn: 'high', minScore: 80 });
  const rawGate = evaluateMatrixItemCiGate({ item, failOn: 'high', minScore: 80, mode: 'raw' });

  assert.equal(professionalGate.status, 'passed');
  assert.equal(professionalGate.scoreField, 'adjustedScore');
  assert.equal(professionalGate.severityCounts.high, 0);
  assert.equal(rawGate.status, 'failed');
  assert.equal(rawGate.scoreField, 'score');
  assert.equal(rawGate.severityCounts.high, 2);
});
