import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildDefectProof } from '../src/proof/defectProof.ts';

function baseIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ISSUE-001',
    title: '保存按钮点击后没有反馈',
    category: 'frontend-ui',
    severity: 'high',
    confidence: 0.92,
    description: 'Clicking save does not show success or error state.',
    evidence: { selector: '.save-button', screenshot: 'screen.png', details: { sourceFile: 'src/views/UserView.vue', line: 42 } },
    reproduceSteps: ['Open page', 'Click save', 'Observe no feedback'],
    reason: 'Users cannot know whether the save action completed.',
    suggestion: { frontend: 'Render success/error feedback and add a regression assertion.', priority: 'P1' },
    ...overrides
  };
}

function baseResult(issueOverrides: Record<string, unknown> = {}) {
  return normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 40, bodyTextSample: 'Users Save' } },
    issues: [baseIssue(issueOverrides)]
  });
}

test('defect proof marks strong actionable root causes as proven', () => {
  const result = baseResult();
  result.scopeReview.status = 'configured';
  result.requirementCoverage.summary.providedCount = 1;
  result.requirementCoverage.items = [
    {
      id: 'REQ-SAVE-FEEDBACK',
      title: '保存后必须显示反馈',
      priority: 'P1',
      source: 'provided',
      status: 'failed',
      confidence: 'high',
      evidence: { selectors: ['.save-button'], texts: [], networkRequestIds: [], consoleIds: [], issueIds: ['ISSUE-001'], interactionTestIds: [], journeyIds: [] },
      gaps: ['No feedback after save']
    }
  ];

  const proof = buildDefectProof(result);
  assert.equal(proof.status, 'ready');
  assert.equal(proof.items[0].status, 'proven');
  assert.equal(proof.items[0].dimensions.sourceEvidence.strength, 'strong');
  assert.equal(proof.items[0].dimensions.requirementEvidence.strength, 'medium');
});

test('defect proof requires more evidence when source/runtime/product proof is weak', () => {
  const result = baseResult();
  result.issues = result.issues.map((issue) => ({ ...issue, evidence: {}, reproduceSteps: [], confidence: 0.6 }));
  result.rootCauseGroups = result.rootCauseGroups.map((group) => ({
    ...group,
    selectors: [],
    networkRequestIds: [],
    consoleIds: [],
    pageErrorIds: [],
    resourceUrls: []
  }));
  result.issueDisposition.items = result.issueDisposition.items.map((item) => ({ ...item, actionability: 'actionable' as const, status: 'confirmed' as const }));
  result.scopeReview.status = 'needs-input';
  result.sourceAnalysis.status = 'skipped';
  result.sourceRuntimeCorrelation.status = 'skipped';

  const proof = buildDefectProof(result);
  assert.equal(proof.status, 'blocked');
  assert.equal(proof.items[0].status, 'needs-evidence');
  assert.equal(proof.items[0].missingEvidence.some((item) => item.includes('runtimeEvidence')), true);
  assert.equal(proof.items[0].nextSteps.some((item) => item.includes('sourceRoot')), true);
});
