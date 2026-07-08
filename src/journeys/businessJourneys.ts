import type {
  AssertionSuggestionItem,
  BusinessJourneyResult,
  BusinessJourneyScenario,
  JourneyAssertionAuditItem,
  JourneyStepConfig,
  JourneyStepResult,
  JourneyTestResult,
  QaResult,
  RequirementConfigItem,
  RequirementCoverageItem,
  RequirementPriority
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type BusinessJourneyInput = Pick<
  QaResult,
  | 'summary'
  | 'metadata'
  | 'pageModel'
  | 'network'
  | 'pageProfile'
  | 'requirementCoverage'
  | 'journeyTests'
  | 'journeyAssertionAudit'
  | 'assertionSuggestions'
  | 'testData'
>;

type ScenarioSeed = Omit<BusinessJourneyScenario, 'id' | 'preconditions' | 'actions' | 'assertions' | 'expectedOutcome' | 'roleNeeds' | 'testDataNeeds' | 'gaps' | 'evidenceRefs' | 'nextSteps' | 'networkRequestIds' | 'assertionSuggestionIds' | 'journeyIds' | 'requirementIds'> & {
  requirementIds?: string[];
  journeyIds?: string[];
  assertionSuggestionIds?: string[];
  networkRequestIds?: string[];
  preconditions?: string[];
  actions?: string[];
  assertions?: JourneyStepConfig[];
  expectedOutcome?: string[];
  roleNeeds?: string[];
  testDataNeeds?: string[];
  gaps?: string[];
  evidenceRefs?: string[];
  nextSteps?: string[];
};

const PRIORITY_ORDER: Record<RequirementPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const STATUS_ORDER: Record<BusinessJourneyScenario['status'], number> = { ready: 0, 'needs-input': 1, 'manual-required': 2 };
const MAX_SCENARIOS = 24;

function uniq(items: Array<string | undefined | null>): string[] {
  return [...new Set(items.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function textContainsAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

function isMutatingText(text: string): boolean {
  return textContainsAny(text, ['create', 'edit', 'delete', 'remove', 'upload', 'import', 'submit', 'save', 'export', 'download', '新增', '创建', '编辑', '删除', '上传', '导入', '提交', '保存', '导出', '下载']);
}

function isRoleSensitive(input: BusinessJourneyInput, text = ''): boolean {
  return input.pageProfile.pageType === 'credential-security'
    || input.pageProfile.pageType === 'auth-login'
    || textContainsAny(`${input.summary.title} ${input.pageModel.stats.bodyTextSample} ${text}`, ['credential', 'secret', 'token', 'password', 'permission', 'role', 'auth', 'login', 'admin', '凭证', '密钥', '令牌', '权限', '角色', '登录', '管理']);
}

function assertionFromSuggestion(item: AssertionSuggestionItem): JourneyStepConfig {
  return item.value === undefined
    ? { action: item.action, target: item.target, description: item.reason }
    : { action: item.action, target: item.target, value: item.value, description: item.reason };
}

function configRequirementById(input: BusinessJourneyInput): Map<string, RequirementConfigItem> {
  const map = new Map<string, RequirementConfigItem>();
  for (const item of input.metadata.config.requirements.items) {
    const id = item.id ?? item.title;
    map.set(id, item);
  }
  return map;
}

function configRequirementFor(map: Map<string, RequirementConfigItem>, requirement: RequirementCoverageItem): RequirementConfigItem | undefined {
  return map.get(requirement.id) ?? [...map.values()].find((item) => item.title === requirement.title);
}

function assertionStepsFromRequirement(config: RequirementConfigItem | undefined, requirement: RequirementCoverageItem, suggestions: AssertionSuggestionItem[]): JourneyStepConfig[] {
  const steps: JourneyStepConfig[] = [];
  for (const selector of uniq([...(config?.selectors ?? []), ...requirement.evidence.selectors]).slice(0, 4)) {
    steps.push({ action: 'expectVisible', target: selector, description: `Requirement ${requirement.id} selector must be visible.` });
  }
  for (const text of uniq(config?.expectedTexts ?? []).slice(0, 4)) {
    steps.push({ action: 'expectText', target: 'body', value: text, description: `Requirement ${requirement.id} expected text.` });
  }
  for (const pattern of uniq(config?.apiPatterns ?? []).slice(0, 4)) {
    steps.push({ action: 'expectRequest', target: pattern, value: '2xx', description: `Requirement ${requirement.id} expected API request.` });
  }
  for (const suggestion of suggestions.slice(0, 4)) steps.push(assertionFromSuggestion(suggestion));
  return dedupeAssertions(steps);
}

function dedupeAssertions(steps: JourneyStepConfig[]): JourneyStepConfig[] {
  const seen = new Set<string>();
  const result: JourneyStepConfig[] = [];
  for (const step of steps) {
    const key = `${step.action}:${step.target ?? ''}:${step.value ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(step);
  }
  return result;
}

function actionDescriptions(steps: Array<JourneyStepConfig | JourneyStepResult>): string[] {
  return steps
    .filter((step) => ['click', 'fill', 'press', 'select', 'check', 'uncheck', 'goto', 'waitForLoad'].includes(step.action))
    .map((step, index) => `${index + 1}. ${step.action}${step.target ? ` ${step.target}` : ''}${step.action === 'fill' ? ' <value>' : step.value ? ` ${step.value}` : ''}`)
    .slice(0, 12);
}

function scenarioStatus(assertions: JourneyStepConfig[], actions: string[], gaps: string[], runtimeQuality?: JourneyAssertionAuditItem['quality']): BusinessJourneyScenario['status'] {
  if (runtimeQuality === 'runtime-verified') return 'ready';
  if (assertions.length > 0 && actions.length > 0 && gaps.length === 0) return 'ready';
  if (assertions.length > 0 || actions.length > 0) return 'needs-input';
  return 'manual-required';
}

function confidenceFor(status: BusinessJourneyScenario['status'], assertions: JourneyStepConfig[], linkedRuntime = false): BusinessJourneyScenario['confidence'] {
  if (linkedRuntime || (status === 'ready' && assertions.length >= 2)) return 'high';
  if (assertions.length > 0 || status === 'needs-input') return 'medium';
  return 'low';
}

function addScenario(target: ScenarioSeed[], input: ScenarioSeed): void {
  target.push({
    ...input,
    requirementIds: uniq(input.requirementIds ?? []),
    journeyIds: uniq(input.journeyIds ?? []),
    assertionSuggestionIds: uniq(input.assertionSuggestionIds ?? []),
    networkRequestIds: uniq(input.networkRequestIds ?? []),
    preconditions: uniq(input.preconditions ?? []),
    actions: uniq(input.actions ?? []),
    assertions: dedupeAssertions(input.assertions ?? []),
    expectedOutcome: uniq(input.expectedOutcome ?? []),
    roleNeeds: uniq(input.roleNeeds ?? []),
    testDataNeeds: uniq(input.testDataNeeds ?? []),
    gaps: uniq(input.gaps ?? []),
    evidenceRefs: uniq(input.evidenceRefs ?? []),
    nextSteps: uniq(input.nextSteps ?? [])
  });
}

function auditByJourney(input: BusinessJourneyInput): Map<string, JourneyAssertionAuditItem> {
  return new Map(input.journeyAssertionAudit.items.map((item) => [item.journeyId, item]));
}

function suggestionsByRequirement(input: BusinessJourneyInput): Map<string, AssertionSuggestionItem[]> {
  const map = new Map<string, AssertionSuggestionItem[]>();
  for (const suggestion of input.assertionSuggestions.items) {
    if (!suggestion.requirementId) continue;
    map.set(suggestion.requirementId, [...(map.get(suggestion.requirementId) ?? []), suggestion]);
  }
  return map;
}

function suggestionsByJourney(input: BusinessJourneyInput): Map<string, AssertionSuggestionItem[]> {
  const map = new Map<string, AssertionSuggestionItem[]>();
  for (const suggestion of input.assertionSuggestions.items) {
    if (!suggestion.journeyId) continue;
    map.set(suggestion.journeyId, [...(map.get(suggestion.journeyId) ?? []), suggestion]);
  }
  return map;
}

function networkIdsFromAssertions(assertions: JourneyStepConfig[], input: BusinessJourneyInput): string[] {
  const patterns = assertions.filter((step) => step.action === 'expectRequest').map((step) => clean(step.target));
  if (patterns.length === 0) return [];
  return input.network.requests
    .filter((request) => patterns.some((pattern) => pattern && request.url.includes(pattern.replace(/\*/g, ''))))
    .map((request) => request.id)
    .slice(0, 8);
}

function buildRequirementScenarios(input: BusinessJourneyInput, seeds: ScenarioSeed[]): void {
  const configs = configRequirementById(input);
  const suggestionMap = suggestionsByRequirement(input);
  for (const requirement of input.requirementCoverage.items.filter((item) => item.source === 'provided').slice(0, 16)) {
    const config = configRequirementFor(configs, requirement);
    const suggestions = suggestionMap.get(requirement.id) ?? [];
    const configuredSteps = config?.journeySteps ?? [];
    const actions = actionDescriptions(configuredSteps);
    const assertions = assertionStepsFromRequirement(config, requirement, suggestions);
    const text = `${requirement.title} ${requirement.description ?? ''} ${configuredSteps.map((step) => `${step.action} ${step.target ?? ''}`).join(' ')}`;
    const gaps = uniq([
      ...requirement.gaps,
      assertions.length === 0 ? '缺少可执行 expectVisible/expectText/expectUrl/expectRequest 断言。' : undefined,
      actions.length === 0 ? '缺少业务动作步骤；只能验证当前页静态状态，不能证明完整业务流。' : undefined
    ]);
    const status = scenarioStatus(assertions, actions, gaps);
    const roleNeeds = isRoleSensitive(input, text) ? ['提供 admin/viewer/readonly 等角色 storageState 与允许/禁止动作期望。'] : [];
    const testDataNeeds = isMutatingText(text) && !input.testData.enabled ? ['提供隔离测试数据、setup/cleanup/rollback 规则后再执行写入/导入导出类路径。'] : [];
    addScenario(seeds, {
      title: `Requirement ${requirement.id}: ${requirement.title}`,
      source: 'requirement',
      priority: requirement.priority,
      status,
      confidence: confidenceFor(status, assertions),
      requirementIds: [requirement.id],
      journeyIds: requirement.evidence.journeyIds,
      assertionSuggestionIds: suggestions.map((item) => item.id),
      networkRequestIds: uniq([...requirement.evidence.networkRequestIds, ...networkIdsFromAssertions(assertions, input)]),
      preconditions: roleNeeds.length ? ['使用匹配角色登录态。'] : [],
      actions: actions.length ? actions : ['QA 补充真实业务动作步骤（点击/填写/提交/过滤/切换等）。'],
      assertions,
      expectedOutcome: uniq([requirement.title, ...(config?.expectedTexts ?? []).map((text) => `页面出现：${text}`)]),
      roleNeeds,
      testDataNeeds,
      gaps,
      evidenceRefs: uniq(['requirementCoverage', requirement.id, ...suggestions.map((item) => item.id)]),
      nextSteps: status === 'ready'
        ? ['把该场景作为核心回归路径复跑，并保留 DOM/Network/截图证据。']
        : ['在 qa-intake.config.json 中补齐 journeySteps/expectedTexts/apiPatterns 后 rerun。']
    });
  }
}

function buildJourneyScenarios(input: BusinessJourneyInput, seeds: ScenarioSeed[]): void {
  const audits = auditByJourney(input);
  const suggestions = suggestionsByJourney(input);
  for (const journey of input.journeyTests.slice(0, 16)) {
    if (journey.status === 'skipped') continue;
    const audit = audits.get(journey.id);
    const draftSuggestions = suggestions.get(journey.id) ?? [];
    const existingAssertions = journey.steps
      .filter((step) => step.action.startsWith('expect'))
      .map((step) => ({ action: step.action, target: step.target, value: step.value } as JourneyStepConfig));
    const assertions = dedupeAssertions([...existingAssertions, ...draftSuggestions.map(assertionFromSuggestion)]);
    const actions = actionDescriptions(journey.steps);
    const gaps = uniq([
      audit?.quality === 'runtime-verified' ? undefined : `当前 journey 质量为 ${audit?.quality ?? 'not-audited'}，不能直接作为业务通过证据。`,
      assertions.length === 0 ? '缺少业务成功断言。' : undefined,
      journey.status === 'failed' ? journey.issue ?? 'Journey failed.' : undefined
    ]);
    const status = scenarioStatus(assertions, actions, gaps, audit?.quality);
    const text = `${journey.name} ${journey.steps.map((step) => `${step.action} ${step.target ?? ''}`).join(' ')}`;
    addScenario(seeds, {
      title: `Journey ${journey.id}: ${journey.name}`,
      source: 'journey',
      priority: journey.requirementIds?.length ? 'P1' : 'P2',
      status,
      confidence: confidenceFor(status, assertions, audit?.quality === 'runtime-verified'),
      requirementIds: journey.requirementIds ?? [],
      journeyIds: [journey.id],
      assertionSuggestionIds: draftSuggestions.map((item) => item.id),
      networkRequestIds: uniq([...journey.steps.flatMap((step) => step.networkRequestIds ?? []), ...networkIdsFromAssertions(assertions, input)]),
      preconditions: journey.startUrl !== input.summary.url ? [`Start URL: ${journey.startUrl}`] : [],
      actions,
      assertions,
      expectedOutcome: audit?.quality === 'runtime-verified' ? ['已有 meaningful expect* 断言通过；可作为回归场景复用。'] : draftSuggestions.map((item) => item.reason),
      roleNeeds: isRoleSensitive(input, text) ? ['如该路径涉及权限/敏感操作，补 admin/viewer 角色矩阵后复跑。'] : [],
      testDataNeeds: isMutatingText(text) ? ['补测试数据生命周期，避免写生产或无法清理。'] : [],
      gaps,
      evidenceRefs: uniq(['journeyTests', journey.id, ...(audit ? ['journeyAssertionAudit'] : []), ...draftSuggestions.map((item) => item.id)]),
      nextSteps: status === 'ready'
        ? ['将该 runtime-verified journey 纳入回归矩阵。']
        : ['复制 assertionSuggestions 中的 expect* 到 journey 配置并 rerun。']
    });
  }
}

function buildOrphanSuggestionScenarios(input: BusinessJourneyInput, seeds: ScenarioSeed[]): void {
  const used = new Set(seeds.flatMap((seed) => seed.assertionSuggestionIds ?? []));
  for (const suggestion of input.assertionSuggestions.items.filter((item) => !used.has(item.id)).slice(0, 8)) {
    const assertion = assertionFromSuggestion(suggestion);
    addScenario(seeds, {
      title: `Assertion draft ${suggestion.id}: ${suggestion.action}`,
      source: 'assertion-suggestion',
      priority: suggestion.priority,
      status: 'needs-input',
      confidence: suggestion.confidence,
      requirementIds: suggestion.requirementId ? [suggestion.requirementId] : [],
      journeyIds: suggestion.journeyId ? [suggestion.journeyId] : [],
      assertionSuggestionIds: [suggestion.id],
      networkRequestIds: networkIdsFromAssertions([assertion], input),
      actions: ['把该断言绑定到具体业务动作后执行。'],
      assertions: [assertion],
      expectedOutcome: [suggestion.reason],
      gaps: ['这是断言草案，不是已执行 journey；需要绑定业务动作、角色和测试数据后 rerun。'],
      evidenceRefs: uniq([suggestion.id, ...suggestion.evidenceRefs]),
      nextSteps: [suggestion.exampleStep, ...suggestion.notes]
    });
  }
}

function buildFallbackScenario(input: BusinessJourneyInput, seeds: ScenarioSeed[]): void {
  if (seeds.length > 0) return;
  const text = clean(input.pageModel.title || input.summary.title || input.pageModel.stats.bodyTextSample.slice(0, 60));
  const assertions: JourneyStepConfig[] = text ? [{ action: 'expectText', target: 'body', value: text, description: 'Smoke assertion generated from page title/text; replace with business-specific success criteria.' }] : [];
  addScenario(seeds, {
    title: `Manual business journey discovery for ${input.summary.title || input.summary.url}`,
    source: 'page-model',
    priority: 'P2',
    status: 'manual-required',
    confidence: 'low',
    actions: ['录制真实主路径：搜索/筛选/查看详情/新建/编辑/删除/导入导出等，以 PRD 为准。'],
    assertions,
    expectedOutcome: ['补充 PRD 后把成功文本、稳定 selector、关键 API 请求写成 expect*。'],
    roleNeeds: isRoleSensitive(input) ? ['提供角色 storageState 后验证权限边界。'] : [],
    testDataNeeds: ['如路径包含写入/下载/导出，提供隔离测试数据与 cleanup。'],
    gaps: ['缺少 provided requirements 或可执行 journeys；不能宣称业务功能验证通过。'],
    evidenceRefs: ['pageModel', 'qaIntake', 'scopeReview'],
    nextSteps: ['运行 frontlens journey record 捕获人工路径，补 expect* 后 rerun。']
  });
}

function finalize(seeds: ScenarioSeed[]): BusinessJourneyScenario[] {
  const seen = new Set<string>();
  return seeds
    .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      || left.title.localeCompare(right.title))
    .filter((seed) => {
      const key = `${seed.source}:${(seed.requirementIds ?? []).join(',')}:${(seed.journeyIds ?? []).join(',')}:${seed.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SCENARIOS)
    .map((seed, index) => ({
      id: `BJ-${String(index + 1).padStart(3, '0')}`,
      ...seed,
      requirementIds: uniq(seed.requirementIds ?? []),
      journeyIds: uniq(seed.journeyIds ?? []),
      assertionSuggestionIds: uniq(seed.assertionSuggestionIds ?? []),
      networkRequestIds: uniq(seed.networkRequestIds ?? []),
      preconditions: uniq(seed.preconditions ?? []),
      actions: uniq(seed.actions ?? []),
      assertions: dedupeAssertions(seed.assertions ?? []),
      expectedOutcome: uniq(seed.expectedOutcome ?? []),
      roleNeeds: uniq(seed.roleNeeds ?? []),
      testDataNeeds: uniq(seed.testDataNeeds ?? []),
      gaps: uniq(seed.gaps ?? []),
      evidenceRefs: uniq(seed.evidenceRefs ?? []),
      nextSteps: uniq(seed.nextSteps ?? [])
    }));
}

export function buildBusinessJourneys(input: BusinessJourneyInput): BusinessJourneyResult {
  const seeds: ScenarioSeed[] = [];
  buildRequirementScenarios(input, seeds);
  buildJourneyScenarios(input, seeds);
  buildOrphanSuggestionScenarios(input, seeds);
  buildFallbackScenario(input, seeds);
  const scenarios = finalize(seeds);
  const readyCount = scenarios.filter((item) => item.status === 'ready').length;
  const needsInputCount = scenarios.filter((item) => item.status === 'needs-input').length;
  const manualRequiredCount = scenarios.filter((item) => item.status === 'manual-required').length;
  const assertionStepCount = scenarios.reduce((count, item) => count + item.assertions.length, 0);
  const apiAssertionCount = scenarios.reduce((count, item) => count + item.assertions.filter((step) => step.action === 'expectRequest').length, 0);
  const status: BusinessJourneyResult['status'] = scenarios.length === 0
    ? 'skipped'
    : readyCount > 0 && needsInputCount === 0 && manualRequiredCount === 0
      ? 'ready'
      : needsInputCount > 0
        ? 'needs-input'
        : manualRequiredCount > 0
          ? 'manual-required'
          : 'needs-input';
  return {
    generatedAt: new Date().toISOString(),
    status,
    targetUrl: input.summary.url,
    summary: {
      scenarioCount: scenarios.length,
      readyCount,
      needsInputCount,
      manualRequiredCount,
      requirementLinkedCount: scenarios.filter((item) => item.requirementIds.length > 0).length,
      runtimeVerifiedCount: scenarios.filter((item) => item.source === 'journey' && item.status === 'ready' && item.confidence === 'high').length,
      assertionStepCount,
      apiAssertionCount,
      roleNeedCount: scenarios.filter((item) => item.roleNeeds.length > 0).length,
      testDataNeedCount: scenarios.filter((item) => item.testDataNeeds.length > 0).length
    },
    scenarios,
    notes: [
      'Business journeys are a QA planning artifact: ready means enough reviewed actions/assertions exist to rerun, not that a newly generated scenario has passed.',
      'Use these scenarios to enrich requirements/journeys with expectVisible/expectText/expectUrl/expectRequest and rerun before claiming business validation.',
      'Role and test-data needs must be resolved before validating permission-sensitive or mutating flows.'
    ]
  };
}

function list(items: string[]): string {
  return items.length ? items.map((item) => `- ${markdownEscape(item)}`).join('<br>') : '-';
}

function stepText(step: JourneyStepConfig): string {
  const target = step.target ? ` ${step.target}` : '';
  const value = step.value ? ` = ${step.value}` : '';
  return `${step.action}${target}${value}`;
}

export function formatBusinessJourneys(result: BusinessJourneyResult): string {
  const rows = result.scenarios.map((item) => `| ${markdownEscape(item.id)} | ${item.priority} | ${markdownEscape(item.source)} | ${markdownEscape(item.status)} / ${markdownEscape(item.confidence)} | ${markdownEscape(truncateMiddle(item.title, 110))} | ${markdownEscape(item.requirementIds.join(', ') || '-')} | ${item.assertions.length} | ${markdownEscape(truncateMiddle(item.gaps[0] ?? item.nextSteps[0] ?? '-', 120))} |`);
  const detail = result.scenarios.slice(0, 12).map((item) => `### ${markdownEscape(item.id)} ${markdownEscape(item.title)}

- Source/status/confidence: **${markdownEscape(item.source)}** / **${markdownEscape(item.status)}** / **${markdownEscape(item.confidence)}**
- Requirements: ${markdownEscape(item.requirementIds.join(', ') || '-')}
- Journeys: ${markdownEscape(item.journeyIds.join(', ') || '-')}
- Actions:<br>${list(item.actions)}
- Assertions:<br>${list(item.assertions.map(stepText))}
- Expected outcome:<br>${list(item.expectedOutcome)}
- Role needs:<br>${list(item.roleNeeds)}
- Test data needs:<br>${list(item.testDataNeeds)}
- Gaps:<br>${list(item.gaps)}
- Next steps:<br>${list(item.nextSteps)}
`).join('\n');
  return `# FrontLens Business Journeys

## Status

- Status: **${result.status}**
- Target: ${markdownEscape(result.targetUrl)}
- Scenarios: **${result.summary.scenarioCount}**（ready ${result.summary.readyCount}, needs-input ${result.summary.needsInputCount}, manual-required ${result.summary.manualRequiredCount}）
- Requirement-linked / runtime-verified: ${result.summary.requirementLinkedCount} / ${result.summary.runtimeVerifiedCount}
- Assertion steps / API assertions: ${result.summary.assertionStepCount} / ${result.summary.apiAssertionCount}
- Role/test-data needs: ${result.summary.roleNeedCount} / ${result.summary.testDataNeedCount}

## Scenario matrix

${rows.length ? ['| ID | Pri | Source | Status | Title | Requirements | Assertions | Next/gap |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No business journey scenarios were generated.'}

## Scenario details

${detail || 'No details.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
