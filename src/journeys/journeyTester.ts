import path from 'node:path';
import type { BrowserContext, Locator, Page } from 'playwright';
import type { ArtifactIndex, ConsoleRecord, FrontLensConfig, JourneyStepConfig, JourneyStepResult, JourneyTestResult, PageErrorRecord } from '../types.js';
import { createId } from '../utils/id.js';
import { redactText, redactUrl } from '../utils/redact.js';
import { isActionableConsoleError } from '../utils/console.js';
import { saveDownloadArtifact } from '../downloads/downloadArtifact.js';

interface JourneyTesterDeps {
  config: FrontLensConfig;
  artifacts: ArtifactIndex;
  getNetworkRecords: () => Array<{ id: string; startedAt: string }>;
  getConsoleRecords: () => ConsoleRecord[];
  getPageErrors: () => PageErrorRecord[];
}

type PlaywrightRole = Parameters<Page['getByRole']>[0];

function now(): string {
  return new Date().toISOString();
}

function idsAfter<T extends { id: string }>(items: T[], before: Set<string>): string[] {
  return items.map((item) => item.id).filter((id) => !before.has(id));
}

function isUnsafeStep(step: JourneyStepConfig): boolean {
  if (step.allowMutating) return false;
  if (step.action !== 'click' && step.action !== 'press') return false;
  return /(delete|remove|destroy|submit|save|create|update|upload|confirm|删除|移除|提交|保存|新增|创建|上传|确认)/i.test(`${step.target ?? ''} ${step.value ?? ''} ${step.description ?? ''}`);
}

function isDownloadStep(step: JourneyStepConfig): boolean {
  if (step.action !== 'click' && step.action !== 'press') return false;
  return /导出|下载|download|export/i.test(`${step.target ?? ''} ${step.value ?? ''} ${step.description ?? ''}`);
}

async function targetLocator(page: Page, target?: string): Promise<Locator> {
  if (!target) throw new Error('step.target is required.');
  if (/^(text=|role=|css=|xpath=)/.test(target)) {
    if (target.startsWith('css=')) return page.locator(target.slice(4)).first();
    if (target.startsWith('xpath=')) return page.locator(`xpath=${target.slice(6)}`).first();
    if (target.startsWith('text=')) return page.getByText(target.slice(5), { exact: false }).first();
    if (target.startsWith('role=')) {
      const raw = target.slice(5).trim();
      const match = /^([a-zA-Z][\w-]*)(?:\s*\[\s*name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]+))\s*\])?$/.exec(raw);
      if (!match) throw new Error(`Invalid role target: ${target}. Expected role=button or role=button[name="Save"].`);
      const [, role, doubleQuotedName, singleQuotedName, bareName] = match;
      const name = doubleQuotedName ?? singleQuotedName ?? bareName?.trim();
      return page.getByRole(role as PlaywrightRole, name ? { name, exact: false } : {}).first();
    }
  }
  if (/^[.#\[]|^[a-z][\w-]*(?:[.#\[:\s>]|$)/i.test(target)) {
    return page.locator(target).first();
  }
  return page.getByText(target, { exact: false }).first();
}

async function runStep(page: Page, step: JourneyStepConfig, config: FrontLensConfig): Promise<void> {
  const timeout = step.timeoutMs ?? Math.min(config.browser.timeoutMs, 10_000);
  if (isUnsafeStep(step) && config.safety.blockMutatingRequests) {
    throw new Error(`Unsafe journey step skipped by default safety policy: ${step.action} ${step.target ?? ''}`);
  }
  if (isDownloadStep(step) && !config.safety.allowDownload) {
    throw new Error(`Download journey step skipped by default safety policy: ${step.action} ${step.target ?? ''}`);
  }
  switch (step.action) {
    case 'goto': {
      const url = step.target ?? step.value ?? config.target.url;
      await page.goto(url, { waitUntil: config.browser.waitUntil, timeout });
      return;
    }
    case 'click':
      await (await targetLocator(page, step.target)).click({ timeout });
      return;
    case 'fill':
      await (await targetLocator(page, step.target)).fill(step.value ?? '', { timeout });
      return;
    case 'press':
      await (await targetLocator(page, step.target)).press(step.value ?? 'Enter', { timeout });
      return;
    case 'select':
      await (await targetLocator(page, step.target)).selectOption(step.value ?? '', { timeout });
      return;
    case 'check':
      await (await targetLocator(page, step.target)).check({ timeout });
      return;
    case 'uncheck':
      await (await targetLocator(page, step.target)).uncheck({ timeout });
      return;
    case 'expectVisible':
      await (await targetLocator(page, step.target)).waitFor({ state: 'visible', timeout });
      return;
    case 'expectText': {
      const expected = step.value ?? step.target ?? '';
      await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible', timeout });
      return;
    }
    case 'expectUrl': {
      const pattern = step.value ?? step.target ?? '';
      if (pattern && !new RegExp(pattern).test(page.url())) throw new Error(`URL ${page.url()} does not match ${pattern}`);
      return;
    }
    case 'waitForLoad':
      await page.waitForLoadState('networkidle', { timeout }).catch(() => page.waitForLoadState('domcontentloaded', { timeout }));
      return;
    case 'waitMs':
      await page.waitForTimeout(Number(step.value ?? step.timeoutMs ?? 500));
      return;
  }
}

export class JourneyTester {
  constructor(private readonly deps: JourneyTesterDeps) {}

  async run(context: BrowserContext): Promise<JourneyTestResult[]> {
    const { config } = this.deps;
    if (!config.journeys.enabled || config.journeys.journeys.length === 0) return [];
    const journeys = config.journeys.journeys.filter((journey) => journey.enabled !== false).slice(0, config.journeys.maxJourneys);
    const results: JourneyTestResult[] = [];
    for (let index = 0; index < journeys.length; index += 1) {
      const journey = journeys[index];
      const startedAt = now();
      const page = await context.newPage();
      const stepResults: JourneyStepResult[] = [];
      let status: JourneyTestResult['status'] = 'passed';
      let issue: string | undefined;
      try {
        await page.goto(journey.startUrl ?? config.target.url, { waitUntil: config.browser.waitUntil, timeout: config.browser.timeoutMs }).catch(() => undefined);
        const steps = journey.steps.slice(0, config.journeys.maxStepsPerJourney);
        for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
          const step = steps[stepIndex];
          const beforeNetwork = new Set(this.deps.getNetworkRecords().map((record) => record.id));
          const beforeConsole = new Set(this.deps.getConsoleRecords().map((record) => record.id));
          const beforeErrors = new Set(this.deps.getPageErrors().map((record) => record.id));
          const stepStartedAt = now();
          try {
            const expectDownload = isDownloadStep(step) && config.safety.allowDownload;
            const downloadPromise = expectDownload ? page.waitForEvent('download', { timeout: 4_000 }).catch(() => null) : undefined;
            await runStep(page, step, config);
            const download = downloadPromise ? await downloadPromise : null;
            const networkRequestIds = idsAfter(this.deps.getNetworkRecords(), beforeNetwork);
            const consoleIds = this.deps.getConsoleRecords().filter((record) => !beforeConsole.has(record.id) && isActionableConsoleError(record)).map((record) => record.id);
            const pageErrorIds = idsAfter(this.deps.getPageErrors(), beforeErrors);
            const downloadFailure = download ? await download.failure().catch(() => null) : null;
            const savedDownload = download && !downloadFailure
              ? await saveDownloadArtifact(download, this.deps.artifacts.outputDir, `JOURNEY-${index + 1}-STEP-${stepIndex + 1}`).catch((error: unknown) => ({
                  failure: error instanceof Error ? error.message : String(error)
                }))
              : undefined;
            if (savedDownload && 'path' in savedDownload) {
              this.deps.artifacts.downloadDir = path.dirname(savedDownload.path);
              this.deps.artifacts.downloadedFiles = [...(this.deps.artifacts.downloadedFiles ?? []), savedDownload.path];
            }
            const downloadSaveFailure = savedDownload && 'failure' in savedDownload ? savedDownload.failure : undefined;
            const emptyDownload = Boolean(savedDownload && 'path' in savedDownload && savedDownload.sizeBytes === 0);
            const downloadMissing = expectDownload && !savedDownload;
            const stepStatus: JourneyStepResult['status'] = pageErrorIds.length > 0 || downloadFailure || downloadSaveFailure || emptyDownload ? 'failed' : consoleIds.length > 0 || downloadMissing ? 'warning' : 'passed';
            if (stepStatus === 'failed') {
              status = 'failed';
              issue = downloadFailure ? `用户旅程下载失败：${downloadFailure}` : downloadSaveFailure ? `用户旅程下载文件保存失败：${downloadSaveFailure}` : emptyDownload ? '用户旅程下载文件为空。' : '用户旅程步骤触发页面运行时错误。';
            } else if (stepStatus === 'warning' && status === 'passed') {
              status = 'warning';
              issue = downloadMissing ? '用户旅程预期下载/导出，但未保存到可校验的下载文件。' : '用户旅程步骤触发可处理的 Console Error。';
            }
            stepResults.push({
              index: stepIndex,
              action: step.action,
              target: step.target,
              value: step.value ? redactText(step.value) : undefined,
              status: stepStatus,
              startedAt: stepStartedAt,
              endedAt: now(),
              durationMs: Date.now() - new Date(stepStartedAt).getTime(),
              networkRequestIds,
              consoleIds,
              pageErrorIds,
              downloadSuggestedFilename: download?.suggestedFilename(),
              downloadPath: savedDownload && 'path' in savedDownload ? savedDownload.path : undefined,
              downloadSizeBytes: savedDownload && 'path' in savedDownload ? savedDownload.sizeBytes : undefined,
              downloadSha256: savedDownload && 'path' in savedDownload ? savedDownload.sha256 : undefined,
              downloadFailure
            });
          } catch (error) {
            const message = redactText(error instanceof Error ? error.message : String(error));
            const skippedBySafety = /^(Unsafe|Download) journey step skipped by default safety policy/i.test(message);
            if (skippedBySafety && status === 'passed') {
              status = 'skipped';
            } else if (!skippedBySafety) {
              status = 'failed';
              issue = message;
            }
            stepResults.push({
              index: stepIndex,
              action: step.action,
              target: step.target,
              value: step.value ? redactText(step.value) : undefined,
              status: skippedBySafety ? 'skipped' : 'failed',
              startedAt: stepStartedAt,
              endedAt: now(),
              durationMs: Date.now() - new Date(stepStartedAt).getTime(),
              error: message,
              networkRequestIds: idsAfter(this.deps.getNetworkRecords(), beforeNetwork),
              consoleIds: idsAfter(this.deps.getConsoleRecords(), beforeConsole),
              pageErrorIds: idsAfter(this.deps.getPageErrors(), beforeErrors)
            });
            if (skippedBySafety || !config.journeys.continueOnFailure) break;
          }
        }
      } finally {
        results.push({
          id: createId('JOURNEY', index + 1),
          name: journey.name,
          source: journey.source ?? 'configured',
          requirementIds: journey.requirementIds,
          status,
          startedAt,
          endedAt: now(),
          durationMs: Date.now() - new Date(startedAt).getTime(),
          startUrl: redactUrl(journey.startUrl ?? config.target.url),
          finalUrl: redactUrl(page.url()),
          steps: stepResults,
          issue,
          suggestion: issue
            ? { test: '将该用户旅程固化为 E2E 回归用例，并按失败步骤定位页面/接口问题。', priority: 'P1' }
            : { test: '保持用户旅程作为关键路径回归。', priority: 'P3' }
        });
        await page.close().catch(() => undefined);
      }
    }
    return results;
  }
}
