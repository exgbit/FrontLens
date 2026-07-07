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
  const brief = await readFile(result.artifacts.professionalBrief!, 'utf8');
  const audit = await readFile(result.artifacts.professionalAudit!, 'utf8');
  const reportContentAudit = await readFile(result.artifacts.reportContentAudit!, 'utf8');
  const journeyAssertionAudit = await readFile(result.artifacts.journeyAssertionAudit!, 'utf8');
  const productContext = await readFile(result.artifacts.productContext!, 'utf8');
  const review = await readFile(result.artifacts.qaReview!, 'utf8');
  const evidence = await readFile(result.artifacts.evidenceReport!, 'utf8');
  const scopeReview = await readFile(result.artifacts.scopeReview!, 'utf8');
  const claimGuard = await readFile(result.artifacts.claimGuard!, 'utf8');
  const qaIntake = await readFile(result.artifacts.qaIntake!, 'utf8');
  const defectProof = await readFile(result.artifacts.defectProof!, 'utf8');
  const riskRegister = await readFile(result.artifacts.riskRegister!, 'utf8');

  assert.match(report, /FrontLens Professional QA Report/);
  assert.match(brief, /FrontLens QA Brief/);
  assert.match(audit, /FrontLens Professional Audit/);
  assert.match(reportContentAudit, /FrontLens Report Content Audit/);
  assert.match(reportContentAudit, /Status: \*\*(passed|warning|failed)\*\*/);
  assert.match(journeyAssertionAudit, /FrontLens Journey Assertion Audit/);
  assert.match(productContext, /FrontLens Product Context Suggestion/);
  assert.match(brief, /Core fixes/);
  assert.match(brief, /Professional audit:/);
  assert.match(brief, /professional-audit\.md/);
  assert.match(brief, /Report content audit:/);
  assert.match(brief, /report-content-audit\.md/);
  assert.match(brief, /Journey assertion audit:/);
  assert.match(brief, /journey-assertion-audit\.md/);
  assert.match(brief, /product-context\.md/);
  assert.match(brief, /product-context\.config\.json/);
  assert.match(brief, /qa-plan\.md/);
  assert.match(brief, /qa-coverage\.md/);
  assert.match(brief, /risk-register\.md/);
  assert.match(report, /核心缺陷 \/ 修复根因/);
  assert.match(report, /Professional audit/);
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
  assert.match(riskRegister, /FrontLens Risk Register/);
});

test('markdown report profile controls primary report depth while preserving evidence appendix', async () => {
  const makeResult = async (profile: 'executive' | 'full') => {
    const outputDir = await mkdtemp(path.join(tmpdir(), `frontlens-profile-${profile}-`));
    return normalizeResult({
      summary: {
        url: 'https://example.com/profile',
        title: 'Profile',
        testedAt: '2026-07-07T00:00:00.000Z',
        browser: 'chromium',
        viewport: { width: 1440, height: 900 }
      },
      metadata: { config: { report: { profile } } },
      artifacts: { outputDir },
      pageModel: {
        url: 'https://example.com/profile',
        title: 'Profile',
        stats: { domNodes: 12, visibleTextLength: 80, bodyTextSample: 'Profile' }
      },
      issues: [
        {
          title: '确认按钮点击无响应',
          category: 'frontend-ui',
          severity: 'high',
          confidence: 0.9,
          description: 'Primary confirm action does not update visible state.',
          evidence: { selector: '.confirm-button', details: { interactionTestId: 'IT-001' } },
          reproduceSteps: ['Open page', 'Click confirm'],
          reason: 'The button action is visible but has no runtime feedback.',
          suggestion: { frontend: '补充点击处理、反馈状态和回归断言', priority: 'P1' }
        }
      ]
    });
  };

  const executive = await makeResult('executive');
  await writeMarkdownReport(executive);
  const executiveReport = await readFile(executive.artifacts.markdownReport!, 'utf8');
  const executiveEvidence = await readFile(executive.artifacts.evidenceReport!, 'utf8');
  assert.match(executiveReport, /FrontLens Executive QA Report/);
  assert.doesNotMatch(executiveReport, /## 十三、问题详情/);
  assert.match(executiveEvidence, /## 十三、问题详情/);

  const full = await makeResult('full');
  await writeMarkdownReport(full);
  const fullReport = await readFile(full.artifacts.markdownReport!, 'utf8');
  assert.match(fullReport, /FrontLens Professional QA Report/);
  assert.match(fullReport, /FrontLens QA Evidence Appendix/);
  assert.match(fullReport, /## 十三、问题详情/);
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
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.professionalBrief' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.professionalAudit' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.professionalAuditLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.reportContentAudit' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.reportContentAuditLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.journeyAssertionAudit' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.journeyAssertionAuditLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.productContext' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.productContextLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.productContextConfig' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.qaPlan' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.qaPlanLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.qaCoverage' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.qaCoverageLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.riskRegister' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.riskRegisterLog' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.evidenceReport' && entry.exists), true);
  assert.equal(result.artifactIntegrity.entries.some((entry) => entry.source === 'artifacts.htmlReport' && entry.exists), true);
  assert.match(report, /Artifact integrity：passed（missing 0）/);
  assert.match(evidence, /- Artifact Integrity：passed（missing 0）/);
  assert.match(html, /<span>Artifacts<\/span><strong>passed<\/strong>/);
});

test('markdown reporter annotates missing local artifact references inline', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-missing-artifact-'));
  const missingScreenshot = path.join(outputDir, 'screenshots', 'missing.png');
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/orders',
      title: 'Orders',
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    metadata: {
      config: {
        report: { formats: ['json', 'markdown'] }
      }
    },
    artifacts: { outputDir },
    pageModel: {
      url: 'https://example.com/orders',
      title: 'Orders',
      stats: { domNodes: 10, visibleTextLength: 40, bodyTextSample: 'Orders' }
    },
    issues: [
      {
        title: '截图证据路径不存在',
        category: 'frontend-ui',
        severity: 'medium',
        confidence: 0.8,
        description: 'The report references a missing screenshot.',
        evidence: { screenshot: missingScreenshot },
        reproduceSteps: ['Open report'],
        reason: 'Missing evidence should be visible in the human report.',
        suggestion: { test: '重新采集截图或移除不可用证据路径。', priority: 'P2' }
      }
    ]
  });

  await writeReports(result);

  const report = await readFile(result.artifacts.markdownReport!, 'utf8');
  const evidence = await readFile(result.artifacts.evidenceReport!, 'utf8');

  assert.equal(result.artifactIntegrity.status, 'failed');
  assert.equal(result.artifactIntegrity.missing.some((entry) => entry.source === 'issues.ISSUE-001.evidence.screenshot'), true);
  assert.match(report, /Artifact integrity：failed（missing 1）/);
  assert.match(evidence, /screenshots\/missing\.png \(missing artifact\)/);
});

test('qa-review lists downgraded non-fix findings with reasons', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'frontlens-review-disposition-'));
  const result = normalizeResult({
    summary: {
      url: 'http://127.0.0.1:5173/admin',
      title: 'Admin',
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    metadata: {
      config: {
        report: { formats: ['json', 'markdown'] }
      }
    },
    artifacts: { outputDir },
    pageModel: {
      url: 'http://127.0.0.1:5173/admin',
      title: 'Admin',
      stats: { domNodes: 20, visibleTextLength: 80, bodyTextSample: 'Admin' }
    },
    issues: [
      {
        id: 'ISSUE-TAP',
        title: '触控目标尺寸偏小',
        category: 'frontend-accessibility',
        severity: 'low',
        confidence: 0.8,
        description: 'Some icon buttons are below the mobile tap target threshold.',
        evidence: { selector: '.toolbar .icon-button', details: { rule: 'tap-target' } },
        reproduceSteps: ['Open mobile viewport'],
        reason: 'Mobile tap target is small.',
        suggestion: { product: '确认移动端支持范围。', frontend: '若移动端在范围内，在小屏断点扩大点击区。', priority: 'P3' }
      },
      {
        id: 'ISSUE-DEV',
        title: '未使用JS资源偏多：http://127.0.0.1:5173/src/App.vue',
        category: 'resource-performance',
        severity: 'low',
        confidence: 0.72,
        description: 'Vite dev module coverage noise.',
        evidence: { resourceUrl: 'http://127.0.0.1:5173/src/App.vue', details: { coverageEntry: { url: 'http://127.0.0.1:5173/src/App.vue' } } },
        reproduceSteps: ['Open Vite dev page'],
        reason: 'Dev server module graph noise.',
        suggestion: { frontend: '对该脚本做代码分割。', priority: 'P3' }
      }
    ]
  });

  await writeMarkdownReport(result);

  const review = await readFile(result.artifacts.qaReview!, 'utf8');
  assert.match(review, /降级 \/ 不修 \/ 待补证据样例/);
  assert.match(review, /ISSUE-TAP/);
  assert.match(review, /product-decision/);
  assert.match(review, /该类结论依赖产品需求、页面类型、设备范围或更强绑定证据/);
  assert.match(review, /ISSUE-DEV/);
  assert.match(review, /tool-limitation/);
  assert.match(review, /Vite dev server 源码模块\/HMR/);
});
