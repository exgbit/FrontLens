import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { writeMarkdownReport } from '../src/reporters/markdownReporter.ts';
import { writeReports } from '../src/reporter.ts';

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
  const scopeReview = await readFile(result.artifacts.scopeReview!, 'utf8');
  const claimGuard = await readFile(result.artifacts.claimGuard!, 'utf8');
  const qaIntake = await readFile(result.artifacts.qaIntake!, 'utf8');
  const defectProof = await readFile(result.artifacts.defectProof!, 'utf8');

  assert.match(report, /FrontLens Professional QA Report/);
  assert.match(report, /核心缺陷 \/ 修复根因/);
  assert.match(report, /产品范围 \/ PRD 待确认/);
  assert.match(report, /结论护栏 \/ 禁止过度承诺/);
  assert.match(report, /专业 QA 待补输入 \/ 避免猜测/);
  assert.match(report, /缺陷证明强度/);
  assert.match(report, /Adjusted score：\*\*.*专业排期口径/);
  assert.match(report, /Raw score：\*\*.*不能直接等同页面质量或修复工作量/);
  assert.ok(report.indexOf('Adjusted score') < report.indexOf('Raw score'));
  assert.doesNotMatch(report, /## 十三、问题详情/);
  assert.doesNotMatch(report, /<details><summary>Evidence details/);
  assert.match(review, /完整原始证据见 `evidence-report\.md`/);
  assert.match(evidence, /FrontLens QA Evidence Appendix/);
  assert.match(evidence, /## 十三、问题详情/);
  assert.match(evidence, /<details><summary>Evidence details/);
  assert.match(scopeReview, /Scope Review \/ 产品范围确认/);
  assert.match(scopeReview, /Suggested productContext/);
  assert.match(claimGuard, /Claim Guard \/ 结论护栏/);
  assert.match(claimGuard, /业务功能验证通过可信度 100%/);
  assert.match(qaIntake, /QA Intake \/ 专业测试待补输入/);
  assert.match(qaIntake, /Top questions/);
  assert.match(defectProof, /Defect Proof \/ 缺陷证明强度/);
  assert.match(defectProof, /Proof status/);
});

test('writeReports rewrites human reports after final artifact integrity is known', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-stable-reports-'));
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/users',
      title: 'Users',
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    metadata: {
      config: {
        report: { formats: ['json', 'markdown', 'html'] }
      }
    },
    artifacts: { outputDir },
    pageModel: {
      url: 'https://example.com/users',
      title: 'Users',
      stats: { domNodes: 10, visibleTextLength: 40, bodyTextSample: 'Users' }
    }
  });

  await writeReports(result);

  const report = await readFile(result.artifacts.markdownReport!, 'utf8');
  const evidence = await readFile(result.artifacts.evidenceReport!, 'utf8');
  const html = await readFile(result.artifacts.htmlReport!, 'utf8');

  assert.equal(result.artifactIntegrity.status, 'passed');
  assert.equal(result.artifactIntegrity.missingCount, 0);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.markdownReport' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.evidenceReport' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.htmlReport' && entry.exists), true);
  assert.match(report, /Artifact integrity：passed（missing 0）/);
  assert.match(evidence, /- Artifact Integrity：passed（missing 0）/);
  assert.match(html, /<span>Artifacts<\/span><strong>passed<\/strong>/);
});
