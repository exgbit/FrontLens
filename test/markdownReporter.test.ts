import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { writeMarkdownReport } from '../src/reporters/markdownReporter.ts';

test('markdown reporter makes report.md decision-oriented and moves raw evidence to evidence-report.md', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-markdown-'));
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      score: 78,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    artifacts: { outputDir },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 12, visibleTextLength: 80, bodyTextSample: 'Credentials' }
    },
    issues: [
      {
        title: '确认按钮点击无响应',
        category: 'frontend-ui',
        severity: 'high',
        confidence: 0.9,
        description: 'Primary confirm action does not update visible state.',
        evidence: { selector: '.confirm-button', details: { interactionTestId: 'IT-001', expectedState: 'saved' } },
        reproduceSteps: ['Open page', 'Click confirm'],
        reason: 'The button action is visible but has no runtime feedback.',
        suggestion: { frontend: '补充点击处理、反馈状态和回归断言', priority: 'P1' }
      }
    ]
  });

  await writeMarkdownReport(result);

  const report = await readFile(result.artifacts.markdownReport!, 'utf8');
  const review = await readFile(result.artifacts.qaReview!, 'utf8');
  const evidence = await readFile(result.artifacts.evidenceReport!, 'utf8');

  assert.match(report, /FrontLens Professional QA Report/);
  assert.match(report, /核心缺陷 \/ 修复根因/);
  assert.doesNotMatch(report, /## 十三、问题详情/);
  assert.doesNotMatch(report, /<details><summary>Evidence details/);
  assert.match(review, /完整原始证据见 `evidence-report\.md`/);
  assert.match(evidence, /FrontLens QA Evidence Appendix/);
  assert.match(evidence, /## 十三、问题详情/);
  assert.match(evidence, /<details><summary>Evidence details/);
});
