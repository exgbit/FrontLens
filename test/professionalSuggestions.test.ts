import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildProfessionalSuggestions } from '../src/review/professionalSuggestions.ts';

test('professional suggestions default returns only proof-ready actionable implementation work', () => {
  const result = normalizeResult({
    summary: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    pageModel: {
      url: 'https://example.com/credentials',
      title: 'Credentials',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: '凭证管理' }
    },
    metadata: {
      config: {
        source: { enabled: true, root: '/repo' }
      }
    },
    issues: [
      {
        id: 'A11Y-BUTTON-NAME',
        title: '图标按钮缺少可访问名称',
        category: 'frontend-accessibility',
        severity: 'medium',
        confidence: 0.92,
        description: '图标按钮只有 tooltip，没有 aria-label/title。',
        evidence: {
          selector: '.cred-card button.act-icon',
          details: { rule: 'button-name', sourceFile: 'src/components/CredRegionDetail.vue', line: 14 }
        },
        reproduceSteps: ['打开凭证页', '用无障碍树检查按钮名称'],
        reason: '屏幕阅读器无法理解按钮用途。',
        suggestion: { frontend: '为图标按钮补充 aria-label 或 title。', test: '增加 axe button-name 回归。', priority: 'P2' }
      },
      {
        id: 'TOUCH-TARGET',
        title: '触控目标尺寸偏小：mobile 390x844',
        category: 'frontend-accessibility',
        severity: 'low',
        confidence: 0.76,
        description: '部分按钮点击区域小于 32px。',
        evidence: { selector: '.act--mini' },
        reproduceSteps: ['切换到 390px 视口', '检查按钮点击区域'],
        reason: '是否需要修复取决于移动端/触屏范围。',
        suggestion: { frontend: '在移动端断点扩大点击区。', product: '确认移动端触控范围。', priority: 'P3' }
      },
      {
        id: 'DATA-MISMATCH-GUESS',
        title: '接口返回疑似有列表数据，但页面表格为空',
        category: 'integration-data-mismatch',
        severity: 'medium',
        confidence: 0.78,
        description: '列表接口返回 data，但页面中一个 table 行数为 0。',
        evidence: { networkRequestId: 'REQ-1', selector: '#maybe-table' },
        reproduceSteps: ['打开页面', '查看接口响应', '查看页面列表区域'],
        reason: '缺少需求绑定和源码数据流绑定时不应直接排前端修复。',
        suggestion: { frontend: '核对接口响应到渲染状态的数据流。', test: '补齐 requirement + sourceRuntimeCorrelation 后复测。', priority: 'P2' }
      }
    ],
    network: {
      requests: [
        {
          id: 'REQ-1',
          url: 'https://example.com/api/list',
          method: 'GET',
          resourceType: 'fetch',
          requestHeaders: {},
          responseHeaders: { 'content-type': 'application/json' },
          status: 200,
          ok: true,
          failed: false,
          contentType: 'application/json',
          responseBodyPreview: '{"data":[{"id":1}]}',
          startedAt: '2026-07-07T00:00:00.000Z'
        }
      ]
    }
  });

  const professional = buildProfessionalSuggestions(result);
  assert.equal(professional.mode, 'professional-default');
  assert.deepEqual(professional.items.map((item) => item.id), ['A11Y-BUTTON-NAME']);
  assert.equal(professional.summary.rawSuggestionCount, 3);
  assert.equal(professional.summary.returnedCount, 1);
  assert.equal(professional.summary.suppressedCount, 2);
  assert.equal(professional.items[0].disposition?.status, 'confirmed');
  assert.match(professional.notes.join('\n'), /needs-evidence guesses are suppressed/i);

  const raw = buildProfessionalSuggestions(result, { includeAll: true });
  assert.equal(raw.mode, 'raw-all');
  assert.equal(raw.items.length, 3);
});
