import type { BrowserContext, Page } from 'playwright';
import type { ConsoleRecord, ExceptionSimulationKind, ExceptionSimulationResult, FrontLensConfig, NetworkRecord, PageErrorRecord } from '../types.js';
import { compactText } from '../utils/text.js';
import { isActionableConsoleError } from '../utils/console.js';

interface ExceptionTesterOptions {
  config: FrontLensConfig;
  getNetworkRecords: () => NetworkRecord[];
  getConsoleRecords: () => ConsoleRecord[];
  getPageErrors: () => PageErrorRecord[];
}

interface Snapshot {
  networkIds: Set<string>;
  consoleIds: Set<string>;
  pageErrorIds: Set<string>;
}

function newIds<T extends { id: string }>(items: T[], before: Set<string>): string[] {
  return items.filter((item) => !before.has(item.id)).map((item) => item.id);
}

function newConsoleErrorIds(items: ConsoleRecord[], before: Set<string>): string[] {
  return items.filter((item) => isActionableConsoleError(item) && !before.has(item.id)).map((item) => item.id);
}

export function hasErrorFeedback(text: string): boolean {
  return /加载失败|请求失败|获取失败|保存失败|失败[:：]?|错误|出错|重试|无权限|未登录|网络错误|网络异常|网络不可用|超时|断网|离线|接口异常|系统异常|error|failed|retry|timeout|offline|network/i.test(text);
}

function noFeedbackStatus(kind: 'api-500' | 'api-404' | 'api-401' | 'api-403'): ExceptionSimulationResult['status'] {
  return kind === 'api-500' || kind === 'api-401' || kind === 'api-403' ? 'failed' : 'warning';
}

function routePatternForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}**`;
  } catch {
    return url;
  }
}

export class ExceptionTester {
  private counter = 0;

  constructor(private readonly options: ExceptionTesterOptions) {}

  async run(context: BrowserContext, page: Page): Promise<ExceptionSimulationResult[]> {
    if (!this.options.config.exception.enabled) {
      return [];
    }

    const api = this.options
      .getNetworkRecords()
      .find((record) => record.method === 'GET' && ['xhr', 'fetch'].includes(record.resourceType) && record.status !== undefined && record.status < 400);

    const results: ExceptionSimulationResult[] = [];
    results.push(await this.testPageRefresh(page));

    if (!api) {
      results.push(
        this.createResult({
          kind: 'api-500',
          status: 'skipped',
          startedAt: new Date().toISOString(),
          issue: '未找到可用于异常模拟的 GET XHR/Fetch 接口。',
          observations: {}
        })
      );
      return results;
    }

    const routeUrl = (api as NetworkRecord & { rawUrl?: string }).rawUrl ?? api.url;
    const apiPattern = routePatternForUrl(routeUrl);
    results.push(await this.testApiFulfill(context, page, api.url, apiPattern, 'api-500', 500));
    results.push(await this.testApiFulfill(context, page, api.url, apiPattern, 'api-404', 404));
    results.push(await this.testApiFulfill(context, page, api.url, apiPattern, 'api-401', 401));
    results.push(await this.testApiFulfill(context, page, api.url, apiPattern, 'api-403', 403));
    results.push(await this.testApiAbort(context, page, api.url, apiPattern, 'api-timeout'));
    results.push(await this.testOffline(context, page));

    await context.unroute(apiPattern).catch(() => undefined);
    await context.setOffline(false).catch(() => undefined);
    await page.reload({ waitUntil: this.options.config.browser.waitUntil, timeout: this.options.config.browser.timeoutMs }).catch(() => undefined);
    await page.waitForTimeout(500).catch(() => undefined);

    return results;
  }

  private snapshot(): Snapshot {
    return {
      networkIds: new Set(this.options.getNetworkRecords().map((record) => record.id)),
      consoleIds: new Set(this.options.getConsoleRecords().map((record) => record.id)),
      pageErrorIds: new Set(this.options.getPageErrors().map((record) => record.id))
    };
  }

  private createResult(input: {
    kind: ExceptionSimulationKind;
    target?: string;
    status: ExceptionSimulationResult['status'];
    startedAt: string;
    issue?: string;
    suggestion?: ExceptionSimulationResult['suggestion'];
    observations: ExceptionSimulationResult['observations'];
  }): ExceptionSimulationResult {
    const endedAt = new Date().toISOString();
    return {
      id: `EX-${String(++this.counter).padStart(3, '0')}`,
      kind: input.kind,
      target: input.target,
      status: input.status,
      startedAt: input.startedAt,
      endedAt,
      durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(input.startedAt).getTime()),
      observations: input.observations,
      issue: input.issue,
      suggestion: input.suggestion
    };
  }

  private async settle(page: Page): Promise<string> {
    await page.waitForLoadState('domcontentloaded', { timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(this.options.config.exception.delayMs).catch(() => undefined);
    return compactText(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''), 1200);
  }

  private async testPageRefresh(page: Page): Promise<ExceptionSimulationResult> {
    const startedAt = new Date().toISOString();
    const before = this.snapshot();
    try {
      await page.reload({ waitUntil: this.options.config.browser.waitUntil, timeout: this.options.config.browser.timeoutMs });
      const text = await this.settle(page);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      return this.createResult({
        kind: 'page-refresh',
        status: consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : 'passed',
        startedAt,
        issue: consoleIds.length > 0 || pageErrorIds.length > 0 ? '刷新页面后出现新的 Console/Page Error。' : undefined,
        suggestion:
          consoleIds.length > 0 || pageErrorIds.length > 0
            ? {
                frontend: '检查页面刷新后的初始化、路由恢复、缓存读取和空值保护。',
                priority: 'P1'
              }
            : undefined,
        observations: {
          bodyTextSample: text,
          networkRequestIds: newIds(this.options.getNetworkRecords(), before.networkIds),
          consoleIds,
          pageErrorIds
        }
      });
    } catch (error: unknown) {
      return this.createResult({
        kind: 'page-refresh',
        status: 'failed',
        startedAt,
        issue: '页面刷新失败或超时。',
        suggestion: {
          frontend: '检查路由刷新、鉴权跳转和首屏加载状态。',
          backend: '确认 HTML 入口和静态资源在刷新时可直接访问。',
          priority: 'P1'
        },
        observations: {
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async testApiFulfill(context: BrowserContext, page: Page, apiUrl: string, apiPattern: string, kind: 'api-500' | 'api-404' | 'api-401' | 'api-403', status: number): Promise<ExceptionSimulationResult> {
    const startedAt = new Date().toISOString();
    const before = this.snapshot();
    let hitCount = 0;
    await context.unroute(apiPattern).catch(() => undefined);
    await context.route(apiPattern, async (route) => {
      hitCount += 1;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ code: `FRONTLENS_${status}`, message: `FrontLens simulated ${status}` })
      });
    });
    try {
      const reloadError = await page.reload({ waitUntil: this.options.config.browser.waitUntil, timeout: this.options.config.browser.timeoutMs }).then(() => undefined).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      const text = await this.settle(page);
      const feedback = hasErrorFeedback(text);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const networkRequestIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      return this.createResult({
        kind,
        target: apiUrl,
        status: hitCount === 0 ? 'skipped' : reloadError || consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : feedback ? 'passed' : noFeedbackStatus(kind),
        startedAt,
        issue:
          hitCount === 0
            ? `模拟 ${status} 的路由未命中，页面刷新时未重新请求目标接口。`
            : reloadError
              ? `模拟 ${status} 后页面刷新失败：${reloadError}`
              : consoleIds.length > 0 || pageErrorIds.length > 0
            ? `模拟 ${status} 后出现新的 Console/Page Error。`
            : feedback
              ? undefined
              : `模拟接口 ${status} 后页面未发现明显错误反馈。`,
        suggestion: feedback
          ? undefined
          : {
              frontend: '为接口异常增加错误状态、重试入口和用户可理解的提示文案。',
              backend: '返回稳定错误码、requestId 和可展示的错误信息。',
              priority: noFeedbackStatus(kind) === 'failed' ? 'P1' : 'P2'
            },
        observations: {
          bodyHasErrorFeedback: feedback,
          bodyTextSample: text,
          networkRequestIds,
          consoleIds,
          pageErrorIds,
          error: reloadError,
          details: { routeHitCount: hitCount, routePattern: apiPattern }
        }
      });
    } finally {
      await context.unroute(apiPattern).catch(() => undefined);
    }
  }

  private async testApiAbort(context: BrowserContext, page: Page, apiUrl: string, apiPattern: string, kind: 'api-timeout'): Promise<ExceptionSimulationResult> {
    const startedAt = new Date().toISOString();
    const before = this.snapshot();
    let hitCount = 0;
    await context.unroute(apiPattern).catch(() => undefined);
    await context.route(apiPattern, async (route) => {
      hitCount += 1;
      await route.abort('timedout');
    });
    try {
      const reloadError = await page.reload({ waitUntil: this.options.config.browser.waitUntil, timeout: this.options.config.browser.timeoutMs }).then(() => undefined).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      const text = await this.settle(page);
      const feedback = hasErrorFeedback(text);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const networkRequestIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      return this.createResult({
        kind,
        target: apiUrl,
        status: hitCount === 0 ? 'skipped' : reloadError || pageErrorIds.length > 0 ? 'failed' : feedback ? 'passed' : 'warning',
        startedAt,
        issue: hitCount === 0 ? '模拟超时的路由未命中，页面刷新时未重新请求目标接口。' : reloadError ? `模拟接口超时后页面刷新失败：${reloadError}` : pageErrorIds.length > 0 ? '模拟接口超时后出现 Page Error。' : feedback ? undefined : '模拟接口超时后页面未发现明显超时/失败反馈。',
        suggestion: feedback
          ? undefined
          : {
              frontend: '为请求增加超时处理、取消能力、重试入口和 Loading 退出机制。',
              backend: '优化慢接口并提供可观测 requestId，必要时支持异步任务。',
              priority: 'P2'
            },
        observations: {
          bodyHasErrorFeedback: feedback,
          bodyTextSample: text,
          networkRequestIds,
          consoleIds,
          pageErrorIds,
          error: reloadError,
          details: { routeHitCount: hitCount, routePattern: apiPattern }
        }
      });
    } finally {
      await context.unroute(apiPattern).catch(() => undefined);
    }
  }

  private async testOffline(context: BrowserContext, page: Page): Promise<ExceptionSimulationResult> {
    const startedAt = new Date().toISOString();
    const before = this.snapshot();
    try {
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 5_000 }).catch(() => undefined);
      const text = await this.settle(page);
      const feedback = hasErrorFeedback(text);
      const hasBootedPage = text.trim().length > 0;
      await context.setOffline(false);
      return this.createResult({
        kind: 'offline',
        status: !hasBootedPage ? 'skipped' : feedback ? 'passed' : 'warning',
        startedAt,
        issue: !hasBootedPage ? '断网 reload 未能加载 SPA 入口，无法评估应用内离线反馈。' : feedback ? undefined : '模拟断网后页面未发现明显网络错误反馈。',
        suggestion: !hasBootedPage || feedback
          ? undefined
          : {
              frontend: '增加断网/离线状态提示、重试按钮和缓存兜底。',
              priority: 'P3'
            },
        observations: {
          bodyHasErrorFeedback: feedback,
          bodyTextSample: text,
          networkRequestIds: newIds(this.options.getNetworkRecords(), before.networkIds),
          consoleIds: newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds),
          pageErrorIds: newIds(this.options.getPageErrors(), before.pageErrorIds),
          details: !hasBootedPage ? { skippedReason: 'spa-not-booted' } : undefined
        }
      });
    } catch (error: unknown) {
      await context.setOffline(false).catch(() => undefined);
      return this.createResult({
        kind: 'offline',
        status: 'failed',
        startedAt,
        issue: '断网模拟执行失败。',
        suggestion: {
          frontend: '检查离线状态下的错误页和重试逻辑。',
          priority: 'P3'
        },
        observations: {
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }
}
