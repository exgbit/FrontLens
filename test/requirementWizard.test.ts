import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { synthesizeRequirements } from '../src/requirements/requirementWizard.ts';

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
