import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { InteractionTestKind, RequirementConfigItem, RequirementPriority, RequirementWizardCandidate, RequirementWizardResult } from '../types.js';
import { ensureDir, writeJson, writeText } from '../utils/fs.js';
import { markdownEscape } from '../utils/text.js';

export interface RequirementWizardInput {
  text?: string;
  inputPath?: string;
  outputPath?: string;
  inferFromPage?: boolean;
  prefix?: string;
}

function normalizeLine(value: string): string {
  return value
    .replace(/^\s{0,4}(?:[-*+]|\d+[.)]|#{1,6})\s+/, '')
    .replace(/^\s*[-–—]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitRequirementText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized
    .split('\n')
    .filter((line) => !/^\s*#{1,6}\s+/.test(line) && !/^\s*```/.test(line))
    .map(normalizeLine)
    .filter((line) => line.length >= 4 && !/^(需求|功能需求|非功能需求|验收标准|业务规则|背景|说明|备注|范围|目标)[:：]?$/i.test(line));
  const candidates: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[。.!?；;])\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts.length ? parts : [line]) {
      if (/^(背景|说明|备注|note|background)[:：]?$/i.test(part)) continue;
      candidates.push(part.replace(/[。.;；]+$/g, '').trim());
    }
  }
  return [...new Set(candidates)].slice(0, 80);
}

function priorityOf(text: string): RequirementPriority {
  const explicit = text.match(/\bP([0-3])\b/i);
  if (explicit) return `P${explicit[1]}` as RequirementPriority;
  if (/阻断|发布阻断|核心|关键功能|关键路径|critical/i.test(text)) return 'P0';
  // RFC/PRD-style MUST/“必须” expresses normativity, not automatically release-blocking impact.
  if (/必须|must|shall|应该|需要|required|high/i.test(text)) return 'P1';
  if (/可选|建议|优化|nice|optional|could/i.test(text)) return 'P3';
  if (/一般|普通|medium/i.test(text)) return 'P2';
  return 'P2';
}

function inferInteractionKinds(text: string): InteractionTestKind[] {
  const kinds = new Set<InteractionTestKind>();
  if (/搜索|查询|筛选|过滤|search|filter|query/i.test(text)) kinds.add('search');
  if (/重置|清空|reset|clear/i.test(text)) kinds.add('reset');
  if (/分页|翻页|上一页|下一页|page|pagination/i.test(text)) kinds.add('pagination');
  if (/弹窗|抽屉|dialog|modal|drawer/i.test(text)) kinds.add('dialog');
  if (/tab|标签页|页签/i.test(text)) kinds.add('tab');
  if (/排序|sort/i.test(text)) kinds.add('table-sort');
  if (/选择|勾选|批量|selection|select/i.test(text)) kinds.add('table-selection');
  if (/刷新|reload|refresh/i.test(text)) kinds.add('refresh');
  if (/下载|导出|download|export/i.test(text)) kinds.add('download');
  if (/上传|导入|upload|import/i.test(text)) kinds.add('upload');
  if (/表单|校验|必填|提交|保存|输入|验证|form|validation|required|submit|save/i.test(text)) kinds.add('form-validation');
  return [...kinds];
}

function inferApiPatterns(text: string): string[] {
  const patterns = new Set<string>();
  for (const match of text.matchAll(/(?:(\bGET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/api\/[^\s，。,;；)）\]`'"<>]+|\/v\d+\/[^\s，。,;；)）\]`'"<>]+)/gi)) {
    const method = match[1]?.toUpperCase();
    patterns.add(method ? `${method} ${match[2]}` : match[2]);
  }
  for (const match of text.matchAll(/接口[:：]?\s*([\w/-]+(?:\/[\w{}:-]+)+)/g)) {
    const value = match[1].startsWith('/') ? match[1] : `/${match[1]}`;
    patterns.add(value);
  }
  return [...patterns].slice(0, 6);
}

function inferSelectors(text: string): string[] {
  const selectors = new Set<string>();
  for (const match of text.matchAll(/\b(?:css=)?(\[[\w-]+=["'][^"']+["']\]|#[\w-]+|\.[\w-]+|\[data-testid=["'][^"']+["']\])/g)) {
    const raw = match[0];
    selectors.add(raw.startsWith('css=') ? raw : `css=${raw}`);
  }
  return [...selectors].slice(0, 8);
}

function inferExpectedTexts(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/[「“"]([^「」“”"]{2,40})[」”"]/g)) values.add(match[1].trim());
  for (const match of text.matchAll(/(?:显示|提示|出现|看到|展示|文案为|toast)[:：]?\s*([^，。,;；]{2,24})/g)) {
    const raw = match[1].trim();
    const quoted = raw.match(/[「“"]([^「」“”"]{2,40})[」”"]/);
    if (quoted) {
      values.add(quoted[1].trim());
      continue;
    }
    const value = raw
      .replace(/^(应|应该|需要|可以|为|是)/, '')
      .replace(/(?:并|且|同时|然后|后|时).*/, '')
      .trim();
    if (value && !/[点击输入选择接口/「」“”"]/.test(value)) values.add(value);
  }
  return [...values].slice(0, 8);
}

function inferRoles(text: string): string[] {
  const roles = new Set<string>();
  const known = ['普通用户', '管理员', '操作员', '审核员', '访客', '游客', 'admin', 'viewer', 'operator', 'auditor', 'guest'];
  for (const role of known) if (new RegExp(role, 'i').test(text)) roles.add(role);
  const withoutPriority = text.replace(/^\s*P[0-3]\s*/i, '');
  if (/^(用户|user)\s*(?:必须|应|可以|可|不能|不得|只|需要|must|shall|can|cannot)/i.test(withoutPriority) && !roles.has('普通用户')) roles.add(/^user/i.test(withoutPriority) ? 'user' : '用户');
  for (const match of text.matchAll(/(?:角色|用户类型)[:：]\s*([\w\u4e00-\u9fff-]{2,20})/g)) roles.add(match[1]);
  return [...roles];
}

function inferPreconditions(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/(?:前提|前置条件|在|当)([^，。,；;]{2,50})(?:时|后|情况下)[，,]?/g)) {
    values.push(match[1].trim());
  }
  if (/登录后|已登录/.test(text)) values.push('用户已登录');
  if (/未登录|登录失效|会话失效/.test(text)) values.push('用户未登录或会话已失效');
  return [...new Set(values)];
}

function inferBusinessRules(text: string): string[] {
  if (/必须|不得|不能|仅|只能|至少|最多|上限|下限|连续|唯一|必填|禁止|must|shall|required/i.test(text)) return [text];
  return [];
}

function inferAcceptanceCriteria(text: string): string[] {
  const values = new Set<string>();
  if (/应|必须|可以|成功|失败|显示|返回|保存|创建|更新|删除|导出|上传|下载|shall|must|should/i.test(text)) values.add(text);
  for (const expected of inferExpectedTexts(text)) values.add(`界面显示「${expected}」`);
  return [...values];
}

function inferStateTransitions(text: string): string[] {
  const values = new Set<string>();
  for (const match of text.matchAll(/([\w\u4e00-\u9fff]{1,20})\s*(?:->|→|变为|变成|转为|转换为)\s*([\w\u4e00-\u9fff]{1,20})/g)) {
    values.add(`${match[1]} -> ${match[2]}`);
  }
  if (/提交/.test(text)) values.add('提交前 -> 提交后');
  if (/审核|审批/.test(text)) values.add('待审核 -> 审核结果');
  if (/删除/.test(text) && !/(?:不能|不得|禁止|无权|不允许|不可)[^，。,；;]{0,16}删除/.test(text)) values.add('存在 -> 已删除');
  return [...values];
}

function inferScopes(text: string, apiPatterns: string[]): { frontendScope: string[]; backendScope: string[]; apiScope: string[]; sourceScope: string[] } {
  const frontendScope: string[] = [];
  const backendScope: string[] = [];
  const apiScope: string[] = [];
  const sourceScope: string[] = [];
  if (/页面|按钮|输入|选择|表单|弹窗|提示|显示|隐藏|跳转|刷新|列表|搜索|筛选|上传|下载|前端|UI|toast/i.test(text)) frontendScope.push(text);
  if (/数据|保存|创建|更新|删除|校验|权限|并发|事务|幂等|数据库|后端|服务|上传|导入/i.test(text)) backendScope.push(text);
  if (apiPatterns.length || /接口|请求|响应|状态码|错误码|API|上传|导入/i.test(text)) apiScope.push(...(apiPatterns.length ? apiPatterns : [text]));
  if (/代码|组件|函数|模块|单元测试|集成测试|lint|typecheck|source/i.test(text)) sourceScope.push(text);
  // Every business requirement needs implementation-side verification even when the PRD omits file names.
  if (sourceScope.length === 0) sourceScope.push('检查与该需求对应的实现分支、错误处理和自动化测试。');
  return { frontendScope, backendScope, apiScope, sourceScope };
}

function inferAmbiguities(text: string): string[] {
  const values: string[] = [];
  if (/适当|合理|尽快|友好|正常|等|相关|必要时|视情况|可能|大概/.test(text)) values.push('存在不可量化表述，需要补充明确验收标准。');
  if (/支持|处理/.test(text) && !/显示|返回|保存|创建|更新|删除|成功|失败|允许|禁止/.test(text)) values.push('仅描述能力，缺少可观察的成功结果。');
  return values;
}

function titleOf(text: string): string {
  return text
    .replace(/^P[0-3]\s+/i, '')
    .replace(/^(用户|管理员|操作员|当|如果|在|进入|打开)\s*/i, '')
    .replace(/^(系统|页面)应(该)?/, '')
    .slice(0, 80)
    .trim() || text.slice(0, 80).trim();
}

function confidenceOf(item: RequirementConfigItem): RequirementWizardCandidate['confidence'] {
  const signals = Number((item.selectors?.length ?? 0) > 0) + Number((item.expectedTexts?.length ?? 0) > 0) + Number((item.apiPatterns?.length ?? 0) > 0) + Number((item.interactionKinds?.length ?? 0) > 0);
  if (signals >= 2) return 'high';
  if (signals === 1) return 'medium';
  return 'low';
}

function makeId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(3, '0')}`;
}

function candidateFromText(text: string, index: number, prefix: string): RequirementWizardCandidate {
  const selectors = inferSelectors(text);
  const expectedTexts = inferExpectedTexts(text);
  const apiPatterns = inferApiPatterns(text);
  const interactionKinds = inferInteractionKinds(text);
  const roles = inferRoles(text);
  const preconditions = inferPreconditions(text);
  const businessRules = inferBusinessRules(text);
  const acceptanceCriteria = inferAcceptanceCriteria(text);
  const stateTransitions = inferStateTransitions(text);
  const scopes = inferScopes(text, apiPatterns);
  const ambiguities = inferAmbiguities(text);
  const item: RequirementConfigItem = {
    id: makeId(prefix, index),
    title: titleOf(text),
    description: text,
    priority: priorityOf(text),
    source: 'provided',
    selectors: selectors.length ? selectors : undefined,
    expectedTexts: expectedTexts.length ? expectedTexts : undefined,
    apiPatterns: apiPatterns.length ? apiPatterns : undefined,
    interactionKinds: interactionKinds.length ? interactionKinds : undefined,
    roles: roles.length ? roles : undefined,
    preconditions: preconditions.length ? preconditions : undefined,
    businessRules: businessRules.length ? businessRules : undefined,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : undefined,
    stateTransitions: stateTransitions.length ? stateTransitions : undefined,
    frontendScope: scopes.frontendScope.length ? scopes.frontendScope : undefined,
    backendScope: scopes.backendScope.length ? scopes.backendScope : undefined,
    apiScope: scopes.apiScope.length ? scopes.apiScope : undefined,
    sourceScope: scopes.sourceScope,
    ambiguities: ambiguities.length ? ambiguities : undefined,
    sourceRefs: [`requirement-text:${index + 1}`]
  };
  const confidence = confidenceOf(item);
  const reviewNotes: string[] = [];
  if (confidence === 'low') reviewNotes.push('仅提取到自由文本需求，缺少 selector、expectedTexts、apiPatterns 或 interactionKinds；不能直接证明业务通过。');
  if (/新增|创建|编辑|删除|提交|保存|上传|导入|导出|下载|create|edit|delete|submit|save|upload|export|download/i.test(text)) reviewNotes.push('涉及可能产生副作用或下载的流程，默认 QA 会保持非破坏，需要明确授权和测试数据。');
  if (/权限|角色|管理员|普通用户|viewer|admin|operator/i.test(text)) reviewNotes.push('涉及角色/权限，需要提供对应 storageState/sessionStorageState 角色矩阵。');
  if (/接口|数据|列表|准确|一致|金额|数量|统计|指标/i.test(text) && apiPatterns.length === 0) reviewNotes.push('涉及数据/API 正确性，但未提取到接口模式；建议补 apiPatterns 或业务断言。');
  if (ambiguities.length) reviewNotes.push(...ambiguities);
  const rationale = [
    selectors.length ? `selectors:${selectors.join(',')}` : '',
    expectedTexts.length ? `expectedTexts:${expectedTexts.join(',')}` : '',
    apiPatterns.length ? `apiPatterns:${apiPatterns.join(',')}` : '',
    interactionKinds.length ? `interactionKinds:${interactionKinds.join(',')}` : ''
  ].filter(Boolean);
  return {
    ...item,
    confidence,
    sourceText: text,
    rationale,
    needsReview: reviewNotes.length > 0 || confidence !== 'high',
    reviewNotes
  };
}

function buildQuestions(candidates: RequirementWizardCandidate[]): string[] {
  const questions = new Set<string>();
  if (candidates.some((item) => item.confidence === 'low')) questions.add('哪些低置信需求可以补充 selector、期望文案、接口路径或明确 journeySteps？');
  if (candidates.some((item) => /新增|创建|编辑|删除|提交|保存|上传|导入|导出|下载|create|edit|delete|submit|save|upload|export|download/i.test(item.sourceText))) questions.add('哪些创建/编辑/删除/上传/下载流程允许在测试环境执行？测试数据如何准备和清理？');
  if (candidates.some((item) => /权限|角色|admin|viewer|operator|管理员/i.test(item.sourceText))) questions.add('需要覆盖哪些角色？是否已准备每个角色的 storageState/sessionStorageState？');
  if (candidates.some((item) => /移动|手机|响应式|mobile|responsive/i.test(item.sourceText))) questions.add('移动端/响应式是发布阻断范围，还是 PC-first 降级适配？');
  questions.add('这些草案需求是否都属于当前页面/版本范围，是否有可选或 out-of-scope 项需要写入 productContext？');
  return [...questions];
}

function markdown(result: RequirementWizardResult): string {
  const rows = result.candidates.map((item) => `| ${item.id} | ${item.priority} | ${item.confidence} | ${item.needsReview ? 'yes' : 'no'} | ${markdownEscape(item.title)} | ${markdownEscape([...(item.selectors ?? []), ...(item.expectedTexts ?? []), ...(item.apiPatterns ?? []), ...(item.interactionKinds ?? [])].join(', ') || '-')} |`);
  return `# FrontLens Requirements Wizard\n\n- Generated at: ${result.generatedAt}\n- Input: ${result.inputPath ? markdownEscape(result.inputPath) : 'inline text'}\n- Requirements: ${result.requirementCount}\n- Executable assertions/signals: ${result.executableAssertionCount}\n- Needs review: ${result.needsReviewCount}\n\n## Candidates\n\n${rows.length ? ['| ID | Priority | Confidence | Review | Title | Signals |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No candidates.'}\n\n## Warnings\n\n${result.warnings.map((item) => `- ${markdownEscape(item)}`).join('\n') || '- None.'}\n\n## Questions\n\n${result.questions.map((item) => `- ${markdownEscape(item)}`).join('\n') || '- None.'}\n`;
}

export async function synthesizeRequirements(input: RequirementWizardInput): Promise<RequirementWizardResult> {
  const text = input.text ?? (input.inputPath ? await readFile(input.inputPath, 'utf8') : '');
  const prefix = input.prefix?.trim() || 'REQ-DRAFT';
  const chunks = splitRequirementText(text);
  const candidates = chunks.map((chunk, index) => candidateFromText(chunk, index, prefix));
  const warnings = [
    'Generated requirements are drafts. Review before using them as release/blocking acceptance criteria.',
    'The wizard only creates safe read-only assertions/signals automatically; mutating journeys require explicit human authorization and journeySteps.'
  ];
  if (candidates.length === 0) warnings.push('No requirement-like text was detected. Provide bullet points, numbered acceptance criteria, or explicit expected UI/API behavior.');
  const result: RequirementWizardResult = {
    generatedAt: new Date().toISOString(),
    inputPath: input.inputPath,
    requirementCount: candidates.length,
    executableAssertionCount: candidates.filter((item) => (item.selectors?.length ?? 0) + (item.expectedTexts?.length ?? 0) + (item.apiPatterns?.length ?? 0) + (item.interactionKinds?.length ?? 0) > 0).length,
    needsReviewCount: candidates.filter((item) => item.needsReview).length,
    requirements: {
      enabled: true,
      inferFromPage: input.inferFromPage ?? true,
      items: candidates.map(({ confidence: _confidence, sourceText: _sourceText, rationale: _rationale, needsReview: _needsReview, reviewNotes: _reviewNotes, ...item }) => item)
    },
    candidates,
    warnings,
    questions: buildQuestions(candidates)
  };
  if (input.outputPath) {
    await ensureDir(path.dirname(input.outputPath));
    await writeJson(input.outputPath, result);
    await writeText(input.outputPath.replace(/\.json$/i, '.md'), markdown(result));
  }
  return result;
}

/** Bounded default response for agents. Use the full result only on explicit request. */
export function compactRequirementWizard(result: RequirementWizardResult): unknown {
  const requirementLimit = 20;
  const questionLimit = 10;
  return {
    generatedAt: result.generatedAt,
    inputPath: result.inputPath,
    requirementCount: result.requirementCount,
    executableAssertionCount: result.executableAssertionCount,
    needsReviewCount: result.needsReviewCount,
    candidatesSample: result.candidates.slice(0, requirementLimit).map((item) => ({
      id: item.id,
      title: item.title,
      priority: item.priority,
      confidence: item.confidence,
      needsReview: item.needsReview,
      signals: {
        selectorCount: item.selectors?.length ?? 0,
        expectedTextCount: item.expectedTexts?.length ?? 0,
        apiPatternCount: item.apiPatterns?.length ?? 0,
        interactionKindCount: item.interactionKinds?.length ?? 0
      }
    })),
    candidatesSampleTruncated: result.candidates.length > requirementLimit,
    warnings: result.warnings.slice(0, questionLimit),
    questionsSample: result.questions.slice(0, questionLimit),
    questionsSampleTruncated: result.questions.length > questionLimit,
    detailHint: 'Bounded summary. Use --json or detail=true only when the expanded requirement draft is required.'
  };
}
