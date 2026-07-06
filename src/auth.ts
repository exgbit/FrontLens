import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { chmod } from 'node:fs/promises';
import { chromium, firefox, webkit } from 'playwright';
import type { BrowserName } from './types.js';
import { ensureDir, writeJson } from './utils/fs.js';

export interface SaveAuthStateInput {
  url: string;
  outputPath: string;
  browser: BrowserName;
  waitMs: number;
}

function launcherFor(browserName: BrowserName) {
  switch (browserName) {
    case 'chromium':
      return chromium;
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
  }
}

export function sessionStorageSidecarPath(storageStatePath: string): string {
  return `${storageStatePath}.session-storage.json`;
}

export async function saveAuthState(inputArgs: SaveAuthStateInput): Promise<string> {
  const absoluteOutput = path.isAbsolute(inputArgs.outputPath) ? inputArgs.outputPath : path.resolve(process.cwd(), inputArgs.outputPath);
  await ensureDir(path.dirname(absoluteOutput));

  const browser = await launcherFor(inputArgs.browser).launch({
    headless: false
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(inputArgs.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (process.stdin.isTTY) {
      const rl = createInterface({ input, output });
      try {
        await rl.question(`请在打开的浏览器中完成登录，然后回到终端按 Enter 保存登录态到 ${absoluteOutput}\n`);
      } finally {
        rl.close();
      }
    } else {
      await page.waitForTimeout(inputArgs.waitMs);
    }

    await context.storageState({ path: absoluteOutput });
    await chmod(absoluteOutput, 0o600).catch(() => undefined);
    const savedSessionStorage = (
      await Promise.all(
        context.pages().map(async (openPage) => {
          const origin = await openPage.evaluate(() => location.origin).catch(() => '');
          const items = await openPage
            .evaluate(() => Object.entries(sessionStorage).map(([name, value]) => ({ name, value })))
            .catch(() => [] as Array<{ name: string; value: string }>);
          return origin && items.length > 0 ? { origin, items } : undefined;
        })
      )
    ).filter((item): item is { origin: string; items: Array<{ name: string; value: string }> } => Boolean(item));
    await writeJson(sessionStorageSidecarPath(absoluteOutput), {
      version: 1,
      savedAt: new Date().toISOString(),
      sessionStorage: savedSessionStorage
    });
    await chmod(sessionStorageSidecarPath(absoluteOutput), 0o600).catch(() => undefined);
    await context.close();
    return absoluteOutput;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
