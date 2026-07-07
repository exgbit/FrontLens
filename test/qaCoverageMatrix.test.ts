import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildQaCoverageMatrix, formatQaCoverageMatrix } from '../src/coverage/qaCoverageMatrix.ts';

test('qa coverage matrix exposes skipped and needs-input dimensions as coverage gaps', () => {
  const result = normalizeResult({
    summary: { url: 'http://127.0.0.1:5173/rules', title: 'Rules', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: {
      url: 'http://127.0.0.1:5173/rules',
      title: 'Rules',
      meta: { h1: ['Rules'] },
      stats: { domNodes: 25, visibleTextLength: 180, bodyTextSample: 'Rules 管理 新建 编辑' },
      components: [],
      buttons: [],
      inputs: []
    },
    interactionTests: [{ id: 'IT-001', kind: 'search', target: '搜索', status: 'skipped', observations: {}, issue: 'No safe target' }]
  });

  const matrix = buildQaCoverageMatrix(result);
  const markdown = formatQaCoverageMatrix(matrix);

  assert.notEqual(matrix.status, 'sufficient');
  assert.equal(matrix.items.some((item) => item.area === 'requirements' && item.status === 'needs-input'), true);
  assert.equal(matrix.items.some((item) => item.area === 'journey' && item.status === 'skipped'), true);
  assert.equal(matrix.items.some((item) => item.area === 'interaction' && item.status === 'partial'), true);
  assert.match(markdown, /FrontLens QA Coverage Matrix/);
  assert.match(markdown, /needs-input/);
  assert.match(markdown, /skipped/);
});
