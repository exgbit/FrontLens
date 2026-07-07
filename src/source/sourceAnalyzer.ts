import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { FrontLensConfig, Issue, SourceAnalysisResult, SourceApiRecord, SourceImportRecord, SourceLocation, SourceRouteRecord, SourceStateSignal } from '../types.js';
import { redactText } from '../utils/redact.js';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro']);
const HEAVY_IMPORT_RE = /(@codemirror|codemirror|monaco|ace-builds|echarts|chart\.js|three|mapbox|leaflet|antd\/dist|element-plus\/dist|highlight\.js|yaml|xlsx|pdfjs|mermaid)/i;
const ROUTE_IMPORT_RE = /(^|\/)(views?|pages?|routes?)\/|\.vue$|\.svelte$|\.astro$/i;

export function createEmptySourceAnalysis(config: FrontLensConfig, status: SourceAnalysisResult['status'] = 'skipped', error?: string): SourceAnalysisResult {
  return {
    enabled: config.source.enabled,
    status,
    checkedAt: new Date().toISOString(),
    root: config.source.root,
    error,
    scannedFiles: 0,
    scannedBytes: 0,
    summary: {
      routeFileCount: 0,
      routeCount: 0,
      eagerRouteImportCount: 0,
      heavyImportCount: 0,
      apiCallCount: 0,
      errorStateSignalCount: 0,
      emptyStateSignalCount: 0
    },
    routeFiles: [],
    routes: [],
    imports: [],
    apiCalls: [],
    stateSignals: [],
    findings: []
  };
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/');
}

function shouldExclude(rel: string, config: FrontLensConfig): boolean {
  const normalized = normalizePath(rel);
  return config.source.exclude.some((item) => item && (normalized === item || normalized.includes(`/${item}/`) || normalized.startsWith(`${item}/`) || normalized.includes(item)));
}

function shouldInclude(rel: string, config: FrontLensConfig): boolean {
  if (config.source.include.length === 0) return true;
  const normalized = normalizePath(rel);
  return config.source.include.some((item) => item && (normalized === item || normalized.startsWith(`${item}/`) || normalized.includes(`/${item}/`) || normalized.includes(item)));
}

async function collectSourceFiles(root: string, config: FrontLensConfig): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= config.source.maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= config.source.maxFiles) break;
      const absolute = path.join(dir, entry.name);
      const rel = normalizePath(path.relative(root, absolute));
      if (shouldExclude(rel, config)) continue;
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (!shouldInclude(rel, config)) continue;
      files.push(absolute);
    }
  }

  await walk(root);
  return files;
}

function isRouteFile(rel: string, content: string): boolean {
  return /(^|\/)(router|routes?)(\/|\.|$)/i.test(rel) || /createRouter|RouterProvider|createBrowserRouter|useRoutes|RouteObject|routes\s*=/.test(content);
}

function parseImports(rel: string, lines: string[]): SourceImportRecord[] {
  const imports: SourceImportRecord[] = [];
  const staticImport = /^\s*import\s+(?:type\s+)?(.+?)\s+from\s+['"]([^'"]+)['"]/;
  const dynamicImport = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const [index, line] of lines.entries()) {
    const staticMatch = staticImport.exec(line);
    if (staticMatch) {
      const [, specifier, source] = staticMatch;
      imports.push({
        file: rel,
        line: index + 1,
        source,
        kind: 'static',
        specifier: specifier.trim().slice(0, 120),
        isRouteComponent: ROUTE_IMPORT_RE.test(source),
        isHeavy: HEAVY_IMPORT_RE.test(source)
      });
    }
    for (const match of line.matchAll(dynamicImport)) {
      const source = match[1];
      imports.push({
        file: rel,
        line: index + 1,
        column: match.index,
        source,
        kind: 'dynamic',
        isRouteComponent: ROUTE_IMPORT_RE.test(source),
        isHeavy: HEAVY_IMPORT_RE.test(source)
      });
    }
  }

  return imports;
}

function parseRoutes(rel: string, lines: string[]): SourceRouteRecord[] {
  const routes: SourceRouteRecord[] = [];
  for (const [index, line] of lines.entries()) {
    const pathMatch = /path\s*:\s*['"`]([^'"`]+)['"`]/.exec(line);
    if (!pathMatch) continue;
    const window = lines.slice(index, Math.min(lines.length, index + 10)).join('\n');
    const nameMatch = /name\s*:\s*['"`]([^'"`]+)['"`]/.exec(window);
    const componentMatch = /component\s*:\s*([^,\n}]+)/.exec(window);
    routes.push({
      file: rel,
      line: index + 1,
      path: pathMatch[1],
      name: nameMatch?.[1],
      component: componentMatch?.[1]?.trim().slice(0, 120),
      lazy: /import\s*\(/.test(window)
    });
  }
  return routes;
}

function parseApiCalls(rel: string, lines: string[]): SourceApiRecord[] {
  const calls: SourceApiRecord[] = [];
  const patterns: Array<{ re: RegExp; method?: string; client: string }> = [
    { re: /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g, client: 'fetch' },
    { re: /\b(?:axios|http|request|api)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi, client: 'http-client' },
    { re: /url\s*:\s*['"`]([^'"`]+)['"`]/g, client: 'request-config' }
  ];
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern.re)) {
        const hasMethodGroup = match.length > 2;
        calls.push({
          file: rel,
          line: index + 1,
          column: match.index,
          method: hasMethodGroup ? match[1].toUpperCase() : pattern.method,
          path: hasMethodGroup ? match[2] : match[1],
          client: pattern.client,
          expression: redactText(line.trim()).slice(0, 240)
        });
      }
    }
  }
  return calls;
}

function parseStateSignals(rel: string, lines: string[]): SourceStateSignal[] {
  const signals: SourceStateSignal[] = [];
  const kinds: Array<{ kind: SourceStateSignal['kind']; re: RegExp }> = [
    { kind: 'loading', re: /\b(loading|isLoading|pending|加载中|加载)/i },
    { kind: 'error', re: /\b(error|err|catch|onError|失败|错误|异常)/i },
    { kind: 'empty', re: /\b(empty|noData|暂无|无数据|空态|空状态)/i },
    { kind: 'retry', re: /\b(retry|reload|refresh|重试|重新加载|刷新)/i }
  ];
  for (const [index, line] of lines.entries()) {
    for (const item of kinds) {
      if (!item.re.test(line)) continue;
      signals.push({
        file: rel,
        line: index + 1,
        kind: item.kind,
        text: redactText(line.trim()).slice(0, 240)
      });
      break;
    }
  }
  return signals;
}

function makeFinding(id: number, input: SourceAnalysisResult['findings'][number]): SourceAnalysisResult['findings'][number] {
  return {
    ...input,
    id: `SRC-${String(id).padStart(3, '0')}`
  };
}

function sourceIssue(finding: SourceAnalysisResult['findings'][number], config: FrontLensConfig): Issue {
  const first = finding.locations[0];
  return {
    id: `SOURCE-${finding.id}`,
    title: finding.title,
    category: finding.kind === 'eager-route-imports' || finding.kind === 'heavy-import' ? 'frontend-performance' : 'unknown',
    severity: finding.severity,
    confidence: 0.86,
    description: finding.kind === 'eager-route-imports'
      ? '源码扫描发现路由文件静态 import 多个页面组件，当前路由可能被迫加载无关页面代码。'
      : '源码扫描发现首屏路径可能静态引入重型依赖，需要结合构建产物确认。',
    evidence: {
      details: {
        sourceFindingId: finding.id,
        sourceFile: first?.file,
        line: first?.line,
        ...finding.details
      }
    },
    reproduceSteps: [
      `检查源码文件 ${first?.file ?? '(unknown)'}`,
      `运行 FrontLens QA：node dist/cli.js qa --url ${config.target.url} --source-root ${config.source.root ?? '<sourceRoot>'}`
    ],
    reason: finding.kind === 'eager-route-imports'
      ? '静态路由组件导入会削弱路由级拆包，dev-server 噪音降级后仍可能代表真实源码级性能问题。'
      : '重型依赖若被首屏静态引入，会拉高首包和 Coverage 未使用比例。',
    suggestion: {
      frontend: finding.kind === 'eager-route-imports'
        ? '将非当前首屏必需的 route component 改为 component: () => import(...)，并在 build + preview 下复测 bundle/coverage。'
        : '确认重型依赖是否仅在特定功能页使用；必要时改为动态导入或路由懒加载。',
      test: '补充 sourceAnalysis + build/preview coverage 回归，确保当前页面首包不包含无关路由/重型功能依赖。',
      priority: finding.severity === 'medium' ? 'P2' : 'P3'
    },
    source: 'rule'
  };
}

export async function analyzeSource(config: FrontLensConfig): Promise<{ result: SourceAnalysisResult; issues: Issue[] }> {
  if (!config.source.enabled) return { result: createEmptySourceAnalysis(config, 'skipped', 'Source analysis disabled.'), issues: [] };
  if (!config.source.root) return { result: createEmptySourceAnalysis(config, 'skipped', 'No source.root/sourceRoot was provided.'), issues: [] };

  const root = path.resolve(config.source.root);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return { result: createEmptySourceAnalysis({ ...config, source: { ...config.source, root } }, 'failed', 'source.root is not a directory.'), issues: [] };
  } catch (error) {
    return { result: createEmptySourceAnalysis({ ...config, source: { ...config.source, root } }, 'failed', error instanceof Error ? error.message : String(error)), issues: [] };
  }

  const result = createEmptySourceAnalysis({ ...config, source: { ...config.source, root } }, 'passed');
  const files = await collectSourceFiles(root, config);
  const routeFileSet = new Set<string>();

  for (const file of files) {
    const fileStat = await stat(file).catch(() => undefined);
    if (!fileStat?.isFile() || fileStat.size > config.source.maxBytesPerFile) continue;
    const rel = normalizePath(path.relative(root, file));
    const content = await readFile(file, 'utf8').catch(() => '');
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    result.scannedFiles += 1;
    result.scannedBytes += Buffer.byteLength(content);
    const imports = parseImports(rel, lines);
    result.imports.push(...imports);
    result.apiCalls.push(...parseApiCalls(rel, lines));
    result.stateSignals.push(...parseStateSignals(rel, lines));
    if (isRouteFile(rel, content)) {
      routeFileSet.add(rel);
      result.routes.push(...parseRoutes(rel, lines));
    }
  }

  result.routeFiles = [...routeFileSet].sort();
  const routeImports = result.imports.filter((item) => item.kind === 'static' && item.isRouteComponent && routeFileSet.has(item.file));
  const heavyStaticImports = result.imports.filter((item) => item.kind === 'static' && item.isHeavy);
  result.summary = {
    routeFileCount: result.routeFiles.length,
    routeCount: result.routes.length,
    eagerRouteImportCount: routeImports.length,
    heavyImportCount: result.imports.filter((item) => item.isHeavy).length,
    apiCallCount: result.apiCalls.length,
    errorStateSignalCount: result.stateSignals.filter((item) => item.kind === 'error').length,
    emptyStateSignalCount: result.stateSignals.filter((item) => item.kind === 'empty').length
  };

  const findings: SourceAnalysisResult['findings'] = [];
  let findingIndex = 1;
  if (routeImports.length >= 2) {
    findings.push(makeFinding(findingIndex++, {
      id: '',
      kind: 'eager-route-imports',
      severity: routeImports.some((item) => item.isHeavy) || result.summary.heavyImportCount > 0 ? 'medium' : 'low',
      title: `源码发现路由组件静态导入：${routeImports.length} 个`,
      locations: routeImports.slice(0, 20).map(({ file, line, column }) => ({ file, line, column })),
      details: {
        routeFiles: result.routeFiles,
        imports: routeImports.slice(0, 20).map((item) => ({ file: item.file, line: item.line, source: item.source, specifier: item.specifier }))
      }
    }));
  }
  if (heavyStaticImports.length > 0) {
    findings.push(makeFinding(findingIndex++, {
      id: '',
      kind: 'heavy-import',
      severity: 'low',
      title: `源码发现静态重型依赖导入：${heavyStaticImports.length} 个`,
      locations: heavyStaticImports.slice(0, 20).map(({ file, line, column }) => ({ file, line, column })),
      details: {
        imports: heavyStaticImports.slice(0, 20).map((item) => ({ file: item.file, line: item.line, source: item.source }))
      }
    }));
  }
  result.findings = findings;
  return {
    result,
    issues: findings.filter((finding) => finding.kind === 'eager-route-imports').map((finding) => sourceIssue(finding, config))
  };
}
