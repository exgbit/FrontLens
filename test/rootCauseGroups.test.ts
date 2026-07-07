import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildRootCauseGroups } from '../src/rootCause/rootCauseGroups.ts';
import type { Issue } from '../src/types.ts';

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
