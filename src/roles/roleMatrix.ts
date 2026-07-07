import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createDefaultConfig } from '../defaultConfig.js';
import { runQa } from '../runner.js';
import type { BrowserName, ComponentRecord, Issue, QaResult, ReportProfile, RoleMatrixResult, RoleMatrixRoleConfig } from '../types.js';
import { ensureDir, resolveOutputDir, writeJson, writeText } from '../utils/fs.js';
import { markdownEscape } from '../utils/text.js';

export interface RoleMatrixRunInput {
  url: string;
  outputDir?: string;
  configPath?: string;
  requirementsPath?: string;
  sourceRoot?: string;
  sourceRunScripts?: boolean;
  sourceScripts?: string[];
  sourceScriptTimeoutMs?: number;
  browser?: BrowserName;
  headless?: boolean;
  trace?: boolean;
  video?: boolean;
  screenshot?: boolean;
  reportProfile?: ReportProfile;
  simulateExceptions?: boolean;
  coverage?: boolean;
  ai?: boolean;
  blockMutatingRequests?: boolean;
  security?: boolean;
  journeys?: boolean;
  contract?: boolean;
  realtime?: boolean;
  p2?: boolean;
  roles: RoleMatrixRoleConfig[];
}

export interface RoleMatrixCollectedRun {
  role: RoleMatrixRoleConfig;
  result?: QaResult;
  error?: string;
  outputDir: string;
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolveOutputDir(path.join(createDefaultConfig().report.outputDir, '..', 'frontlens-role-matrix', stamp));
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'role';
}

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function componentLabel(component: ComponentRecord): string | undefined {
  return normalizeText(component.label ?? component.text ?? component.attributes['aria-label'] ?? component.attributes.title ?? component.placeholder);
}

function actionLabels(result: QaResult): string[] {
  const labels = result.pageModel.buttons.map(componentLabel).filter((item): item is string => Boolean(item));
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
}

const dangerousActionPattern = /删除|移除|禁用|停用|启用|保存|提交|创建|新增|编辑|授权|审批|发布|导出|下载|上传|delete|remove|disable|enable|save|submit|create|add|edit|authorize|approve|publish|export|download|upload/i;
const lowPrivilegeRolePattern = /guest|anon|anonymous|visitor|viewer|readonly|read-only|read_only|normal|user|member|普通|访客|游客|只读|观察|成员/i;

function dangerousActionLabels(labels: string[]): string[] {
  return labels.filter((label) => dangerousActionPattern.test(label));
}

function issueIdentity(issue: Issue): string {
  return issue.fingerprint || `${issue.category}:${issue.title}`;
}

function issueTitleMap(result: QaResult): Map<string, string> {
  return new Map(result.issues.map((issue) => [issueIdentity(issue), issue.title]));
}

function sharedValues(valuesByRole: Record<string, string[]>): string[] {
  const entries = Object.values(valuesByRole);
  if (entries.length === 0) return [];
  const [first, ...rest] = entries.map((items) => new Set(items));
  return [...first].filter((value) => rest.every((set) => set.has(value))).sort((a, b) => a.localeCompare(b));
}

function roleSpecific(valuesByRole: Record<string, string[]>): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const [role, values] of Object.entries(valuesByRole)) {
    output[role] = values.filter((value) => Object.entries(valuesByRole).every(([otherRole, otherValues]) => otherRole === role || !otherValues.includes(value))).sort((a, b) => a.localeCompare(b));
  }
  return output;
}

function expectedTextGaps(role: RoleMatrixRoleConfig, result: QaResult): { allowedMissing: string[]; forbiddenVisible: string[] } {
  const body = [result.pageModel.stats.bodyTextSample, ...result.pageModel.components.map((component) => `${component.label ?? ''} ${component.text ?? ''}`)].join(' ');
  const allowedMissing = (role.expectedAllowedTexts ?? []).filter((text) => !body.includes(text));
  const forbiddenVisible = (role.expectedForbiddenTexts ?? []).filter((text) => body.includes(text));
  return { allowedMissing, forbiddenVisible };
}

function recommendations(result: RoleMatrixResult): string[] {
  const items: string[] = [];
  if (result.roles.length < 2) items.push('Role matrix has fewer than two roles; add admin/normal/readonly/anonymous storage states before permission sign-off.');
  if (result.comparison.failedRoleCount > 0) items.push('Some role runs failed; verify storageState freshness, login redirects, and role-specific test data before interpreting differences.');
  if (result.comparison.lowPrivilegeDangerousActionRoles.length > 0) items.push('Low-privilege roles expose dangerous action labels. Treat as a permission review candidate until PRD/source/runtime confirms whether those actions are actually allowed or disabled.');
  if (result.comparison.permissionRiskCount > 0) items.push('Expected forbidden/allowed text checks found role contract violations or gaps; inspect the role-specific reports and source permission guards.');
  if (result.comparison.authRiskCount > 0) items.push('Auth/API permission findings differ by role; stale login state or backend permission policy may be involved.');
  const roleSpecificHigh = result.roles.some((role) => (role.criticalCount ?? 0) + (role.highCount ?? 0) > 0);
  if (roleSpecificHigh) items.push('At least one role has Critical/High issues; prioritize role-specific blockers before declaring business validation runtime-verified.');
  if (items.length === 0) items.push('No obvious role-matrix risk detected. Still map differences to explicit permission requirements before release sign-off.');
  return [...new Set(items)];
}

function itemFromRun(run: RoleMatrixCollectedRun): RoleMatrixResult['roles'][number] {
  const role = run.role;
  if (!run.result) {
    return {
      role: role.name,
      success: false,
      outputDir: run.outputDir,
      storageStateProvided: Boolean(role.storageState),
      sessionStorageStateProvided: Boolean(role.sessionStorageState),
      error: run.error
    };
  }
  const labels = actionLabels(run.result);
  const permissionIssueCount = run.result.issues.filter((issue) => issue.category === 'frontend-permission' || issue.category === 'backend-api-auth').length;
  const authIssueCount = run.result.issues.filter((issue) => issue.category === 'backend-api-auth' || /401|403|unauthorized|forbidden|未登录|无权限/i.test(`${issue.title} ${issue.description}`)).length;
  const gaps = expectedTextGaps(role, run.result);
  return {
    role: role.name,
    success: true,
    outputDir: run.outputDir,
    storageStateProvided: Boolean(role.storageState),
    sessionStorageStateProvided: Boolean(role.sessionStorageState),
    score: run.result.summary.score,
    adjustedScore: run.result.summary.adjustedScore,
    issueCount: run.result.summary.issueCount,
    adjustedIssueCount: run.result.summary.adjustedIssueCount,
    criticalCount: run.result.summary.criticalCount,
    highCount: run.result.summary.highCount,
    mediumCount: run.result.summary.mediumCount,
    lowCount: run.result.summary.lowCount,
    infoCount: run.result.summary.infoCount,
    qaSignoffStatus: run.result.qaSignoff.status,
    qaSignoffConfidence: run.result.qaSignoff.confidence,
    businessValidationConfidence: run.result.qaSignoff.businessValidationConfidence,
    title: run.result.summary.title,
    finalUrl: run.result.environment.finalUrl,
    componentCount: run.result.pageModel.components.length,
    actionLabels: labels,
    dangerousActionLabels: dangerousActionLabels(labels),
    permissionIssueCount,
    authIssueCount,
    expectedAllowedMissing: gaps.allowedMissing,
    expectedForbiddenVisible: gaps.forbiddenVisible,
    screenshot: run.result.artifacts.screenshot,
    jsonReport: run.result.artifacts.jsonReport,
    markdownReport: run.result.artifacts.markdownReport,
    qaReview: run.result.artifacts.qaReview
  };
}

export function createRoleMatrixResult(runs: RoleMatrixCollectedRun[], url: string, outputDir: string): RoleMatrixResult {
  const items = runs.map(itemFromRun);
  const successful = runs.filter((run): run is RoleMatrixCollectedRun & { result: QaResult } => Boolean(run.result));
  const issueTitlesByRole: Record<string, string[]> = {};
  const issueIdsByRole: Record<string, string[]> = {};
  const actionLabelsByRole: Record<string, string[]> = {};
  const dangerousByRole: Record<string, string[]> = {};
  const forbiddenViolations: Record<string, string[]> = {};
  const allowedGaps: Record<string, string[]> = {};

  for (const run of successful) {
    const map = issueTitleMap(run.result);
    issueIdsByRole[run.role.name] = [...map.keys()];
    issueTitlesByRole[run.role.name] = [...map.values()];
    const labels = actionLabels(run.result);
    actionLabelsByRole[run.role.name] = labels;
    const dangerous = dangerousActionLabels(labels);
    if (dangerous.length) dangerousByRole[run.role.name] = dangerous;
    const gaps = expectedTextGaps(run.role, run.result);
    if (gaps.forbiddenVisible.length) forbiddenViolations[run.role.name] = gaps.forbiddenVisible;
    if (gaps.allowedMissing.length) allowedGaps[run.role.name] = gaps.allowedMissing;
  }

  const sharedIssueIds = sharedValues(issueIdsByRole);
  const issueTitleById = new Map(successful.flatMap((run) => [...issueTitleMap(run.result).entries()]));
  const lowPrivilegeDangerousActionRoles = Object.entries(dangerousByRole).filter(([role]) => lowPrivilegeRolePattern.test(role)).map(([role]) => role);
  const comparison: RoleMatrixResult['comparison'] = {
    successfulRoleCount: items.filter((item) => item.success).length,
    failedRoleCount: items.filter((item) => !item.success).length,
    roleSpecificIssueTitles: Object.fromEntries(Object.entries(roleSpecific(issueIdsByRole)).map(([role, ids]) => [role, ids.map((id) => issueTitleById.get(id) ?? id)])),
    sharedIssueTitles: sharedIssueIds.map((id) => issueTitleById.get(id) ?? id),
    roleSpecificActionLabels: roleSpecific(actionLabelsByRole),
    sharedActionLabels: sharedValues(actionLabelsByRole),
    dangerousActionsByRole: dangerousByRole,
    lowPrivilegeDangerousActionRoles,
    expectedForbiddenViolations: forbiddenViolations,
    expectedAllowedGaps: allowedGaps,
    permissionRiskCount: Object.values(forbiddenViolations).reduce((sum, values) => sum + values.length, 0) + Object.values(allowedGaps).reduce((sum, values) => sum + values.length, 0) + lowPrivilegeDangerousActionRoles.length,
    authRiskCount: items.reduce((sum, item) => sum + (item.authIssueCount ?? 0), 0)
  };
  const result: RoleMatrixResult = {
    url,
    testedAt: new Date().toISOString(),
    outputDir,
    roles: items,
    comparison,
    recommendations: [],
    artifacts: {
      json: path.join(outputDir, 'role-matrix.json'),
      markdown: path.join(outputDir, 'role-matrix.md')
    }
  };
  result.recommendations = recommendations(result);
  return result;
}

function markdown(result: RoleMatrixResult): string {
  const roleRows = result.roles.map((role) => `| ${markdownEscape(role.role)} | ${role.success ? 'success' : 'failed'} | ${role.adjustedScore ?? '-'} | ${role.score ?? '-'} | ${role.adjustedIssueCount ?? '-'} | ${role.issueCount ?? '-'} | ${role.qaSignoffStatus ?? '-'} | ${role.permissionIssueCount ?? '-'} | ${(role.dangerousActionLabels ?? []).map(markdownEscape).join(', ') || '-'} | ${role.markdownReport ? `\`${markdownEscape(role.markdownReport)}\`` : '-'} | ${markdownEscape(role.error ?? '-')} |`);
  const actionRows = Object.entries(result.comparison.roleSpecificActionLabels).flatMap(([role, labels]) => labels.map((label) => `| ${markdownEscape(role)} | ${markdownEscape(label)} |`));
  const issueRows = Object.entries(result.comparison.roleSpecificIssueTitles).flatMap(([role, titles]) => titles.map((title) => `| ${markdownEscape(role)} | ${markdownEscape(title)} |`));
  const violationRows = [
    ...Object.entries(result.comparison.expectedForbiddenViolations).flatMap(([role, texts]) => texts.map((text) => `| forbidden-visible | ${markdownEscape(role)} | ${markdownEscape(text)} |`)),
    ...Object.entries(result.comparison.expectedAllowedGaps).flatMap(([role, texts]) => texts.map((text) => `| allowed-missing | ${markdownEscape(role)} | ${markdownEscape(text)} |`))
  ];
  return `# FrontLens Role Matrix Report

This report compares the same page across auth roles. Differences are permission-review evidence; they become defects only when mapped to explicit permission requirements or source/runtime proof.

- URL: ${markdownEscape(result.url)}
- Tested at: ${result.testedAt}
- Successful / failed roles: ${result.comparison.successfulRoleCount} / ${result.comparison.failedRoleCount}
- Permission risk candidates: ${result.comparison.permissionRiskCount}
- Auth/API risk findings: ${result.comparison.authRiskCount}

## Recommendations

${result.recommendations.map((item) => `- ${markdownEscape(item)}`).join('\n')}

## Role Runs

| Role | Status | Adjusted score | Raw score | Actionable issues | Raw issues | QA sign-off | Permission/Auth issues | Dangerous action labels | Report | Error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${roleRows.join('\n')}

## Role-specific Actions

${actionRows.length ? ['| Role | Action label |', '| --- | --- |', ...actionRows].join('\n') : 'No role-specific action labels detected.'}

## Role-specific Issues

${issueRows.length ? ['| Role | Issue title |', '| --- | --- |', ...issueRows].join('\n') : 'No role-specific issues detected.'}

## Expected Permission Contract Gaps

${violationRows.length ? ['| Type | Role | Text |', '| --- | --- | --- |', ...violationRows].join('\n') : 'No expected allowed/forbidden text gaps configured or detected.'}

## Shared Action Labels

${result.comparison.sharedActionLabels.length ? result.comparison.sharedActionLabels.map((item) => `- ${markdownEscape(item)}`).join('\n') : '- None.'}
`;
}

export async function writeRoleMatrixResult(result: RoleMatrixResult): Promise<RoleMatrixResult> {
  await ensureDir(result.outputDir);
  await writeJson(result.artifacts.json, result);
  await writeText(result.artifacts.markdown, markdown(result));
  return result;
}

export async function runRoleMatrix(input: RoleMatrixRunInput): Promise<RoleMatrixResult> {
  if (!input.roles.length) {
    throw new Error('Role matrix requires at least one role.');
  }
  const outputDir = input.outputDir ? resolveOutputDir(input.outputDir) : defaultOutputDir();
  await ensureDir(outputDir);
  const runs: RoleMatrixCollectedRun[] = [];
  for (const role of input.roles) {
    const roleOutput = path.join(outputDir, sanitizeName(role.name));
    try {
      const result = await runQa({
        url: input.url,
        configPath: input.configPath,
        requirementsPath: input.requirementsPath,
        sourceRoot: input.sourceRoot,
        sourceRunScripts: input.sourceRunScripts,
        sourceScripts: input.sourceScripts,
        sourceScriptTimeoutMs: input.sourceScriptTimeoutMs,
        outputDir: roleOutput,
        browser: input.browser,
        headless: input.headless,
        storageState: role.storageState,
        sessionStorageState: role.sessionStorageState,
        trace: input.trace ?? false,
        video: input.video,
        screenshot: input.screenshot,
        reportProfile: input.reportProfile,
        simulateExceptions: input.simulateExceptions,
        coverage: input.coverage,
        ai: input.ai,
        blockMutatingRequests: input.blockMutatingRequests,
        security: input.security,
        journeys: input.journeys,
        contract: input.contract,
        realtime: input.realtime,
        p2: input.p2
      });
      runs.push({ role, result, outputDir: roleOutput });
    } catch (error) {
      runs.push({ role, outputDir: roleOutput, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return writeRoleMatrixResult(createRoleMatrixResult(runs, input.url, outputDir));
}

export async function loadRoleMatrixRoles(filePath: string): Promise<RoleMatrixRoleConfig[]> {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const parsed = JSON.parse(await readFile(absolute, 'utf8')) as unknown;
  const raw = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { roles?: unknown }).roles) ? (parsed as { roles: unknown[] }).roles : undefined;
  if (!raw) throw new Error('Role matrix file must be an array or an object with roles[].');
  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`roles[${index}] must be an object.`);
    const role = item as Record<string, unknown>;
    if (typeof role.name !== 'string' || !role.name.trim()) throw new Error(`roles[${index}].name is required.`);
    const stringArray = (key: string): string[] | undefined => {
      const value = role[key];
      if (value === undefined) return undefined;
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) throw new Error(`roles[${index}].${key} must be an array of strings.`);
      return value;
    };
    return {
      name: role.name.trim(),
      storageState: typeof role.storageState === 'string' && role.storageState.trim() ? role.storageState : undefined,
      sessionStorageState: typeof role.sessionStorageState === 'string' && role.sessionStorageState.trim() ? role.sessionStorageState : undefined,
      expectedAllowedTexts: stringArray('expectedAllowedTexts'),
      expectedForbiddenTexts: stringArray('expectedForbiddenTexts')
    };
  });
}

export function parseRoleSpec(spec: string): RoleMatrixRoleConfig {
  const separator = spec.indexOf('=');
  if (separator === -1) {
    return { name: spec.trim() };
  }
  const name = spec.slice(0, separator).trim();
  const value = spec.slice(separator + 1).trim();
  if (!name) throw new Error(`Invalid role spec ${JSON.stringify(spec)}: role name is empty.`);
  const [storageState, sessionStorageState] = value.split('|').map((part) => part.trim());
  return {
    name,
    storageState: storageState || undefined,
    sessionStorageState: sessionStorageState || undefined
  };
}
