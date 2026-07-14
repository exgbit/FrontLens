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
