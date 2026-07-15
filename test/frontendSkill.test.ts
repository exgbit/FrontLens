import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skillPath = new URL('../skills/frontend-qa/SKILL.md', import.meta.url);

test('frontend QA skill includes Git impact-selected original business regression in its core checklist', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /automatic remote-default\/main\/master\/develop detection/);
  assert.match(skill, /staged, unstaged, and untracked files/);
  assert.match(skill, /change-impact\.md/);
  assert.match(skill, /CHANGE-REG-\*/);
  assert.match(skill, /Static changed\/dependent-file analysis selects scope but never proves/);
  assert.match(skill, /distinguish passed\/failed\/not-run impact targets/);
  assert.match(skill, /database explicitly identified as test\/staging/);
  assert.match(skill, /authorization for bounded create\/query\/update\/delete/);
  assert.match(skill, /does not authorize migrations, `DROP`, `TRUNCATE`, broad updates\/deletes/);
  assert.match(skill, /mark only the required journey steps `allowMutating=true`/);
  assert.match(skill, /keep `blockMutatingRequests=true`/);
  assert.match(skill, /Do not use the broad `--allow-mutating-requests`/);
});
