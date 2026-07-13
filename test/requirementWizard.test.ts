import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { synthesizeRequirements } from '../src/requirements/requirementWizard.ts';
import { applyRequirementJourneySynthesis } from '../src/requirements/requirementJourneys.ts';
import { createDefaultConfig } from '../src/defaultConfig.ts';

test('requirements wizard converts PRD text into reviewable executable requirement draft', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-req-'));
  try {
    const output = path.join(dir, 'requirements.json');
    const result = await synthesizeRequirements({
      text: `
- P1 搜索输入关键词后应显示「搜索结果」，并调用 /api/users/list。
- 必须支持删除用户前出现「确认删除」提示。
- 普通用户不能看到管理员按钮。
`,
      outputPath: output,
      prefix: 'REQ-USER'
    });

    assert.equal(result.requirementCount, 3);
    assert.equal(result.requirements.enabled, true);
    assert.equal(result.requirements.items[0].id, 'REQ-USER-001');
    assert.equal(result.requirements.items[0].priority, 'P1');
    assert.equal(result.requirements.items[0].expectedTexts?.includes('搜索结果'), true);
    assert.equal(result.requirements.items[0].expectedTexts?.some((item) => /api\/users/.test(item)), false);
    assert.equal(result.requirements.items[0].apiPatterns?.includes('/api/users/list'), true);
    assert.equal(result.requirements.items[0].interactionKinds?.includes('search'), true);
    assert.equal(result.candidates.some((item) => item.reviewNotes.some((note) => /副作用/.test(note))), true);
    assert.equal(result.questions.some((item) => /storageState/.test(item)), true);
    const written = JSON.parse(await readFile(output, 'utf8')) as typeof result;
    assert.equal(written.requirements.items.length, 3);
    assert.match(await readFile(output.replace(/\.json$/, '.md'), 'utf8'), /Requirements Wizard/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('context-dependent PRD outcomes are not executed as page-load assertions without business actions', async () => {
  const wizard = await synthesizeRequirements({
    text: '- P1 用户点击详情后显示「用户详情」，并调用 GET /api/users/{id}。'
  });
  const config = createDefaultConfig('https://example.com/users');
  config.requirements = wizard.requirements;
  const generated = applyRequirementJourneySynthesis(config);
  assert.equal(generated.length, 0);
  assert.equal(config.requirements.items[0].expectedTexts?.includes('用户详情'), true);
  assert.equal(config.requirements.items[0].apiPatterns?.includes('GET /api/users/{id}'), true);
});

test('wizard preserves explicit HTTP methods so same-path operations are not conflated', async () => {
  const wizard = await synthesizeRequirements({
    text: '- P0 普通用户调用 DELETE /api/users/{id} 必须返回 403。'
  });
  assert.deepEqual(wizard.requirements.items[0].apiPatterns, ['DELETE /api/users/{id}']);
});

test('generated API assertion preserves an explicitly required non-2xx status', async () => {
  const wizard = await synthesizeRequirements({ text: '- P1 健康检查 GET /api/health 必须返回 503。' });
  const config = createDefaultConfig('https://example.com');
  config.requirements = wizard.requirements;
  const generated = applyRequirementJourneySynthesis(config);
  assert.equal(generated.length, 1);
  const requestStep = generated[0].steps.find((step) => step.action === 'expectRequest');
  assert.equal(requestStep?.target, 'GET /api/health');
  assert.equal(requestStep?.value, '503');
});

test('generated API assertions keep statuses bound to each API instead of sharing a requirement-wide union', () => {
  const config = createDefaultConfig('https://example.com');
  config.requirements.inferFromPage = false;
  config.requirements.items = [{
    id: 'REQ-MULTI-API',
    title: 'API contract checks',
    apiPatterns: ['GET /api/profile', 'DELETE /api/profile/{id}'],
    acceptanceCriteria: ['GET /api/profile 返回 200；DELETE /api/profile/{id} 返回 403。']
  }];
  const generated = applyRequirementJourneySynthesis(config);
  const requests = generated[0].steps.filter((step) => step.action === 'expectRequest');
  assert.deepEqual(requests.map((step) => [step.target, step.value]), [
    ['GET /api/profile', '200'],
    ['DELETE /api/profile/{id}', '403']
  ]);
});

test('wizard distinguishes actors from business entities and honors negative state semantics', async () => {
  const wizard = await synthesizeRequirements({
    text: `
- 管理员可以查看用户详情。
- 普通用户不能执行删除。
- 文件上传必须通过类型校验。
`
  });
  assert.deepEqual(wizard.candidates[0].roles, ['管理员']);
  assert.deepEqual(wizard.candidates[1].roles, ['普通用户']);
  assert.equal(wizard.candidates[1].stateTransitions, undefined);
  assert.equal(wizard.candidates[2].priority, 'P1', 'normative 必须 is not automatically a release blocker');
  assert.ok(wizard.candidates[2].backendScope?.length);
  assert.ok(wizard.candidates[2].apiScope?.length);
});
