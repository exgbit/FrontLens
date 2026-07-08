import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildQaIntakeConfig } from '../src/intake/qaIntakeConfig.ts';
import { loadConfig } from '../src/config.ts';

test('qa intake config is a reusable reviewable FrontLens config pack', async () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    sourceAnalysis: { enabled: true, status: 'passed', root: '/repo/frontend', checkedAt: '', scannedFiles: 0, scannedBytes: 0, summary: {} },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Admin' }
    }
  });
  result.artifacts.qaIntakeConfig = 'qa-intake.config.json';

  const pack = buildQaIntakeConfig(result);
  const metadata = pack._frontlensQaIntake as Record<string, unknown>;
  const requirements = pack.requirements as { inferFromPage: boolean; items: unknown[] };

  assert.equal(metadata.reviewRequired, true);
  assert.match(String(metadata.rerunCommand), /qa-intake\.config\.json/);
  assert.equal(requirements.inferFromPage, false);
  assert.equal(requirements.items.length, 0);
  assert.equal(typeof pack.productContext, 'object');
  assert.equal(typeof pack.testData, 'object');
  assert.equal(typeof pack.safety, 'object');

  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-intake-config-'));
  const configPath = path.join(dir, 'qa-intake.config.json');
  await writeFile(configPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  const config = await loadConfig({ url: 'https://example.com/admin', configPath });

  assert.equal(config.requirements.inferFromPage, false);
  assert.equal(config.productContext.enabled, true);
  assert.equal(config.source.root, '/repo/frontend');
});

test('qa intake config carries assertion drafts without auto-enabling business pass', () => {
  const now = '2026-07-07T00:00:00.000Z';
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      headings: [{ level: 1, text: 'Admin Dashboard', selector: 'h1', visible: true }],
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Admin Dashboard' }
    },
    journeyTests: [
      {
        id: 'JT-001',
        name: 'Admin smoke',
        source: 'configured',
        status: 'passed',
        startedAt: now,
        endedAt: now,
        durationMs: 10,
        startUrl: 'https://example.com/admin',
        finalUrl: 'https://example.com/admin/dashboard',
        steps: [
          {
            index: 0,
            action: 'click',
            target: 'button[type=submit]',
            status: 'passed',
            startedAt: now,
            endedAt: now,
            durationMs: 10
          }
        ]
      }
    ]
  });

  const pack = buildQaIntakeConfig(result);
  const metadata = pack._frontlensQaIntake as {
    assertionSuggestions: { draftAssertionStepCount: number; reviewRequired: boolean; howToUse: string };
    draftAssertionSteps: Array<{ journeyId?: string; step: { action: string; target?: string; value?: string }; copyTo: string }>;
  };

  assert.equal(metadata.assertionSuggestions.reviewRequired, true);
  assert.ok(metadata.assertionSuggestions.draftAssertionStepCount > 0);
  assert.match(metadata.assertionSuggestions.howToUse, /Do not treat these drafts as passed evidence/);
  assert.ok(metadata.draftAssertionSteps.some((item) => item.journeyId === 'JT-001' && item.step.action.startsWith('expect')));
  assert.ok(metadata.draftAssertionSteps.every((item) => item.copyTo.includes('journeys') || item.copyTo.includes('requirements')));
  assert.equal(
    (pack.journeys as { journeys: unknown[] }).journeys.length,
    result.metadata.config.journeys.journeys.length
  );
});
