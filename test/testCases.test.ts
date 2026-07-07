import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildTestCaseMatrix, formatTestCaseMatrix } from '../src/cases/testCases.ts';

test('test case matrix separates runtime-verified journeys from path-only coverage', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users' }
    },
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
          id: 'REQ-SEARCH',
          title: 'Search users',
          priority: 'P1',
          source: 'provided',
          status: 'passed',
          confidence: 'high',
          evidence: { selectors: [], componentIds: [], journeyIds: ['JOURNEY-001'], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: []
        }
      ],
      gaps: []
    },
    journeyTests: [
      {
        id: 'JOURNEY-001',
        name: 'Search path without assertion',
        status: 'passed',
        startedAt: '',
        endedAt: '',
        durationMs: 1,
        startUrl: 'https://example.com/users',
        steps: [{ index: 0, action: 'click', target: 'text=Search', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }]
      }
    ]
  });

  const journeyCase = result.testCases.items.find((item) => item.kind === 'journey' && item.journeyIds.includes('JOURNEY-001'));
  assert.equal(journeyCase?.status, 'partial');
  assert.match(journeyCase?.actual ?? '', /path-only|assertions=0/);
  assert.equal(result.testCases.summary.runtimeVerifiedCount, 0);
  assert.match(formatTestCaseMatrix(result.testCases), /FrontLens Test Case Matrix/);
});

test('test case matrix marks source health failures and artifact failures as blocked cases', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Admin' }
    },
    sourceHealth: {
      enabled: true,
      status: 'failed',
      checkedAt: '2026-07-07T00:00:00.000Z',
      packageManager: 'npm',
      packageScripts: [{ name: 'typecheck', command: 'vue-tsc --noEmit', category: 'typecheck' }],
      scriptChecks: [
        {
          id: 'SRC-SCRIPT-001',
          scriptName: 'typecheck',
          command: 'npm run typecheck',
          category: 'typecheck',
          status: 'failed',
          durationMs: 1200,
          exitCode: 2,
          stderrPreview: 'Type error'
        }
      ],
      scannedFiles: 1,
      parsedFiles: 1,
      skippedFiles: 0,
      syntaxErrorCount: 0,
      findings: []
    },
    artifactIntegrity: {
      status: 'failed',
      checkedAt: '2026-07-07T00:00:00.000Z',
      presentCount: 1,
      missingCount: 1,
      skippedCount: 0,
      entries: [],
      missing: [{ source: 'artifacts.screenshot', path: 'missing.png', kind: 'file', expected: true, exists: false }],
      summary: '1 missing artifact'
    }
  });

  assert.equal(result.testCases.status, 'blocked');
  assert.equal(result.testCases.summary.blockedCount >= 1, true);
  assert.equal(result.testCases.items.some((item) => item.kind === 'source-health' && item.status === 'blocked'), true);
  assert.equal(result.testCases.items.some((item) => item.kind === 'artifact' && item.status === 'blocked'), true);
});

test('buildTestCaseMatrix can be rebuilt from normalized result without mutating raw issue disposition', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/basic', title: 'Basic' },
    pageModel: {
      url: 'https://example.com/basic',
      title: 'Basic',
      stats: { domNodes: 10, visibleTextLength: 50, bodyTextSample: 'Basic' }
    },
    interactionTests: [
      { id: 'IT-001', kind: 'search', target: 'Search', status: 'skipped', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }
    ]
  });

  const rebuilt = buildTestCaseMatrix(result);
  assert.equal(rebuilt.summary.totalCount, result.testCases.summary.totalCount);
  assert.equal(rebuilt.items.some((item) => item.kind === 'interaction' && item.status === 'skipped'), true);
});
