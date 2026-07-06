import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, RESULT_SCHEMA_VERSION } from '../src/resultNormalizer.ts';

test('normalizeResult backfills stable contract fields and synthesized fix tasks', () => {
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/admin',
      title: 'Admin',
      score: 77,
      testedAt: '2026-01-01T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin'
    },
    issues: [
      {
        title: '接口异常',
        category: 'backend-api-status',
        severity: 'high',
        confidence: 0.91,
        description: 'API returned 500',
        evidence: { networkRequestId: 'REQ-0001' },
        reproduceSteps: ['Open page'],
        reason: 'Server error',
        suggestion: { backend: 'Fix endpoint', priority: 'P1' },
        source: 'rule'
      }
    ],
    metadata: {
      schemaVersion: RESULT_SCHEMA_VERSION,
      durationMs: 100
    }
  });

  assert.equal(result.summary.issueCount, 1);
  assert.equal(result.summary.highCount, 1);
  assert.equal(result.coverage.status, 'skipped');
  assert.equal(result.security.status, 'skipped');
  assert.equal(result.security.score, 100);
  assert.equal(result.apiContract.summary.endpointCount, 0);
  assert.equal(result.realtime.summary.graphqlOperationCount, 0);
  assert.equal(result.fixTasks.length, 1);
  assert.equal(result.fixTasks[0].owner, 'backend');
  assert.match(result.fixTasks[0].verificationCommand, /node dist\/cli\.js qa --url/);
  assert.ok(result.issues[0].fingerprint);
});

test('normalizeResult recalculates missing score and normalizes P2 child records', () => {
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/admin',
      title: 'Admin',
      testedAt: '2026-01-01T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    issues: [
      {
        title: '高风险问题',
        category: 'frontend-state',
        severity: 'high',
        confidence: 1,
        description: 'failed',
        evidence: {},
        reproduceSteps: [],
        reason: 'state failed',
        suggestion: { frontend: 'fix', priority: 'P1' }
      }
    ],
    p2: {
      enabled: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
      visual: { enabled: true, status: 'bad-status' },
      budgets: [{ metric: 'load', actual: 10, budget: 1, status: 'bad-status', unit: 'ms' }],
      networkProfiles: [{ profile: 'slow-3g', status: 'bad-status', observations: ['x'] }]
    }
  });

  assert.equal(result.summary.score, 88);
  assert.equal(result.p2.visual.status, 'skipped');
  assert.equal(result.p2.budgets[0].status, 'skipped');
  assert.equal(result.p2.networkProfiles[0].profile, 'slow-3g');
  assert.equal(result.p2.networkProfiles[0].status, 'skipped');
});

test('normalizeResult treats missing or skipped security as non-penalizing', () => {
  assert.equal(normalizeResult({ summary: { url: 'https://example.com' } }).security.score, 100);
  assert.equal(normalizeResult({ summary: { url: 'https://example.com' }, security: { enabled: false, status: 'skipped' } }).security.score, 100);
  assert.equal(normalizeResult({ summary: { url: 'https://example.com' }, security: { enabled: false, status: 'skipped', score: 0 } }).security.score, 100);
});

test('normalizeResult tolerates malformed nested performance objects', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com' },
    performance: { paint: null, longTasks: null, layoutShift: null, resources: null, dom: null, mutations: null }
  });
  assert.equal(result.performance.longTasks.count, 0);
  assert.equal(result.performance.resources.slowest.length, 0);
});
