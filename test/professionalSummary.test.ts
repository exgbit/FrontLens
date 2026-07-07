import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, RESULT_SCHEMA_VERSION } from '../src/resultNormalizer.ts';

test('professional summary separates actionable defects from product decisions and next actions', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials' },
    metadata: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      config: {
        productContext: {
          enabled: true,
          deviceScope: 'desktop-first',
          optionalFeatures: ['mobile-touch-target'],
          outOfScopeFeatures: ['export'],
          requiredFeatures: ['error-state']
        }
      }
    },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 80, visibleTextLength: 400, bodyTextSample: 'Credentials empty state' }
    },
    issues: [
      {
        id: 'ISSUE-001',
        title: '接口 500 时没有错误态反馈',
        category: 'frontend-state',
        severity: 'high',
        confidence: 0.95,
        description: 'API 500 is rendered as empty state.',
        evidence: { selector: '.empty', networkRequestId: 'REQ-500' },
        reproduceSteps: ['Open page', 'Mock API 500'],
        reason: 'error state is required but not rendered',
        suggestion: { frontend: 'Render error state with retry.', priority: 'P1' }
      },
      {
        id: 'ISSUE-002',
        title: '移动端触控目标小于 32px',
        category: 'frontend-accessibility',
        severity: 'medium',
        confidence: 0.9,
        description: 'Tap target is small on mobile viewport.',
        evidence: { selector: '.icon-button' },
        reproduceSteps: ['Open 390px viewport'],
        reason: 'desktop-first product context makes this optional',
        suggestion: { product: 'Confirm mobile target scope.', priority: 'P3' }
      }
    ]
  });

  assert.equal(result.metadata.schemaVersion, RESULT_SCHEMA_VERSION);
  assert.equal(result.professionalSummary.status, 'fail');
  assert.equal(result.professionalSummary.mustFix.length, 1);
  assert.equal(result.professionalSummary.mustFix[0].issueIds?.includes('ISSUE-001'), true);
  assert.ok(result.professionalSummary.nonDefectObservations.some((item) => item.kind === 'product-decision' && item.issueIds?.includes('ISSUE-002')));
  assert.ok(result.professionalSummary.nextActions.some((item) => item.kind === 'next-action'));
  assert.match(result.professionalSummary.headline, /QA failed/);
});
