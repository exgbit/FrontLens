import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeResult } from '../src/resultNormalizer.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function writeResult(): Promise<string> {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-cli-result-'));
  const reportPath = path.join(outputDir, 'result.json');
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      score: 88,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    artifacts: { outputDir },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 24, visibleTextLength: 120, bodyTextSample: 'Credentials' }
    },
    issues: [
      {
        id: 'ISSUE-001',
        title: '接口异常时缺少错误态',
        category: 'frontend-state',
        severity: 'high',
        confidence: 0.94,
        description: 'API failure is rendered as an empty state.',
        evidence: { selector: '.empty', networkRequestId: 'REQ-500', details: { sourceFile: 'src/views/CredentialsView.vue', line: 88 } },
        reproduceSteps: ['Open page', 'Mock API 500'],
        reason: 'Users cannot distinguish an API failure from no data.',
        suggestion: { frontend: 'Render error state and retry action.', priority: 'P1' }
      }
    ]
  });
  await writeFile(reportPath, JSON.stringify(result, null, 2));
  return reportPath;
}

function runCli(command: string, reportPath: string, extra: string[] = []): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', command, '--report', reportPath, ...extra], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('guardrail result commands expose professional QA gates', async () => {
  const reportPath = await writeResult();

  assert.match(runCli('claim-guard', reportPath), /FrontLens Claim Guard/);
  assert.match(runCli('defect-proof', reportPath), /FrontLens Defect Proof/);
  assert.match(runCli('defect-tickets', reportPath), /FrontLens Defect Tickets/);
  assert.match(runCli('traceability', reportPath), /FrontLens Traceability Matrix/);
  assert.match(runCli('automation-specs', reportPath), /FrontLens Automation Specs/);
  assert.match(runCli('evidence-bundle', reportPath), /FrontLens Evidence Bundle/);
  assert.match(runCli('test-strategy', reportPath), /FrontLens QA Test Strategy/);
  assert.match(runCli('business-journeys', reportPath), /FrontLens Business Journeys/);
  assert.match(runCli('report-content-audit', reportPath), /FrontLens Report Content Audit/);
  assert.match(runCli('journey-assertion-audit', reportPath), /FrontLens Journey Assertion Audit/);

  assert.ok(['limited', 'blocked'].includes(JSON.parse(runCli('claim-guard', reportPath, ['--json'])).status));
  assert.ok(['ready', 'needs-evidence'].includes(JSON.parse(runCli('defect-proof', reportPath, ['--json'])).status));
  assert.ok(['ready', 'empty', 'needs-evidence'].includes(JSON.parse(runCli('defect-tickets', reportPath, ['--json'])).status));
  assert.ok(['ready', 'partial', 'needs-input', 'blocked'].includes(JSON.parse(runCli('traceability', reportPath, ['--json'])).status));
  assert.ok(['ready', 'partial', 'needs-input', 'skipped'].includes(JSON.parse(runCli('automation-specs', reportPath, ['--json'])).status));
  assert.ok(['ready', 'partial', 'blocked', 'empty'].includes(JSON.parse(runCli('evidence-bundle', reportPath, ['--json'])).status));
  assert.ok(['ready', 'needs-input', 'blocked'].includes(JSON.parse(runCli('test-strategy', reportPath, ['--json'])).status));
  assert.ok(['ready', 'needs-input', 'manual-required', 'skipped'].includes(JSON.parse(runCli('business-journeys', reportPath, ['--json'])).status));
  assert.equal(typeof JSON.parse(runCli('report-content-audit', reportPath, ['--json'])).status, 'string');
  assert.equal(typeof JSON.parse(runCli('journey-assertion-audit', reportPath, ['--json'])).status, 'string');
});
