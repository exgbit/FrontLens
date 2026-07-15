import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const skillPath = new URL('../skills/backend-qa/SKILL.md', import.meta.url);

test('backend QA skill prefers healthy deployed environments and discovers API without requiring a URL', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /Existing authorized test environment/);
  assert.match(skill, /verify and reuse it first/);
  assert.match(skill, /SSH config aliases/);
  assert.match(skill, /remote `\.env`/);
  assert.match(skill, /Compose port mappings/);
  assert.match(skill, /bounded log tail/);
  assert.match(skill, /health\/readiness/);
  assert.match(skill, /OpenAPI/);
  assert.match(skill, /Do not ask for an API address until repository\/environment discovery is exhausted/);
});

test('backend QA skill protects shared environments and cleans only exact run-owned data', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /Never stop, restart, migrate, or remove a reused test environment/);
  assert.match(skill, /Allocate a run ID before the first write/);
  assert.match(skill, /delete only IDs created by this run/);
  assert.match(skill, /never broad-delete/);
  assert.match(skill, /cleanup failure remains visible/);
  assert.match(skill, /Never `cat` an entire remote `\.env`/);
  assert.match(skill, /Do not scan networks/);
});

test('backend QA skill treats a supplied test database as bounded read-write authorization', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /database explicitly identified as a test\/staging database/);
  assert.match(skill, /authorization for bounded business-test reads and writes/);
  assert.match(skill, /Do not request a second confirmation/);
  assert.match(skill, /Supplying an explicitly identified test\/staging database or its access details is sufficient write authorization/);
  assert.match(skill, /Prefer business APIs, service-layer commands, and existing seed\/fixture factories/);
  assert.match(skill, /excludes schema migration, `DROP`, `TRUNCATE`, broad delete\/update/);
});

test('backend QA skill executes Git impact-selected legacy business regression instead of treating static impact as pass', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /detected remote default\/main\/master\/develop merge-base/);
  assert.match(skill, /staged, unstaged, and untracked files/);
  assert.match(skill, /CHANGE-REG-\*/);
  assert.match(skill, /Static impact is scope-selection evidence, never proof/);
  assert.match(skill, /original-business regression status/);
});
