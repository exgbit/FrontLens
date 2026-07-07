import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyAssertionAudit, formatJourneyAssertionAudit } from '../src/journeys/journeyAssertionAudit.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';

function resultWithJourneys(journeyTests: unknown[], requirements: unknown[] = []) {
  return normalizeResult({
    summary: { url: 'https://example.com/app', title: 'App', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    metadata: { config: { requirements: { enabled: requirements.length > 0, inferFromPage: false, items: requirements } } },
    pageModel: { url: 'https://example.com/app', title: 'App', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'App saved' } },
    journeyTests
  });
}

test('journey assertion audit marks click/fill-only passed journeys as path-only warnings', () => {
  const result = resultWithJourneys([
    {
      id: 'J-001',
      name: 'Edit profile',
      status: 'passed',
      startedAt: '',
      endedAt: '',
      durationMs: 10,
      startUrl: 'https://example.com/app',
      steps: [
        { index: 1, action: 'click', target: '#edit', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
        { index: 2, action: 'fill', target: '#name', value: 'Ada', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
        { index: 3, action: 'click', target: '#save', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }
      ]
    }
  ]);

  const audit = buildJourneyAssertionAudit(result);

  assert.equal(audit.status, 'warning');
  assert.equal(audit.summary.pathOnlyJourneyCount, 1);
  assert.equal(audit.findings.some((item) => item.category === 'missing-assertion' && item.severity === 'warning'), true);
  assert.match(formatJourneyAssertionAudit(audit), /Journey Assertion Audit/);
});

test('journey assertion audit blocks requirement-generated journeys without assertions', () => {
  const result = resultWithJourneys([
    {
      id: 'J-REQ',
      name: 'Search users',
      source: 'requirement-generated',
      requirementIds: ['REQ-SEARCH'],
      status: 'passed',
      startedAt: '',
      endedAt: '',
      durationMs: 10,
      startUrl: 'https://example.com/app',
      steps: [
        { index: 1, action: 'fill', target: '#search', value: 'Ada', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
        { index: 2, action: 'press', target: '#search', value: 'Enter', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }
      ]
    }
  ], [
    { id: 'REQ-SEARCH', title: 'Search users', priority: 'P1', source: 'provided', journeySteps: [{ action: 'fill', target: '#search', value: 'Ada' }] }
  ]);

  const audit = buildJourneyAssertionAudit(result);

  assert.equal(audit.status, 'failed');
  assert.equal(audit.summary.blockerCount > 0, true);
  assert.equal(audit.findings.some((item) => item.category === 'missing-assertion' && item.severity === 'blocker'), true);
});

test('journey assertion audit distinguishes generic body checks from meaningful assertions', () => {
  const weak = resultWithJourneys([
    {
      id: 'J-WEAK',
      name: 'Open app',
      status: 'passed',
      startedAt: '',
      endedAt: '',
      durationMs: 10,
      startUrl: 'https://example.com/app',
      steps: [
        { index: 1, action: 'expectVisible', target: 'body', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }
      ]
    }
  ]);
  assert.equal(weak.journeyAssertionAudit.status, 'warning');
  assert.equal(weak.journeyAssertionAudit.summary.weaklyAssertedJourneyCount, 1);

  const strong = resultWithJourneys([
    {
      id: 'J-STRONG',
      name: 'Save profile',
      status: 'passed',
      startedAt: '',
      endedAt: '',
      durationMs: 10,
      startUrl: 'https://example.com/app',
      steps: [
        { index: 1, action: 'click', target: '#save', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
        { index: 2, action: 'expectText', target: '.toast', value: 'Saved', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }
      ]
    }
  ]);
  assert.equal(strong.journeyAssertionAudit.status, 'passed');
  assert.equal(strong.journeyAssertionAudit.summary.runtimeVerifiedJourneyCount, 1);
});
