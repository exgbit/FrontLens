import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 43000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('demo server did not start');
});

after(() => child?.kill('SIGTERM'));

test('search and CSV export honor the same q filter', async () => {
  const search = await fetch(`${base}/api/users?q=frontlens&page=1&pageSize=2`);
  assert.equal(search.status, 200);
  assert.deepEqual((await search.json()).records.map((item) => item.name), ['FrontLens']);
  const exported = await fetch(`${base}/api/export?q=frontlens`);
  const csv = await exported.text();
  assert.match(csv, /FrontLens/);
  assert.doesNotMatch(csv, /Alice/);
});

test('delete requires an admin role at the API boundary', async () => {
  assert.equal((await fetch(`${base}/api/users/4`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/api/users/4`, { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(`${base}/api/users/4`)).status, 200);
  assert.equal((await fetch(`${base}/api/users/4`, { method: 'DELETE', headers: { 'x-role': 'admin' } })).status, 200);
  assert.equal((await fetch(`${base}/api/users/4`)).status, 404);
});

test('upload enforces extension and 1MB file size', async () => {
  const valid = new FormData();
  valid.append('file', new Blob(['hello'], { type: 'text/plain' }), 'avatar.txt');
  assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', body: valid })).status, 200);

  const invalid = new FormData();
  invalid.append('file', new Blob(['bad']), 'avatar.exe');
  assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', body: invalid })).status, 400);

  const oversized = new FormData();
  oversized.append('file', new Blob([new Uint8Array(1024 * 1024 + 1)]), 'avatar.png');
  assert.equal((await fetch(`${base}/api/upload`, { method: 'POST', body: oversized })).status, 413);
});
