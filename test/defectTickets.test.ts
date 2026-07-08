import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildDefectProof } from '../src/proof/defectProof.ts';
import { buildDefectTickets, formatDefectTickets } from '../src/tickets/defectTickets.ts';

function baseIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ISSUE-001',
    title: '保存按钮点击后没有反馈',
    category: 'frontend-ui',
    severity: 'high',
    confidence: 0.95,
    description: 'Clicking save does not show success or error state.',
    evidence: {
      selector: '.save-button',
      screenshot: 'screens/save.png',
      dom: 'dom/save.html',
      details: { sourceFile: 'src/views/UserView.vue', line: 42 }
    },
    reproduceSteps: ['Open users page', 'Click Save', 'Observe no success or error feedback'],
    reason: 'Users cannot know whether the save action completed.',
    suggestion: { frontend: 'Render success/error feedback and add a regression assertion.', priority: 'P1' },
    ...overrides
  };
}

function proofReadyResult() {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Save' }
    },
    issues: [baseIssue()]
  });
  result.scopeReview.status = 'configured';
  result.requirementCoverage.summary.providedCount = 1;
  result.requirementCoverage.summary.requirementCount = 1;
  result.requirementCoverage.items = [
    {
      id: 'REQ-SAVE-FEEDBACK',
      title: '保存后必须显示成功或错误反馈',
      priority: 'P1',
      source: 'provided',
      status: 'failed',
      confidence: 'high',
      evidence: { selectors: ['.save-button'], componentIds: [], networkRequestIds: [], issueIds: ['ISSUE-001'], interactionTestIds: [], journeyIds: [], notes: [] },
      gaps: ['No feedback after save']
    }
  ];
  result.defectProof = buildDefectProof(result);
  return result;
}

test('defect tickets include only proof-ready implementation defects with filing details', () => {
  const result = proofReadyResult();
  const tickets = buildDefectTickets(result);

  assert.equal(tickets.status, 'ready');
  assert.equal(tickets.counts.total, 1);
  assert.equal(tickets.counts.proven, 1);
  assert.equal(tickets.counts.requirementLinked, 1);
  assert.equal(tickets.counts.sourceLocated, 1);

  const ticket = tickets.items[0];
  assert.equal(ticket.rootCauseGroupId, result.rootCauseGroups[0].id);
  assert.equal(ticket.owner, 'frontend');
  assert.equal(ticket.priority, 'P1');
  assert.equal(ticket.proofStatus, 'proven');
  assert.equal(ticket.requirements[0].id, 'REQ-SAVE-FEEDBACK');
  assert.deepEqual(ticket.sourceLocations, [{ file: 'src/views/UserView.vue', line: 42 }]);
  assert.ok(ticket.reproduceSteps.some((step) => step.includes('Click Save')));
  assert.ok(ticket.artifactRefs.includes('screens/save.png'));
  assert.ok(ticket.acceptanceCriteria.some((item) => item.includes('REQ-SAVE-FEEDBACK')));
  assert.match(formatDefectTickets(tickets), /FrontLens Defect Tickets/);
  assert.match(formatDefectTickets(tickets), /TICKET-001/);
});

test('defect tickets suppress needs-evidence observations instead of filing noisy bugs', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Save' } },
    issues: [baseIssue()]
  });
  result.issues = result.issues.map((issue) => ({ ...issue, evidence: {}, reproduceSteps: [] }));
  result.rootCauseGroups = result.rootCauseGroups.map((group) => ({ ...group, sourceLocations: [], selectors: [], networkRequestIds: [], consoleIds: [], pageErrorIds: [] }));
  result.issueDisposition.items = result.issueDisposition.items.map((item) => ({ ...item, actionability: 'actionable' as const, status: 'confirmed' as const }));
  result.sourceAnalysis = { ...result.sourceAnalysis, enabled: true, status: 'passed', root: '/repo', scannedFiles: 1, scannedBytes: 100, summary: { routeFileCount: 0, routeCount: 0, eagerRouteImportCount: 0, heavyImportCount: 0, apiCallCount: 0, errorStateSignalCount: 0, emptyStateSignalCount: 0 }, routeFiles: [], routes: [], imports: [], apiCalls: [], stateSignals: [], findings: [] };
  result.defectProof = buildDefectProof(result);

  const tickets = buildDefectTickets(result);
  assert.equal(tickets.status, 'needs-evidence');
  assert.equal(tickets.counts.total, 0);
  assert.equal(tickets.counts.suppressedNeedsEvidence, 1);
  assert.match(tickets.summary, /need evidence/);
});
