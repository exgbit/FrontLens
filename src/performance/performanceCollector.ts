import type { Page } from 'playwright';
import type { PerformanceMetrics } from '../types.js';
import { redactUrl } from '../utils/redact.js';

interface FrontLensPerfWindow {
  __frontlensPerf?: {
    longTasks: number[];
    layoutShiftScore: number;
    layoutShiftCount: number;
    mutationCount: number;
  };
}

export function performanceInitScript(): void {
  const target = window as unknown as FrontLensPerfWindow;
  target.__frontlensPerf = {
    longTasks: [],
    layoutShiftScore: 0,
    layoutShiftCount: 0,
    mutationCount: 0
  };

  try {
    performance.setResourceTimingBufferSize?.(3000);
  } catch {
    // Ignore unsupported buffer resize.
  }

  try {
    const longTaskObserver = new PerformanceObserver((list) => {
      const perf = (window as unknown as FrontLensPerfWindow).__frontlensPerf;
      if (!perf) return;
      for (const entry of list.getEntries()) {
        if (perf.longTasks.length < 1000) {
          perf.longTasks.push(Math.round(entry.duration));
        }
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    // Browser does not support longtask observer.
  }

  try {
    const layoutShiftObserver = new PerformanceObserver((list) => {
      const perf = (window as unknown as FrontLensPerfWindow).__frontlensPerf;
      if (!perf) return;
      for (const entry of list.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
        if (!entry.hadRecentInput) {
          perf.layoutShiftScore += entry.value ?? 0;
          perf.layoutShiftCount += 1;
        }
      }
    });
    layoutShiftObserver.observe({ type: 'layout-shift', buffered: true });
  } catch {
    // Browser does not support layout-shift observer.
  }

  try {
    const mutationObserver = new MutationObserver((mutations) => {
      const perf = (window as unknown as FrontLensPerfWindow).__frontlensPerf;
      if (!perf) return;
      perf.mutationCount += mutations.length;
    });
    window.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      }
    });
  } catch {
    // Ignore mutation observer failures.
  }
}

export class PerformanceCollector {
  async collect(page: Page): Promise<PerformanceMetrics> {
    const metrics = await page.evaluate<PerformanceMetrics>(() => {
      const perfState = (window as unknown as FrontLensPerfWindow).__frontlensPerf;
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paintEntries = performance.getEntriesByType('paint');
      const firstPaint = paintEntries.find((entry) => entry.name === 'first-paint');
      const firstContentfulPaint = paintEntries.find((entry) => entry.name === 'first-contentful-paint');
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const slowest = resources
        .map((resource) => ({
          name: resource.name,
          initiatorType: resource.initiatorType,
          durationMs: Math.round(resource.duration)
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 10);

      const maxDepthOf = (root: Element): number => {
        let maxDepth = 0;
        const stack: Array<{ element: Element; depth: number }> = [{ element: root, depth: 0 }];
        let visited = 0;
        while (stack.length > 0 && visited < 20_000) {
          const current = stack.pop();
          if (!current) break;
          visited += 1;
          maxDepth = Math.max(maxDepth, current.depth);
          for (const child of Array.from(current.element.children)) {
            stack.push({ element: child, depth: current.depth + 1 });
          }
        }
        return maxDepth;
      };

      const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory;
      const longTasks = perfState?.longTasks ?? [];

      return {
        collectedAt: new Date().toISOString(),
        navigation: nav
          ? {
              startTime: Math.round(nav.startTime),
              domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
              loadMs: nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd - nav.startTime) : undefined,
              responseEndMs: Math.round(nav.responseEnd - nav.startTime),
              transferSize: nav.transferSize,
              encodedBodySize: nav.encodedBodySize,
              decodedBodySize: nav.decodedBodySize
            }
          : undefined,
        paint: {
          firstPaintMs: firstPaint ? Math.round(firstPaint.startTime) : undefined,
          firstContentfulPaintMs: firstContentfulPaint ? Math.round(firstContentfulPaint.startTime) : undefined
        },
        longTasks: {
          count: longTasks.length,
          totalDurationMs: longTasks.reduce((sum, item) => sum + item, 0),
          maxDurationMs: longTasks.length ? Math.max(...longTasks) : 0
        },
        layoutShift: {
          score: Number((perfState?.layoutShiftScore ?? 0).toFixed(4)),
          count: perfState?.layoutShiftCount ?? 0
        },
        resources: {
          count: resources.length,
          totalTransferSize: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
          totalEncodedBodySize: resources.reduce((sum, item) => sum + (item.encodedBodySize || 0), 0),
          slowest
        },
        memory,
        dom: {
          nodeCount: document.querySelectorAll('*').length,
          maxDepth: document.body ? maxDepthOf(document.body) : 0
        },
        mutations: {
          count: perfState?.mutationCount ?? 0
        }
      };
    });
    metrics.resources.slowest = metrics.resources.slowest.map((resource) => ({ ...resource, name: redactUrl(resource.name) }));
    return metrics;
  }
}
