import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildPageProfileAssessment } from '../src/product/pageProfile.ts';
import { buildScopeReview } from '../src/product/scopeReview.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';
import type { PageModel, RequirementCoverageResult } from '../src/types.ts';

function coverage(providedCount: number): RequirementCoverageResult {
  return {
    enabled: true,
    checkedAt: '2026-07-07T00:00:00.000Z',
    source: providedCount > 0 ? 'provided' : 'none',
    summary: {
      requirementCount: providedCount,
      passedCount: providedCount,
      failedCount: 0,
      partialCount: 0,
      notCoveredCount: 0,
      notApplicableCount: 0,
      providedCount,
      inferredCount: 0,
      highPriorityGapCount: 0
    },
    items: [],
    gaps: []
  };
}

function pageModel(): PageModel {
  return {
    url: 'https://example.com/credentials',
    title: 'Credentials',
    meta: { h1: ['Credentials'], openGraph: {} },
    breadcrumbs: [],
    headings: [{ level: 1, text: 'Credentials', selector: 'h1' }],
    structureTree: '',
    components: [{ id: 'CMP-1', type: 'card', selector: '.credential-card', text: 'API Key Secret Token' }],
    forms: [],
    tables: [],
    buttons: [],
    inputs: [],
    images: [],
    links: [],
    stats: { domNodes: 20, visibleTextLength: 80, bodyTextSample: 'Credentials API Key Secret Token' }
  };
}

test('scope review turns inferred page profile into reviewable productContext questions', () => {
  const config = createDefaultConfig('https://example.com/credentials');
  const profile = buildPageProfileAssessment({ config, pageModel: pageModel() });
  const review = buildScopeReview({ config, pageProfile: profile, requirementCoverage: coverage(0), title: 'Credentials' });

  assert.equal(review.status, 'needs-input');
  assert.equal(review.pageType, 'credential-security');
  assert.equal(review.suggestedProductContext.requiredFeatures.includes('secret-masking'), true);
  assert.equal(review.suggestedProductContext.optionalFeatures.includes('mobile-touch-target'), true);
  assert.equal(review.questions.some((item) => item.category === 'requirement'), true);
  assert.equal(review.questions.some((item) => item.category === 'product' && item.question.includes('凭证')), true);
  assert.match(JSON.stringify(review.configSnippet), /secret-masking/);
});

test('scope review is configured when productContext and provided requirements exist', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.productContext.pageType = 'admin-data-list';
  config.productContext.deviceScope = 'desktop-first';
  config.productContext.requiredFeatures = ['error-state', 'search'];
  config.productContext.optionalFeatures = [];
  const profile = buildPageProfileAssessment({ config, pageModel: { ...pageModel(), url: 'https://example.com/users', title: 'Users' } });
  const review = buildScopeReview({ config, pageProfile: profile, requirementCoverage: coverage(1), title: 'Users' });

  assert.equal(review.status, 'configured');
  assert.equal(review.confidence, 'high');
  assert.equal(review.questions.length, 0);
  assert.deepEqual(review.configSnippet.productContext.requiredFeatures, ['error-state', 'search']);
});

test('explicit optional/out-of-scope product decisions do not become new scope questions', () => {
  const config = createDefaultConfig('https://example.com/users');
  config.productContext.pageType = 'admin-data-list';
  config.productContext.deviceScope = 'desktop-first';
  config.productContext.requiredFeatures = ['error-state'];
  config.productContext.optionalFeatures = ['mobile-touch-target'];
  config.productContext.outOfScopeFeatures = ['export'];
  config.productContext.decisions = [
    { id: 'ADR-0001', title: 'PC-first list page without export', appliesTo: ['mobile-touch-target', 'export'] }
  ];
  const profile = buildPageProfileAssessment({ config, pageModel: { ...pageModel(), url: 'https://example.com/users', title: 'Users' } });
  const review = buildScopeReview({ config, pageProfile: profile, requirementCoverage: coverage(1), title: 'Users' });

  assert.equal(review.status, 'configured');
  assert.equal(review.questions.some((item) => item.question.includes('mobile-touch-target')), false);
  assert.equal(review.questions.some((item) => item.question.includes('export')), false);
  assert.deepEqual(review.configSnippet.productContext.outOfScopeFeatures, ['export']);
});

test('partial productContext still asks for missing page type', () => {
  const config = createDefaultConfig('https://example.com/custom');
  config.productContext.productName = 'Example Admin';
  config.productContext.deviceScope = 'desktop-first';
  const profile = buildPageProfileAssessment({ config, pageModel: { ...pageModel(), url: 'https://example.com/custom', title: 'Custom' } });
  const review = buildScopeReview({ config, pageProfile: profile, requirementCoverage: coverage(1), title: 'Custom' });

  assert.equal(review.status, 'needs-input');
  assert.equal(review.questions.some((item) => item.category === 'product' && item.question.includes('当前页面类型')), true);
});

test('normalizeResult backfills scope review for older reports', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials' },
    pageModel: pageModel()
  });

  assert.equal(result.scopeReview.status, 'needs-input');
  assert.equal(result.scopeReview.questions.length > 0, true);
  assert.equal(result.scopeReview.configSnippet.productContext.enabled, true);
});
