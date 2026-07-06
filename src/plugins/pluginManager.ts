import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stat } from 'node:fs/promises';
import type { AnalyzerContext, Issue, QaResult } from '../types.js';
import { normalizeIssueLike } from '../resultNormalizer.js';

type AnalyzerPluginModule =
  | ((context: AnalyzerContext) => Issue[] | Promise<Issue[]>)
  | {
      analyze?: (context: AnalyzerContext) => Issue[] | Promise<Issue[]>;
      default?: ((context: AnalyzerContext) => Issue[] | Promise<Issue[]>) | { analyze?: (context: AnalyzerContext) => Issue[] | Promise<Issue[]> };
    };

type ReporterPluginModule =
  | ((result: QaResult) => void | Promise<void>)
  | {
      report?: (result: QaResult) => void | Promise<void>;
      default?: ((result: QaResult) => void | Promise<void>) | { report?: (result: QaResult) => void | Promise<void> };
    };

function resolvePluginPath(pluginPath: string): string {
  return path.isAbsolute(pluginPath) ? pluginPath : path.resolve(process.cwd(), pluginPath);
}

async function importPlugin<T>(pluginPath: string): Promise<T> {
  const resolved = resolvePluginPath(pluginPath);
  const mtime = await stat(resolved).then((item) => item.mtimeMs).catch(() => Date.now());
  return (await import(`${pathToFileURL(resolved).href}?frontlens_mtime=${mtime}`)) as T;
}

function analyzerFn(module: AnalyzerPluginModule): ((context: AnalyzerContext) => Issue[] | Promise<Issue[]>) | undefined {
  if (typeof module === 'function') return module;
  if (typeof module.analyze === 'function') return module.analyze;
  if (typeof module.default === 'function') return module.default;
  if (module.default && typeof module.default === 'object' && typeof module.default.analyze === 'function') return module.default.analyze;
  return undefined;
}

function reporterFn(module: ReporterPluginModule): ((result: QaResult) => void | Promise<void>) | undefined {
  if (typeof module === 'function') return module;
  if (typeof module.report === 'function') return module.report;
  if (typeof module.default === 'function') return module.default;
  if (module.default && typeof module.default === 'object' && typeof module.default.report === 'function') return module.default.report;
  return undefined;
}

export async function runAnalyzerPlugins(context: AnalyzerContext): Promise<Issue[]> {
  const pluginPaths = [...context.config.plugins.analyzers, ...context.config.plugins.rules];
  const issues: Issue[] = [];

  for (const pluginPath of pluginPaths) {
    try {
      const module = await importPlugin<AnalyzerPluginModule>(pluginPath);
      const fn = analyzerFn(module);
      if (!fn) {
        throw new Error('Plugin does not export a function or analyze(context).');
      }
      const pluginIssues = await fn(context);
      for (const issue of pluginIssues ?? []) {
        issues.push(
          normalizeIssueLike({
            ...issue,
            source: issue.source ?? 'manual'
          })
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({
        id: 'PLUGIN-ERROR',
        title: `插件执行失败：${pluginPath}`,
        category: 'unknown',
        severity: 'medium',
        confidence: 0.95,
        description: message,
        evidence: {
          details: {
            pluginPath,
            error: message
          }
        },
        reproduceSteps: ['运行 FrontLens', `加载插件 ${pluginPath}`],
        reason: '插件加载或执行失败会导致自定义规则/报告缺失。',
        suggestion: {
          frontend: '检查插件导出格式、路径和运行时依赖。',
          priority: 'P2'
        },
        source: 'manual'
      });
    }
  }

  return issues;
}

export async function runReporterPlugins(result: QaResult): Promise<void> {
  for (const pluginPath of result.metadata.config.plugins.reporters) {
    try {
      const module = await importPlugin<ReporterPluginModule>(pluginPath);
      const fn = reporterFn(module);
      if (!fn) {
        throw new Error('Plugin does not export a function or report(result).');
      }
      await fn(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.issues.push({
        id: `PLUGIN-REPORTER-${result.issues.length + 1}`,
        title: `Reporter 插件执行失败：${pluginPath}`,
        category: 'unknown',
        severity: 'medium',
        confidence: 0.95,
        description: message,
        evidence: {
          details: {
            pluginPath,
            error: message
          }
        },
        reproduceSteps: ['运行 FrontLens', `执行 Reporter 插件 ${pluginPath}`],
        reason: 'Reporter 插件失败会导致自定义报告缺失。',
        suggestion: {
          frontend: '检查 Reporter 插件导出格式、路径和运行时依赖。',
          priority: 'P2'
        },
        source: 'manual'
      });
    }
  }
}
