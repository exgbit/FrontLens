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

test('synthetic exception traffic is excluded from normal requirement pass/fail attribution', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{ id: 'REQ-USERS', title: 'Users API works', priority: 'P0', apiPatterns: ['/api/users'], interactionKinds: ['search'] }];
  const networkRecords = [
    { id: 'REQ-NORMAL', url: 'https://example.com/api/users', method: 'GET', resourceType: 'fetch', requestHeaders: {}, status: 200, failed: false, startedAt: '' },
    { id: 'REQ-SYNTHETIC-500', url: 'https://example.com/api/users', method: 'GET', resourceType: 'fetch', requestHeaders: {}, status: 500, failed: false, startedAt: '' }
  ];
  const common = {
    config,
    pageModel: pageModel(),
    networkRecords,
    issues: [],
    journeyTests: [],
    interactionTests: [{ id: 'IT-SEARCH', kind: 'search' as const, target: 'Search', status: 'passed' as const, startedAt: '', endedAt: '', durationMs: 1, actions: [], observations: {} }],
    accessibilityChecks: []
  };

  assert.equal(buildRequirementCoverage(common).items[0].status, 'failed');
  const filtered = buildRequirementCoverage({ ...common, excludedNetworkRequestIds: ['REQ-SYNTHETIC-500'] });
  assert.equal(filtered.items[0].status, 'passed');
  assert.deepEqual(filtered.items[0].evidence.networkRequestIds, ['REQ-NORMAL']);
});

test('requirement API evidence respects an explicitly declared HTTP method', () => {
  const config = createDefaultConfig('https://example.com/users/1');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{ id: 'REQ-DELETE', title: 'Delete user', priority: 'P0', apiPatterns: ['DELETE /api/users/1'] }];
  const common = {
    config,
    pageModel: pageModel(),
    issues: [],
    journeyTests: [],
    interactionTests: [],
    accessibilityChecks: []
  };
  const wrongMethod = buildRequirementCoverage({
    ...common,
    networkRecords: [{ id: 'GET-1', url: 'https://example.com/api/users/1', method: 'GET', resourceType: 'fetch', requestHeaders: {}, status: 200, failed: false, startedAt: '' }]
  });
  assert.equal(wrongMethod.items[0].status, 'not-covered');
  const matchingMethod = buildRequirementCoverage({
    ...common,
    networkRecords: [{ id: 'DELETE-1', url: 'https://example.com/api/users/1', method: 'DELETE', resourceType: 'fetch', requestHeaders: {}, status: 204, failed: false, startedAt: '' }]
  });
  assert.equal(matchingMethod.items[0].status, 'partial');
  assert.deepEqual(matchingMethod.items[0].evidence.networkRequestIds, ['DELETE-1']);
});

test('requirement API evidence matches OpenAPI-style path parameters without conflating methods', () => {
  const config = createDefaultConfig('https://example.com/users/42');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{ id: 'REQ-DETAIL', title: 'User detail', priority: 'P1', apiPatterns: ['GET /api/users/{id}'] }];
  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [
      { id: 'DELETE-42', url: 'https://example.com/api/users/42', method: 'DELETE', resourceType: 'fetch', requestHeaders: {}, status: 204, failed: false, startedAt: '' },
      { id: 'GET-42', url: 'https://example.com/api/users/42?include=role', method: 'GET', resourceType: 'fetch', requestHeaders: {}, status: 200, failed: false, startedAt: '' }
    ],
    issues: [], journeyTests: [], interactionTests: [], accessibilityChecks: []
  });
  assert.equal(coverage.items[0].status, 'partial');
  assert.deepEqual(coverage.items[0].evidence.networkRequestIds, ['GET-42']);
});

test('an explicitly expected 403 is acceptance evidence rather than a failed network request', () => {
  const config = createDefaultConfig('https://example.com/users/42');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{
    id: 'REQ-FORBIDDEN',
    title: '普通用户删除必须返回 403',
    description: '普通用户直接调用 DELETE /api/users/{id} 必须返回 403。',
    priority: 'P0',
    apiPatterns: ['DELETE /api/users/{id}']
  }];
  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [{ id: 'DELETE-403', url: 'https://example.com/api/users/42', method: 'DELETE', resourceType: 'fetch', requestHeaders: {}, status: 403, failed: false, startedAt: '' }],
    issues: [], journeyTests: [], interactionTests: [], accessibilityChecks: []
  });
  assert.equal(coverage.items[0].status, 'partial');
  assert.doesNotMatch(coverage.items[0].gaps.join(' '), /接口失败|4xx\/5xx/);
  assert.deepEqual(coverage.items[0].evidence.networkRequestIds, ['DELETE-403']);
});

test('multi-API requirement rejects statuses swapped between operations', () => {
  const config = createDefaultConfig('https://example.com/users/42');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{
    id: 'REQ-MULTI-API',
    title: '用户读取和删除权限',
    description: 'GET /api/users/{id} 返回 200；DELETE /api/users/{id} 返回 403。',
    priority: 'P0',
    apiPatterns: ['GET /api/users/{id}', 'DELETE /api/users/{id}'],
    interactionKinds: ['search']
  }];
  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [
      { id: 'GET-WRONG', url: 'https://example.com/api/users/42', method: 'GET', resourceType: 'fetch', requestHeaders: {}, status: 403, failed: false, startedAt: '' },
      { id: 'DELETE-WRONG', url: 'https://example.com/api/users/42', method: 'DELETE', resourceType: 'fetch', requestHeaders: {}, status: 200, failed: false, startedAt: '' }
    ],
    issues: [], journeyTests: [], accessibilityChecks: [],
    interactionTests: [{ id: 'IT-PASS', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, actions: [], observations: {} }]
  });
  assert.equal(coverage.items[0].status, 'failed');
  assert.match(coverage.items[0].gaps.join(' '), /接口失败|4xx\/5xx/);
});

test('unrelated failing source category does not become a requirement-specific failure', () => {
  const config = createDefaultConfig('https://example.com');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{ id: 'REQ-TYPECHECK', title: 'typecheck 必须通过', priority: 'P0' }];
  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [], issues: [], journeyTests: [], interactionTests: [], accessibilityChecks: [],
    sourceHealth: {
      enabled: true, status: 'failed', checkedAt: '', packageScripts: [], scannedFiles: 1, parsedFiles: 1, skippedFiles: 0, syntaxErrorCount: 0, findings: [],
      scriptChecks: [
        { id: 'TYPE', scriptName: 'typecheck', command: 'npm run typecheck', category: 'typecheck', status: 'passed', durationMs: 1 },
        { id: 'LINT', scriptName: 'lint', command: 'npm run lint', category: 'lint', status: 'failed', durationMs: 1 }
      ]
    }
  });
  assert.equal(coverage.items[0].status, 'passed');
});

test('code acceptance requirement consumes executed source script evidence', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{ id: 'REQ-CODE', title: 'typecheck、lint 和 test 必须通过', priority: 'P0', sourceScope: ['代码验收'] }];
  const coverage = buildRequirementCoverage({
    config,
    pageModel: pageModel(),
    networkRecords: [],
    issues: [],
    journeyTests: [],
    interactionTests: [],
    accessibilityChecks: [],
    sourceHealth: {
      enabled: true,
      status: 'passed',
      checkedAt: '',
      packageScripts: [],
      scriptChecks: [
        { id: 'SRC-1', scriptName: 'typecheck', command: 'npm run typecheck', category: 'typecheck', status: 'passed', durationMs: 1 },
        { id: 'SRC-2', scriptName: 'lint', command: 'npm run lint', category: 'lint', status: 'passed', durationMs: 1 },
        { id: 'SRC-3', scriptName: 'test', command: 'npm test', category: 'test', status: 'passed', durationMs: 1 }
      ],
      scannedFiles: 1,
      parsedFiles: 1,
      skippedFiles: 0,
      syntaxErrorCount: 0,
      findings: []
    }
  });
  assert.equal(coverage.items[0].status, 'passed');
  assert.equal(coverage.items[0].confidence, 'high');
  assert.match(coverage.items[0].evidence.notes.join(' '), /sourceHealth=passed/);
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
