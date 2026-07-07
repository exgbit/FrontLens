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
