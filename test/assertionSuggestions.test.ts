import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildAssertionSuggestions, formatAssertionSuggestions } from '../src/journeys/assertionSuggestions.ts';

test('assertion suggestions turn path-only journeys into concrete expect steps', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      meta: { h1: ['Users'] },
      headings: [{ level: 1, text: 'Users' }],
      buttons: [{ id: 'BTN-001', type: 'button', text: 'Search', selector: 'button.search', visible: true, attributes: {}, confidence: 0.9 }],
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Search' }
    },
    network: {
      requests: [
        {
          id: 'REQ-001',
          url: 'https://example.com/api/users?q=alice',
          method: 'GET',
          resourceType: 'fetch',
          requestHeaders: {},
          status: 200,
          ok: true,
          failed: false,
          startedAt: '2026-07-07T00:00:00.000Z'
        }
      ]
    },
    journeyTests: [
      {
        id: 'JOURNEY-001',
        name: 'Search users',
        status: 'passed',
        startedAt: '',
        endedAt: '',
        durationMs: 1,
        startUrl: 'https://example.com/users',
        steps: [{ index: 0, action: 'click', target: 'button.search', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, networkRequestIds: ['REQ-001'] }]
      }
    ]
  });

  const suggestions = buildAssertionSuggestions(result);
  assert.equal(suggestions.status, 'ready');
  assert.equal(suggestions.summary.weakJourneyCount, 1);
  assert.equal(suggestions.items.some((item) => item.journeyId === 'JOURNEY-001' && item.action === 'expectText'), true);
  assert.equal(suggestions.items.some((item) => item.journeyId === 'JOURNEY-001' && item.action === 'expectRequest' && item.target.includes('/api/users')), true);
  assert.match(formatAssertionSuggestions(suggestions), /FrontLens Assertion Suggestions/);
});

test('assertion suggestions create requirement-bound drafts for uncovered provided requirements', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/orders', title: 'Orders' },
    pageModel: {
      url: 'https://example.com/orders',
      title: 'Orders',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Orders List' },
      components: [{ id: 'CMP-001', type: 'section', selector: '[data-testid="orders-list"]', visible: true, attributes: {}, confidence: 0.9 }]
    }
  });
  result.requirementCoverage = {
      enabled: true,
      checkedAt: '2026-07-07T00:00:00.000Z',
      source: 'provided',
      summary: {
        requirementCount: 1,
        passedCount: 0,
        failedCount: 0,
        partialCount: 0,
        notCoveredCount: 1,
        notApplicableCount: 0,
        providedCount: 1,
        inferredCount: 0,
        highPriorityGapCount: 1
      },
      items: [
        {
          id: 'REQ-ORDERS-LIST',
          title: 'Orders list is visible',
          priority: 'P1',
          source: 'provided',
          status: 'not-covered',
          confidence: 'medium',
          evidence: { selectors: ['[data-testid="orders-list"]'], componentIds: [], journeyIds: [], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: ['No executable journey assertion.']
        }
      ],
      gaps: ['No executable journey assertion.']
  };
  result.assertionSuggestions = buildAssertionSuggestions(result);

  assert.equal(result.assertionSuggestions.summary.requirementSuggestionCount >= 1, true);
  assert.equal(result.assertionSuggestions.items.some((item) => item.requirementId === 'REQ-ORDERS-LIST' && item.action === 'expectVisible'), true);
});
