import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runAiAnalyzer } from '../src/ai/aiAnalyzer.ts';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import type { AnalyzerContext, Issue } from '../src/types.ts';

test('heuristic AI writes advisory summary without creating raw issues', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-ai-'));
  const config = createDefaultConfig('https://example.com/credentials');
  config.analysis.ai = true;
  config.ai.provider = 'heuristic';

  const sourceIssue: Issue = {
    id: 'ISSUE-001',
    title: '接口异常无错误态',
    category: 'integration-no-feedback',
    severity: 'high',
    confidence: 0.9,
    description: '接口失败后页面仍显示空态。',
    evidence: { details: { simulationId: 'EX-001' } },
    reproduceSteps: ['Open page', 'Simulate API failure'],
    reason: '运行时异常与 UI 状态不一致。',
    suggestion: { frontend: '渲染错误态并提供重试入口。', priority: 'P1' },
    source: 'rule'
  };

  const context = {
    config,
    artifacts: { outputDir },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
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
      stats: { domNodes: 0, visibleTextLength: 0, bodyTextSample: '' }
    },
    networkRecords: [],
    consoleRecords: [],
    performanceMetrics: {},
    apiContract: {},
    realtime: {},
    interactionTests: [],
    journeyTests: [],
    accessibilityChecks: [],
    responsiveChecks: [],
    exceptionSimulations: [],
    security: {},
    p2: {}
  } as unknown as AnalyzerContext;

  const result = await runAiAnalyzer(context, [sourceIssue]);

  assert.equal(result.enabled, true);
  assert.equal(result.provider, 'heuristic');
  assert.equal(result.status, 'passed');
  assert.match(result.summary ?? '', /AI Heuristic 综合分析/);
  assert.equal(result.suggestions.length > 0, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.contextPath, path.join(outputDir, 'ai-context.json'));
  await access(result.contextPath);
});
