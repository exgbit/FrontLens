import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildIssueDisposition } from '../src/disposition/issueDisposition.ts';
import { buildRootCauseGroups } from '../src/rootCause/rootCauseGroups.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';
import type { Issue } from '../src/types.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: 'ISSUE-001',
    title: 'Test issue',
    category: 'frontend-ui',
    severity: 'medium',
    confidence: 0.8,
    description: 'desc',
    evidence: {},
    reproduceSteps: ['Open page'],
    reason: 'reason',
    suggestion: { frontend: 'fix', priority: 'P2' },
    source: 'rule',
    ...overrides
  };
}

test('issue disposition separates confirmed fixes, product decisions, deployment work, and source-confirmation gaps', () => {
  const config = createDefaultConfig('https://example.com/admin');
  const issues = [
    issue({
      id: 'ISSUE-001',
      title: '按钮缺少可访问名称',
      category: 'frontend-accessibility',
      severity: 'medium',
      evidence: { selector: 'button.icon' },
      suggestion: { frontend: 'add aria-label', priority: 'P2' }
    }),
    issue({
      id: 'ISSUE-002',
      title: '触控目标尺寸偏小：mobile 390x844',
      category: 'frontend-accessibility',
      severity: 'low',
      evidence: { details: { smallTapTargetCount: 8 } },
      suggestion: { frontend: 'increase target', priority: 'P3' }
    }),
    issue({
      id: 'ISSUE-003',
      title: '缺少 Content-Security-Policy',
      category: 'security',
      severity: 'medium',
      evidence: { details: { category: 'headers', rule: 'content-security-policy' } },
      suggestion: { backend: 'set csp', priority: 'P2' }
    }),
    issue({
      id: 'ISSUE-004',
      title: '接口返回疑似有列表数据，但页面表格为空',
      category: 'integration-data-mismatch',
      severity: 'medium',
      evidence: { networkRequestId: 'REQ-1', screenshot: '/tmp/page.png' },
      suggestion: { frontend: 'verify binding', priority: 'P2' }
    })
  ];
  const groups = buildRootCauseGroups(issues, config);
  const disposition = buildIssueDisposition(issues, config, groups);
  const byId = new Map(disposition.items.map((item) => [item.issueId, item]));

  assert.equal(byId.get('ISSUE-001')?.status, 'confirmed');
  assert.equal(byId.get('ISSUE-001')?.actionability, 'actionable');
  assert.equal(byId.get('ISSUE-002')?.status, 'product-decision');
  assert.equal(byId.get('ISSUE-002')?.actionability, 'conditional');
  assert.equal(byId.get('ISSUE-003')?.status, 'deployment-only');
  assert.equal(byId.get('ISSUE-003')?.bucket, 'deployment-security-config');
  assert.equal(byId.get('ISSUE-004')?.status, 'needs-source-confirmation');
  assert.equal(byId.get('ISSUE-004')?.actionability, 'conditional');
  assert.equal(disposition.summary.actionableCount, 1);
  assert.equal(disposition.summary.conditionalCount, 3);
});

test('quality gate uses disposition so speculative high findings become pass-with-risks, not fail', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'ok' }
    },
    interactionTests: [{ id: 'IT-001', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }],
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com/admin', steps: [] }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'page-refresh', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }],
    issues: [
      {
        title: '接口返回疑似有列表数据，但页面表格为空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.66,
        description: 'speculative mismatch',
        evidence: { networkRequestId: 'REQ-1', screenshot: '/tmp/page.png' },
        reproduceSteps: ['Open page'],
        reason: 'requires source confirmation',
        suggestion: { frontend: 'verify binding', priority: 'P2' }
      }
    ]
  });

  assert.equal(result.issueDisposition.items[0].status, 'needs-source-confirmation');
  assert.equal(result.issueDisposition.items[0].actionability, 'conditional');
  assert.equal(result.rootCauseGroups.length, 0);
  assert.equal(result.fixTasks.length, 0);
  assert.equal(result.qualityGate.status, 'pass-with-risks');
  assert.equal(result.qualityGate.blockingIssueCount, 0);
  assert.equal(result.qualityGate.coverageGaps.some((gap) => gap.includes('Raw finding')), true);
});

test('api/ui data mismatch becomes actionable only with requirement network ui and source proof', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/orders', title: 'Orders' },
    metadata: {
      config: {
        requirements: {
          enabled: true,
          inferFromPage: false,
          items: [
            {
              id: 'REQ-ORDERS-LIST',
              title: '订单列表必须展示接口返回记录',
              priority: 'P1',
              source: 'provided',
              apiPatterns: ['/api/orders/list'],
              selectors: ['table.orders']
            }
          ]
        },
        productContext: {
          pageType: 'admin-data-list',
          requiredFeatures: ['list-rendering']
        }
      }
    },
    pageModel: {
      url: 'https://example.com/orders',
      title: 'Orders',
      tables: [
        { id: 'TBL-001', type: 'table', tagName: 'table', selector: 'table.orders', visible: true, attributes: {}, confidence: 0.95, rowCount: 0, columnCount: 4, headers: ['ID', 'Name'] }
      ],
      stats: { domNodes: 30, visibleTextLength: 100, bodyTextSample: 'Orders 暂无数据' }
    },
    network: {
      requests: [
        {
          id: 'REQ-LIST',
          url: 'https://example.com/api/orders/list',
          method: 'GET',
          resourceType: 'fetch',
          status: 200,
          ok: true,
          failed: false,
          startedAt: '2026-07-07T00:00:00.000Z',
          requestHeaders: {},
          responseBodyPreview: '{"data":[{"id":1,"name":"A"},{"id":2,"name":"B"}]}',
          contentType: 'application/json'
        }
      ]
    },
    sourceRuntimeCorrelation: {
      enabled: true,
      status: 'passed',
      checkedAt: '',
      summary: { networkRequestCount: 1, linkedRequestCount: 1, strongLinkCount: 1, unlinkedRequestCount: 0, listResponseLinkCount: 1 },
      links: [
        {
          id: 'SRC-LINK-ORDERS',
          networkRequestId: 'REQ-LIST',
          method: 'GET',
          url: 'https://example.com/api/orders/list',
          path: '/api/orders/list',
          status: 200,
          confidence: 'high',
          sourceMatches: [{ file: 'src/api/orders.ts', line: 12, method: 'GET', path: '/api/orders/list', client: 'http-client', expression: "http.get('/api/orders/list')" }],
          stateSignals: [{ file: 'src/views/OrdersView.vue', line: 44, kind: 'empty', text: 'orders.length === 0' }],
          componentIds: ['TBL-001'],
          responseListHints: [{ path: '$.data', length: 2, sampleKeys: ['id', 'name'] }],
          notes: []
        }
      ],
      gaps: []
    },
    issues: [
      {
        id: 'ISSUE-LIST',
        title: '接口返回疑似有列表数据，但页面表格为空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.9,
        description: '订单接口返回 2 条记录，但订单表格 rowCount=0。',
        evidence: {
          networkRequestId: 'REQ-LIST',
          screenshot: 'screenshots/orders-empty.png',
          details: {
            maxReturnedArrayLength: 2,
            maxTableRows: 0,
            responsePath: '$.data',
            tableIds: ['TBL-001'],
            tableSelectors: ['table.orders'],
            sourceRuntimeLinkId: 'SRC-LINK-ORDERS',
            sourceRuntimeConfidence: 'high',
            sourceApiMatches: [{ file: 'src/api/orders.ts', line: 12 }],
            sourceStateSignals: [{ file: 'src/views/OrdersView.vue', line: 44 }],
            sourceComponentIds: ['TBL-001']
          }
        },
        reproduceSteps: ['打开订单页', '检查 REQ-LIST 响应', '观察 table.orders 行数为 0'],
        reason: '明确需求要求订单列表展示接口返回记录，且运行时与源码均已绑定到当前 UI。',
        suggestion: { frontend: '修复订单列表数据绑定或空态判断。', priority: 'P1' }
      }
    ]
  });

  assert.equal(result.requirementCoverage.items[0].evidence.issueIds.includes('ISSUE-LIST'), true);
  assert.equal(result.issueDisposition.items[0].status, 'confirmed');
  assert.equal(result.issueDisposition.items[0].actionability, 'actionable');
  assert.equal(result.issueDisposition.items[0].evidenceStrength, 'strong');
  assert.equal(result.rootCauseGroups.length, 1);
  assert.equal(result.defectProof.items[0].status === 'proven' || result.defectProof.items[0].status === 'probable', true);
  assert.equal(result.fixTasks.length, 1);
  assert.equal(result.professionalSummary.mustFix.length, 1);
});

test('exception no-feedback findings become proof-ready root-cause candidates when runtime and source binding are reproducible', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials' },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 40, visibleTextLength: 200, bodyTextSample: 'Credentials 暂无数据' }
    },
    interactionTests: [{ id: 'IT-001', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }],
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com/credentials', steps: [] }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'api-500', status: 'failed', target: 'https://example.com/api/credentials', startedAt: '', endedAt: '', durationMs: 0, observations: { networkRequestIds: ['REQ-500'] } }],
    sourceRuntimeCorrelation: {
      enabled: true,
      status: 'passed',
      checkedAt: '',
      summary: { networkRequestCount: 1, linkedRequestCount: 1, strongLinkCount: 1, unlinkedRequestCount: 0, listResponseLinkCount: 0 },
      links: [
        {
          id: 'SRC-LINK-001',
          networkRequestId: 'REQ-BASELINE',
          method: 'GET',
          url: 'https://example.com/api/credentials',
          path: '/api/credentials',
          status: 200,
          confidence: 'high',
          sourceMatches: [{ file: 'src/api/credentials.ts', line: 8, method: 'GET', path: '/api/credentials', client: 'http-client', expression: "http.get('/api/credentials')" }],
          stateSignals: [{ file: 'src/views/CredentialsView.vue', line: 55, kind: 'error', text: 'catch (err) { error.value = err }' }],
          componentIds: ['CMP-001'],
          responseListHints: [],
          notes: []
        }
      ],
      gaps: []
    },
    issues: [
      {
        id: 'ISSUE-EX',
        title: '异常场景测试失败：api-500',
        category: 'integration-no-feedback',
        severity: 'high',
        confidence: 0.86,
        description: '模拟接口 500 后页面未发现明显错误反馈。',
        evidence: { networkRequestId: 'REQ-500', details: { exceptionSimulationId: 'EX-001', kind: 'api-500', target: 'https://example.com/api/credentials' } },
        reproduceSteps: ['开启异常模拟运行 FrontLens', '执行异常场景：api-500', '观察页面反馈、Network 和 Console'],
        reason: '异常场景下页面没有明显反馈，用户难以判断失败原因或恢复方式。',
        suggestion: { frontend: '增加错误状态和重试入口。', priority: 'P1' }
      }
    ]
  });

  assert.equal(result.issueDisposition.items[0].actionability, 'actionable');
  assert.equal(result.rootCauseGroups.length, 1);
  assert.equal(result.rootCauseGroups[0].networkRequestIds.includes('REQ-500'), true);
  assert.deepEqual(result.rootCauseGroups[0].sourceLocations, [
    { file: 'src/api/credentials.ts', line: 8 },
    { file: 'src/views/CredentialsView.vue', line: 55 }
  ]);
  assert.equal(result.defectProof.items[0].status, 'proven');
  assert.equal(result.fixTasks.length, 1);
  assert.equal(result.professionalSummary.mustFix.length, 1);
  assert.equal(result.professionalSummary.mustFix[0].rootCauseGroupId, result.rootCauseGroups[0].id);
});

test('adjusted score excludes deployment, product, and insufficient-evidence findings', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: {
      url: 'https://example.com/admin',
      title: 'Admin',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'ok' }
    },
    interactionTests: [{ id: 'IT-001', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }],
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com/admin', steps: [{ index: 0, action: 'expectVisible', target: 'body', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }] }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'page-refresh', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }],
    issues: [
      {
        title: '缺少 Content-Security-Policy',
        category: 'security',
        severity: 'high',
        confidence: 0.95,
        description: 'Missing deployment header',
        evidence: { details: { category: 'headers', rule: 'content-security-policy' } },
        reproduceSteps: ['Open page'],
        reason: 'deployment config',
        suggestion: { backend: 'set CSP', priority: 'P1' }
      },
      {
        title: '接口返回疑似有列表数据，但页面表格为空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.66,
        description: 'speculative mismatch',
        evidence: { networkRequestId: 'REQ-1', screenshot: '/tmp/page.png' },
        reproduceSteps: ['Open page'],
        reason: 'requires source confirmation',
        suggestion: { frontend: 'verify binding', priority: 'P2' }
      }
    ]
  });

  assert.equal(result.issueDisposition.summary.actionableCount, 0);
  assert.equal(result.rootCauseGroups.length, 0);
  assert.equal(result.fixTasks.length, 0);
  assert.equal(result.summary.score < 100, true);
  assert.equal(result.summary.adjustedScore, 100);
  assert.equal(result.summary.adjustedIssueCount, 0);
  assert.equal(result.summary.scoreBasis, 'actionable');
  assert.equal(result.summary.scoreNotes.some((note) => note.includes('excluded')), true);
});

test('product context decides whether product-scope findings are defects or non-defect observations', () => {
  const mobileConfig = createDefaultConfig('https://example.com/app');
  mobileConfig.productContext.deviceScope = 'mobile-first';
  mobileConfig.productContext.requiredFeatures = ['mobile-touch-target'];
  const mobileDisposition = buildIssueDisposition(
    [
      issue({
        id: 'ISSUE-MOBILE',
        title: '触控目标尺寸偏小：mobile 390x844',
        category: 'frontend-accessibility',
        severity: 'medium',
        evidence: { selector: 'button.icon', details: { smallTapTargetCount: 3 } },
        suggestion: { frontend: 'increase target', priority: 'P2' }
      })
    ],
    mobileConfig,
    []
  );
  assert.equal(mobileDisposition.items[0].status, 'confirmed');
  assert.equal(mobileDisposition.items[0].bucket, 'real-frontend-fix');
  assert.equal(mobileDisposition.items[0].actionability, 'actionable');

  const credentialConfig = createDefaultConfig('https://example.com/credentials');
  credentialConfig.productContext.pageType = 'credential';
  credentialConfig.productContext.outOfScopeFeatures = ['export'];
  credentialConfig.productContext.decisions = [{ id: 'ADR-SEC-EXPORT', title: '凭证页不提供导出能力', appliesTo: ['export'], rationale: '凭证导出属于安全反模式。' }];
  const credentialDisposition = buildIssueDisposition(
    [
      issue({
        id: 'ISSUE-EXPORT',
        title: '页面未提供导出入口',
        category: 'frontend-ui',
        severity: 'medium',
        evidence: { details: { expectedFeature: 'export' } },
        suggestion: { frontend: 'add export', priority: 'P2' }
      })
    ],
    credentialConfig,
    []
  );
  assert.equal(credentialDisposition.items[0].status, 'product-decision');
  assert.equal(credentialDisposition.items[0].actionability, 'non-actionable');
  assert.match(credentialDisposition.items[0].reason, /不在当前页面\/版本范围/);
});

test('color contrast findings require explicit WCAG or accessibility scope before becoming frontend fixes', () => {
  const basicConfig = createDefaultConfig('https://example.com/admin');
  const contrastIssue = issue({
    id: 'ISSUE-CONTRAST',
    title: '文本颜色对比度不足：3 处',
    category: 'frontend-accessibility',
    severity: 'low',
    evidence: { selector: '.muted', details: { rule: 'color-contrast', count: 3 } },
    suggestion: { frontend: 'adjust text color token', priority: 'P3' }
  });
  const basicDisposition = buildIssueDisposition([contrastIssue], basicConfig, []);
  assert.equal(basicDisposition.items[0].status, 'product-decision');
  assert.equal(basicDisposition.items[0].actionability, 'conditional');
  assert.equal(basicDisposition.items[0].owner, 'product');

  const wcagConfig = createDefaultConfig('https://example.com/public');
  wcagConfig.productContext.accessibilityTarget = 'wcag-aa';
  const wcagDisposition = buildIssueDisposition([contrastIssue], wcagConfig, []);
  assert.equal(wcagDisposition.items[0].status, 'confirmed');
  assert.equal(wcagDisposition.items[0].bucket, 'real-frontend-fix');
});
