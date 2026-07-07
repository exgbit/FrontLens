import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import type { BrowserContext, CDPSession, Page } from 'playwright';
import type { ArtifactIndex, FrontLensConfig, Issue, NetworkRecord, P2TestResult, PerformanceMetrics } from '../types.js';
import { IssueFactory } from '../analyzers/issueFactory.js';
import { ensureDir } from '../utils/fs.js';
import { redactText } from '../utils/redact.js';
import { isViteDevServerRun } from '../utils/devServer.js';

export function createEmptyP2Result(config: FrontLensConfig): P2TestResult {
  const visualEnabled = config.p2.enabled && config.p2.visual.enabled;
  return {
    enabled: config.p2.enabled,
    checkedAt: new Date().toISOString(),
    visual: { enabled: visualEnabled, status: 'skipped', message: visualEnabled ? 'Visual check not collected.' : 'Visual check disabled.' },
    budgets: [],
    networkProfiles: []
  };
}

async function byteDiffRatio(aPath: string, bPath: string): Promise<number> {
  const [a, b] = await Promise.all([readFile(aPath), readFile(bPath)]);
  const max = Math.max(a.length, b.length);
  if (max === 0) return 0;
  let diff = Math.abs(a.length - b.length);
  const len = Math.min(a.length, b.length);
  for (let index = 0; index < len; index += 1) {
    if (a[index] !== b[index]) diff += 1;
  }
  return diff / max;
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

function budget(metric: string, actual: number | undefined, budgetValue: number | undefined, unit: string): P2TestResult['budgets'][number] | undefined {
  if (actual === undefined || budgetValue === undefined) return undefined;
  return { metric, actual, budget: budgetValue, status: actual <= budgetValue ? 'passed' : 'failed', unit };
}

async function enableSlow3g(context: BrowserContext, page: Page): Promise<CDPSession> {
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 50 * 1024
  });
  return session;
}

async function disableNetworkEmulation(session: CDPSession | undefined): Promise<void> {
  if (!session) return;
  await session
    .send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    })
    .catch(() => undefined);
  await session.detach().catch(() => undefined);
}

export class P2Tester {
  constructor(
    private readonly config: FrontLensConfig,
    private readonly artifacts: ArtifactIndex,
    private readonly performance: PerformanceMetrics,
    private readonly networkRecords: NetworkRecord[] = []
  ) {}

  async run(context: BrowserContext, page: Page): Promise<{ result: P2TestResult; issues: Issue[] }> {
    const result = createEmptyP2Result(this.config);
    if (!this.config.p2.enabled) return { result, issues: [] };

    if (this.config.p2.visual.enabled) {
      const visualDir = path.join(this.artifacts.outputDir, 'visual');
      await ensureDir(visualDir);
      const current = path.join(visualDir, 'current.png');
      await page.screenshot({ path: current, fullPage: true }).catch(() => undefined);
      const baseline = this.config.p2.visual.baselineDir ? path.join(this.config.p2.visual.baselineDir, 'baseline.png') : undefined;
      result.visual.currentScreenshot = current;
      result.visual.baselinePath = baseline;
      if (!baseline) {
        result.visual.status = 'skipped';
        result.visual.message = 'No visual.baselineDir configured; current screenshot captured as evidence.';
      } else {
        const ratio = await byteDiffRatio(current, baseline).catch(() => undefined);
        result.visual.diffRatio = ratio;
        if (ratio === undefined) {
          result.visual.status = 'skipped';
          result.visual.message = 'Baseline screenshot not found or unreadable.';
        } else if (ratio > this.config.p2.visual.diffThresholdRatio) {
          result.visual.status = 'failed';
          result.visual.message = `Visual byte diff ratio ${ratio.toFixed(4)} exceeds threshold ${this.config.p2.visual.diffThresholdRatio}.`;
        } else {
          result.visual.status = 'passed';
          result.visual.message = `Visual byte diff ratio ${ratio.toFixed(4)} within threshold.`;
        }
      }
    }

    if (this.config.p2.budgets.enabled) {
      const viteDevServerRun = isViteDevServerRun(this.networkRecords, this.config.target.url);
      result.budgets = [
        budget('firstContentfulPaint', this.performance.paint.firstContentfulPaintMs, this.config.p2.budgets.fcpMs, 'ms'),
        budget('load', this.performance.navigation?.loadMs, this.config.p2.budgets.loadMs, 'ms'),
        viteDevServerRun ? undefined : budget('totalTransfer', Math.round(this.performance.resources.totalTransferSize / 1024), this.config.p2.budgets.totalTransferKb, 'KB'),
        budget('domNodes', this.performance.dom.nodeCount, this.config.p2.budgets.domNodes, 'nodes'),
        budget('longTaskCount', this.performance.longTasks.count, this.config.p2.budgets.longTaskCount, 'count'),
        budget('cls', this.performance.layoutShift.score, this.config.p2.budgets.cls, 'score')
      ].filter((item): item is P2TestResult['budgets'][number] => Boolean(item));
    }

    if (this.config.p2.networkProfiles.enabled) {
      for (const profile of this.config.p2.networkProfiles.profiles) {
        const observations: string[] = [];
        let probe: Page | undefined;
        let cdpSession: CDPSession | undefined;
        try {
          if (profile === 'offline') {
            await context.setOffline(true);
          }
          probe = await context.newPage();
          if (profile === 'slow-3g') {
            if (this.config.browser.name !== 'chromium') {
              result.networkProfiles.push({
                profile,
                status: 'skipped',
                observations: ['slow-3g emulation is currently supported only for Chromium via CDP.']
              });
              continue;
            }
            cdpSession = await enableSlow3g(context, probe);
            observations.push('Applied Chromium CDP slow-3g network emulation.');
          }
          let navigationError: string | undefined;
          await probe.goto(this.config.target.url, { waitUntil: 'domcontentloaded', timeout: Math.min(this.config.browser.timeoutMs, 8000) }).catch((error: unknown) => {
            navigationError = redactText(error instanceof Error ? error.message : String(error));
            observations.push(navigationError);
          });
          const text = await probe.locator('body').innerText({ timeout: 1000 }).catch(() => '');
          const hasBootedPage = text.trim().length > 0;
          const hasUserVisibleNetworkFeedback = /offline|network|retry|error|失败|断网|重试/i.test(text);
          if (hasUserVisibleNetworkFeedback) observations.push('Page shows network/offline feedback.');
          if (navigationError && !hasBootedPage) observations.push('Page did not boot under this network profile; feedback assessment skipped.');
          const screenshotPath = path.join(this.artifacts.outputDir, 'screenshots', `network-${profile}.png`);
          await ensureDir(path.dirname(screenshotPath));
          await probe.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
          const screenshot = (await fileExists(screenshotPath)) ? screenshotPath : undefined;
          result.networkProfiles.push({
            profile,
            status: navigationError && !hasBootedPage ? 'skipped' : profile === 'offline' ? (hasUserVisibleNetworkFeedback ? 'passed' : 'warning') : navigationError ? 'warning' : 'passed',
            observations,
            screenshot
          });
        } catch (error) {
          result.networkProfiles.push({ profile, status: 'failed', observations, error: redactText(error instanceof Error ? error.message : String(error)) });
        } finally {
          await disableNetworkEmulation(cdpSession);
          await probe?.close().catch(() => undefined);
          if (profile === 'offline') await context.setOffline(false).catch(() => undefined);
        }
      }
    }

    const factory = new IssueFactory();
    const issues: Issue[] = [];
    if (result.visual.status === 'failed') {
      issues.push(factory.create({
        title: '视觉回归差异超过阈值',
        category: 'frontend-visual',
        severity: 'medium',
        confidence: 0.72,
        description: result.visual.message ?? '当前截图与基线存在差异。',
        evidence: { screenshot: result.visual.currentScreenshot, details: result.visual },
        reproduceSteps: ['运行 FrontLens P2 visual check', '对比 visual.current.png 与 baseline.png'],
        reason: '视觉差异可能意味着布局错乱、样式回归或组件遮挡。',
        suggestion: { frontend: '确认截图差异是否符合预期；非预期时修复样式/布局并更新回归基线。', test: '将视觉基线纳入 CI。', priority: 'P2' }
      }));
    }
    for (const item of result.budgets.filter((entry) => entry.status === 'failed')) {
      issues.push(factory.create({
        title: `性能预算超标：${item.metric}`,
        category: 'frontend-performance',
        severity: item.metric === 'load' || item.metric === 'firstContentfulPaint' ? 'medium' : 'low',
        confidence: 0.86,
        description: `${item.metric} 实际值 ${item.actual}${item.unit}，预算 ${item.budget}${item.unit}。`,
        evidence: { details: item },
        reproduceSteps: ['运行 FrontLens QA', '查看 p2.budgets 与 performance 指标'],
        reason: '性能预算超标会影响首屏体验和交互稳定性。',
        suggestion: { frontend: '减少首屏 JS/CSS/图片体积，延迟非关键资源，优化渲染路径。', test: '在 CI 中启用性能预算门禁。', priority: 'P2' }
      }));
    }
    for (const item of result.networkProfiles.filter((entry) => entry.status === 'warning' || entry.status === 'failed')) {
      issues.push(factory.create({
        title: `弱网/断网场景缺少明确反馈：${item.profile}`,
        category: 'frontend-interaction',
        severity: 'medium',
        confidence: 0.7,
        description: `${item.profile} 场景未观察到明确的错误、重试或离线提示。`,
        evidence: { screenshot: item.screenshot, details: item },
        reproduceSteps: ['启用 p2.networkProfiles', `模拟 ${item.profile}`, '观察页面是否有错误反馈和恢复入口'],
        reason: '弱网/断网没有反馈会让用户误以为页面卡死。',
        suggestion: { frontend: '为接口失败、断网和超时提供错误提示、重试按钮和加载状态恢复。', test: '增加离线/慢网自动化回归。', priority: 'P2' }
      }));
    }
    return { result, issues };
  }
}
