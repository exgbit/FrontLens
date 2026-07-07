import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { formatProfessionalBrief } from '../src/reporters/briefReporter.ts';

test('professional brief stays concise and buckets unproven product/API guesses', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin/orders', title: 'Orders', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: { url: 'https://example.com/admin/orders', title: 'Orders', stats: { domNodes: 40, visibleTextLength: 100, bodyTextSample: 'Orders 暂无数据' } },
    metadata: {
      config: {
        productContext: {
          enabled: true,
          pageType: 'admin-list',
          deviceScope: 'desktop-first',
          accessibilityTarget: 'basic',
          requiredFeatures: [],
          optionalFeatures: ['mobile-touch-target'],
          outOfScopeFeatures: [],
          decisions: [{ id: 'ADR-PC', title: 'PC first', appliesTo: ['mobile-touch-target'] }],
          adrRefs: []
        }
      }
    },
    issues: [
      {
        id: 'ISSUE-TOUCH',
        title: '触控目标尺寸偏小：mobile 390x844',
        category: 'frontend-accessibility',
        severity: 'low',
        confidence: 0.84,
        description: 'Small tap targets on mobile.',
        evidence: { selector: '.icon', details: { rule: 'tap-target' } },
        reproduceSteps: ['Open mobile viewport'],
        reason: 'Mobile click target is small.',
        suggestion: { frontend: 'Increase mobile click target.', priority: 'P3' }
      },
      {
        id: 'ISSUE-LIST',
        title: '接口返回疑似有列表数据，但页面表格为空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.66,
        description: 'Unbound network response and empty DOM.',
        evidence: { networkRequestId: 'REQ-LIST', screenshot: 'screenshots/empty.png' },
        reproduceSteps: ['Open page', 'Inspect list API'],
        reason: 'No source/runtime UI binding.',
        suggestion: { frontend: 'Verify binding first.', priority: 'P2' }
      }
    ]
  });

  const brief = formatProfessionalBrief(result);
  assert.match(brief, /FrontLens QA Brief/);
  assert.match(brief, /当前没有 proof-ready 实现缺陷/);
  assert.match(brief, /产品\/设计\/ADR/);
  assert.match(brief, /证据不足\/需源码确认/);
  assert.doesNotMatch(brief, /\| P[0-3] \| .*接口返回疑似有列表数据/);
  assert.equal(result.professionalSummary.mustFix.length, 0);
  assert.equal(result.professionalSummary.shouldFix.length, 0);
  assert.ok(brief.length < 5000, `brief should stay compact, got ${brief.length}`);
});

test('professional brief highlights source-bound proof-ready root causes', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: { url: 'https://example.com/credentials', title: 'Credentials', stats: { domNodes: 40, visibleTextLength: 120, bodyTextSample: 'Credentials 暂无数据' } },
    sourceRuntimeCorrelation: {
      enabled: true,
      status: 'passed',
      checkedAt: '2026-07-07T00:00:00.000Z',
      summary: { networkRequestCount: 1, linkedRequestCount: 1, strongLinkCount: 1, unlinkedRequestCount: 0, listResponseLinkCount: 0 },
      links: [
        {
          id: 'SRC-LINK-ERROR',
          networkRequestId: 'REQ-500',
          method: 'GET',
          url: 'https://example.com/api/credentials',
          path: '/api/credentials',
          status: 500,
          sourceMatches: [{ file: 'src/api/credentials.ts', line: 8, method: 'GET', path: '/api/credentials', client: 'http', expression: "http.get('/api/credentials')" }],
          stateSignals: [{ file: 'src/views/CredentialsView.vue', line: 55, kind: 'error', text: 'error.value = err' }],
          componentIds: ['CMP-CREDENTIALS'],
          responseListHints: [],
          confidence: 'high',
          notes: []
        }
      ],
      gaps: []
    },
    exceptionSimulations: [{ id: 'EX-500', kind: 'api-500', status: 'failed', startedAt: '', endedAt: '', durationMs: 1, observations: { networkRequestIds: ['REQ-500'] } }],
    issues: [
      {
        id: 'ISSUE-ERROR',
        title: '异常场景测试失败：api-500 后无错误态和重试入口',
        category: 'integration-no-feedback',
        severity: 'high',
        confidence: 0.9,
        description: 'API 500 renders empty state.',
        evidence: { networkRequestId: 'REQ-500', screenshot: 'screenshots/api-500.png', details: { exceptionSimulationId: 'EX-500', kind: 'api-500' } },
        reproduceSteps: ['Run api-500 simulation', 'Observe no error state'],
        reason: 'View does not render the error state.',
        suggestion: { frontend: 'Render error state and retry button.', priority: 'P1' }
      }
    ]
  });

  const brief = formatProfessionalBrief(result);
  assert.match(brief, /Proof-ready root causes: \*\*1\*\*/);
  assert.match(brief, /异常场景测试失败/);
  assert.match(brief, /source:src\/api\/credentials\.ts:8, src\/views\/CredentialsView\.vue:55/);
  assert.match(brief, /Render error state and retry button/);
});
