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
  assert.equal(result.sourceHealth.status, 'skipped');
  assert.equal(result.sourceHealth.syntaxErrorCount, 0);
  assert.equal(result.sourceHealth.scriptChecks.length, 0);
  assert.equal(result.environment.kind, 'unknown');
  assert.equal(result.environment.trust.performance, 'low');
  assert.equal(result.fixTasks.length, 1);
  assert.equal(result.rootCauseGroups.length, 1);
  assert.equal(result.rootCauseGroups[0].issueCount, 1);
  assert.equal(result.rootCauseGroups[0].owner, 'backend');
  assert.equal(result.issueDisposition.summary.actionableCount, 1);
  assert.equal(result.issueDisposition.items[0].status, 'confirmed');
  assert.equal(result.fixTasks[0].owner, 'backend');
  assert.match(result.fixTasks[0].verificationCommand, /node dist\/cli\.js qa --url/);
  assert.ok(result.issues[0].fingerprint);
  assert.equal(result.qualityGate.status, 'fail');
  assert.equal(result.qualityGate.blockingIssueCount, 1);
  assert.equal(result.qaSignoff.status, 'fail');
  assert.equal(result.qaSignoff.businessValidationConfidence, 'not-verified');
});

test('normalizeResult preserves sourceHealth script checks from reports', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com' },
    sourceHealth: {
      enabled: true,
      status: 'failed',
      checkedAt: '2026-01-01T00:00:00.000Z',
      packageManager: 'npm',
      packageScripts: [{ name: 'typecheck', command: 'vue-tsc --noEmit', category: 'typecheck' }],
      scriptChecks: [
        {
          id: 'SRC-SCRIPT-001',
          scriptName: 'typecheck',
          command: 'npm run typecheck',
          category: 'typecheck',
          status: 'timed-out',
          durationMs: 120000,
          signal: 'SIGTERM',
          stderrPreview: 'timeout'
        }
      ],
      scannedFiles: 1,
      parsedFiles: 1,
      skippedFiles: 0,
      syntaxErrorCount: 0,
      findings: []
    }
  });

  assert.equal(result.sourceHealth.scriptChecks.length, 1);
  assert.equal(result.sourceHealth.scriptChecks[0].status, 'timed-out');
  assert.equal(result.sourceHealth.scriptChecks[0].category, 'typecheck');
  assert.equal(result.sourceHealth.scriptChecks[0].signal, 'SIGTERM');
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
  assert.equal(result.qualityGate.status, 'fail');
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

test('normalizeResult backfills quality gate pass-with-risks from coverage gaps', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Example' },
    pageModel: {
      url: 'https://example.com',
      title: 'Example',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'ok' }
    },
    issues: [],
    interactionTests: [{ id: 'IT-001', kind: 'search', target: 'search', status: 'skipped', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }],
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com', steps: [] }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'page-refresh', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }]
  });
  assert.equal(result.qualityGate.status, 'pass-with-risks');
  assert.equal(result.qualityGate.confidence, 'medium');
  assert.equal(result.qualityGate.coverageGapCount >= 1, true);
});

test('normalizeResult marks navigation blocker as blocked quality gate', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com' },
    pageModel: { url: 'https://example.com', structureTree: '页面加载失败', stats: { domNodes: 0, visibleTextLength: 0, bodyTextSample: '' } },
    issues: [
      {
        title: '页面打开失败或导航超时',
        category: 'frontend-routing',
        severity: 'critical',
        confidence: 0.96,
        description: 'timeout',
        evidence: {},
        reproduceSteps: [],
        reason: 'navigation failed',
        suggestion: { frontend: 'fix route', priority: 'P0' }
      }
    ]
  });
  assert.equal(result.qualityGate.status, 'blocked');
  assert.equal(result.qualityGate.confidence, 'low');
});

test('normalizeResult preserves artifact integrity summaries from reports', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com' },
    artifactIntegrity: {
      status: 'failed',
      checkedAt: '2026-01-01T00:00:00.000Z',
      presentCount: 1,
      missingCount: 1,
      skippedCount: 0,
      entries: [
        { source: 'artifacts.screenshot', path: '/tmp/missing.png', kind: 'file', expected: true, exists: false, message: 'missing' }
      ],
      missing: [
        { source: 'artifacts.screenshot', path: '/tmp/missing.png', kind: 'file', expected: true, exists: false, message: 'missing' }
      ],
      summary: '1 missing'
    }
  });
  assert.equal(result.artifactIntegrity.status, 'failed');
  assert.equal(result.artifactIntegrity.missingCount, 1);
  assert.equal(result.artifactIntegrity.missing[0].source, 'artifacts.screenshot');
});


test('normalizeResult preserves quality gate when requirement coverage is absent', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com' },
    qualityGate: {
      status: 'pass-with-risks',
      confidence: 'medium',
      checkedAt: '2026-01-01T00:00:00.000Z',
      actionableIssueCount: 0,
      referenceIssueCount: 0,
      blockingIssueCount: 0,
      mediumRiskCount: 0,
      coverageGapCount: 1,
      coverageGaps: ['manual gap'],
      reasons: ['manual reason'],
      summary: 'manual gate'
    }
  });
  assert.equal(result.qualityGate.status, 'pass-with-risks');
  assert.equal(result.qualityGate.summary, 'manual gate');
  assert.deepEqual(result.qualityGate.reasons, ['manual reason']);
});
