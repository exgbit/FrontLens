import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildProductContextSuggestion, formatProductContextSuggestion } from '../src/product/productContextSuggestion.ts';

test('product context suggestion turns inferred page profile into reviewable config snippet', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin/credentials', title: 'Credentials', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    artifacts: {
      outputDir: '/tmp/frontlens-product-context-test',
      productContextConfig: '/tmp/frontlens-product-context-test/product-context.config.json'
    },
    pageModel: {
      url: 'https://example.com/admin/credentials',
      title: 'Credentials',
      meta: { h1: ['Credentials'] },
      stats: { domNodes: 30, visibleTextLength: 140, bodyTextSample: 'API Key Secret Token 授权 复制 启停' },
      components: [{ id: 'CMP-1', type: 'card', selector: '.credential-card', confidence: 0.9, text: 'API Key Secret Token' }],
      buttons: [{ selector: '.copy', text: '复制', attributes: {}, confidence: 0.9 }],
      inputs: []
    }
  });

  const suggestion = buildProductContextSuggestion(result);
  const markdown = formatProductContextSuggestion(suggestion);

  assert.equal(suggestion.status, 'needs-input');
  assert.equal(suggestion.productContext.pageType, 'credential-security');
  assert.equal(suggestion.productContext.requiredFeatures.includes('secret-masking'), true);
  assert.equal(suggestion.productContext.optionalFeatures.includes('mobile-touch-target'), true);
  assert.equal(suggestion.usage.configSnippet.productContext.pageType, 'credential-security');
  assert.equal(suggestion.usage.configPath, '/tmp/frontlens-product-context-test/product-context.config.json');
  assert.match(suggestion.usage.rerunCommand, /product-context\.config\.json/);
  assert.match(markdown, /FrontLens Product Context Suggestion/);
  assert.match(markdown, /Config artifact/);
  assert.match(markdown, /secret-masking/);
  assert.match(markdown, /Do not treat this suggestion as an automatic PRD decision/);
});
