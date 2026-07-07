import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildRiskAcceptance, formatRiskAcceptance } from '../src/risk/riskAcceptance.ts';

test('risk acceptance turns blocked release risks into must-mitigate checklist items', () => {
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
    }
  });

  assert.equal(result.riskRegister.status, 'blocked');
  assert.equal(result.riskAcceptance.status, 'blocked');
  assert.ok(result.riskAcceptance.summary.mustMitigateCount >= 1);
  assert.ok(result.riskAcceptance.items.some((item) => item.decision === 'must-mitigate' && item.requiredApprovers.includes('engineering')));
  assert.match(formatRiskAcceptance(result.riskAcceptance), /FrontLens Risk Acceptance/);
});

test('risk acceptance requires explicit sign-off for high non-blocking risks without auto-closing them', () => {
  const acceptance = buildRiskAcceptance({
    riskRegister: {
      generatedAt: '2026-07-07T00:00:00.000Z',
      status: 'at-risk',
      summary: {
        totalCount: 1,
        criticalCount: 0,
        highCount: 1,
        mediumCount: 0,
        lowCount: 0,
        openCount: 1,
        blockedCount: 0,
        acceptedCount: 0,
        mitigatedCount: 0,
        releaseBlockingCount: 0
      },
      items: [
        {
          id: 'RISK-001',
          category: 'coverage',
          title: 'No role-matrix coverage for permission-sensitive page',
          impact: 'high',
          likelihood: 'medium',
          exposure: 6,
          level: 'high',
          status: 'open',
          owner: 'product',
          blocksRelease: false,
          evidenceRefs: ['qaCoverage', 'qaPlan'],
          trigger: 'Role expectations are not configured.',
          mitigation: 'Provide role storage states and expected allowed/forbidden text.',
          verification: 'Run frontlens role-matrix with explicit role contracts.'
        }
      ],
      notes: []
    }
  });

  assert.equal(acceptance.status, 'needs-acceptance');
  assert.equal(acceptance.summary.mustMitigateCount, 0);
  assert.equal(acceptance.summary.acceptanceRequiredCount, 1);
  assert.equal(acceptance.items[0].decision, 'needs-acceptance');
  assert.deepEqual(acceptance.items[0].requiredApprovers, ['qa', 'product', 'release-manager']);
  assert.match(formatRiskAcceptance(acceptance), /needs-acceptance/);
});
