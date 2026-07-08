import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomationSpecs, formatAutomationSpecs } from '../src/automation/automationSpecs.ts';

test('automation specs generate reviewable Playwright drafts from requirements and assertion suggestions', () => {
  const result = {
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users Create Save' } },
    requirementCoverage: {
      enabled: true,
      checkedAt: '2026-07-07T00:00:00.000Z',
      source: 'provided',
      summary: {
        requirementCount: 1,
        passedCount: 1,
        failedCount: 0,
        partialCount: 0,
        notCoveredCount: 0,
        notApplicableCount: 0,
        providedCount: 1,
        inferredCount: 0,
        highPriorityGapCount: 0
      },
      items: [
        {
          id: 'REQ-USERS-LIST',
          title: 'Users list is visible',
          priority: 'P1',
          source: 'provided',
          status: 'passed',
          confidence: 'high',
          evidence: { selectors: ['[data-testid="users-list"]'], componentIds: ['CMP-001'], journeyIds: [], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: []
        }
      ],
      gaps: []
    },
    assertionSuggestions: {
      generatedAt: '2026-07-07T00:00:00.000Z',
      status: 'ready',
      summary: { totalCount: 1, journeySuggestionCount: 0, requirementSuggestionCount: 1, highConfidenceCount: 1, weakJourneyCount: 0, needsInputCount: 0 },
      items: [
        {
          id: 'ASSERT-001',
          source: 'requirement',
          priority: 'P1',
          action: 'expectText',
          target: 'body',
          value: 'Users',
          requirementId: 'REQ-USERS-LIST',
          confidence: 'high',
          reason: 'Users text proves the list shell rendered.',
          evidenceRefs: ['REQ-USERS-LIST'],
          exampleStep: '{ "action": "expectText", "target": "body", "value": "Users" }',
          notes: []
        }
      ],
      notes: []
    }
  } as any;
  result.testCases = { items: [] };
  result.journeyTests = [];
  result.traceability = { status: 'ready' };
  result.qaSignoff = { status: 'pass' };

  const specs = buildAutomationSpecs(result);
  assert.equal(specs.status, 'ready');
  assert.equal(specs.summary.readyCount >= 1, true);
  assert.equal(specs.summary.requirementLinkedCount >= 1, true);
  assert.match(specs.specSource, /@playwright\/test/);
  assert.match(specs.specSource, /FRONTLENS_TARGET_URL/);
  assert.match(specs.specSource, /data-testid/);
  assert.match(formatAutomationSpecs(specs), /FrontLens Automation Specs/);
  assert.match(formatAutomationSpecs(specs), /REQ-USERS-LIST/);
});

test('automation specs keep manual or request-only work as needs-input instead of overclaiming execution', () => {
  const result = {
    summary: { url: 'https://example.com/orders', title: 'Orders' },
    pageModel: { url: 'https://example.com/orders', title: 'Orders', stats: { domNodes: 10, visibleTextLength: 50, bodyTextSample: 'Orders' } },
    requirementCoverage: {
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
          id: 'REQ-EXPORT',
          title: 'Export orders',
          priority: 'P1',
          source: 'provided',
          status: 'not-covered',
          confidence: 'low',
          evidence: { selectors: [], componentIds: [], journeyIds: [], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: ['No reviewed test data or download assertion.']
        }
      ],
      gaps: ['Missing export assertions.']
    },
    assertionSuggestions: {
      generatedAt: '2026-07-07T00:00:00.000Z',
      status: 'needs-input',
      summary: { totalCount: 1, journeySuggestionCount: 0, requirementSuggestionCount: 1, highConfidenceCount: 0, weakJourneyCount: 0, needsInputCount: 1 },
      items: [
        {
          id: 'ASSERT-REQ',
          source: 'api',
          priority: 'P1',
          action: 'expectRequest',
          target: '/api/orders/export',
          requirementId: 'REQ-EXPORT',
          confidence: 'medium',
          reason: 'Export endpoint should be observed.',
          evidenceRefs: ['REQ-EXPORT'],
          exampleStep: '{ "action": "expectRequest", "target": "/api/orders/export" }',
          notes: ['Needs a safe click and download fixture.']
        }
      ],
      notes: []
    }
  } as any;
  result.testCases = { items: [] };
  result.journeyTests = [];
  result.traceability = { status: 'ready' };
  result.qaSignoff = { status: 'pass' };

  const specs = buildAutomationSpecs(result);
  assert.equal(specs.status, 'needs-input');
  assert.equal(specs.summary.readyCount, 0);
  assert.equal(specs.summary.needsInputCount >= 1, true);
  assert.match(specs.specSource, /TODO\(manual-review\)/);
  assert.doesNotMatch(specs.specSource, /not\.toThrow/);
});
