import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildBusinessJourneys, formatBusinessJourneys } from '../src/journeys/businessJourneys.ts';

test('business journeys turn requirements and assertion drafts into rerunnable scenarios without overclaiming pass', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials' },
    metadata: {
      config: {
        requirements: {
          enabled: true,
          inferFromPage: false,
          items: [
            {
              id: 'REQ-CRED-001',
              title: '管理员可以查看凭证列表',
              priority: 'P1',
              selectors: ['[data-testid="credential-list"]'],
              expectedTexts: ['凭证列表'],
              apiPatterns: ['/api/credentials'],
              journeySteps: [
                { action: 'waitForLoad' },
                { action: 'click', target: 'role=tab[name="凭证"]' }
              ]
            }
          ]
        }
      }
    },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 20, visibleTextLength: 80, bodyTextSample: '凭证列表 token secret admin' },
      components: [{ id: 'CMP-001', kind: 'list', selector: '[data-testid="credential-list"]', text: '凭证列表', visible: true }]
    },
    network: {
      requests: [{ id: 'REQ-001', url: 'https://example.com/api/credentials', method: 'GET', status: 200, resourceType: 'fetch', failed: false }]
    }
  });

  const journeys = buildBusinessJourneys(result);
  const scenario = journeys.scenarios.find((item) => item.requirementIds.includes('REQ-CRED-001'));

  assert.equal(journeys.status, 'needs-input');
  assert.ok(scenario);
  assert.equal(scenario?.source, 'requirement');
  assert.equal(scenario?.status, 'needs-input');
  assert.ok(scenario?.assertions.some((step) => step.action === 'expectVisible' && step.target === '[data-testid="credential-list"]'));
  assert.ok(scenario?.assertions.some((step) => step.action === 'expectText' && step.value === '凭证列表'));
  assert.ok(scenario?.assertions.some((step) => step.action === 'expectRequest' && step.target === '/api/credentials'));
  assert.ok((scenario?.roleNeeds.length ?? 0) > 0);
  assert.match(formatBusinessJourneys(journeys), /FrontLens Business Journeys/);
});

test('business journeys produce manual discovery scenario when requirements and journeys are missing', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/dashboard', title: 'Dashboard' },
    pageModel: {
      url: 'https://example.com/dashboard',
      title: 'Dashboard',
      stats: { domNodes: 10, visibleTextLength: 40, bodyTextSample: 'Dashboard overview' }
    }
  });
  const journeys = buildBusinessJourneys(result);

  assert.equal(journeys.status, 'manual-required');
  assert.equal(journeys.summary.manualRequiredCount, 1);
  assert.equal(journeys.scenarios[0].source, 'page-model');
  assert.ok(journeys.scenarios[0].gaps.some((gap) => gap.includes('缺少 provided requirements')));
});
