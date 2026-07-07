import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { formatReportContentAudit, runReportContentAudit } from '../src/audit/reportContentAudit.ts';

function baseResult() {
  return normalizeResult({
    summary: { url: 'https://example.com/app', title: 'App', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: { url: 'https://example.com/app', title: 'App', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'App' } }
  });
}

test('report content audit blocks forbidden claimGuard wording in generated Markdown', () => {
  const result = baseResult();
  result.claimGuard.forbiddenClaims = ['业务功能验证通过可信度 100%'];

  const audit = runReportContentAudit(result, '# Report\n\n业务功能验证通过可信度 100%\n');

  assert.equal(audit.status, 'failed');
  assert.equal(audit.findings.some((item) => item.category === 'forbidden-wording' && item.severity === 'blocker'), true);
  assert.match(formatReportContentAudit(audit), /Report Content Audit/);
});

test('report content audit blocks raw evidence leakage in professional profile', () => {
  const result = baseResult();
  result.metadata.config.report.profile = 'professional';

  const audit = runReportContentAudit(result, '# FrontLens Professional QA Report\n\n## 十三、问题详情\n\n<details><summary>Evidence details</summary>raw</details>\n');

  assert.equal(audit.status, 'failed');
  assert.equal(audit.findings.some((item) => item.category === 'profile-depth' && item.severity === 'blocker'), true);
});

test('report content audit allows raw evidence in full profile but warns when coverage gaps are hidden', () => {
  const result = baseResult();
  result.metadata.config.report.profile = 'full';
  result.qaCoverage.status = 'partial';
  result.qaCoverage.summary.partialCount = 1;

  const audit = runReportContentAudit(result, '# FrontLens Professional QA Report\n\nRaw score: 90/100（不能直接等同页面质量）\n\n## 十三、问题详情\n');

  assert.notEqual(audit.findings.some((item) => item.category === 'profile-depth'), true);
  assert.equal(audit.findings.some((item) => item.category === 'coverage-boundary' && item.severity === 'warning'), true);
});

test('report content audit warns when raw score lacks caveat', () => {
  const result = baseResult();

  const audit = runReportContentAudit(result, '# Report\n\nQA sign-off ok\nAdjusted score 95/100\nFix queue 0\nRaw score: 100/100\nQA coverage gap: none\n');

  assert.equal(audit.findings.some((item) => item.category === 'raw-score-caveat' && item.severity === 'warning'), true);
});

test('report content audit warns when professional report is too detailed for default review', () => {
  const result = baseResult();
  result.metadata.config.report.profile = 'professional';
  const largeTable = Array.from({ length: 150 }, (_, index) => `| ISSUE-${index} | high | raw selector detail |`).join('\n');
  const markdown = `# FrontLens Professional QA Report\n\nQA sign-off ok\nAdjusted score 90/100\nFix queue 0\nRaw score: 90/100（原始扫描趋势分，不能直接等同页面质量）\nQA coverage gap: none\n\n## 结论\n\n| Issue | Severity | Detail |\n| --- | --- | --- |\n${largeTable}\n`;

  const audit = runReportContentAudit(result, markdown);

  assert.equal(audit.findings.some((item) => item.category === 'profile-depth' && /too detailed/.test(item.title)), true);
});

test('report content audit warns when executive report exceeds compact brief budget', () => {
  const result = baseResult();
  result.metadata.config.report.profile = 'executive';
  const longExecutive = [
    '# FrontLens Executive QA Report',
    '## Sign-off',
    '- QA sign-off: scoped.',
    '- Adjusted score: 100.',
    '## Core fixes',
    '| A | B |',
    '| --- | --- |',
    ...Array.from({ length: 40 }, (_, index) => `| row-${index} | detail that should live in sidecar evidence |`)
  ].join('\n');

  const audit = runReportContentAudit(result, longExecutive);

  assert.equal(audit.status, 'warning');
  assert.equal(audit.findings.some((finding) => finding.category === 'profile-depth' && /too detailed/.test(finding.title)), true);
});
