import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildQaStrategy, formatQaStrategy } from '../src/strategy/qaStrategy.ts';

function localCredentialResult(overrides: Record<string, unknown> = {}) {
  return normalizeResult({
    summary: {
      url: 'http://127.0.0.1:5173/credentials',
      title: 'Credentials',
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    metadata: {
      config: {
        productContext: {
          enabled: false,
          deviceScope: 'unknown',
          accessibilityTarget: 'unknown',
          requiredFeatures: [],
          optionalFeatures: [],
          outOfScopeFeatures: [],
          decisions: [],
          adrRefs: []
        }
      }
    },
    artifacts: { outputDir: '/tmp/frontlens-strategy' },
    pageModel: {
      url: 'http://127.0.0.1:5173/credentials',
      title: 'Credentials',
      stats: { domNodes: 40, visibleTextLength: 200, bodyTextSample: 'Credentials token secret admin edit delete enable disable' }
    },
    network: {
      requests: [{ id: 'REQ-001', url: 'http://127.0.0.1:5173/api/credentials', method: 'GET', status: 200 }]
    },
    environment: {
      checkedAt: '2026-07-07T00:00:00.000Z',
      targetUrl: 'http://127.0.0.1:5173/credentials',
      finalUrl: 'http://127.0.0.1:5173/credentials',
      origin: 'http://127.0.0.1:5173',
      kind: 'local-dev',
      confidence: 'high',
      isLocalOrPrivate: true,
      isHttps: false,
      isViteDevServer: true,
      hasHmr: true,
      sameOriginRequestCount: 10,
      devModuleRequestCount: 8,
      hashedAssetCount: 0,
      trust: { functional: 'high', performance: 'low', security: 'low', businessSignoff: 'low' },
      evidence: ['hmr:true'],
      warnings: ['Vite/dev-source mode detected.'],
      recommendations: ['Run a build + preview pass.']
    },
    ...overrides
  });
}

test('qa strategy turns dev credential page into scoped plan instead of production/security overclaim', () => {
  const result = localCredentialResult();
  const strategy = buildQaStrategy(result);

  assert.equal(strategy.summary.pageType, 'credential-security');
  assert.ok(['high', 'critical'].includes(strategy.summary.riskLevel));
  assert.equal(strategy.summary.recommendedRunMode, 'full');
  assert.ok(['needs-input', 'blocked'].includes(strategy.status));
  assert.equal(strategy.modules.find((item) => item.module === 'env-compare')?.decision, 'run-if-input');
  assert.equal(strategy.modules.find((item) => item.module === 'security-passive')?.decision, 'run-if-input');
  assert.equal(strategy.modules.find((item) => item.module === 'role-matrix')?.decision, 'run-if-input');
  assert.equal(strategy.modules.find((item) => item.module === 'requirements')?.decision, 'run-if-input');
  assert.ok(strategy.questions.some((question) => question.category === 'environment'));
  assert.ok(strategy.questions.some((question) => question.category === 'role-auth'));
  assert.match(formatQaStrategy(strategy), /FrontLens QA Test Strategy/);
  assert.match(formatQaStrategy(strategy), /run-if-input/);
});

test('qa strategy blocks evidence handoff when artifact integrity or bundle is missing', () => {
  const result = localCredentialResult({
    artifactIntegrity: {
      status: 'failed',
      checkedAt: '2026-07-07T00:00:00.000Z',
      presentCount: 0,
      missingCount: 1,
      skippedCount: 0,
      entries: [{ source: 'artifacts.screenshot', path: '/tmp/missing.png', absolutePath: '/tmp/missing.png', kind: 'file', expected: true, exists: false, message: 'Referenced artifact path does not exist.' }],
      missing: [{ source: 'artifacts.screenshot', path: '/tmp/missing.png', absolutePath: '/tmp/missing.png', kind: 'file', expected: true, exists: false, message: 'Referenced artifact path does not exist.' }],
      summary: '1 referenced artifact path(s) are missing.'
    }
  });
  const strategy = buildQaStrategy(result);

  assert.equal(strategy.status, 'blocked');
  assert.equal(strategy.summary.recommendedRunMode, 'blocked');
  assert.equal(strategy.modules.find((item) => item.module === 'evidence-handoff')?.decision, 'blocked');
  assert.ok(strategy.notes.some((note) => note.includes('Evidence bundle') || note.includes('artifact')));
});
