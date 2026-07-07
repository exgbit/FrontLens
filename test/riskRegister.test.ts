import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { formatRiskRegister } from '../src/risk/riskRegister.ts';

test('normalizeResult builds release risk register from source-health and professional QA gaps', () => {
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
  assert.ok(result.riskRegister.summary.releaseBlockingCount >= 1);
  assert.ok(result.riskRegister.items.some((item) => item.category === 'source-health' && item.blocksRelease));
  assert.ok(result.riskRegister.items.every((item) => item.exposure >= 1));
  assert.match(formatRiskRegister(result.riskRegister), /Risk Register/);
});
