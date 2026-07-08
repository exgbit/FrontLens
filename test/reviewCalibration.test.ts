import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildReviewCalibration, formatReviewCalibration } from '../src/review/reviewCalibration.ts';

function sampleResult() {
  return normalizeResult({
    summary: { url: 'http://127.0.0.1:5173/credentials', title: 'Credentials' },
    metadata: {
      config: {
        productContext: {
          enabled: true,
          pageType: 'detail-master',
          deviceScope: 'unknown',
          accessibilityTarget: 'basic',
          requiredFeatures: [],
          optionalFeatures: [],
          outOfScopeFeatures: [],
          decisions: [],
          adrRefs: []
        },
        source: { enabled: true, root: '/repo/frontend' }
      }
    },
    pageModel: {
      url: 'http://127.0.0.1:5173/credentials',
      title: 'Credentials',
      stats: { domNodes: 80, visibleTextLength: 300, bodyTextSample: '凭证 站点 卡片 暂无匹配凭证' },
      components: [{ id: 'CMP-001', type: 'card', visible: true, attributes: {}, confidence: 0.8 }]
    },
    issues: [
      {
        id: 'ISSUE-001',
        title: '接口有数据但页面显示空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.82,
        description: 'Network contains a list but UI appears empty.',
        evidence: { networkRequestId: 'REQ-001', selector: '.empty', details: { responsePath: 'data.records' } },
        reproduceSteps: [],
        reason: 'Data mismatch suspected.',
        suggestion: { frontend: 'Check binding.', priority: 'P1' }
      },
      {
        id: 'ISSUE-002',
        title: '样式风格按钮层级不一致',
        category: 'frontend-visual',
        severity: 'low',
        confidence: 0.7,
        description: 'Visual style mismatch.',
        evidence: { selector: '.toolbar' },
        reproduceSteps: [],
        reason: 'Style heuristic.',
        suggestion: { product: 'Confirm design.', priority: 'P3' }
      },
      {
        id: 'ISSUE-003',
        title: '触控目标 <32px',
        category: 'frontend-accessibility',
        severity: 'low',
        confidence: 0.9,
        description: 'Small tap target on mobile.',
        evidence: { selector: '.act--mini' },
        reproduceSteps: [],
        reason: 'Tap target too small.',
        suggestion: { frontend: 'Increase tap target.', priority: 'P3' }
      },
      {
        id: 'ISSUE-004',
        title: 'api-500 无错误反馈',
        category: 'integration-no-feedback',
        severity: 'high',
        confidence: 0.9,
        description: 'API 500 is shown as empty state.',
        evidence: { networkRequestId: 'REQ-500', selector: '.empty' },
        reproduceSteps: [],
        reason: 'No error state or retry.',
        suggestion: { frontend: 'Render error state.', priority: 'P1' }
      },
      {
        id: 'ISSUE-005',
        title: '图标按钮无 accessible name',
        category: 'frontend-accessibility',
        severity: 'medium',
        confidence: 0.95,
        description: 'Icon-only buttons miss names.',
        evidence: { selector: '.icon-button' },
        reproduceSteps: [],
        reason: 'button-name rule.',
        suggestion: { frontend: 'Add aria-label.', priority: 'P2' }
      },
      {
        id: 'ISSUE-006',
        title: 'Vite dev server 暴露 /@vite/client 调试信息',
        category: 'security',
        severity: 'high',
        confidence: 0.8,
        description: 'Debug/source modules are visible.',
        evidence: { resourceUrl: 'http://127.0.0.1:5173/@vite/client', details: { rule: 'api-leak' } },
        reproduceSteps: [],
        reason: 'Dev server source module.',
        suggestion: { security: 'Use production build.', priority: 'P2' }
      }
    ]
  });
}

test('review calibration turns reviewer feedback into reusable triage config and issue actions', () => {
  const result = sampleResult();
  const calibration = buildReviewCalibration(result, {
    feedbackText: '项目 PC 为主，移动端降级；样式风格产品设计如此；接口有数据但页面显示空是误报，不要假设，必须结合源码四段证据；Vite dev server/HMR 是环境噪音；异常无反馈和 aria 图标按钮是真问题。'
  });

  assert.equal(calibration.status, 'ready');
  assert.equal(calibration.calibrationSource, 'feedback');
  assert.ok(calibration.signals.some((item) => item.kind === 'desktop-first'));
  assert.ok(calibration.signals.some((item) => item.kind === 'data-mismatch-needs-proof'));
  assert.ok(calibration.signals.some((item) => item.kind === 'dev-server-noise'));
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-001')?.action, 'needs-evidence');
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-002')?.action, 'ask-product');
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-003')?.action, 'downgrade');
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-004')?.action, 'keep');
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-005')?.action, 'keep');
  assert.equal(calibration.issueDecisions.find((item) => item.issueId === 'ISSUE-006')?.action, 'out-of-scope');
  assert.equal((calibration.configPatch.productContext as any).deviceScope, 'desktop-first');
  assert.equal((calibration.configPatch.requirements as any).inferFromPage, false);
  assert.match(formatReviewCalibration(calibration), /FrontLens Review Calibration/);
});

test('review calibration recognizes previously generated config on rerun', () => {
  const initial = buildReviewCalibration(sampleResult(), {
    feedbackText: '项目 PC 为主，移动端降级；样式风格产品设计如此；接口有数据但页面显示空是误报，不要假设，必须结合源码四段证据；Vite dev server/HMR 是环境噪音；异常无反馈和 aria 图标按钮是真问题。'
  });
  const rerun = normalizeResult({
    summary: { url: 'http://127.0.0.1:5173/credentials', title: 'Credentials rerun' },
    metadata: {
      config: {
        ...initial.configPatch,
        productContext: {
          ...(initial.configPatch.productContext as any),
          deviceScope: 'mobile-first',
          requiredFeatures: ['mobile-touch-target']
        }
      }
    },
    pageModel: {
      url: 'http://127.0.0.1:5173/credentials',
      title: 'Credentials rerun',
      stats: { domNodes: 80, visibleTextLength: 300, bodyTextSample: '凭证 站点 卡片 暂无匹配凭证' }
    },
    issues: [
      {
        id: 'ISSUE-RERUN-001',
        title: '接口有数据但页面显示空',
        category: 'integration-data-mismatch',
        severity: 'high',
        confidence: 0.82,
        description: 'Network contains a list but UI appears empty.',
        evidence: { networkRequestId: 'REQ-001', selector: '.empty', details: { responsePath: 'data.records' } },
        reproduceSteps: [],
        reason: 'Data mismatch suspected.',
        suggestion: { frontend: 'Check binding.', priority: 'P1' }
      },
      {
        id: 'ISSUE-RERUN-002',
        title: 'Vite dev server 暴露 /@vite/client 调试信息',
        category: 'security',
        severity: 'high',
        confidence: 0.8,
        description: 'Debug/source modules are visible.',
        evidence: { resourceUrl: 'http://127.0.0.1:5173/@vite/client', details: { rule: 'api-leak' } },
        reproduceSteps: [],
        reason: 'Dev server source module.',
        suggestion: { security: 'Use production build.', priority: 'P2' }
      },
      {
        id: 'ISSUE-RERUN-003',
        title: '触控目标 <32px',
        category: 'frontend-accessibility',
        severity: 'medium',
        confidence: 0.9,
        description: 'Small tap target on required mobile scope.',
        evidence: { selector: '.act--mini' },
        reproduceSteps: [],
        reason: 'Tap target too small.',
        suggestion: { frontend: 'Increase tap target.', priority: 'P3' }
      }
    ]
  });
  const applied = buildReviewCalibration(rerun);
  const dispositionByIssue = new Map(rerun.issueDisposition.items.map((item) => [item.issueId, item]));

  assert.equal(applied.status, 'ready');
  assert.equal(applied.calibrationSource, 'config');
  assert.equal(applied.feedbackProvided, false);
  assert.ok(applied.signals.some((item) => item.kind === 'data-mismatch-needs-proof'));
  assert.ok(applied.signals.some((item) => item.kind === 'dev-server-noise'));
  assert.equal(applied.issueDecisions.find((item) => item.issueId === 'ISSUE-RERUN-001')?.action, 'needs-evidence');
  assert.equal(applied.issueDecisions.find((item) => item.issueId === 'ISSUE-RERUN-002')?.action, 'out-of-scope');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-001')?.status, 'insufficient-evidence');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-001')?.actionability, 'conditional');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-002')?.status, 'tool-limitation');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-002')?.actionability, 'non-actionable');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-003')?.status, 'confirmed');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-003')?.bucket, 'real-frontend-fix');
  assert.equal(dispositionByIssue.get('ISSUE-RERUN-003')?.actionability, 'actionable');
  assert.equal(rerun.summary.adjustedIssueCount, 0);
  assert.equal(applied.questions.some((item) => item.includes('人工复核')), false);
  assert.match(applied.feedbackSummary, /Applied existing review-calibration config/);
});

test('review calibration asks for feedback instead of guessing when no reviewer context exists', () => {
  const calibration = buildReviewCalibration(sampleResult());

  assert.equal(calibration.status, 'needs-feedback');
  assert.equal(calibration.calibrationSource, 'none');
  assert.equal(calibration.feedbackProvided, false);
  assert.ok(calibration.questions.some((item) => item.includes('人工复核')));
  assert.ok(calibration.notes.some((item) => item.includes('stays needs-feedback')));
});
