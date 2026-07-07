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
