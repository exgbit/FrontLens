import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 44000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
let child;
let browser;

before(async () => {
  child = spawn(process.execPath, ['src/server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  child?.kill('SIGTERM');
});

test('viewer UI hides delete and repeated direct DELETE calls preserve the user', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.locator('#tbody tr').first().waitFor();
  assert.equal(await page.locator('.danger').count(), 0);
  assert.match(await page.locator('#permission-hint').textContent(), /普通用户无删除权限/);

  const statuses = await page.evaluate(async () => {
    const first = await fetch('/api/users/4', { method: 'DELETE' });
    const second = await fetch('/api/users/4', { method: 'DELETE' });
    const existing = await fetch('/api/users/4');
    return [first.status, second.status, existing.status];
  });
  assert.deepEqual(statuses, [403, 403, 200]);
  await page.reload();
  await page.locator('#keyword').fill('Carol');
  await page.locator('#search').click();
  await page.locator('#tbody').getByText('Carol').waitFor();
  assert.equal(await page.locator('.danger').count(), 0);
  await page.close();
});

test('rapid search clicks are de-duplicated', async () => {
  const page = await browser.newPage();
  let searchRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/users') searchRequests += 1;
  });
  await page.goto(base);
  await page.locator('#tbody tr').first().waitFor();
  searchRequests = 0;
  await page.locator('#search').click();
  await page.locator('#search').click();
  await page.waitForTimeout(500);
  assert.equal(searchRequests, 1);
  await page.close();
});
