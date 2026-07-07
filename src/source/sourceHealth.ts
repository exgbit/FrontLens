import path from 'node:path';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import ts from 'typescript';
import type { FrontLensConfig, Issue, SourceHealthFinding, SourceHealthResult, SourceHealthScript } from '../types.js';

const PARSE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']);

export function createEmptySourceHealth(config: FrontLensConfig, status: SourceHealthResult['status'] = 'skipped', error?: string): SourceHealthResult {
  return {
    enabled: config.source.enabled,
    status,
    checkedAt: new Date().toISOString(),
    root: config.source.root,
    packageScripts: [],
    scannedFiles: 0,
    parsedFiles: 0,
    skippedFiles: 0,
    syntaxErrorCount: 0,
    findings: [],
    error
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

async function collectParseableFiles(root: string, config: FrontLensConfig): Promise<string[]> {
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
      if (!PARSE_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (!shouldInclude(rel, config)) continue;
      files.push(absolute);
    }
  }

  await walk(root);
  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function detectPackageManager(root: string): Promise<SourceHealthResult['packageManager']> {
  if (await fileExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await fileExists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await fileExists(path.join(root, 'bun.lockb')) || await fileExists(path.join(root, 'bun.lock'))) return 'bun';
  if (await fileExists(path.join(root, 'package-lock.json'))) return 'npm';
  if (await fileExists(path.join(root, 'package.json'))) return 'unknown';
  return undefined;
}

function scriptCategory(name: string): SourceHealthScript['category'] {
  const normalized = name.toLowerCase();
  if (/^(build|compile)(:|$)/.test(normalized)) return 'build';
  if (/type(check)?|tsc/.test(normalized)) return 'typecheck';
  if (/lint|eslint|stylelint/.test(normalized)) return 'lint';
  if (/e2e|playwright|cypress/.test(normalized)) return 'e2e';
  if (/coverage|cov/.test(normalized)) return 'coverage';
  if (/test|spec|unit|vitest|jest/.test(normalized)) return 'test';
  return 'other';
}

async function readPackageScripts(root: string): Promise<SourceHealthScript[]> {
  const packagePath = path.join(root, 'package.json');
  try {
    const raw = JSON.parse(await readFile(packagePath, 'utf8')) as { scripts?: Record<string, unknown> };
    return Object.entries(raw.scripts ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, command]) => ({ name, command, category: scriptCategory(name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function scriptKindFor(file: string, lang?: string): ts.ScriptKind {
  const normalizedLang = lang?.toLowerCase();
  const ext = path.extname(file).toLowerCase();
  if (ext === '.tsx' || normalizedLang === 'tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx' || normalizedLang === 'jsx') return ts.ScriptKind.JSX;
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs' || normalizedLang === 'js' || normalizedLang === 'javascript') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function lineCountBefore(value: string, index: number): number {
  if (index <= 0) return 0;
  return (value.slice(0, index).match(/\n/g) ?? []).length;
}

function vueScriptBlocks(content: string): Array<{ code: string; lang?: string; lineOffset: number }> {
  const blocks: Array<{ code: string; lang?: string; lineOffset: number }> = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of content.matchAll(re)) {
    const attrs = match[1] ?? '';
    const lang = /\blang\s*=\s*["']?([\w-]+)["']?/i.exec(attrs)?.[1];
    const scriptStart = (match.index ?? 0) + match[0].indexOf('>') + 1;
    blocks.push({
      code: match[2] ?? '',
      lang,
      lineOffset: lineCountBefore(content, scriptStart)
    });
  }
  return blocks;
}

function diagnosticToFinding(id: number, rel: string, diagnostic: ts.Diagnostic, lineOffset = 0): SourceHealthFinding {
  const location = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined;
  return {
    id: `SRC-HEALTH-${String(id).padStart(3, '0')}`,
    kind: 'syntax-error',
    severity: 'high',
    file: rel,
    line: location ? location.line + 1 + lineOffset : undefined,
    column: location ? location.character + 1 : undefined,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    code: typeof diagnostic.code === 'number' ? diagnostic.code : undefined
  };
}

function parseSyntax(rel: string, content: string): SourceHealthFinding[] {
  const ext = path.extname(rel).toLowerCase();
  const sources = ext === '.vue'
    ? vueScriptBlocks(content).map((block, index) => ({
        fileName: `${rel}?script=${index + 1}`,
        code: block.code,
        kind: scriptKindFor(rel, block.lang),
        lineOffset: block.lineOffset
      }))
    : [{ fileName: rel, code: content, kind: scriptKindFor(rel), lineOffset: 0 }];

  const findings: SourceHealthFinding[] = [];
  for (const source of sources) {
    if (!source.code.trim()) continue;
    const transpile = ts.transpileModule(source.code, {
      fileName: source.fileName,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        allowJs: true
      }
    });
    for (const diagnostic of transpile.diagnostics ?? []) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      findings.push(diagnosticToFinding(findings.length + 1, rel, diagnostic, source.lineOffset));
    }
  }
  return findings;
}

function syntaxIssue(result: SourceHealthResult, config: FrontLensConfig): Issue | undefined {
  if (result.findings.length === 0) return undefined;
  const first = result.findings[0];
  return {
    id: 'SOURCE-HEALTH-SYNTAX',
    title: `源码语法解析发现 ${result.syntaxErrorCount} 个错误`,
    category: 'frontend-source-health',
    severity: 'high',
    confidence: 0.96,
    description: `源码健康检查在 ${result.parsedFiles} 个文件中发现 ${result.syntaxErrorCount} 个语法解析错误，构建或运行可能失败。`,
    evidence: {
      details: {
        sourceHealthStatus: result.status,
        sourceFile: first?.file,
        line: first?.line,
        column: first?.column,
        findings: result.findings.slice(0, 20)
      }
    },
    reproduceSteps: [
      `检查源码文件 ${first?.file ?? '(unknown)'}${first?.line ? `:${first.line}` : ''}`,
      `在源码目录运行 ${result.packageManager && result.packageManager !== 'unknown' ? result.packageManager : 'npm'} run build 或 typecheck`
    ],
    reason: '源码语法错误是构建前置阻断问题，即使浏览器当前页面还能加载，也会影响后续发布、懒加载路由或特定功能路径。',
    suggestion: {
      frontend: '修复 Source Health 指向的语法错误；优先运行 package.json 中的 build/typecheck/lint 脚本确认无编译阻断。',
      test: '将 build/typecheck/lint 纳入 CI，并在 FrontLens sourceHealth 无错误后再做运行时 QA。',
      priority: 'P1'
    },
    source: 'rule'
  };
}

export async function analyzeSourceHealth(config: FrontLensConfig): Promise<{ result: SourceHealthResult; issues: Issue[] }> {
  if (!config.source.enabled) return { result: createEmptySourceHealth(config, 'skipped', 'Source analysis disabled.'), issues: [] };
  if (!config.source.root) return { result: createEmptySourceHealth(config, 'skipped', 'No source.root/sourceRoot was provided.'), issues: [] };

  const root = path.resolve(config.source.root);
  try {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) return { result: createEmptySourceHealth({ ...config, source: { ...config.source, root } }, 'failed', 'source.root is not a directory.'), issues: [] };
  } catch (error) {
    return { result: createEmptySourceHealth({ ...config, source: { ...config.source, root } }, 'failed', error instanceof Error ? error.message : String(error)), issues: [] };
  }

  const result = createEmptySourceHealth({ ...config, source: { ...config.source, root } }, 'passed');
  result.packageManager = await detectPackageManager(root);
  result.packageScripts = await readPackageScripts(root);

  const files = await collectParseableFiles(root, config);
  for (const file of files) {
    const fileStat = await stat(file).catch(() => undefined);
    if (!fileStat?.isFile() || fileStat.size > config.source.maxBytesPerFile) {
      result.skippedFiles += 1;
      continue;
    }
    result.scannedFiles += 1;
    const rel = normalizePath(path.relative(root, file));
    const content = await readFile(file, 'utf8').catch(() => '');
    if (!content) {
      result.skippedFiles += 1;
      continue;
    }
    const findings = parseSyntax(rel, content);
    result.parsedFiles += 1;
    for (const finding of findings) {
      result.findings.push({
        ...finding,
        id: `SRC-HEALTH-${String(result.findings.length + 1).padStart(3, '0')}`
      });
    }
  }
  result.syntaxErrorCount = result.findings.length;
  result.status = result.syntaxErrorCount > 0 ? 'failed' : 'passed';

  const issue = syntaxIssue(result, config);
  return {
    result,
    issues: issue ? [issue] : []
  };
}
