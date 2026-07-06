import path from 'node:path';
import type { Page } from 'playwright';
import type { ArtifactIndex, FrontLensConfig, ResponsiveCheckResult } from '../types.js';
import { ensureDir } from '../utils/fs.js';

interface ResponsiveMetrics {
  horizontalOverflow: boolean;
  maxScrollWidth: number;
  viewportWidth: number;
  bodyScrollWidth: number;
  clippedInteractiveCount: number;
  smallTapTargetCount: number;
  fixedElementCount: number;
  tableOverflowCount: number;
  observations: string[];
}

export class ResponsiveTester {
  constructor(
    private readonly config: FrontLensConfig,
    private readonly artifacts: ArtifactIndex
  ) {}

  async run(page: Page): Promise<ResponsiveCheckResult[]> {
    if (!this.config.analysis.responsive) {
      return [];
    }

    const results: ResponsiveCheckResult[] = [];
    const screenshotDir = path.join(this.artifacts.outputDir, 'screenshots', 'responsive');
    if (this.config.report.screenshot) {
      await ensureDir(screenshotDir);
    }

    for (const viewport of this.config.responsive.viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(350).catch(() => undefined);

      const metrics = await page.evaluate<ResponsiveMetrics>(() => {
        const interactiveSelector = 'button, a, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
        const viewportWidth = window.innerWidth;
        const body = document.body;
        const documentElement = document.documentElement;
        const allElements = Array.from(document.querySelectorAll<HTMLElement>('body *'));
        const visible = (element: HTMLElement): boolean => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };

        const maxScrollWidth = Math.max(documentElement.scrollWidth, body?.scrollWidth ?? 0, ...allElements.slice(0, 3000).map((element) => element.scrollWidth));
        const bodyScrollWidth = body?.scrollWidth ?? documentElement.scrollWidth;
        const horizontalOverflow = bodyScrollWidth > viewportWidth + 2 || maxScrollWidth > viewportWidth + 80;
        const interactive = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelector)).filter(visible);
        const clippedInteractiveCount = interactive.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -2 || rect.right > viewportWidth + 2;
        }).length;
        const smallTapTargetCount = interactive.filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32);
        }).length;
        const fixedElementCount = allElements.filter((element) => visible(element) && ['fixed', 'sticky'].includes(window.getComputedStyle(element).position)).length;
        const tableOverflowCount = Array.from(document.querySelectorAll<HTMLElement>('table, [role="table"], [role="grid"], [class*="table" i]')).filter((element) => {
          const rect = element.getBoundingClientRect();
          return visible(element) && (rect.right > viewportWidth + 2 || element.scrollWidth > element.clientWidth + 2);
        }).length;

        const observations: string[] = [];
        if (horizontalOverflow) observations.push('页面存在横向溢出。');
        if (clippedInteractiveCount > 0) observations.push(`${clippedInteractiveCount} 个交互元素超出视口。`);
        if (smallTapTargetCount > 0) observations.push(`${smallTapTargetCount} 个交互元素触控尺寸偏小。`);
        if (tableOverflowCount > 0) observations.push(`${tableOverflowCount} 个表格/网格在当前视口溢出。`);
        if (observations.length === 0) observations.push('未发现明显响应式布局问题。');

        return {
          horizontalOverflow,
          maxScrollWidth,
          viewportWidth,
          bodyScrollWidth,
          clippedInteractiveCount,
          smallTapTargetCount,
          fixedElementCount,
          tableOverflowCount,
          observations
        };
      });

      const result: ResponsiveCheckResult = {
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
        checkedAt: new Date().toISOString(),
        ...metrics
      };

      if (this.config.report.screenshot) {
        const screenshotPath = path.join(screenshotDir, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
        result.screenshot = screenshotPath;
      }

      results.push(result);
    }

    await page.setViewportSize(this.config.browser.viewport).catch(() => undefined);
    return results;
  }
}
