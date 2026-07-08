import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { analyzeIntegration } from '../src/analyzers/integrationAnalyzer.ts';
import { IssueFactory } from '../src/analyzers/issueFactory.ts';
import type { AnalyzerContext, ComponentRecord, NetworkRecord } from '../src/types.ts';

function network(overrides: Partial<NetworkRecord> = {}): NetworkRecord {
  return {
    id: 'REQ-001',
    url: 'https://example.com/api/users/list',
    method: 'GET',
    resourceType: 'xhr',
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    status: 200,
    ok: true,
    failed: false,
    contentType: 'application/json',
    responseBodyPreview: JSON.stringify({ data: [{ id: 1, name: 'Ada' }] }),
    startedAt: '2026-07-07T00:00:00.000Z',
    ...overrides
  };
}

function table(overrides: Partial<ComponentRecord>): ComponentRecord {
  return {
    id: 'CMP-001',
    type: 'table',
    label: '',
    text: '',
    selector: '#maybe-table',
    tagName: 'div',
    visible: true,
    attributes: {},
    confidence: 0.82,
    ...overrides
  };
}

function context(tables: ComponentRecord[], options: Partial<AnalyzerContext> = {}): AnalyzerContext {
  const config = createDefaultConfig('https://example.com/users');
  if (options.config) Object.assign(config, options.config);
  const pageModel = {
    url: 'https://example.com/users',
    title: 'Users',
    meta: {},
    breadcrumbs: [],
    headings: [],
    components: tables,
    forms: [],
    tables,
    buttons: [],
    inputs: [],
    links: [],
    structureTree: 'Users',
    stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' },
    ...(options.pageModel ?? {})
  };
  return {
    config,
    artifacts: { outputDir: '/tmp/frontlens', screenshot: '/tmp/frontlens/page.png' },
    pageModel,
    networkRecords: [network()],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: [],
    performanceMetrics: {} as AnalyzerContext['performanceMetrics'],
    coverage: {} as AnalyzerContext['coverage'],
    apiContract: {} as AnalyzerContext['apiContract'],
    realtime: {} as AnalyzerContext['realtime'],
    interactionTests: [],
    journeyTests: [],
    accessibilityChecks: [],
    permissionChecks: [],
    responsiveChecks: [],
    exceptionSimulations: [],
    security: {} as AnalyzerContext['security'],
    p2: {} as AnalyzerContext['p2'],
    ...options,
    config,
    pageModel
  };
}

test('integration mismatch ignores card/list containers misclassified as table without table structure', () => {
  const issues = analyzeIntegration(context([
    table({ id: 'CMP-CARD-LIST', attributes: { class: 'credential-list table-card' }, headers: [], confidence: 0.82 })
  ]), new IssueFactory());

  assert.equal(issues.some((issue) => issue.category === 'integration-data-mismatch'), false);
});

test('integration mismatch reports only when requirement and source-runtime binding are strong', () => {
  const record = network();
  const issues = analyzeIntegration(context([
    table({ id: 'CMP-TABLE', tagName: 'table', confidence: 0.95, selector: '#users-table', rowCount: 0, headers: ['name'] })
  ], {
    networkRecords: [record],
    config: {
      requirements: {
        enabled: true,
        inferFromPage: false,
        items: [
          {
            id: 'REQ-USERS-LIST',
            title: '用户列表展示接口数据',
            source: 'provided',
            selectors: ['#users-table'],
            apiPatterns: ['/api/users/list']
          }
        ]
      }
    } as AnalyzerContext['config'],
    sourceRuntimeCorrelation: {
      enabled: true,
      status: 'passed',
      checkedAt: '',
      summary: { networkRequestCount: 1, linkedRequestCount: 1, strongLinkCount: 1, unlinkedRequestCount: 0, listResponseLinkCount: 1 },
      links: [
        {
          id: 'SRC-LINK-001',
          networkRequestId: record.id,
          method: record.method,
          url: record.url,
          path: '/api/users/list',
          status: record.status,
          sourceMatches: [{ file: 'src/views/UsersView.vue', line: 12, column: 1, method: 'GET', path: '/api/users/list', expression: 'listUsers()' }],
          stateSignals: [{ file: 'src/views/UsersView.vue', line: 20, column: 1, kind: 'list-state', text: 'rows = data' }],
          componentIds: ['CMP-TABLE'],
          responseListHints: [{ path: '$.data', length: 1, sampleKeys: ['id', 'name'] }],
          confidence: 'high',
          notes: []
        }
      ],
      gaps: []
    }
  }), new IssueFactory());

  assert.equal(issues.some((issue) => issue.category === 'integration-data-mismatch'), true);
});
