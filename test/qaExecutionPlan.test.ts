import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildQaExecutionPlan, formatQaExecutionPlan } from '../src/plan/qaExecutionPlan.ts';

test('qa execution plan turns missing PRD and journeys into actionable QA inputs', () => {
  const result = normalizeResult({
    summary: { url: 'http://127.0.0.1:5173/credentials', title: 'Credentials', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    artifacts: {
      outputDir: '/tmp/frontlens-qa-plan-test',
      productContextConfig: '/tmp/frontlens-qa-plan-test/product-context.config.json'
    },
    pageModel: {
      url: 'http://127.0.0.1:5173/credentials',
      title: 'Credentials',
      meta: { h1: ['Credentials'] },
      stats: { domNodes: 42, visibleTextLength: 220, bodyTextSample: 'Credentials API Key Secret Token' },
      components: [],
      buttons: [],
      inputs: []
    }
  });

  const plan = buildQaExecutionPlan(result);
  const markdown = formatQaExecutionPlan(plan);

  assert.equal(plan.status, 'needs-input');
  assert.equal(plan.scope.requirementSource, 'inferred');
  assert.equal(plan.commands.productContextRerun?.includes('product-context.config.json'), true);
  assert.equal(plan.items.some((item) => item.type === 'requirement' && item.status === 'needs-input'), true);
  assert.equal(plan.items.some((item) => item.type === 'journey' && item.status === 'needs-input'), true);
  assert.equal(plan.items.some((item) => item.type === 'product-context' && item.status === 'needs-input'), true);
  assert.match(markdown, /FrontLens QA Execution Plan/);
  assert.match(markdown, /Requirement source/);
  assert.match(markdown, /product-context\.config\.json/);
});

test('qa execution plan adds role matrix work for permission-sensitive pages', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin/users', title: 'Users', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: {
      url: 'https://example.com/admin/users',
      title: 'Users',
      meta: { h1: ['Users'] },
      stats: { domNodes: 88, visibleTextLength: 420, bodyTextSample: 'Users Create Edit Delete' },
      components: [],
      buttons: [
        { id: 'BTN-DELETE', type: 'button', visible: true, text: 'Delete user', attributes: {}, confidence: 0.9 }
      ],
      inputs: []
    },
    permissionChecks: [
      {
        id: 'PERM-003',
        rule: 'visible-danger',
        status: 'warning',
        severity: 'medium',
        title: '危险按钮权限标记',
        description: 'Dangerous action lacks permission marker.',
        count: 1,
        evidence: [{ componentId: 'BTN-DELETE', text: 'Delete user' }],
        suggestion: { test: 'Run role matrix.', priority: 'P2' }
      }
    ]
  });

  const plan = buildQaExecutionPlan(result);
  const roleItem = plan.items.find((item) => item.type === 'role-matrix');

  assert.equal(roleItem?.status, 'needs-input');
  assert.equal(roleItem?.priority, 'P1');
  assert.equal(plan.commands.roleMatrix?.includes('role-matrix'), true);
  assert.match(formatQaExecutionPlan(plan), /角色\/权限矩阵|role-matrix/);
});

test('qa execution plan does not require role matrix for ordinary non-privileged form actions', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/contact', title: 'Contact', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: {
      url: 'https://example.com/contact',
      title: 'Contact',
      meta: { h1: ['Contact'] },
      stats: { domNodes: 70, visibleTextLength: 300, bodyTextSample: 'Contact name message submit' },
      components: [],
      buttons: [
        { id: 'BTN-SUBMIT', type: 'button', visible: true, text: 'Submit', attributes: {}, confidence: 0.9 }
      ],
      inputs: []
    }
  });

  const plan = buildQaExecutionPlan(result);

  assert.equal(plan.items.some((item) => item.type === 'role-matrix'), false);
});
