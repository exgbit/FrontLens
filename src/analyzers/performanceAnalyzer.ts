import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { isViteDevServerRun } from '../utils/devServer.js';

export function analyzePerformance(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  if (!context.config.analysis.performance) {
    return [];
  }

  const issues: Issue[] = [];
  const metrics = context.performanceMetrics;
  const fcp = metrics.paint.firstContentfulPaintMs;
  const load = metrics.navigation?.loadMs;
  const totalTransfer = metrics.resources.totalTransferSize;
  const heap = metrics.memory?.usedJSHeapSize;
  const viteDevServerRun = isViteDevServerRun(context.networkRecords, context.config.target.url);

  if (fcp !== undefined && fcp > 2500) {
    issues.push(
      factory.create({
        title: `首屏内容绘制偏慢：FCP ${fcp}ms`,
        category: 'frontend-performance',
        severity: fcp > 4000 ? 'high' : 'medium',
        confidence: 0.86,
        description: `first-contentful-paint 为 ${fcp}ms。`,
        evidence: { details: metrics.paint },
        reproduceSteps: ['打开目标页面', '读取 Performance paint entries', '查看 first-contentful-paint'],
        reason: 'FCP 偏慢会让用户更晚看到可用内容，通常与阻塞资源、慢接口、过大 JS/CSS 或首屏渲染逻辑有关。',
        suggestion: {
          frontend: '减少首屏阻塞 JS/CSS，拆分非关键代码，预加载关键资源，首屏骨架和懒加载非首屏模块。',
          backend: '优化 HTML/API 首包和 CDN 缓存。',
          priority: fcp > 4000 ? 'P1' : 'P2'
        }
      })
    );
  }

  if (load !== undefined && load > 8000) {
    issues.push(
      factory.create({
        title: `页面 Load 耗时过长：${load}ms`,
        category: 'frontend-performance',
        severity: load > 15000 ? 'high' : 'medium',
        confidence: 0.82,
        description: `Navigation loadEventEnd 为 ${load}ms。`,
        evidence: { details: metrics.navigation },
        reproduceSteps: ['打开目标页面', '读取 Performance navigation timing'],
        reason: 'Load 过慢通常说明资源过多、资源过大、网络慢或同步初始化过重。',
        suggestion: {
          frontend: '减少首屏资源数量，合并/延迟非关键请求，启用缓存和压缩。',
          backend: '检查静态资源服务、CDN 和首屏接口性能。',
          priority: 'P2'
        }
      })
    );
  }

  if (metrics.longTasks.count > 0 && metrics.longTasks.totalDurationMs > 300) {
    issues.push(
      factory.create({
        title: `存在长任务：${metrics.longTasks.count} 个，总耗时 ${metrics.longTasks.totalDurationMs}ms`,
        category: 'frontend-performance',
        severity: metrics.longTasks.totalDurationMs > 1000 ? 'high' : 'medium',
        confidence: 0.82,
        description: `最长长任务 ${metrics.longTasks.maxDurationMs}ms。`,
        evidence: { details: metrics.longTasks },
        reproduceSteps: ['打开目标页面', '观察 PerformanceObserver longtask 数据'],
        reason: '长任务会阻塞主线程，造成点击、输入、滚动卡顿。',
        suggestion: {
          frontend: '拆分长同步任务，使用 requestIdleCallback/Web Worker，减少大列表同步渲染和复杂计算。',
          priority: metrics.longTasks.totalDurationMs > 1000 ? 'P1' : 'P2'
        }
      })
    );
  }

  if (metrics.layoutShift.score > 0.1) {
    issues.push(
      factory.create({
        title: `布局偏移偏高：CLS ${metrics.layoutShift.score}`,
        category: 'frontend-performance',
        severity: metrics.layoutShift.score > 0.25 ? 'high' : 'medium',
        confidence: 0.8,
        description: `累计布局偏移 ${metrics.layoutShift.score}，次数 ${metrics.layoutShift.count}。`,
        evidence: { details: metrics.layoutShift },
        reproduceSteps: ['打开目标页面', '观察 layout-shift PerformanceObserver 数据'],
        reason: '布局偏移会导致误点和阅读体验下降。',
        suggestion: {
          frontend: '为图片/广告/异步内容预留尺寸，避免加载后插入首屏上方内容。',
          priority: metrics.layoutShift.score > 0.25 ? 'P1' : 'P2'
        }
      })
    );
  }

  if (totalTransfer > 5_000_000 && !viteDevServerRun) {
    issues.push(
      factory.create({
        title: `页面资源传输体积过大：${Math.round(totalTransfer / 1024)}KB`,
        category: 'frontend-performance',
        severity: totalTransfer > 15_000_000 ? 'high' : 'medium',
        confidence: 0.84,
        description: `PerformanceResourceTiming transferSize 总计约 ${Math.round(totalTransfer / 1024)}KB。`,
        evidence: { details: metrics.resources },
        reproduceSteps: ['打开目标页面', '统计 resource timing transferSize'],
        reason: '传输体积过大会显著影响弱网、移动端和首次访问体验。',
        suggestion: {
          frontend: '压缩图片、拆包、移除未使用依赖、启用懒加载。',
          backend: '启用 gzip/br、CDN 和长期缓存。',
          priority: 'P2'
        }
      })
    );
  }

  if (heap !== undefined && heap > 80_000_000) {
    issues.push(
      factory.create({
        title: `JS Heap 使用偏高：${Math.round(heap / 1024 / 1024)}MB`,
        category: 'frontend-performance',
        severity: heap > 180_000_000 ? 'high' : 'medium',
        confidence: 0.7,
        description: `usedJSHeapSize 约 ${Math.round(heap / 1024 / 1024)}MB。`,
        evidence: { details: metrics.memory },
        reproduceSteps: ['打开目标页面', '读取 performance.memory.usedJSHeapSize'],
        reason: '较高内存可能来自大数据列表、缓存泄漏、未卸载组件或大对象常驻。',
        suggestion: {
          frontend: '检查大数组缓存、虚拟列表、组件卸载清理和图片/文件对象释放。',
          priority: 'P2'
        }
      })
    );
  }

  if ((metrics.mutations?.count ?? 0) > 2500) {
    issues.push(
      factory.create({
        title: `DOM Mutation 次数偏高：${metrics.mutations?.count}`,
        category: 'frontend-performance',
        severity: (metrics.mutations?.count ?? 0) > 8000 ? 'high' : 'medium',
        confidence: 0.7,
        description: `页面访问和交互期间记录到 ${metrics.mutations?.count} 次 DOM mutation。`,
        evidence: { details: metrics.mutations },
        reproduceSteps: ['打开目标页面', '观察 MutationObserver 计数'],
        reason: '大量 DOM mutation 可能表示重复渲染、列表渲染过重或状态频繁更新。',
        suggestion: {
          frontend: '减少不必要状态更新，使用 memo/虚拟列表，拆分高频变更区域。',
          priority: 'P2'
        }
      })
    );
  }

  return issues;
}
