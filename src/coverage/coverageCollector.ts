import type { CDPSession, Page } from 'playwright';
import type { CoverageEntry, CoverageResult, FrontLensConfig } from '../types.js';
import { redactUrl } from '../utils/redact.js';

interface CoverageRange {
  startOffset: number;
  endOffset: number;
  count?: number;
}

interface StyleSheetHeader {
  styleSheetId: string;
  sourceURL?: string;
  frameURL?: string;
  origin?: string;
  length?: number;
  isInline?: boolean;
}

function emptyTotals(): CoverageResult['totals'] {
  return {
    js: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 },
    css: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 },
    all: { totalBytes: 0, usedBytes: 0, unusedBytes: 0, unusedPercent: 0 }
  };
}

export function createEmptyCoverageResult(config: FrontLensConfig, status: CoverageResult['status'], message?: string): CoverageResult {
  return {
    enabled: config.analysis.coverage,
    status,
    browser: config.browser.name,
    collectedAt: new Date().toISOString(),
    message,
    totals: emptyTotals(),
    entries: [],
    topUnused: []
  };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function mergeRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }
  return merged;
}

function coveredBytes(ranges: Array<{ start: number; end: number }>): number {
  return mergeRanges(ranges).reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
}

function percent(unusedBytes: number, totalBytes: number): number {
  return totalBytes > 0 ? Math.round((unusedBytes / totalBytes) * 1000) / 10 : 0;
}

function sourceForUrl(url: string, fallback: 'inline' | 'eval' | 'unknown' = 'unknown'): CoverageEntry['source'] {
  if (!url) return fallback;
  if (url.startsWith('eval://') || url.startsWith('debugger://')) return 'eval';
  if (url.startsWith('inline://')) return 'inline';
  return 'network';
}

function safeUrl(url: string | undefined, fallback: string): string {
  const trimmed = (url ?? '').trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function buildTotals(entries: CoverageEntry[]): CoverageResult['totals'] {
  const sum = (type?: CoverageEntry['type']) => {
    const filtered = type ? entries.filter((entry) => entry.type === type) : entries;
    const totalBytes = filtered.reduce((acc, entry) => acc + entry.totalBytes, 0);
    const usedBytes = filtered.reduce((acc, entry) => acc + entry.usedBytes, 0);
    const unusedBytes = Math.max(0, totalBytes - usedBytes);
    return {
      totalBytes,
      usedBytes,
      unusedBytes,
      unusedPercent: percent(unusedBytes, totalBytes)
    };
  };

  return {
    js: sum('js'),
    css: sum('css'),
    all: sum()
  };
}

export class CoverageCollector {
  private session?: CDPSession;
  private started = false;
  private stopped = false;
  private readonly styleSheets = new Map<string, StyleSheetHeader>();

  constructor(private readonly config: FrontLensConfig) {}

  async start(page: Page): Promise<CoverageResult | undefined> {
    if (!this.config.analysis.coverage) {
      return createEmptyCoverageResult(this.config, 'skipped', 'Coverage analysis disabled.');
    }

    if (this.config.browser.name !== 'chromium') {
      return createEmptyCoverageResult(this.config, 'skipped', 'Chromium CDP is required for JS/CSS coverage.');
    }

    this.session = await page.context().newCDPSession(page);
    this.session.on('CSS.styleSheetAdded', (event: unknown) => {
      const header = (event as { header?: StyleSheetHeader }).header;
      if (header?.styleSheetId) {
        this.styleSheets.set(header.styleSheetId, header);
      }
    });

    await this.session.send('Profiler.enable');
    await this.session.send('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true
    });
    await this.session.send('DOM.enable');
    await this.session.send('CSS.enable');
    await this.session.send('CSS.startRuleUsageTracking');
    this.started = true;
    return undefined;
  }

  async stop(): Promise<CoverageResult> {
    if (!this.config.analysis.coverage) {
      return createEmptyCoverageResult(this.config, 'skipped', 'Coverage analysis disabled.');
    }
    if (this.config.browser.name !== 'chromium') {
      return createEmptyCoverageResult(this.config, 'skipped', 'Chromium CDP is required for JS/CSS coverage.');
    }
    if (!this.session || !this.started) {
      return createEmptyCoverageResult(this.config, 'skipped', 'Coverage collector was not started.');
    }
    if (this.stopped) {
      return createEmptyCoverageResult(this.config, 'skipped', 'Coverage collector already stopped.');
    }

    this.stopped = true;

    try {
      const [jsCoverage, cssCoverage] = await Promise.all([
        this.session.send('Profiler.takePreciseCoverage') as Promise<{
          result?: Array<{
            scriptId: string;
            url?: string;
            functions?: Array<{
              functionName?: string;
              ranges?: CoverageRange[];
              isBlockCoverage?: boolean;
            }>;
          }>;
        }>,
        this.session.send('CSS.stopRuleUsageTracking') as Promise<{
          ruleUsage?: Array<{
            styleSheetId: string;
            startOffset: number;
            endOffset: number;
            used: boolean;
          }>;
        }>
      ]);

      const entries = [
        ...this.createJsEntries(jsCoverage.result ?? []),
        ...(await this.createCssEntries(cssCoverage.ruleUsage ?? []))
      ].filter((entry) => entry.totalBytes > 0);
      const totals = buildTotals(entries);
      const topUnused = entries
        .filter((entry) => entry.unusedBytes > 0)
        .sort((a, b) => b.unusedBytes - a.unusedBytes)
        .slice(0, 25);

      return {
        enabled: true,
        status: 'passed',
        browser: this.config.browser.name,
        collectedAt: new Date().toISOString(),
        totals,
        entries,
        topUnused
      };
    } catch (error) {
      return createEmptyCoverageResult(this.config, 'failed', error instanceof Error ? error.message : String(error));
    } finally {
      await this.disableCollectors();
    }
  }

  async dispose(): Promise<void> {
    if (!this.session || !this.started) {
      return;
    }
    this.stopped = true;
    await this.disableCollectors();
  }

  private async disableCollectors(): Promise<void> {
    if (!this.session) {
      return;
    }
    await this.session.send('Profiler.stopPreciseCoverage').catch(() => undefined);
    await this.session.send('Profiler.disable').catch(() => undefined);
    await this.session.send('CSS.stopRuleUsageTracking').catch(() => undefined);
    await this.session.send('CSS.disable').catch(() => undefined);
    await this.session.send('DOM.disable').catch(() => undefined);
    await this.session.detach().catch(() => undefined);
  }

  private createJsEntries(scripts: Array<{ scriptId: string; url?: string; functions?: Array<{ ranges?: CoverageRange[] }> }>): CoverageEntry[] {
    return scripts.filter((script) => (script.url ?? '').trim().length > 0).map((script, index) => {
      const ranges = (script.functions ?? []).flatMap((fn) => fn.ranges ?? []);
      const totalBytes = ranges.reduce((max, range) => Math.max(max, range.endOffset), 0);
      const usedRanges = ranges.filter((range) => (range.count ?? 0) > 0).map((range) => ({ start: range.startOffset, end: range.endOffset }));
      const usedBytes = Math.min(totalBytes, coveredBytes(usedRanges));
      const unusedBytes = Math.max(0, totalBytes - usedBytes);
      const url = redactUrl(safeUrl(script.url, `inline://script/${script.scriptId || index}`));
      return {
        id: `coverage-js-${script.scriptId || index}`,
        type: 'js' as const,
        url,
        source: sourceForUrl(url, 'inline'),
        totalBytes,
        usedBytes,
        unusedBytes,
        unusedPercent: percent(unusedBytes, totalBytes),
        rangesUsed: mergeRanges(usedRanges).length,
        details: {
          scriptId: script.scriptId,
          functionCount: script.functions?.length ?? 0
        }
      };
    });
  }

  private async createCssEntries(ruleUsage: Array<{ styleSheetId: string; startOffset: number; endOffset: number; used: boolean }>): Promise<CoverageEntry[]> {
    const bySheet = new Map<string, Array<{ startOffset: number; endOffset: number; used: boolean }>>();
    for (const rule of ruleUsage) {
      const list = bySheet.get(rule.styleSheetId) ?? [];
      list.push(rule);
      bySheet.set(rule.styleSheetId, list);
    }

    const entries: CoverageEntry[] = [];
    for (const [styleSheetId, rules] of bySheet.entries()) {
      const header = this.styleSheets.get(styleSheetId);
      let totalBytes = Math.max(header?.length ?? 0, ...rules.map((rule) => rule.endOffset), 0);
      let textBytes: number | undefined;
      try {
        const response = (await this.session?.send('CSS.getStyleSheetText', { styleSheetId })) as { text?: string } | undefined;
        if (response?.text !== undefined) {
          textBytes = byteLength(response.text);
          totalBytes = Math.max(totalBytes, textBytes);
        }
      } catch {
        // Some cross-origin/constructed stylesheets may not expose text; offsets still provide a useful estimate.
      }

      const usedRanges = rules.filter((rule) => rule.used).map((rule) => ({ start: rule.startOffset, end: rule.endOffset }));
      const usedBytes = Math.min(totalBytes, coveredBytes(usedRanges));
      const unusedBytes = Math.max(0, totalBytes - usedBytes);
      const url = redactUrl(safeUrl(header?.sourceURL, header?.isInline ? `inline://style/${styleSheetId}` : header?.frameURL ? `inline://style/${styleSheetId}@${header.frameURL}` : `inline://style/${styleSheetId}`));
      entries.push({
        id: `coverage-css-${styleSheetId}`,
        type: 'css',
        url,
        source: sourceForUrl(url, header?.isInline ? 'inline' : 'unknown'),
        totalBytes,
        usedBytes,
        unusedBytes,
        unusedPercent: percent(unusedBytes, totalBytes),
        rangesUsed: mergeRanges(usedRanges).length,
        details: {
          styleSheetId,
          ruleCount: rules.length,
          textBytes,
          origin: header?.origin,
          frameURL: header?.frameURL
        }
      });
    }

    return entries;
  }
}
