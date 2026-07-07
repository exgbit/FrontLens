import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.ts';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { createEmptyP2Result } from '../src/p2/p2Tester.ts';
import { createEmptySecurityResult, isLocalOrPrivateTarget } from '../src/security/securityScanner.ts';
import { deepMerge } from '../src/utils/deepMerge.ts';

test('default config enables complete non-destructive QA capabilities', () => {
  const config = createDefaultConfig('https://example.com/credentials');

  assert.equal(config.journeys.enabled, true);
  assert.ok(config.journeys.journeys.length >= 1);
  assert.equal(config.journeys.journeys[0].steps.some((step) => step.action === 'expectVisible'), true);

  assert.equal(config.p2.enabled, true);
  assert.equal(config.p2.visual.enabled, true);
  assert.equal(config.p2.budgets.enabled, true);
  assert.equal(config.p2.networkProfiles.enabled, true);
  assert.deepEqual(config.p2.networkProfiles.profiles, ['offline', 'slow-3g']);

  assert.equal(config.exception.enabled, true);
  assert.equal(config.analysis.ai, true);
  assert.equal(config.requirements.enabled, true);
  assert.equal(config.requirements.inferFromPage, true);

  assert.equal(config.safety.blockMutatingRequests, true);
  assert.equal(config.safety.allowCreate, false);
  assert.equal(config.safety.allowEdit, false);
  assert.equal(config.safety.allowDelete, false);
  assert.equal(config.safety.allowUpload, false);
  assert.equal(config.safety.allowSubmit, false);
});

test('disabled optional module placeholders are non-penalizing and clearly skipped', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  config.security.enabled = false;
  config.p2.enabled = false;

  const security = createEmptySecurityResult(config);
  const p2 = createEmptyP2Result(config);

  assert.equal(security.status, 'skipped');
  assert.equal(security.score, 100);
  assert.equal(p2.enabled, false);
  assert.equal(p2.visual.enabled, false);
  assert.equal(p2.visual.status, 'skipped');
});

test('enabled but uncollected security placeholder is skipped, not passed', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  const security = createEmptySecurityResult(config, 'Security scan was not collected.');
  assert.equal(security.enabled, true);
  assert.equal(security.status, 'skipped');
  assert.equal(security.summary.skippedCount, 1);
});

test('security scanner recognizes local and private targets as deployment/test environments', () => {
  assert.equal(isLocalOrPrivateTarget('file:///tmp/demo.html'), true);
  assert.equal(isLocalOrPrivateTarget('http://localhost:5173/credentials'), true);
  assert.equal(isLocalOrPrivateTarget('http://127.0.0.1:5173/credentials'), true);
  assert.equal(isLocalOrPrivateTarget('http://localhost.:5173/credentials'), true);
  assert.equal(isLocalOrPrivateTarget('http://host.docker.internal:5173/credentials'), true);
  assert.equal(isLocalOrPrivateTarget('http://100.67.147.98:5174/credentials'), true);
  assert.equal(isLocalOrPrivateTarget('http://192.168.1.10/admin'), true);
  assert.equal(isLocalOrPrivateTarget('http://[::ffff:127.0.0.1]/admin'), true);
  assert.equal(isLocalOrPrivateTarget('http://[fd00::1]/admin'), true);
  assert.equal(isLocalOrPrivateTarget('http://[fe80::1]/admin'), true);
  assert.equal(isLocalOrPrivateTarget('https://example.com/admin'), false);
});

test('config file relative paths resolve from config directory and invalid nested objects fail clearly', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-config-'));
  const schemaPath = path.join(dir, 'openapi.json');
  const configPath = path.join(dir, 'frontlens.json');
  await writeFile(schemaPath, '{"openapi":"3.0.0","paths":{}}', 'utf8');
  await writeFile(configPath, JSON.stringify({ contract: { schemaPath: 'openapi.json' } }), 'utf8');
  const config = await loadConfig({ url: 'https://example.com', configPath });
  assert.equal(config.contract.schemaPath, schemaPath);

  const badConfigPath = path.join(dir, 'bad.json');
  await writeFile(badConfigPath, JSON.stringify({ browser: null }), 'utf8');
  await assert.rejects(() => loadConfig({ url: 'https://example.com', configPath: badConfigPath }), /Invalid FrontLens config: browser must be an object/);
});

test('deepMerge ignores prototype pollution keys', () => {
  const merged = deepMerge({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'));
  assert.equal((merged as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
