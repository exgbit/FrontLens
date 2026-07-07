import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { loadConfig } from '../src/config.ts';
import { buildRequirementCoverage } from '../src/requirements/requirementCoverage.ts';
import { applyRequirementJourneySynthesis } from '../src/requirements/requirementJourneys.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';
import type { PageModel } from '../src/types.ts';

function pageModel(): PageModel {
  return {
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
  };
}

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
        interactionKinds: ['search'],
        selectors: ['body'],
        expectedTexts: ['Users'],
        journeySteps: [{ action: 'waitForLoad', description: 'wait for async data' }]
      }
    ]),
    'utf8'
  );
  const config = await loadConfig({ url: 'https://example.com/users', requirementsPath });
  assert.equal(config.requirements.enabled, true);
  assert.equal(config.requirements.inferFromPage, false);
  assert.equal(config.requirements.items.length, 1);
  assert.equal(config.requirements.items[0].id, 'REQ-SEARCH');
  assert.deepEqual(config.requirements.items[0].selectors, ['body']);
  assert.deepEqual(config.requirements.items[0].expectedTexts, ['Users']);
  assert.equal(config.requirements.items[0].journeySteps?.[0].action, 'waitForLoad');
});

test('requirement coverage treats journey without success assertions as partial', () => {
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
    pageModel: pageModel(),
    networkRecords: [],
    issues: [],
    journeyTests: [{ id: 'JOURNEY-001', name: 'Users smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, startUrl: 'https://example.com/users', steps: [] }],
    interactionTests: [],
    accessibilityChecks: []
  });

  assert.equal(coverage.summary.requirementCount, 1);
  assert.equal(coverage.items[0].status, 'partial');
  assert.equal(coverage.items[0].confidence, 'medium');
  assert.equal(coverage.items[0].gaps.some((gap) => gap.includes('缺少 expectVisible/expectText/expectUrl')), true);
  assert.equal(coverage.summary.highPriorityGapCount, 1);
});

test('explicit requirement assertions synthesize safe journeys and link coverage by requirement id', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.journeys.maxJourneys = 1;
  config.requirements.inferFromPage = false;
  config.requirements.items = [
    {
      id: 'REQ-USERS-VISIBLE',
      title: 'Users list is visible',
      priority: 'P1',
      selectors: ['body'],
      expectedTexts: ['Users'],
      apiPatterns: ['/api/users'],
      journeySteps: [{ action: 'waitForLoad', description: 'wait for users' }]
    }
  ];

  const generated = applyRequirementJourneySynthesis(config, pageModel());

  assert.equal(generated.length, 1);
  assert.equal(generated[0].source, 'requirement-generated');
  assert.deepEqual(generated[0].requirementIds, ['REQ-USERS-VISIBLE']);
  assert.equal(config.requirements.items[0].journeyNames?.includes(generated[0].name), true);
  assert.equal(config.journeys.maxJourneys >= config.journeys.journeys.length, true);
  assert.equal(generated[0].steps.some((step) => step.action === 'expectVisible' && step.target === 'body'), true);
  assert.equal(generated[0].steps.some((step) => step.action === 'expectText' && step.value === 'Users'), true);
  assert.equal(generated[0].steps.some((step) => step.action === 'expectRequest' && step.target === '/api/users' && step.value === '2xx'), true);

  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [],
    issues: [],
    journeyTests: [
      {
        id: 'JOURNEY-002',
        name: generated[0].name,
        source: 'requirement-generated',
        requirementIds: ['REQ-USERS-VISIBLE'],
        status: 'passed',
        startedAt: '',
        endedAt: '',
        durationMs: 1,
        startUrl: 'https://example.com/users',
        steps: [
          { index: 0, action: 'expectVisible', target: 'body', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
          { index: 1, action: 'expectText', target: 'body', value: 'Users', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 },
          { index: 2, action: 'expectRequest', target: '/api/users', value: '2xx', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, networkRequestIds: ['REQ-001'] }
        ]
      }
    ],
    interactionTests: [],
    accessibilityChecks: []
  });

  assert.equal(coverage.items[0].status, 'passed');
  assert.equal(coverage.items[0].confidence, 'high');
  assert.deepEqual(coverage.items[0].evidence.journeyIds, ['JOURNEY-002']);
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
