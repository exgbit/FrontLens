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

function context(tables: ComponentRecord[]): AnalyzerContext {
  return {
    config: createDefaultConfig('https://example.com/users'),
    artifacts: { outputDir: '/tmp/frontlens', screenshot: '/tmp/frontlens/page.png' },
    pageModel: {
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
      stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' }
    },
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
    p2: {} as AnalyzerContext['p2']
  };
}

test('integration mismatch ignores card/list containers misclassified as table without table structure', () => {
  const issues = analyzeIntegration(context([
    table({ id: 'CMP-CARD-LIST', attributes: { class: 'credential-list table-card' }, headers: [], confidence: 0.82 })
  ]), new IssueFactory());

  assert.equal(issues.some((issue) => issue.category === 'integration-data-mismatch'), false);
});

test('integration mismatch still reports semantic empty tables with list-like API data', () => {
  const issues = analyzeIntegration(context([
    table({ id: 'CMP-TABLE', tagName: 'table', confidence: 0.95 })
  ]), new IssueFactory());

  assert.equal(issues.some((issue) => issue.category === 'integration-data-mismatch'), true);
});
