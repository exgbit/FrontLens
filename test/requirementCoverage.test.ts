import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { loadConfig } from '../src/config.ts';
import { buildRequirementCoverage } from '../src/requirements/requirementCoverage.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';

test('requirements file loads acceptance criteria into config', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-req-'));
  const requirementsPath = path.join(dir, 'requirements.json');
  await writeFile(
    requirementsPath,
    JSON.stringify([
      {
        id: 'REQ-SEARCH',
        title: 'Search filters visible results',
        priority: 'P1',
        interactionKinds: ['search']
      }
    ]),
    'utf8'
  );
  const config = await loadConfig({ url: 'https://example.com/users', requirementsPath });
  assert.equal(config.requirements.enabled, true);
  assert.equal(config.requirements.inferFromPage, false);
  assert.equal(config.requirements.items.length, 1);
  assert.equal(config.requirements.items[0].id, 'REQ-SEARCH');
});

test('requirement coverage marks explicit journey-backed requirement as passed', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.requirements.inferFromPage = false;
  config.requirements.items = [
    {
      id: 'REQ-SMOKE',
      title: 'Users page opens',
      priority: 'P1',
      journeyNames: ['Users smoke']
    }
  ];

  const coverage = buildRequirementCoverage({
    config,
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      meta: { h1: [], openGraph: {} },
      breadcrumbs: [],
      headings: [],
      structureTree: 'body',
      components: [],
      forms: [],
      tables: [],
      buttons: [],
      inputs: [],
      images: [],
      links: [],
      stats: { domNodes: 10, visibleTextLength: 100, bodyTextSample: 'Users' }
    },
    networkRecords: [],
    issues: [],
    journeyTests: [{ id: 'JOURNEY-001', name: 'Users smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, startUrl: 'https://example.com/users', steps: [] }],
    interactionTests: [],
    accessibilityChecks: []
  });

  assert.equal(coverage.summary.requirementCount, 1);
  assert.equal(coverage.items[0].status, 'passed');
  assert.equal(coverage.items[0].confidence, 'high');
  assert.equal(coverage.summary.highPriorityGapCount, 0);
});

test('uncovered P1 requirement fails the QA quality gate', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Users' }
    },
    metadata: {
      config: {
        target: { url: 'https://example.com/users' },
        requirements: {
          enabled: true,
          inferFromPage: false,
          items: [{ id: 'REQ-EXPORT', title: 'Export includes selected rows', priority: 'P1', interactionKinds: ['download'] }]
        }
      }
    },
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com/users', steps: [] }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'page-refresh', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }]
  });

  assert.equal(result.requirementCoverage.items[0].status, 'not-covered');
  assert.equal(result.requirementCoverage.summary.highPriorityGapCount, 1);
  assert.equal(result.qualityGate.status, 'fail');
});
