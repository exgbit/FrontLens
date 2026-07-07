import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildRootCauseGroups } from '../src/rootCause/rootCauseGroups.ts';
import type { Issue, SourceAnalysisResult, SourceRuntimeLink } from '../src/types.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'ISSUE-001',
    title: 'Test issue',
    category: 'frontend-ui',
    severity: 'low',
    confidence: 0.9,
    description: 'desc',
    evidence: {},
    reproduceSteps: ['Open page'],
    reason: 'reason',
    suggestion: { frontend: 'fix', priority: 'P3' },
    source: 'rule',
    ...overrides
  };
}

test('buildRootCauseGroups merges exception feedback issues by target endpoint', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-002',
      title: 'api-404 无错误反馈',
      category: 'integration-no-feedback',
      severity: 'medium',
      evidence: { networkRequestId: 'REQ-002', details: { kind: 'api-404', target: 'https://example.com/api/credentials' } },
      suggestion: { frontend: '复用列表错误态。', priority: 'P2' }
    }),
    issue({
      id: 'ISSUE-001',
      title: 'api-500 无错误反馈',
      category: 'integration-no-feedback',
      severity: 'high',
      evidence: { networkRequestId: 'REQ-001', details: { kind: 'api-500', target: 'https://example.com/api/credentials' } },
      suggestion: { frontend: '渲染错误态并提供重试。', priority: 'P1' }
    })
  ], config);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].issueCount, 2);
  assert.equal(groups[0].severity, 'high');
  assert.equal(groups[0].priority, 'P1');
  assert.deepEqual(groups[0].issueIds, ['ISSUE-002', 'ISSUE-001']);
  assert.deepEqual(groups[0].networkRequestIds, ['REQ-002', 'REQ-001']);
  assert.match(groups[0].rootCauseKey, /integration-no-feedback:\/api\/credentials/);
  assert.equal(groups[0].suggestedFix, '渲染错误态并提供重试。');
});

test('buildRootCauseGroups groups deployment security headers separately from transport', () => {
  const config = createDefaultConfig('https://example.com/admin');
  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-001',
      title: '缺少 Content-Security-Policy',
      category: 'security',
      severity: 'medium',
      evidence: { details: { category: 'headers', rule: 'content-security-policy' } },
      suggestion: { backend: '配置 CSP。', priority: 'P2' }
    }),
    issue({
      id: 'ISSUE-002',
      title: '缺少 X-Content-Type-Options',
      category: 'security',
      severity: 'low',
      evidence: { details: { category: 'headers', rule: 'x-content-type-options' } },
      suggestion: { backend: '配置 nosniff。', priority: 'P3' }
    }),
    issue({
      id: 'ISSUE-003',
      title: '页面使用 HTTP 明文传输',
      category: 'security',
      severity: 'high',
      evidence: { details: { category: 'transport', rule: 'https-required' } },
      suggestion: { backend: '启用 HTTPS。', priority: 'P1' }
    })
  ], config);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].rootCauseKey, 'backend:security:transport');
  assert.equal(groups[0].priority, 'P1');
  assert.equal(groups[1].rootCauseKey, 'backend:security:deployment-headers');
  assert.equal(groups[1].issueCount, 2);
});

test('buildRootCauseGroups carries source file locations into implementation root causes', () => {
  const config = createDefaultConfig('https://example.com/orders');
  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-001',
      title: '接口返回疑似有列表数据，但页面表格为空',
      category: 'integration-data-mismatch',
      severity: 'medium',
      evidence: {
        networkRequestId: 'REQ-001',
        details: {
          target: 'https://example.com/api/orders',
          sourceApiMatches: [{ file: 'src/api/orders.ts', line: 12, method: 'GET', path: '/api/orders' }],
          sourceStateSignals: [{ file: 'src/views/OrdersView.vue', line: 45, kind: 'empty', text: 'empty state' }]
        }
      },
      suggestion: { frontend: '修复列表数据绑定。', priority: 'P2' }
    }),
    issue({
      id: 'ISSUE-002',
      title: '同一列表源码确认空态判断错误',
      category: 'integration-data-mismatch',
      severity: 'low',
      evidence: {
        details: {
          target: 'https://example.com/api/orders',
          sourceFile: 'src/views/OrdersView.vue',
          line: 45
        }
      },
      suggestion: { frontend: '修复列表数据绑定。', priority: 'P2' }
    })
  ], config);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceLocations, [
    { file: 'src/api/orders.ts', line: 12 },
    { file: 'src/views/OrdersView.vue', line: 45 }
  ]);
});

test('buildRootCauseGroups enriches root causes with medium/high source-runtime links by target endpoint', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  const runtimeLinks: SourceRuntimeLink[] = [
    {
      id: 'SRC-LINK-001',
      networkRequestId: 'REQ-BASELINE',
      method: 'GET',
      url: 'https://example.com/api/credentials',
      path: '/api/credentials',
      status: 200,
      confidence: 'high',
      sourceMatches: [
        { file: 'src/api/credentials.ts', line: 8, method: 'GET', path: '/api/credentials', client: 'http-client', expression: "http.get('/api/credentials')" }
      ],
      stateSignals: [
        { file: 'src/views/CredentialsView.vue', line: 51, kind: 'error', text: 'const { loading, error } = useCredentials()' },
        { file: 'src/views/CredentialsView.vue', line: 72, kind: 'empty', text: '暂无匹配凭证' }
      ],
      componentIds: ['CMP-001'],
      responseListHints: [],
      notes: []
    }
  ];

  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-001',
      title: 'api-500 无错误反馈',
      category: 'integration-no-feedback',
      severity: 'high',
      evidence: {
        networkRequestId: 'REQ-SYNTHETIC',
        details: { kind: 'api-500', target: 'https://example.com/api/credentials' }
      },
      suggestion: { frontend: '渲染错误态并提供重试。', priority: 'P1' }
    })
  ], config, { links: runtimeLinks });

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceLocations, [
    { file: 'src/api/credentials.ts', line: 8 },
    { file: 'src/views/CredentialsView.vue', line: 51 },
    { file: 'src/views/CredentialsView.vue', line: 72 }
  ]);
});

test('buildRootCauseGroups enriches runtime accessibility issues with source ui-accessibility findings', () => {
  const config = createDefaultConfig('https://example.com/rules');
  const sourceAnalysis: SourceAnalysisResult = {
    enabled: true,
    status: 'passed',
    checkedAt: '',
    root: '/repo',
    scannedFiles: 1,
    scannedBytes: 100,
    summary: {
      routeFileCount: 0,
      routeCount: 0,
      eagerRouteImportCount: 0,
      heavyImportCount: 0,
      apiCallCount: 0,
      errorStateSignalCount: 0,
      emptyStateSignalCount: 0
    },
    routeFiles: [],
    routes: [],
    imports: [],
    apiCalls: [],
    stateSignals: [],
    findings: [
      {
        id: 'SRC-001',
        kind: 'ui-accessibility',
        severity: 'medium',
        title: '源码发现疑似无可访问名称的图标按钮：2 处',
        locations: [
          { file: 'src/components/RuleActions.vue', line: 12 },
          { file: 'src/components/RuleActions.vue', line: 15 }
        ],
        details: { rule: 'button-name' }
      }
    ]
  };

  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-001',
      title: '按钮缺少可访问名称：2 处',
      category: 'frontend-accessibility',
      severity: 'medium',
      evidence: {
        selector: 'button:nth-of-type(1)',
        details: { accessibilityCheckId: 'A11Y-003', rule: 'button-name', count: 2 }
      },
      suggestion: { frontend: '为图标按钮增加 aria-label。', priority: 'P2' }
    })
  ], config, undefined, sourceAnalysis);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceLocations, [
    { file: 'src/components/RuleActions.vue', line: 12 },
    { file: 'src/components/RuleActions.vue', line: 15 }
  ]);
});

test('buildRootCauseGroups enriches exception feedback issues with source error-state-gap findings', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  const sourceAnalysis: SourceAnalysisResult = {
    enabled: true,
    status: 'passed',
    checkedAt: '',
    root: '/repo',
    scannedFiles: 1,
    scannedBytes: 100,
    summary: {
      routeFileCount: 0,
      routeCount: 0,
      eagerRouteImportCount: 0,
      heavyImportCount: 0,
      apiCallCount: 0,
      errorStateSignalCount: 1,
      emptyStateSignalCount: 1
    },
    routeFiles: [],
    routes: [],
    imports: [],
    apiCalls: [],
    stateSignals: [],
    findings: [
      {
        id: 'SRC-001',
        kind: 'error-state-gap',
        severity: 'medium',
        title: '源码发现错误状态可能被空态吞掉',
        locations: [
          { file: 'src/views/CredentialsView.vue', line: 55 },
          { file: 'src/views/CredentialsView.vue', line: 88 }
        ],
        details: { rule: 'error-state-rendering', tokens: ['credentials'] }
      }
    ]
  };

  const groups = buildRootCauseGroups([
    issue({
      id: 'ISSUE-001',
      title: 'api-500 无错误反馈',
      category: 'integration-no-feedback',
      severity: 'high',
      evidence: {
        networkRequestId: 'REQ-001',
        details: { kind: 'api-500', target: 'https://example.com/api/credentials' }
      },
      suggestion: { frontend: '渲染错误态并提供重试。', priority: 'P1' }
    })
  ], config, undefined, sourceAnalysis);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].sourceLocations, [
    { file: 'src/views/CredentialsView.vue', line: 55 },
    { file: 'src/views/CredentialsView.vue', line: 88 }
  ]);
});
