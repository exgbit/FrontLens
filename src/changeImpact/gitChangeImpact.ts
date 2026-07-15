import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import type {
  ChangeFileKind,
  ChangeFileStatus,
  ChangeImpactConfidence,
  ChangeImpactFile,
  ChangeImpactModule,
  ChangeImpactResult,
  ChangeRegressionTarget,
  RequirementPriority,
  TestLayer
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

const execFileAsync = promisify(execFile);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.py', '.go', '.java', '.kt', '.kts', '.cs', '.php', '.rb', '.rs']);
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'reports']);

export interface AnalyzeGitChangeImpactInput {
  sourceRoot?: string;
  enabled?: boolean;
  baseRef?: string;
  headRef?: string;
  includeWorkingTree?: boolean;
  maxChangedFiles?: number;
  maxSourceFiles?: number;
  maxDiffBytes?: number;
}

interface GitOutput {
  stdout: string;
  stderr: string;
}

export type GitCommandRunner = (args: string[], cwd: string, maxBuffer: number) => Promise<GitOutput>;

const defaultGitRunner: GitCommandRunner = async (args, cwd, maxBuffer) => {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8', maxBuffer, timeout: 20_000 });
  return { stdout: result.stdout, stderr: result.stderr };
};

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function emptyResult(input: AnalyzeGitChangeImpactInput, status: ChangeImpactResult['status'], warnings: string[] = []): ChangeImpactResult {
  return {
    enabled: input.enabled !== false,
    status,
    generatedAt: new Date().toISOString(),
    headRef: input.headRef ?? 'HEAD',
    includeWorkingTree: input.includeWorkingTree !== false,
    workingTreeIncluded: false,
    changedFileCount: 0,
    committedFileCount: 0,
    workingTreeFileCount: 0,
    files: [],
    modules: [],
    regressionTargets: [],
    warnings,
    limits: {
      maxChangedFiles: input.maxChangedFiles ?? 300,
      maxSourceFiles: input.maxSourceFiles ?? 1_000,
      maxDiffBytes: input.maxDiffBytes ?? 1_500_000,
      truncated: false
    }
  };
}

async function git(runner: GitCommandRunner, cwd: string, args: string[], maxBuffer: number): Promise<string> {
  return (await runner(args, cwd, maxBuffer)).stdout.trim();
}

async function tryGit(runner: GitCommandRunner, cwd: string, args: string[], maxBuffer: number): Promise<string | undefined> {
  try {
    return await git(runner, cwd, args, maxBuffer);
  } catch {
    return undefined;
  }
}

async function resolveBaseRef(runner: GitCommandRunner, root: string, explicit: string | undefined, maxBuffer: number): Promise<{ ref?: string; source?: ChangeImpactResult['baseRefSource']; warning?: string }> {
  if (explicit) {
    const resolved = await tryGit(runner, root, ['rev-parse', '--verify', `${explicit}^{commit}`], maxBuffer);
    return resolved ? { ref: explicit, source: 'explicit' } : { warning: `显式基础分支/提交不存在或不可读取：${explicit}` };
  }
  const remoteDefault = await tryGit(runner, root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], maxBuffer);
  if (remoteDefault && await tryGit(runner, root, ['rev-parse', '--verify', `${remoteDefault}^{commit}`], maxBuffer)) {
    return { ref: remoteDefault, source: 'remote-default' };
  }
  for (const candidate of ['origin/main', 'main', 'origin/master', 'master', 'origin/develop', 'develop']) {
    if (await tryGit(runner, root, ['rev-parse', '--verify', `${candidate}^{commit}`], maxBuffer)) return { ref: candidate, source: 'fallback' };
  }
  return { warning: '无法确定基础分支；请使用 --base-ref 指定远端默认分支、main、master 或 develop。' };
}

interface RawChange {
  path: string;
  previousPath?: string;
  status: ChangeFileStatus;
  source: ChangeImpactFile['source'];
}

function changeStatus(value: string): ChangeFileStatus {
  if (value.startsWith('A')) return 'added';
  if (value.startsWith('D')) return 'deleted';
  if (value.startsWith('R')) return 'renamed';
  if (value.startsWith('C')) return 'copied';
  return 'modified';
}

function parseNameStatusZ(raw: string, source: RawChange['source']): RawChange[] {
  const parts = raw.split('\0').filter((item) => item.length > 0);
  const changes: RawChange[] = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++];
    if (!code) break;
    if (code.startsWith('R') || code.startsWith('C')) {
      const previousPath = normalize(parts[index++] ?? '');
      const currentPath = normalize(parts[index++] ?? '');
      if (currentPath) changes.push({ path: currentPath, previousPath, status: changeStatus(code), source });
    } else {
      const currentPath = normalize(parts[index++] ?? '');
      if (currentPath) changes.push({ path: currentPath, status: changeStatus(code), source });
    }
  }
  return changes;
}

function parseNumstat(raw: string): Map<string, { additions?: number; deletions?: number }> {
  const result = new Map<string, { additions?: number; deletions?: number }>();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!match) continue;
    let file = normalize(match[3]);
    const rename = /\{(.+?) => (.+?)\}/.exec(file);
    if (rename) file = file.replace(rename[0], rename[2]);
    else if (file.includes(' => ')) file = file.split(' => ').pop() ?? file;
    result.set(file, {
      additions: match[1] === '-' ? undefined : Number(match[1]),
      deletions: match[2] === '-' ? undefined : Number(match[2])
    });
  }
  return result;
}

function fileKind(file: string): ChangeFileKind {
  const value = file.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec|specs|e2e|fixtures?)(\/|\.)|\.(test|spec)\./.test(value)) return 'test';
  if (/(^|\/)(docs?|readme|changelog)(\/|\.|$)|\.(md|mdx|rst|txt)$/.test(value)) return 'docs';
  if (/(^|\/)(auth|authentication|authorization|permissions?|security|rbac|acl)(\/|\.)/.test(value)) return 'auth';
  if (/(^|\/)(migrations?|schema|entities?|models?|repositories?|repo|dao|database|db)(\/|\.)/.test(value)) return 'data';
  if (/(^|\/)(controllers?|routes?|routers?|handlers?|endpoints?|graphql|openapi)(\/|\.)/.test(value)) return 'api';
  if (/(^|\/)(services?|usecases?|domain|commands?|jobs?|workers?)(\/|\.)/.test(value)) return 'service';
  if (/(^|\/)(pages?|views?|components?|layouts?|widgets?)(\/|\.)|\.(vue|svelte|astro)$/.test(value)) return 'frontend';
  if (/(^|\/)(stores?|state|reducers?|hooks?|composables?)(\/|\.)/.test(value)) return 'state';
  if (/(^|\/)(shared|common|utils?|helpers?|lib|core)(\/|\.)/.test(value)) return 'shared';
  if (/(^|\/)(config|configs|deploy|deployment|infra|ci)(\/|\.)|(^|\/)(dockerfile|compose[^/]*|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|go\.mod|cargo\.toml|pom\.xml|pyproject\.toml)$|\.(ya?ml|toml|properties|env)$/.test(value)) return 'config';
  if (SOURCE_EXTENSIONS.has(path.posix.extname(value))) return 'shared';
  return 'other';
}

const GENERIC_SEGMENTS = new Set(['src', 'app', 'apps', 'packages', 'services', 'service', 'modules', 'module', 'features', 'feature', 'pages', 'views', 'components', 'controllers', 'routes', 'handlers', 'repositories', 'models', 'domain', 'lib', 'server', 'client', 'frontend', 'backend', 'agents']);

function moduleName(file: string): string {
  const parts = normalize(file).split('/').filter(Boolean);
  const stem = path.posix.basename(file, path.posix.extname(file));
  if (parts.length === 1 && /^(package|pyproject|cargo|pom|build\.gradle|go\.mod|composer)$/i.test(stem)) return 'application';
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const part = parts[index].toLowerCase();
    if (!GENERIC_SEGMENTS.has(part) && !EXCLUDED_DIRS.has(part) && !/^(index|main)$/.test(part)) return parts[index];
  }
  return /^(index|main|app|server)$/i.test(stem) ? 'application' : stem;
}

function riskFor(kind: ChangeFileKind, file: string): RequirementPriority {
  if (kind === 'auth' || /migration|schema|transaction|payment|billing|inventory/i.test(file)) return 'P0';
  if (kind === 'data' || kind === 'api' || kind === 'service' || kind === 'shared' || kind === 'config' || kind === 'state') return 'P1';
  if (kind === 'frontend') return 'P1';
  if (kind === 'test') return 'P2';
  return 'P3';
}

function extractDiffSignals(diff: string): Map<string, { symbols: string[]; apiPatterns: string[] }> {
  const result = new Map<string, { symbols: string[]; apiPatterns: string[] }>();
  let current: string | undefined;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      current = normalize(line.slice(6));
      if (!result.has(current)) result.set(current, { symbols: [], apiPatterns: [] });
      continue;
    }
    if (!current || (!line.startsWith('+') && !line.startsWith('-') && !line.startsWith('@@'))) continue;
    const entry = result.get(current)!;
    const hunk = /^@@[^@]*@@\s*(.+)$/.exec(line)?.[1];
    if (hunk && !/^\s*$/.test(hunk)) entry.symbols.push(hunk.trim().slice(0, 160));
    const code = line.replace(/^[+-]/, '');
    const symbol = /(?:function|class|interface|type|enum|def|func|public|private|protected|async|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(code)?.[1];
    if (symbol) entry.symbols.push(symbol);
    entry.apiPatterns.push(...apiPatternsFromText(code));
  }
  for (const entry of result.values()) {
    entry.symbols = uniq(entry.symbols).slice(0, 20);
    entry.apiPatterns = uniq(entry.apiPatterns).slice(0, 20);
  }
  return result;
}

function apiPatternsFromText(content: string): string[] {
  const patterns: string[] = [];
  for (const match of content.matchAll(/\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([/][\w{}:.*?&=+\-/]*)/gi)) patterns.push(`${match[1].toUpperCase()} ${match[2]}`);
  for (const match of content.matchAll(/(?:router|app|route)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]+)/gi)) patterns.push(`${match[1].toUpperCase()} ${match[2]}`);
  for (const match of content.matchAll(/@(Get|Post|Put|Patch|Delete)(?:Mapping)?\s*\(\s*['"]?([^'"),\s]+)/g)) patterns.push(`${match[1].toUpperCase()} ${match[2]}`);
  for (const match of content.matchAll(/@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)/g)) patterns.push(match[1]);
  return uniq(patterns).slice(0, 30);
}

async function collectSourceFiles(root: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name.toLowerCase())) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(normalize(path.relative(root, absolute)));
    }
  }
  await walk(root);
  return files;
}

function importSpecifiers(content: string): string[] {
  const values: string[] = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*from\s+([\w.]+)\s+import\s+/gm,
    /^\s*import\s+([\w.]+)/gm,
    /^\s*import\s+["`]([^"`]+)["`]/gm,
    /^\s*using\s+([\w.]+)\s*;/gm
  ];
  for (const pattern of patterns) for (const match of content.matchAll(pattern)) values.push(match[1]);
  return uniq(values);
}

function resolveImport(importer: string, specifier: string, fileSet: Set<string>): string | undefined {
  const extension = path.posix.extname(specifier);
  let base: string;
  if (specifier.startsWith('.')) base = normalize(path.posix.join(path.posix.dirname(importer), specifier));
  else {
    const dotted = specifier.replace(/\./g, '/');
    const candidates = [...fileSet].filter((file) => file === dotted || file.endsWith(`/${dotted}`) || file.endsWith(`/${dotted}.py`));
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  const runtimeMapped = /\.(mjs|cjs|js|jsx)$/.test(base)
    ? [base.replace(/\.(mjs|cjs|js|jsx)$/, '.ts'), base.replace(/\.(mjs|cjs|js|jsx)$/, '.tsx')]
    : [];
  const candidates = extension
    ? [base, ...runtimeMapped]
    : [base, ...[...SOURCE_EXTENSIONS].map((ext) => `${base}${ext}`), ...[...SOURCE_EXTENSIONS].map((ext) => `${base}/index${ext}`)];
  return candidates.find((item) => fileSet.has(item));
}

async function dependencyContext(root: string, changedFiles: ChangeImpactFile[], maxSourceFiles: number): Promise<{ dependents: Map<string, string[]>; relatedTests: Map<string, string[]>; apiPatterns: Map<string, string[]>; truncated: boolean }> {
  const sourceFiles = await collectSourceFiles(root, maxSourceFiles);
  const fileSet = new Set(sourceFiles);
  // Keep deleted and pre-rename paths resolvable. Existing importers of a file
  // that disappeared are precisely the callers most likely to regress.
  for (const changed of changedFiles) {
    fileSet.add(changed.path);
    if (changed.previousPath) fileSet.add(changed.previousPath);
  }
  const reverse = new Map<string, Set<string>>();
  const contents = new Map<string, string>();
  let totalBytes = 0;
  for (const file of sourceFiles) {
    if (totalBytes >= 16_000_000) break;
    const absolute = path.join(root, file);
    const info = await stat(absolute).catch(() => undefined);
    if (!info?.isFile() || info.size > 256_000) continue;
    const content = await readFile(absolute, 'utf8').catch(() => '');
    totalBytes += Buffer.byteLength(content);
    contents.set(file, content);
    for (const specifier of importSpecifiers(content)) {
      const resolved = resolveImport(file, specifier, fileSet);
      if (!resolved) continue;
      const rows = reverse.get(resolved) ?? new Set<string>();
      rows.add(file);
      reverse.set(resolved, rows);
    }
  }
  const dependents = new Map<string, string[]>();
  const relatedTests = new Map<string, string[]>();
  const apiPatterns = new Map<string, string[]>();
  for (const changed of changedFiles) {
    const direct = new Set<string>([
      ...(reverse.get(changed.path) ?? []),
      ...(changed.previousPath ? reverse.get(changed.previousPath) ?? [] : [])
    ]);
    const propagated = new Set<string>(direct);
    for (const item of [...direct]) for (const next of reverse.get(item) ?? []) propagated.add(next);
    dependents.set(changed.path, [...propagated].slice(0, 60));
    const stem = path.posix.basename(changed.path, path.posix.extname(changed.path)).toLowerCase();
    const lexicalStemAllowed = stem.length >= 4 && !/^(index|main|app|server|client|config|types|package|common|utils?|helpers?|service|controller)$/i.test(stem);
    const tests = sourceFiles.filter((file) => {
      if (fileKind(file) !== 'test') return false;
      if (propagated.has(file)) return true;
      const content = contents.get(file)?.toLowerCase() ?? '';
      return lexicalStemAllowed && (file.toLowerCase().includes(stem) || content.includes(stem));
    });
    relatedTests.set(changed.path, tests.slice(0, 30));
    apiPatterns.set(changed.path, uniq([changed.path, ...direct]
      .filter((file) => fileKind(file) !== 'test')
      .flatMap((file) => apiPatternsFromText(contents.get(file) ?? ''))).slice(0, 30));
  }
  return { dependents, relatedTests, apiPatterns, truncated: sourceFiles.length >= maxSourceFiles || totalBytes >= 16_000_000 };
}

function businessFlows(module: string, kinds: ChangeFileKind[], apiPatterns: string[]): string[] {
  const flows = [`${module} 既有成功路径`];
  if (kinds.includes('api')) flows.push(`${module} 接口请求、响应和错误契约`);
  if (kinds.includes('service')) flows.push(`${module} 业务规则、状态流转和异常分支`);
  if (kinds.includes('data')) flows.push(`${module} 数据持久化、事务、兼容性和回滚`);
  if (kinds.includes('auth')) flows.push(`${module} 授权、越权拒绝和审计`);
  if (kinds.includes('frontend') || kinds.includes('state')) flows.push(`${module} 页面交互、状态同步和失败反馈`);
  if (kinds.includes('shared')) flows.push(`引用 ${module} 公共能力的相邻业务`);
  flows.push(...apiPatterns.map((item) => `${item} 原有调用方`));
  return uniq(flows).slice(0, 12);
}

function risks(kinds: ChangeFileKind[], dependentCount: number): string[] {
  const values: string[] = [];
  if (kinds.includes('auth')) values.push('权限边界或未授权调用行为发生回归');
  if (kinds.includes('data')) values.push('旧数据兼容、事务一致性或清理回滚发生回归');
  if (kinds.includes('api')) values.push('接口状态码、字段或错误契约破坏现有调用方');
  if (kinds.includes('service')) values.push('共享业务规则或状态流转影响相邻流程');
  if (kinds.includes('frontend') || kinds.includes('state')) values.push('页面展示、交互、状态同步或异常反馈回归');
  if (kinds.includes('shared')) values.push('公共模块变更向多个引用模块传播');
  if (dependentCount > 0) values.push(`静态依赖分析发现 ${dependentCount} 个一至二跳引用文件`);
  return uniq(values.length ? values : ['当前仅能确认文件级变更，需要运行原有测试验证业务兼容性。']);
}

function targetLayer(kinds: ChangeFileKind[]): TestLayer {
  if (kinds.includes('frontend') || kinds.includes('state')) return 'frontend';
  if (kinds.includes('api')) return 'api';
  if (kinds.includes('service') || kinds.includes('data') || kinds.includes('auth')) return 'backend';
  return 'source';
}

function targetPriority(files: ChangeImpactFile[], dependentCount: number): RequirementPriority {
  if (files.some((item) => item.directRisk === 'P0') || dependentCount >= 8) return 'P0';
  if (files.some((item) => item.directRisk === 'P1') || dependentCount > 0) return 'P1';
  if (files.some((item) => item.directRisk === 'P2')) return 'P2';
  return 'P3';
}

function buildTarget(module: ChangeImpactModule, files: ChangeImpactFile[], index: number): ChangeRegressionTarget {
  const priority = targetPriority(files, module.dependentFiles.length);
  const related = module.relatedTests.length ? `先运行相关既有测试：${module.relatedTests.join('、')}` : '定位并运行覆盖该模块的既有单元/集成/E2E 测试。';
  return {
    id: `CHANGE-REG-${String(index + 1).padStart(3, '0')}`,
    module: module.name,
    title: `回归受影响的原有 ${module.name} 业务`,
    priority,
    layer: targetLayer(module.kinds),
    reason: module.risks.join('；'),
    changedFiles: module.directFiles,
    dependentFiles: module.dependentFiles,
    relatedTests: module.relatedTests,
    apiPatterns: module.apiPatterns,
    businessFlows: module.businessFlows,
    steps: [
      related,
      `按修改前已经支持的输入、角色和状态执行：${module.businessFlows.join('；')}`,
      '覆盖原有成功、失败、边界、权限/状态、重复提交及依赖异常场景中适用的部分。',
      '核对响应/页面、持久化副作用、日志和下游引用模块，并保存独立运行证据。'
    ],
    expected: [
      '本次需求行为满足验收标准。',
      '受影响的原有业务契约、权限、状态流转和数据副作用保持正常。',
      '相关既有自动化测试通过，且没有新增 P0/P1 回归缺陷。'
    ],
    confidence: module.confidence
  };
}

export async function analyzeGitChangeImpact(input: AnalyzeGitChangeImpactInput, runner: GitCommandRunner = defaultGitRunner): Promise<ChangeImpactResult> {
  if (input.enabled === false) return emptyResult(input, 'disabled');
  if (!input.sourceRoot) return emptyResult(input, 'unavailable', ['未提供 sourceRoot，跳过 Git 变更影响分析；需求测试仍可继续。']);
  const requestedRoot = path.resolve(input.sourceRoot);
  // Git commonly returns a canonical path (for example /private/tmp on macOS)
  // while callers may use a symlinked spelling such as /tmp. Canonicalize both
  // sides before computing a repository-relative source scope.
  const rootInput = await realpath(requestedRoot).catch(() => requestedRoot);
  const maxChangedFiles = input.maxChangedFiles ?? 300;
  const maxSourceFiles = input.maxSourceFiles ?? 1_000;
  const maxDiffBytes = input.maxDiffBytes ?? 1_500_000;
  const maxBuffer = Math.max(maxDiffBytes * 2, 2_000_000);
  const result = emptyResult({ ...input, maxChangedFiles, maxSourceFiles, maxDiffBytes }, 'unavailable');
  const repositoryRoot = await tryGit(runner, rootInput, ['rev-parse', '--show-toplevel'], maxBuffer);
  if (!repositoryRoot) {
    result.warnings.push('sourceRoot 不在 Git 仓库中，无法进行基础分支差异分析；已降级为普通需求测试。');
    return result;
  }
  result.repositoryRoot = path.resolve(repositoryRoot);
  const scopeRelative = normalize(path.relative(result.repositoryRoot, rootInput));
  const scopePrefix = scopeRelative && !scopeRelative.startsWith('../') && scopeRelative !== '..' ? `${scopeRelative.replace(/\/$/, '')}/` : '';
  const headRef = input.headRef ?? 'HEAD';
  result.headRef = headRef;
  const headCommit = await tryGit(runner, result.repositoryRoot, ['rev-parse', '--verify', `${headRef}^{commit}`], maxBuffer);
  if (!headCommit) {
    result.warnings.push(`目标分支/提交不存在或不可读取：${headRef}`);
    return result;
  }
  const base = await resolveBaseRef(runner, result.repositoryRoot, input.baseRef, maxBuffer);
  if (!base.ref) {
    result.warnings.push(base.warning ?? '无法确定基础分支。');
    return result;
  }
  result.baseRef = base.ref;
  result.baseRefSource = base.source;
  const mergeBase = await tryGit(runner, result.repositoryRoot, ['merge-base', base.ref, headRef], maxBuffer);
  if (!mergeBase) {
    result.warnings.push(`无法计算 ${base.ref} 与 ${headRef} 的 merge-base。`);
    return result;
  }
  result.mergeBase = mergeBase;

  const committedRaw = await tryGit(runner, result.repositoryRoot, ['diff', '--name-status', '-z', '--find-renames', mergeBase, headRef], maxBuffer) ?? '';
  const committed = parseNameStatusZ(committedRaw, 'committed');
  const changes = new Map<string, RawChange>();
  for (const item of committed) changes.set(item.path, item);
  let workingChanges: RawChange[] = [];

  const currentHead = await tryGit(runner, result.repositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}'], maxBuffer);
  const canIncludeWorkingTree = input.includeWorkingTree !== false && currentHead === headCommit;
  if (input.includeWorkingTree !== false && !canIncludeWorkingTree) result.warnings.push('指定 headRef 不是当前 HEAD，未混入工作区修改，避免产生错误基线。');
  if (canIncludeWorkingTree) {
    const staged = parseNameStatusZ(await tryGit(runner, result.repositoryRoot, ['diff', '--cached', '--name-status', '-z', '--find-renames'], maxBuffer) ?? '', 'staged');
    const unstaged = parseNameStatusZ(await tryGit(runner, result.repositoryRoot, ['diff', '--name-status', '-z', '--find-renames'], maxBuffer) ?? '', 'unstaged');
    const untracked = (await tryGit(runner, result.repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z'], maxBuffer) ?? '')
      .split('\0').filter(Boolean).map((file): RawChange => ({ path: normalize(file), status: 'untracked', source: 'untracked' }));
    workingChanges = [...staged, ...unstaged, ...untracked];
    for (const item of workingChanges) changes.set(item.path, item);
    result.workingTreeIncluded = true;
  }

  const inSourceScope = (item: RawChange): boolean => !scopePrefix
    || item.path === scopeRelative
    || item.path.startsWith(scopePrefix)
    || Boolean(item.previousPath && (item.previousPath === scopeRelative || item.previousPath.startsWith(scopePrefix)));
  result.committedFileCount = new Set(committed.filter(inSourceScope).map((item) => item.path)).size;
  result.workingTreeFileCount = new Set(workingChanges.filter(inSourceScope).map((item) => item.path)).size;

  let rawChanges = [...changes.values()]
    .filter(inSourceScope)
    .sort((a, b) => a.path.localeCompare(b.path));
  if (rawChanges.length > maxChangedFiles) {
    result.limits.truncated = true;
    result.warnings.push(`变更文件 ${rawChanges.length} 个，超过上限 ${maxChangedFiles}；影响分析只处理前 ${maxChangedFiles} 个文件。`);
    rawChanges = rawChanges.slice(0, maxChangedFiles);
  }
  if (!rawChanges.length) {
    result.status = 'no-changes';
    return result;
  }

  const numstatRaw = canIncludeWorkingTree
    ? await tryGit(runner, result.repositoryRoot, ['diff', '--numstat', mergeBase], maxBuffer) ?? ''
    : await tryGit(runner, result.repositoryRoot, ['diff', '--numstat', mergeBase, headRef], maxBuffer) ?? '';
  const stats = parseNumstat(numstatRaw);
  const trackedPaths = rawChanges.filter((item) => item.status !== 'untracked').map((item) => item.path);
  let diff = trackedPaths.length
    ? await tryGit(runner, result.repositoryRoot, ['diff', '--no-ext-diff', '--unified=0', mergeBase, ...(canIncludeWorkingTree ? [] : [headRef]), '--', ...trackedPaths], maxBuffer) ?? ''
    : '';
  if (Buffer.byteLength(diff) > maxDiffBytes) {
    diff = Buffer.from(diff).subarray(0, maxDiffBytes).toString('utf8');
    result.limits.truncated = true;
    result.warnings.push(`Git diff 超过 ${maxDiffBytes} bytes，已截断；低置信度传播项需要人工复核。`);
  }
  const oversizedUntracked: Array<{ path: string; size: number }> = [];
  for (const item of rawChanges.filter((entry) => entry.status === 'untracked')) {
    if (Buffer.byteLength(diff) >= maxDiffBytes) break;
    const absolute = path.join(result.repositoryRoot, item.path);
    const info = await stat(absolute).catch(() => undefined);
    const extension = path.extname(item.path).toLowerCase();
    const textCandidate = SOURCE_EXTENSIONS.has(extension)
      || /(?:^|\/)(?:dockerfile|makefile|readme|changelog|package\.json|tsconfig(?:\.[^/]+)?\.json)$/i.test(item.path)
      || /\.(?:json|ya?ml|toml|properties|env|md|mdx|rst|txt|sql|graphql|gql|html?|css|scss|less)$/i.test(item.path);
    if (!info?.isFile() || !textCandidate || info.size > 256_000) {
      result.limits.truncated ||= Boolean(info?.isFile() && info.size > 256_000);
      if (info?.isFile() && info.size > 256_000) oversizedUntracked.push({ path: item.path, size: info.size });
      continue;
    }
    const content = await readFile(absolute, 'utf8').catch(() => '');
    const remaining = Math.max(0, maxDiffBytes - Buffer.byteLength(diff));
    const chunk = `\n+++ b/${item.path}\n${content.split(/\r?\n/).map((line) => `+${line}`).join('\n')}`;
    diff += Buffer.from(chunk).subarray(0, remaining).toString('utf8');
  }
  if (oversizedUntracked.length) {
    const sample = oversizedUntracked.slice(0, 5).map((item) => `${item.path} (${item.size} bytes)`).join('、');
    result.warnings.push(`未读取 ${oversizedUntracked.length} 个过大的未跟踪文件内容：${sample}${oversizedUntracked.length > 5 ? ' 等' : ''}。`);
  }
  const signals = extractDiffSignals(diff);
  result.files = rawChanges.map((item) => {
    const kind = fileKind(item.path);
    const signal = signals.get(item.path);
    return {
      ...item,
      ...stats.get(item.path),
      kind,
      module: moduleName(item.path),
      changedSymbols: signal?.symbols ?? [],
      apiPatterns: signal?.apiPatterns ?? [],
      directRisk: riskFor(kind, item.path)
    };
  });
  result.changedFileCount = result.files.length;

  const dependency = await dependencyContext(result.repositoryRoot, result.files, maxSourceFiles);
  if (dependency.truncated) {
    result.limits.truncated = true;
    result.warnings.push('源码依赖索引达到文件/字节上限；传播影响为有界结果，不代表完整调用图。');
  }
  const grouped = new Map<string, ChangeImpactFile[]>();
  for (const file of result.files) {
    const rows = grouped.get(file.module) ?? [];
    rows.push(file);
    grouped.set(file.module, rows);
  }
  result.modules = [...grouped.entries()].map(([name, files]): ChangeImpactModule => {
    const kinds = uniq(files.map((item) => item.kind)) as ChangeFileKind[];
    const dependentFiles = uniq(files.flatMap((item) => dependency.dependents.get(item.path) ?? []));
    const relatedTests = uniq(files.flatMap((item) => dependency.relatedTests.get(item.path) ?? []));
    const apiPatterns = uniq(files.flatMap((item) => [...item.apiPatterns, ...(dependency.apiPatterns.get(item.path) ?? [])]));
    const confidence: ChangeImpactConfidence = dependentFiles.length > 0 || apiPatterns.length > 0 || relatedTests.length > 0 ? 'high' : files.some((item) => item.kind === 'docs' || item.kind === 'other') ? 'low' : 'medium';
    return {
      name,
      kinds,
      directFiles: files.map((item) => item.path),
      dependentFiles,
      relatedTests,
      apiPatterns,
      businessFlows: businessFlows(name, kinds, apiPatterns),
      risks: risks(kinds, dependentFiles.length),
      confidence
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  result.regressionTargets = result.modules
    .filter((module) => !module.kinds.every((kind) => kind === 'docs' || kind === 'test' || kind === 'other'))
    .map((module, index) => buildTarget(module, grouped.get(module.name) ?? [], index));
  result.status = result.limits.truncated ? 'partial' : 'analyzed';
  return result;
}

export function formatChangeImpactMarkdown(result: ChangeImpactResult): string {
  const fileLimit = 50;
  const moduleLimit = 30;
  const targetLimit = 30;
  const priorityRank: Record<RequirementPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const reportFiles = [...result.files].sort((left, right) => priorityRank[left.directRisk] - priorityRank[right.directRisk] || left.path.localeCompare(right.path));
  const reportTargets = [...result.regressionTargets].sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || left.module.localeCompare(right.module));
  const fileRows = reportFiles.slice(0, fileLimit).map((file) => `| ${file.status} | ${markdownEscape(file.path)} | ${file.module} | ${file.kind} | ${file.directRisk} | ${file.additions ?? '-'} | ${file.deletions ?? '-'} | ${markdownEscape(truncateMiddle(file.changedSymbols.slice(0, 5).join(', ') || '-', 260))} |`);
  if (result.files.length > fileRows.length) fileRows.push(`| - | 其余 ${result.files.length - fileRows.length} 个文件见 change-impact.json | - | - | - | - | - | 已省略 |`);
  const moduleRows = result.modules.slice(0, moduleLimit).map((module) => `| ${markdownEscape(module.name)} | ${module.kinds.join(', ')} | ${module.directFiles.length} | ${module.dependentFiles.length} | ${module.relatedTests.length} | ${module.confidence} | ${markdownEscape(truncateMiddle(module.businessFlows.slice(0, 5).join('；'), 400))} |`);
  if (result.modules.length > moduleRows.length) moduleRows.push(`| 其余 ${result.modules.length - moduleRows.length} 个模块见 change-impact.json | - | 0 | 0 | 0 | - | 已省略 |`);
  const targetRows = reportTargets.slice(0, targetLimit).map((target) => `| ${target.id} | ${target.priority} | ${target.layer} | ${markdownEscape(target.module)} | ${markdownEscape(truncateMiddle(target.title, 160))} | ${markdownEscape(truncateMiddle(target.reason, 350))} |`);
  if (result.regressionTargets.length > targetRows.length) targetRows.push(`| - | - | - | 其余 ${result.regressionTargets.length - targetRows.length} 个目标见 change-impact.json | 已省略 | - |`);
  return `# Git 变更影响与原业务回归范围

## 基线

- 状态：**${result.status}**
- 仓库：${markdownEscape(result.repositoryRoot ?? '-')}
- 基础分支：${markdownEscape(result.baseRef ?? '-')}（${result.baseRefSource ?? '-'}）
- 目标：${markdownEscape(result.headRef)}
- Merge Base：${result.mergeBase ?? '-'}
- 包含工作区：${result.workingTreeIncluded ? '是' : '否'}
- 变更文件/影响模块/回归目标：${result.changedFileCount}/${result.modules.length}/${result.regressionTargets.length}
- 有界截断：${result.limits.truncated ? '是' : '否'}

## 变更文件

| 状态 | 文件 | 模块 | 类型 | 风险 | + | - | 变更符号 |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
${fileRows.join('\n') || '| - | - | - | - | - | - | - | 无代码变更 |'}

## 影响模块与原有业务

| 模块 | 类型 | 直接文件 | 一至二跳引用 | 相关测试 | 置信度 | 需要回归的原有业务 |
| --- | --- | ---: | ---: | ---: | --- | --- |
${moduleRows.join('\n') || '| - | - | 0 | 0 | 0 | - | 无 |'}

## 定向回归目标

| ID | 优先级 | 层级 | 模块 | 回归目标 | 原因 |
| --- | --- | --- | --- | --- | --- |
${targetRows.join('\n') || '| - | - | - | - | 无 | - |'}

## 分析边界

${result.warnings.map((warning) => `- ${markdownEscape(warning)}`).join('\n') || '- 无额外警告。'}

> 静态影响分析用于选择回归范围，不代表原有业务已经通过；只有执行报告中的独立证据才能关闭回归目标。
`;
}
