import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, RESULT_SCHEMA_VERSION } from '../src/resultNormalizer.ts';

test('normalizeResult synthesizes regression plan from root causes, source blockers, and downloads', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      stats: { domNodes: 50, visibleTextLength: 200, bodyTextSample: 'Admin export' }
    },
    issues: [
      {
        id: 'ISSUE-001',
        title: '接口错误态没有反馈',
        category: 'frontend-state',
        severity: 'high',
        confidence: 0.95,
        description: 'API failure is rendered as an empty state.',
        evidence: { selector: '.empty-state', networkRequestId: 'REQ-0001' },
        reproduceSteps: ['Open page', 'Mock API 500'],
        reason: 'error ref is not rendered',
        suggestion: { frontend: 'Render error state with retry action.', priority: 'P1' }
      }
    ],
    interactionTests: [
      {
        id: 'IT-EXPORT',
        kind: 'download',
        target: 'Export CSV',
        status: 'failed',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        actions: ['click export'],
        observations: {
          networkRequestIds: ['REQ-EXPORT'],
          downloadSizeBytes: 0,
          downloadContent: { kind: 'empty', parseStatus: 'failed', issue: 'Downloaded file is empty.' }
        },
        issue: 'Download did not produce a usable file.'
      }
    ],
    journeyTests: [
      { id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com/admin', steps: [] }
    ],
    exceptionSimulations: [{ id: 'EX-001', kind: 'api-500', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }],
    metadata: { schemaVersion: RESULT_SCHEMA_VERSION },
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
          status: 'failed',
          durationMs: 1234,
          exitCode: 2,
          stderrPreview: 'Type error'
        }
      ],
      scannedFiles: 1,
      parsedFiles: 1,
      skippedFiles: 0,
      syntaxErrorCount: 0,
      findings: []
    }
  });

  assert.equal(result.metadata.schemaVersion, RESULT_SCHEMA_VERSION);
  assert.equal(result.regressionPlan.status, 'blocked');
  assert.ok(result.regressionPlan.summary.itemCount >= 4);
  assert.ok(result.regressionPlan.items.some((item) => item.type === 'full-rerun'));
  assert.ok(result.regressionPlan.items.some((item) => item.type === 'root-cause' && item.issueIds?.includes('ISSUE-001')));
  assert.ok(result.regressionPlan.items.some((item) => item.type === 'download' && item.evidenceRefs.includes('IT-EXPORT')));
  const sourceItem = result.regressionPlan.items.find((item) => item.type === 'source-health' && item.evidenceRefs.includes('SRC-SCRIPT-001'));
  assert.equal(sourceItem?.status, 'blocked');
  assert.ok(result.regressionPlan.commands.some((command) => command.includes('node dist/cli.js qa --url')));
});
