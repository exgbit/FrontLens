import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { IssueFactory } from '../src/analyzers/issueFactory.ts';
import { analyzeNetwork } from '../src/analyzers/networkAnalyzer.ts';
import { analyzeIntegration } from '../src/analyzers/integrationAnalyzer.ts';
import { analyzeCompleteness } from '../src/analyzers/completenessAnalyzer.ts';
import { analyzePageQuality } from '../src/analyzers/pageAnalyzer.ts';
import { analyzePermissions } from '../src/analyzers/permissionAnalyzer.ts';
import { analyzePerformance } from '../src/analyzers/performanceAnalyzer.ts';
import { analyzeResources } from '../src/analyzers/resourceAnalyzer.ts';
import { analyzeAll } from '../src/analyzers/index.ts';
import { calculateScore } from '../src/summary.ts';
import { analyzeApiContract } from '../src/contract/apiContract.ts';
import { dedupeIssues } from '../src/fix/issueDedupe.ts';
import { applySuggestionTemplates } from '../src/fix/suggestionTemplates.ts';
import { hasErrorFeedback } from '../src/exceptions/exceptionTester.ts';
import { P2Tester } from '../src/p2/p2Tester.ts';
import { hasSensitivePayloadSignal, hasSensitiveUrlSignal, runSecurityScanner } from '../src/security/securityScanner.ts';
import { shouldBlockMutatingRequest } from '../src/runner.ts';
import { redactText, redactUrl } from '../src/utils/redact.ts';
import { isNativeResourceLoadConsole } from '../src/utils/console.ts';
import type { AnalyzerContext, Issue, NetworkRecord, PageModel } from '../src/types.ts';

function networkRecord(input: Partial<NetworkRecord> & { id: string; url: string }): NetworkRecord {
  return {
    method: 'GET',
    resourceType: 'fetch',
    requestHeaders: {},
    failed: false,
    startedAt: '2026-07-04T00:00:00.000Z',
    ...input
  };
}

function context(overrides: Partial<AnalyzerContext> = {}): AnalyzerContext {
  const config = createDefaultConfig('http://example.test/credentials');
  const pageModel: PageModel = {
    url: 'http://example.test/credentials',
    title: 'test',
    meta: { h1: [], openGraph: {} },
    breadcrumbs: [],
    headings: [],
    structureTree: '',
    components: [],
    forms: [],
    tables: [],
    buttons: [],
    inputs: [],
    images: [],
    links: [],
    stats: { domNodes: 1, visibleTextLength: 0, bodyTextSample: '' }
  };
  return {
    config,
    artifacts: {},
    pageModel,
    networkRecords: [],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: [],
    performanceMetrics: { collectedAt: '', paint: {}, longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 }, layoutShift: { score: 0, count: 0 }, resources: { count: 0, totalTransferSize: 0, totalEncodedBodySize: 0, slowest: [] }, dom: { nodeCount: 0, maxDepth: 0 } },
    coverage: { enabled: false, status: 'skipped', browser: 'chromium', collectedAt: '', totals: { js: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 }, css: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 }, all: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 } }, entries: [], topUnused: [] },
    apiContract: { enabled: false, checkedAt: '', summary: { endpointCount: 0, undocumentedCount: 0, statusMismatchCount: 0, schemaMismatchCount: 0, inferredCount: 0 }, endpoints: [] },
    realtime: { enabled: false, checkedAt: '', graphql: [], webSockets: [], sse: [], summary: { graphqlOperationCount: 0, graphqlErrorCount: 0, webSocketCount: 0, webSocketErrorCount: 0, sseCount: 0 } },
    interactionTests: [],
    journeyTests: [],
    accessibilityChecks: [],
    permissionChecks: [],
    responsiveChecks: [],
    exceptionSimulations: [],
    security: { enabled: false, mode: 'passive', score: 100, status: 'skipped', checkedAt: '', summary: { checkCount: 0, failedCount: 0, warningCount: 0, passedCount: 0, skippedCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, infoCount: 0 }, checks: [] },
    p2: { enabled: false, checkedAt: '', visual: { enabled: false, status: 'skipped' }, budgets: [], networkProfiles: [] },
    ...overrides
  };
}

test('network analyzer ignores synthetic document offline failure and phase-spread duplicate navigations', () => {
  const records: NetworkRecord[] = [
    networkRecord({ id: 'REQ-0011', url: 'http://example.test/[REDACTED]', resourceType: 'document', failed: true, failureText: 'net::ERR_INTERNET_DISCONNECTED' }),
    ...Array.from({ length: 5 }, (_, index) =>
      networkRecord({
        id: `REQ-A${index}`,
        url: 'http://example.test/v1/[REDACTED]',
        resourceType: 'fetch',
        status: 200,
        ok: true,
        startedAt: new Date(Date.UTC(2026, 6, 4, 0, 0, index * 5)).toISOString()
      })
    )
  ];
  const result = analyzeNetwork(context({ networkRecords: records }), new IssueFactory());
  assert.equal(result.issues.some((issue) => issue.category === 'backend-api-status'), false);
  assert.equal(result.duplicatedRequests.length, 0);
});

test('network analyzer still reports burst duplicate API requests', () => {
  const records = [0, 1, 2].map((index) =>
    networkRecord({
      id: `REQ-${index}`,
      url: 'http://example.test/v1/users',
      resourceType: 'fetch',
      status: 200,
      ok: true,
      startedAt: new Date(Date.UTC(2026, 6, 4, 0, 0, 0, index * 100)).toISOString()
    })
  );
  const result = analyzeNetwork(context({ networkRecords: records }), new IssueFactory());
  assert.equal(result.duplicatedRequests.length, 1);
  assert.equal(result.issues.some((issue) => issue.category === 'backend-api-consistency'), true);
});

test('dev server module graph does not become production request or transfer findings', () => {
  const records = [
    networkRecord({ id: 'REQ-DOC', url: 'http://127.0.0.1:5173/credentials', resourceType: 'document', status: 200, ok: true }),
    networkRecord({ id: 'REQ-VITE', url: 'http://127.0.0.1:5173/@vite/client', resourceType: 'script', status: 200, ok: true }),
    ...Array.from({ length: 260 }, (_, index) =>
      networkRecord({
        id: `REQ-SRC-${index}`,
        url: `http://127.0.0.1:5173/src/module-${index}.ts`,
        resourceType: 'script',
        status: 200,
        ok: true
      })
    )
  ];
  const ctx = context({
    config: createDefaultConfig('http://127.0.0.1:5173/credentials'),
    networkRecords: records,
    resourceRecords: [
      {
        name: 'http://127.0.0.1:5173/node_modules/.vite/deps/chunk-ABC.js?v=123',
        initiatorType: 'script',
        durationMs: 30,
        transferSize: 2_500_000,
        encodedBodySize: 2_500_000
      }
    ],
    performanceMetrics: {
      collectedAt: '',
      paint: {},
      longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
      layoutShift: { score: 0, count: 0 },
      resources: { count: 261, totalTransferSize: 6_800_000, totalEncodedBodySize: 6_800_000, slowest: [] },
      dom: { nodeCount: 1, maxDepth: 1 }
    }
  });
  const factory = new IssueFactory();
  assert.equal(analyzeNetwork(ctx, factory).issues.some((issue) => /请求数量过多/.test(issue.title)), false);
  assert.equal(analyzeResources(ctx, factory).issues.some((issue) => /资源体积过大/.test(issue.title)), false);
  assert.equal(analyzePerformance(ctx, factory).some((issue) => /传输体积过大/.test(issue.title)), false);
});

test('exception feedback heuristic rejects empty states and KPI labels as error feedback', () => {
  assert.equal(hasErrorFeedback('接入平台 0 店铺 / 站点 0 正常授权 0 异常项 0 暂无匹配凭证'), false);
  assert.equal(hasErrorFeedback('加载失败，请检查网络后重试'), true);
});

test('P2 transfer budget is skipped for Vite dev server runs', async () => {
  const config = createDefaultConfig('http://127.0.0.1:5173/credentials');
  config.p2.visual.enabled = false;
  config.p2.networkProfiles.enabled = false;
  const performance = {
    collectedAt: '',
    paint: {},
    longTasks: { count: 0, totalDurationMs: 0, maxDurationMs: 0 },
    layoutShift: { score: 0, count: 0 },
    resources: { count: 261, totalTransferSize: 6_800_000, totalEncodedBodySize: 6_800_000, slowest: [] },
    dom: { nodeCount: 1, maxDepth: 1 }
  };
  const records = [
    networkRecord({ id: 'REQ-VITE', url: 'http://127.0.0.1:5173/@vite/client', resourceType: 'script', status: 200, ok: true }),
    networkRecord({ id: 'REQ-SRC', url: 'http://127.0.0.1:5173/src/App.vue', resourceType: 'script', status: 200, ok: true })
  ];
  const output = await new P2Tester(config, {}, performance, records).run({} as never, {} as never);
  assert.equal(output.result.budgets.some((item) => item.metric === 'totalTransfer'), false);
  assert.equal(output.issues.some((issue) => /totalTransfer/.test(issue.title)), false);
});

test('phase-owned journey requests are ignored by duplicate-request heuristic', () => {
  const records = [0, 1, 2].map((index) =>
    networkRecord({
      id: `REQ-J${index}`,
      url: 'http://example.test/v1/credentials',
      resourceType: 'fetch',
      status: 200,
      ok: true,
      startedAt: new Date(Date.UTC(2026, 6, 4, 0, 0, 0, index * 100)).toISOString()
    })
  );
  const result = analyzeNetwork(
    context({
      networkRecords: records,
      journeyTests: [
        {
          id: 'JOURNEY-001',
          name: 'smoke',
          status: 'passed',
          startedAt: '',
          endedAt: '',
          durationMs: 0,
          startUrl: 'http://example.test/credentials',
          steps: [
            {
              index: 0,
              action: 'waitForLoad',
              status: 'passed',
              startedAt: '',
              endedAt: '',
              durationMs: 0,
              networkRequestIds: records.map((record) => record.id)
            }
          ]
        }
      ]
    }),
    new IssueFactory()
  );
  assert.equal(result.duplicatedRequests.length, 0);
});

test('analysis excludes synthetic P2 and exception traffic from normal findings', () => {
  const p2 = networkRecord({ id: 'REQ-P2', url: 'http://example.test/v1/credentials', resourceType: 'fetch', status: 500, ok: false });
  const exception = networkRecord({ id: 'REQ-EX', url: 'http://example.test/v1/credentials', resourceType: 'fetch', status: 500, ok: false });
  const real = networkRecord({ id: 'REQ-REAL', url: 'http://example.test/v1/credentials', resourceType: 'fetch', status: 200, ok: true });
  const result = analyzeAll(context({
    networkRecords: [p2, exception, real],
    analysisExclusions: { networkRequestIds: [p2.id] },
    exceptionSimulations: [
      {
        id: 'EX-001',
        kind: 'api-500',
        status: 'warning',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        observations: { networkRequestIds: [exception.id] },
        issue: '模拟接口 500 后页面未发现明显错误反馈。'
      }
    ]
  }));
  assert.equal(result.network.failedRequests.some((record) => record.id === p2.id || record.id === exception.id), false);
  assert.equal(result.issues.some((issue) => issue.category === 'backend-api-status'), false);
  assert.equal(result.issues.some((issue) => issue.category === 'integration-no-feedback'), true);
});

test('integration analyzer ignores safety-blocked mutating requests', () => {
  const result = analyzeIntegration(
    context({
      networkRecords: [
        networkRecord({
          id: 'REQ-BLOCKED',
          method: 'POST',
          url: 'http://example.test/v1/credentials',
          resourceType: 'fetch',
          failed: true,
          failureText: 'net::ERR_BLOCKED_BY_CLIENT'
        })
      ]
    }),
    new IssueFactory()
  );
  assert.equal(result.some((issue) => issue.category === 'integration-no-feedback'), false);
});

test('native browser resource-load console errors do not become app console issues', () => {
  assert.equal(isNativeResourceLoadConsole({ type: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' }), true);
  const result = analyzeAll(context({
    consoleRecords: [
      { id: 'CON-001', type: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)', timestamp: '' }
    ]
  }));
  assert.equal(result.console.errors.length, 0);
  assert.equal(result.issues.some((issue) => issue.category === 'console-error'), false);
});

test('api contract analysis ignores excluded synthetic 5xx records', async () => {
  const config = createDefaultConfig('http://example.test/credentials');
  const records = [
    networkRecord({ id: 'REQ-OK', url: 'http://example.test/v1/credentials', resourceType: 'fetch', status: 200, ok: true, contentType: 'application/json', responseBodyPreview: '{"code":0,"data":[]}' }),
    networkRecord({ id: 'REQ-SYNTH', url: 'http://example.test/v1/credentials', resourceType: 'fetch', status: 500, ok: false, contentType: 'application/json', responseBodyPreview: '{"code":"FRONTLENS_500"}' })
  ];
  const output = await analyzeApiContract(config, records, {}, { excludedNetworkRequestIds: ['REQ-SYNTH'] });
  assert.equal(output.result.endpoints.length, 1);
  assert.deepEqual(output.result.endpoints[0].statusCodes, [200]);
  assert.equal(output.issues.some((issue) => issue.category === 'backend-api-contract'), false);
});

test('table analyzers ignore low-confidence CSS grid cards', () => {
  const ctx = context({
    pageModel: {
      ...context().pageModel,
      tables: [{ id: 'CMP-grid', type: 'table', label: 'cards', text: '美国 加拿大', selector: '.crd-grid', tagName: 'div', visible: true, attributes: { class: 'crd-grid' }, childrenCount: 4, confidence: 0.65 }],
      stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: '美国 加拿大' }
    },
    networkRecords: [networkRecord({ id: 'REQ-json', url: 'http://example.test/v1/credentials', status: 200, ok: true, contentType: 'application/json', responseBodyPreview: '{"data":[{"id":1},{"id":2}]}' })]
  });
  const integrationIssues = analyzeIntegration(ctx, new IssueFactory());
  const completenessIssues = analyzeCompleteness(ctx, new IssueFactory());
  assert.equal(integrationIssues.length, 0);
  assert.equal(completenessIssues.length, 0);
});



test('redactUrl preserves ordinary business path words while redacting real secrets', () => {
  assert.equal(redactUrl('http://example.test/credentials'), 'http://example.test/credentials');
  assert.equal(redactUrl('http://example.test/token/abcdefghijklmnopqrstuvwxyz'), 'http://example.test/token/[REDACTED]');
  assert.equal(redactUrl('http://example.test/path?access_token=abc'), 'http://example.test/path?access_token=%5BREDACTED%5D');
});

test('sensitive data scanner ignores credential path/id words but flags real token fields', () => {
  assert.equal(hasSensitiveUrlSignal('http://example.test/credentials'), false);
  assert.equal(hasSensitiveUrlSignal('http://example.test/v1/credentials?access_token=[REDACTED]'), true);
  assert.equal(hasSensitivePayloadSignal('{"credential_id":"abc","token_status":"ok","has_refresh_token":true}', 'application/json'), false);
  assert.equal(hasSensitivePayloadSignal('{"access_token":"[REDACTED]"}', 'application/json'), true);
});

test('redactText avoids broad key/code false positives and redacts bare JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz';
  assert.equal(redactText('zipcode=12345 monkey=banana codeName=alpha'), 'zipcode=12345 monkey=banana codeName=alpha');
  assert.equal(redactText(`token=${jwt}`).includes(jwt), false);
});

test('GraphQL safety blocks multi-operation mutation despite earlier query', () => {
  const config = createDefaultConfig('https://example.com');
  const body = JSON.stringify({
    operationName: 'DeleteUser',
    query: 'query Viewer { viewer { id } } mutation DeleteUser { deleteUser(id: 1) { ok } }'
  });
  assert.equal(shouldBlockMutatingRequest(config, 'POST', 'https://example.com/graphql', body, { 'content-type': 'application/json' }), true);
  assert.equal(shouldBlockMutatingRequest(config, 'POST', 'https://example.com/graphql', JSON.stringify({ query: 'query Viewer { viewer { id } }' }), { 'content-type': 'application/json' }), false);
  assert.equal(shouldBlockMutatingRequest(config, 'POST', 'https://example.com/api/users/list', '{}', { 'content-type': 'application/json' }), false);
});

test('page analyzer does not emit accessibility issues when accessibility module is disabled', () => {
  const ctx = context();
  ctx.config.analysis.accessibility = false;
  ctx.pageModel.inputs = [{ id: 'CMP-input', type: 'input', selector: '#name', tagName: 'input', visible: true, attributes: {}, confidence: 0.95 }];
  ctx.pageModel.images = [{ id: 'CMP-img', type: 'image', selector: 'img', tagName: 'img', visible: true, attributes: {}, confidence: 0.95 }];
  const issues = analyzePageQuality(ctx, new IssueFactory());
  assert.equal(issues.some((issue) => issue.category === 'frontend-accessibility'), false);
});

test('permission api-auth does not duplicate network auth issue', () => {
  const ctx = context({
    permissionChecks: [
      {
        id: 'PERM-001',
        rule: 'api-auth',
        status: 'failed',
        severity: 'high',
        title: '接口鉴权状态',
        description: '403',
        count: 1,
        evidence: [{ networkRequestId: 'REQ-403', details: { status: 403 } }],
        suggestion: { frontend: 'show auth state', priority: 'P1' }
      }
    ]
  });
  assert.equal(analyzePermissions(ctx, new IssueFactory()).length, 0);
});

test('security scanner treats server fingerprint headers on local/private targets as deployment checklist', async () => {
  const config = createDefaultConfig('http://100.67.147.98:5174/credentials');
  const output = await runSecurityScanner({
    page: {
      evaluate: async () => ({
        inlineScriptCount: 0,
        inlineEventHandlers: [],
        javascriptLinks: [],
        srcdocFrames: [],
        storageFindings: [],
        thirdPartyWithoutSri: []
      })
    } as unknown as Parameters<typeof runSecurityScanner>[0]['page'],
    config,
    artifacts: {},
    pageModel: context().pageModel,
    networkRecords: [
      networkRecord({
        id: 'REQ-DOC',
        url: 'http://100.67.147.98:5174/credentials',
        resourceType: 'document',
        status: 200,
        ok: true,
        responseHeaders: { server: 'nginx/1.27.5' }
      })
    ],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: []
  });

  const fingerprint = output.result.checks.find((check) => check.rule === 'server-fingerprint-headers');
  assert.equal(fingerprint?.status, 'skipped');
  assert.equal(output.issues.some((issue) => issue.evidence.details?.securityCheckId === fingerprint?.id), false);
});

test('security scanner skips Vite dev source modules for debug leak and sensitive response checks', async () => {
  const config = createDefaultConfig('http://127.0.0.1:5173/credentials');
  const output = await runSecurityScanner({
    page: {
      url: () => 'http://127.0.0.1:5173/credentials',
      evaluate: async () => ({
        inlineScriptCount: 0,
        inlineEventHandlers: [],
        javascriptLinks: [],
        srcdocFrames: [],
        storageFindings: [],
        thirdPartyWithoutSri: []
      })
    } as unknown as Parameters<typeof runSecurityScanner>[0]['page'],
    config,
    artifacts: {},
    pageModel: context().pageModel,
    networkRecords: [
      networkRecord({ id: 'REQ-DOC', url: 'http://127.0.0.1:5173/credentials', resourceType: 'document', status: 200, ok: true }),
      networkRecord({ id: 'REQ-VITE', url: 'http://127.0.0.1:5173/@vite/client', resourceType: 'script', status: 200, ok: true, contentType: 'text/javascript', responseBodyPreview: 'debugger; stack trace /Users/justin/project/src/main.ts' }),
      networkRecord({ id: 'REQ-SRC', url: 'http://127.0.0.1:5173/src/components/LoginForm.vue', resourceType: 'script', status: 200, ok: true, contentType: 'text/javascript', responseBodyPreview: 'const password = ref(\"demo1234\"); const client_secret = \"\";' }),
      networkRecord({ id: 'REQ-API', url: 'http://127.0.0.1:5173/v1/credentials', resourceType: 'fetch', status: 200, ok: true, contentType: 'application/json', responseBodyPreview: '{"code":0,"data":[],"msg":"ok"}' })
    ],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: []
  });

  assert.equal(output.result.checks.find((check) => check.rule === 'api-error-and-debug-leak')?.status, 'skipped');
  assert.equal(output.result.checks.find((check) => check.rule === 'sensitive-data-exposure')?.status, 'passed');
  assert.equal(output.issues.some((issue) => issue.category === 'security'), false);
});

test('security scanner uses final page URL for HTTPS transport and ignores safe HTTPS login body', async () => {
  const config = createDefaultConfig('http://example.com/login');
  const output = await runSecurityScanner({
    page: {
      url: () => 'https://example.com/login',
      evaluate: async () => ({
        inlineScriptCount: 0,
        inlineEventHandlers: [],
        javascriptLinks: [],
        srcdocFrames: [],
        storageFindings: [],
        thirdPartyWithoutSri: []
      })
    } as unknown as Parameters<typeof runSecurityScanner>[0]['page'],
    config,
    artifacts: {},
    pageModel: context().pageModel,
    networkRecords: [
      networkRecord({
        id: 'REQ-LOGIN',
        url: 'https://example.com/api/login',
        method: 'POST',
        resourceType: 'fetch',
        status: 200,
        ok: true,
        requestHeaders: { 'content-type': 'application/json' },
        postData: '{"password":"[REDACTED]"}',
        contentType: 'application/json',
        responseBodyPreview: '{"ok":true}'
      })
    ],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: []
  });

  assert.equal(output.result.checks.find((check) => check.rule === 'https-transport')?.status, 'passed');
  assert.equal(output.result.checks.find((check) => check.rule === 'sensitive-data-exposure')?.status, 'passed');
});

test('security scanner ignores third-party server fingerprint as target service fingerprint', async () => {
  const config = createDefaultConfig('https://example.com/app');
  const output = await runSecurityScanner({
    page: {
      url: () => 'https://example.com/app',
      evaluate: async () => ({
        inlineScriptCount: 0,
        inlineEventHandlers: [],
        javascriptLinks: [],
        srcdocFrames: [],
        storageFindings: [],
        thirdPartyWithoutSri: []
      })
    } as unknown as Parameters<typeof runSecurityScanner>[0]['page'],
    config,
    artifacts: {},
    pageModel: context().pageModel,
    networkRecords: [
      networkRecord({ id: 'REQ-DOC', url: 'https://example.com/app', resourceType: 'document', status: 200, ok: true, responseHeaders: {} }),
      networkRecord({ id: 'REQ-CDN', url: 'https://cdn.example.net/app.js', resourceType: 'script', status: 200, ok: true, responseHeaders: { server: 'cloud-cdn' } })
    ],
    consoleRecords: [],
    pageErrors: [],
    resourceRecords: []
  });

  assert.equal(output.result.checks.find((check) => check.rule === 'server-fingerprint-headers')?.status, 'passed');
});

test('score caps noisy category families and weights low-confidence issues', () => {
  const securityIssues = Array.from({ length: 10 }, (_, index): Issue => ({
    id: `ISSUE-${index}`,
    title: 'security header',
    category: 'security',
    severity: 'medium',
    confidence: 0.86,
    description: '',
    evidence: {},
    reproduceSteps: [],
    reason: '',
    suggestion: {}
  }));
  const lowConfidence: Issue = { ...securityIssues[0], id: 'LOW', category: 'frontend-table', severity: 'medium', confidence: 0.5 };
  assert.equal(calculateScore(securityIssues), 65);
  assert.equal(calculateScore([...securityIssues, lowConfidence]), 63);
  assert.equal(calculateScore([{ ...securityIssues[0], category: 'frontend-routing', severity: 'critical', title: '页面打开失败' }]), 50);
});

test('suggestion templates do not treat tablet touch-target issues as table issues', () => {
  const [issue] = applySuggestionTemplates([
    {
      id: 'TOUCH',
      title: '触控目标尺寸偏小：tablet 768x1024',
      category: 'frontend-accessibility',
      severity: 'low',
      confidence: 0.74,
      description: '',
      evidence: {},
      reproduceSteps: [],
      reason: '',
      suggestion: {
        frontend: '移动端按钮/链接/表单控件建议提供至少 32px，最好 44px 的点击区域。',
        priority: 'P3'
      }
    }
  ]);

  assert.equal(issue.suggestion.backend, undefined);
  assert.match(issue.suggestion.test ?? '', /axe|键盘/);
  assert.equal(issue.suggestion.priority, 'P3');
});

test('suggestion templates keep the stricter priority for high integration failures', () => {
  const [issue] = applySuggestionTemplates([
    {
      id: 'ERR',
      title: '异常场景测试失败：api-500',
      category: 'integration-no-feedback',
      severity: 'high',
      confidence: 0.86,
      description: '',
      evidence: {},
      reproduceSteps: [],
      reason: '',
      suggestion: {
        frontend: '为接口异常增加错误状态、重试入口和用户可理解的提示文案。',
        priority: 'P2'
      }
    }
  ]);

  assert.equal(issue.suggestion.priority, 'P1');
});

test('dedupe preserves metadata for grouped exception scenarios', () => {
  const issues: Issue[] = [
    {
      id: 'EX500',
      title: '异常场景测试失败：api-500',
      category: 'integration-no-feedback',
      severity: 'high',
      confidence: 0.86,
      description: '500',
      evidence: { details: { exceptionSimulationId: 'EX-002', kind: 'api-500', target: '/v1/credentials' } },
      reproduceSteps: [],
      reason: '',
      suggestion: {}
    },
    {
      id: 'EX401',
      title: '异常场景测试失败：api-401',
      category: 'integration-no-feedback',
      severity: 'high',
      confidence: 0.86,
      description: '401',
      evidence: { details: { exceptionSimulationId: 'EX-004', kind: 'api-401', target: '/v1/credentials' } },
      reproduceSteps: [],
      reason: '',
      suggestion: {}
    }
  ];

  const [issue] = dedupeIssues(issues);
  const details = issue.evidence.details as { duplicateCount?: number; duplicateIssues?: Array<{ id?: string; kind?: string; exceptionSimulationId?: string }> };
  assert.equal(dedupeIssues(issues).length, 1);
  assert.equal(details.duplicateCount, 2);
  assert.equal(details.duplicateIssues?.[0]?.id, 'EX401');
  assert.equal(details.duplicateIssues?.[0]?.kind, 'api-401');
  assert.equal(details.duplicateIssues?.[0]?.exceptionSimulationId, 'EX-004');
});
