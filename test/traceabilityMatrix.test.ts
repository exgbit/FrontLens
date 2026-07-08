import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildDefectProof } from '../src/proof/defectProof.ts';
import { buildDefectTickets } from '../src/tickets/defectTickets.ts';
import { buildTraceabilityMatrix, formatTraceabilityMatrix } from '../src/traceability/traceabilityMatrix.ts';

function baseIssue() {
  return {
    id: 'ISSUE-001',
    title: '保存失败时没有错误态',
    category: 'frontend-state',
    severity: 'high',
    confidence: 0.96,
    description: 'API 500 is rendered as an empty state.',
    evidence: {
      selector: '.empty-state',
      networkRequestId: 'REQ-500',
      details: { sourceFile: 'src/views/UserView.vue', line: 42 }
    },
    reproduceSteps: ['Open users page', 'Mock save API 500', 'Observe empty state without retry'],
    reason: 'Users cannot distinguish a failed save from no data.',
    suggestion: { frontend: 'Render visible error state and retry action.', priority: 'P1' }
  };
}

function resultWithProvidedFailedRequirement() {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Save' } },
    issues: [baseIssue()]
  });
  result.scopeReview.status = 'configured';
  result.requirementCoverage.source = 'provided';
  result.requirementCoverage.summary = {
    requirementCount: 1,
    providedCount: 1,
    inferredCount: 0,
    passedCount: 0,
    failedCount: 1,
    partialCount: 0,
    notCoveredCount: 0,
    notApplicableCount: 0,
    highPriorityGapCount: 1
  };
  result.requirementCoverage.items = [
    {
      id: 'REQ-ERROR-FEEDBACK',
      title: '接口失败时必须展示错误提示和重试入口',
      priority: 'P1',
      source: 'provided',
      status: 'failed',
      confidence: 'high',
      evidence: { selectors: ['.empty-state'], componentIds: [], networkRequestIds: ['REQ-500'], issueIds: ['ISSUE-001'], interactionTestIds: [], journeyIds: ['JOURNEY-001'], notes: [] },
      gaps: ['Error state and retry action are missing.']
    }
  ];
  result.testCases.items = [
    {
      id: 'TC-REQ-001',
      kind: 'requirement',
      title: '验证接口失败错误态',
      priority: 'P1',
      status: 'failed',
      confidence: 'high',
      executionMode: 'runtime',
      owner: 'test',
      preconditions: ['Mock API 500'],
      steps: ['Open users page'],
      expected: ['Visible error state and retry action'],
      actual: 'Empty state only',
      evidenceRefs: ['REQ-ERROR-FEEDBACK', 'ISSUE-001'],
      issueIds: ['ISSUE-001'],
      requirementIds: ['REQ-ERROR-FEEDBACK'],
      journeyIds: ['JOURNEY-001'],
      nextSteps: ['Fix error state'],
      notes: []
    }
  ];
  result.defectProof = buildDefectProof(result);
  result.defectTickets = buildDefectTickets(result);
  return result;
}

test('traceability links provided requirements to test cases and defect tickets', () => {
  const result = resultWithProvidedFailedRequirement();
  const traceability = buildTraceabilityMatrix(result);

  assert.equal(traceability.status, 'blocked');
  assert.equal(traceability.summary.requirementCount, 1);
  assert.equal(traceability.summary.providedRequirementCount, 1);
  assert.equal(traceability.summary.highPriorityGapCount, 1);
  assert.equal(traceability.summary.defectLinkedCount, 1);

  const row = traceability.requirements[0];
  assert.equal(row.id, 'REQ-ERROR-FEEDBACK');
  assert.equal(row.status, 'failed');
  assert.deepEqual(row.testCaseIds, ['TC-REQ-001']);
  assert.deepEqual(row.defectTicketIds, ['TICKET-001']);
  assert.ok(row.evidenceRefs.includes('defectTicket:TICKET-001'));
  assert.ok(row.nextSteps.some((step) => step.includes('TICKET-001')));
  assert.match(formatTraceabilityMatrix(traceability), /FrontLens Traceability Matrix/);
  assert.match(formatTraceabilityMatrix(traceability), /REQ-ERROR-FEEDBACK/);

  result.requirementCoverage.items[0].status = 'passed';
  const contradictory = buildTraceabilityMatrix(result);
  assert.equal(contradictory.requirements[0].status, 'failed', 'a proof-ready defect ticket should override stale passed coverage for the linked requirement');
});

test('traceability flags orphan proof-ready defects when no PRD maps them', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Save' } },
    issues: [baseIssue()]
  });
  result.scopeReview.status = 'configured';
  result.defectProof = buildDefectProof(result);
  result.defectTickets = buildDefectTickets(result);

  const traceability = buildTraceabilityMatrix(result);
  assert.equal(traceability.status, 'needs-input');
  assert.equal(traceability.summary.providedRequirementCount, 0);
  assert.equal(traceability.summary.orphanDefectCount, 1);
  assert.equal(traceability.orphanItems[0].kind, 'defect-ticket');
  assert.match(traceability.orphanItems[0].nextStep, /requirement/);
});
