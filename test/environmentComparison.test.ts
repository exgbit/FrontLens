import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEnvironmentComparison, writeEnvironmentComparison } from '../src/compare/environmentComparison.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';

function result(input: {
  url: string;
  environmentKind: 'local-dev' | 'local-preview' | 'production-like';
  isViteDevServer?: boolean;
  performanceTrust: 'high' | 'medium' | 'low';
  securityTrust: 'high' | 'medium' | 'low';
  score: number;
  issues: Array<{ title: string; fingerprint: string; category?: string; severity?: string; resourceUrl?: string }>;
}) {
  return normalizeResult({
    summary: {
      url: input.url,
      title: 'Page',
      score: input.score,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    pageModel: {
      url: input.url,
      title: 'Page',
      stats: { domNodes: 10, visibleTextLength: 100, bodyTextSample: 'Page' }
    },
    performance: { resources: { totalTransferSize: input.score * 1000 } },
    environment: {
      checkedAt: '2026-07-07T00:00:00.000Z',
      targetUrl: input.url,
      finalUrl: input.url,
      kind: input.environmentKind,
      confidence: 'high',
      isLocalOrPrivate: input.environmentKind !== 'production-like',
      isHttps: input.environmentKind === 'production-like',
      tlsVerificationBypassed: false,
      isViteDevServer: Boolean(input.isViteDevServer),
      hasHmr: Boolean(input.isViteDevServer),
      sameOriginRequestCount: 2,
      devModuleRequestCount: input.isViteDevServer ? 1 : 0,
      hashedAssetCount: input.environmentKind === 'local-dev' ? 0 : 1,
      trust: {
        functional: 'high',
        performance: input.performanceTrust,
        security: input.securityTrust,
        businessSignoff: input.environmentKind === 'production-like' ? 'high' : 'medium'
      },
      evidence: [],
      warnings: [],
      recommendations: []
    },
    issues: input.issues.map((issue) => ({
      title: issue.title,
      fingerprint: issue.fingerprint,
      category: issue.category ?? 'frontend-performance',
      severity: issue.severity ?? 'medium',
      confidence: 0.9,
      description: issue.title,
      evidence: { resourceUrl: issue.resourceUrl },
      reason: issue.title,
      suggestion: { frontend: 'Fix', priority: 'P2' },
      source: 'rule'
    }))
  });
}

test('environment comparison separates dev-only artifacts, persistent issues, and preview-only findings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-env-'));
  try {
    const dev = result({
      url: 'http://127.0.0.1:5173/users',
      environmentKind: 'local-dev',
      isViteDevServer: true,
      performanceTrust: 'low',
      securityTrust: 'low',
      score: 70,
      issues: [
        { title: 'Vite source module transfer noise', fingerprint: 'fp-dev', resourceUrl: 'http://127.0.0.1:5173/src/App.vue' },
        { title: 'Missing accessible name', fingerprint: 'fp-persist', category: 'frontend-accessibility' }
      ]
    });
    const preview = result({
      url: 'https://staging.example.com/users',
      environmentKind: 'production-like',
      performanceTrust: 'high',
      securityTrust: 'high',
      score: 80,
      issues: [
        { title: 'Missing accessible name', fingerprint: 'fp-persist', category: 'frontend-accessibility' },
        { title: 'CSP header missing', fingerprint: 'fp-preview', category: 'security', severity: 'high' }
      ]
    });

    const comparison = await writeEnvironmentComparison(createEnvironmentComparison(dev, preview, dir));

    assert.equal(comparison.interpretation.productionReadiness, 'production-evidence');
    assert.equal(comparison.interpretation.persistentIssueCount, 1);
    assert.equal(comparison.interpretation.devOnlyIssueCount, 1);
    assert.equal(comparison.interpretation.previewOnlyIssueCount, 1);
    assert.equal(comparison.interpretation.devArtifactIssueCount, 1);
    assert.equal(comparison.interpretation.highConfidenceIssueCount, 1);
    assert.equal(comparison.recommendations.some((item) => /Dev-only findings/.test(item)), true);
    const markdown = await readFile(comparison.artifacts.markdown, 'utf8');
    assert.match(markdown, /Environment Comparison/);
    assert.match(markdown, /Professional interpretation/);
    assert.match(markdown, /Adjusted score delta/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
