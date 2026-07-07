import type {
  AccessibilityCheckResult,
  ComponentRecord,
  FrontLensConfig,
  InteractionTestKind,
  InteractionTestResult,
  Issue,
  JourneyTestResult,
  NetworkRecord,
  PageModel,
  RequirementConfigItem,
  RequirementCoverageItem,
  RequirementCoverageResult,
  RequirementCoverageStatus,
  RequirementPriority,
  RequirementSource
} from '../types.js';

function makeEmptyCoverage(enabled: boolean, gap?: string): RequirementCoverageResult {
  return {
    enabled,
    checkedAt: new Date().toISOString(),
    source: 'none',
    summary: {
      requirementCount: 0,
      passedCount: 0,
      failedCount: 0,
      partialCount: 0,
      notCoveredCount: 0,
      notApplicableCount: 0,
      providedCount: 0,
      inferredCount: 0,
      highPriorityGapCount: 0
    },
    items: [],
    gaps: gap ? [gap] : []
  };
}

function normalizePriority(value: RequirementConfigItem['priority']): RequirementPriority {
  return value === 'P0' || value === 'P1' || value === 'P2' || value === 'P3' ? value : 'P2';
}

function normalizeSource(value: RequirementConfigItem['source'], fallback: RequirementSource): RequirementSource {
  return value === 'provided' || value === 'inferred' ? value : fallback;
}

function textOf(component: ComponentRecord): string {
  return [component.label, component.text, component.placeholder, component.attributes?.['aria-label'], component.attributes?.title]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function selectorMatches(selector: string, component: ComponentRecord): boolean {
  return Boolean(component.selector && (component.selector === selector || component.selector.includes(selector) || selector.includes(component.selector)));
}

function patternMatches(pattern: string, value: string): boolean {
  if (!pattern) return false;
  if (value.includes(pattern)) return true;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function statusFromTests(tests: Array<{ status: string }>): RequirementCoverageStatus | undefined {
  if (tests.length === 0) return undefined;
  if (tests.some((item) => item.status === 'failed')) return 'failed';
  if (tests.some((item) => item.status === 'warning')) return 'partial';
  if (tests.every((item) => item.status === 'passed')) return 'passed';
  if (tests.every((item) => item.status === 'skipped')) return 'not-covered';
  return 'partial';
}

function relatedIssuesForEvidence(input: {
  issues: Issue[];
  selectors: string[];
  networkRequestIds: string[];
  journeyIds: string[];
  interactionTestIds: string[];
}): Issue[] {
  const selectorSet = new Set(input.selectors);
  const networkSet = new Set(input.networkRequestIds);
  const testIdSet = new Set([...input.journeyIds, ...input.interactionTestIds]);
  return input.issues.filter((issue) => {
    if (issue.evidence.selector && selectorSet.has(issue.evidence.selector)) return true;
    if (issue.evidence.networkRequestId && networkSet.has(issue.evidence.networkRequestId)) return true;
    const details = issue.evidence.details;
    if (details && typeof details === 'object') {
      const serialized = JSON.stringify(details);
      if ([...networkSet].some((id) => serialized.includes(id))) return true;
      if ([...testIdSet].some((id) => serialized.includes(id))) return true;
    }
    return false;
  });
}

function buildItemFromConfig(
  item: RequirementConfigItem,
  index: number,
  input: {
    pageModel: PageModel;
    networkRecords: NetworkRecord[];
    issues: Issue[];
    journeyTests: JourneyTestResult[];
    interactionTests: InteractionTestResult[];
  }
): RequirementCoverageItem {
  const source = normalizeSource(item.source, 'provided');
  const priority = normalizePriority(item.priority);
  const id = item.id?.trim() || `${source === 'provided' ? 'REQ' : 'INF'}-${String(index + 1).padStart(3, '0')}`;
  const selectors = (item.selectors ?? []).filter(Boolean);
  const matchedComponents = selectors.length > 0 ? input.pageModel.components.filter((component) => selectors.some((selector) => selectorMatches(selector, component))) : [];
  const journeyTests = [
    ...(item.journeyNames ?? []).flatMap((name) => input.journeyTests.filter((journey) => journey.name === name || journey.name.toLowerCase().includes(name.toLowerCase()))),
    ...input.journeyTests.filter((journey) => journey.requirementIds?.includes(id))
  ].filter((journey, journeyIndex, journeys) => journeys.findIndex((candidate) => candidate.id === journey.id) === journeyIndex);
  const interactionTests = (item.interactionKinds ?? []).flatMap((kind) => input.interactionTests.filter((test) => test.kind === kind));
  const networkRecords = (item.apiPatterns ?? []).flatMap((pattern) => input.networkRecords.filter((record) => patternMatches(pattern, record.url)));
  const networkRequestIds = [...new Set(networkRecords.map((record) => record.id))];
  const matchedSelectors = [...new Set([...matchedComponents.map((component) => component.selector).filter((selector): selector is string => Boolean(selector)), ...selectors.filter((selector) => matchedComponents.some((component) => selectorMatches(selector, component)))])];
  const relatedIssues = relatedIssuesForEvidence({
    issues: input.issues,
    selectors: matchedSelectors,
    networkRequestIds,
    journeyIds: journeyTests.map((journey) => journey.id),
    interactionTestIds: interactionTests.map((test) => test.id)
  });
  const blockingIssue = relatedIssues.find((issue) => issue.severity === 'critical' || issue.severity === 'high');
  const mediumIssue = relatedIssues.find((issue) => issue.severity === 'medium');
  const journeyStatus = statusFromTests(journeyTests);
  const interactionStatus = statusFromTests(interactionTests);
  const failedNetwork = networkRecords.filter((record) => record.failed || (record.status !== undefined && record.status >= 400));

  const evidenceNotes: string[] = [];
  const gaps: string[] = [];
  if (matchedComponents.length > 0) evidenceNotes.push(`匹配到 ${matchedComponents.length} 个页面组件。`);
  if (journeyTests.length > 0) evidenceNotes.push(`匹配到 ${journeyTests.length} 条用户旅程。`);
  if (interactionTests.length > 0) evidenceNotes.push(`匹配到 ${interactionTests.length} 条安全交互测试。`);
  if (networkRecords.length > 0) evidenceNotes.push(`匹配到 ${networkRecords.length} 个网络请求。`);
  if (relatedIssues.length > 0) evidenceNotes.push(`关联到 ${relatedIssues.length} 个 raw issue。`);

  let status: RequirementCoverageStatus = 'not-covered';
  let confidence: RequirementCoverageItem['confidence'] = 'low';
  if (blockingIssue || failedNetwork.length > 0 || journeyStatus === 'failed' || interactionStatus === 'failed') {
    status = 'failed';
    confidence = journeyStatus === 'failed' || interactionStatus === 'failed' ? 'high' : 'medium';
    if (blockingIssue) gaps.push(`存在阻断/高风险关联问题：${blockingIssue.id} ${blockingIssue.title}`);
    if (failedNetwork.length > 0) gaps.push(`${failedNetwork.length} 个关联接口失败或返回 4xx/5xx。`);
  } else if (journeyStatus === 'passed' || interactionStatus === 'passed') {
    status = 'passed';
    confidence = 'high';
  } else if (journeyStatus === 'partial' || interactionStatus === 'partial' || mediumIssue || matchedComponents.length > 0 || networkRecords.length > 0) {
    status = 'partial';
    confidence = journeyStatus === 'partial' || interactionStatus === 'partial' ? 'medium' : 'low';
    if (mediumIssue) gaps.push(`存在 Medium 关联风险：${mediumIssue.id} ${mediumIssue.title}`);
    gaps.push('只有结构/API/部分交互证据，尚未形成完整业务旅程验收。');
  } else if (journeyStatus === 'not-covered' || interactionStatus === 'not-covered') {
    status = 'not-covered';
    confidence = 'low';
    gaps.push('关联旅程或交互测试被 skipped，需求未覆盖。');
  } else {
    gaps.push('未匹配到 selector、journey、interaction 或 API 证据。');
  }

  return {
    id,
    title: item.title,
    description: item.description,
    priority,
    source,
    status,
    confidence,
    evidence: {
      selectors: matchedSelectors,
      componentIds: matchedComponents.map((component) => component.id),
      journeyIds: journeyTests.map((journey) => journey.id),
      interactionTestIds: interactionTests.map((test) => test.id),
      networkRequestIds,
      issueIds: relatedIssues.map((issue) => issue.id),
      notes: evidenceNotes
    },
    gaps
  };
}

function makeInferredItems(input: { pageModel: PageModel; journeyTests: JourneyTestResult[]; interactionTests: InteractionTestResult[]; networkRecords: NetworkRecord[]; accessibilityChecks: AccessibilityCheckResult[] }): RequirementConfigItem[] {
  const items: RequirementConfigItem[] = [
    {
      id: 'INF-PAGE-LOAD',
      title: '页面可打开并展示主体内容',
      priority: 'P1',
      source: 'inferred',
      selectors: ['body'],
      journeyNames: input.journeyTests.length > 0 ? input.journeyTests.map((journey) => journey.name) : undefined
    }
  ];

  const searchLike = input.pageModel.components.some((component) => ['input', 'button'].includes(component.type) && /搜索|查询|筛选|search|filter|query/.test(textOf(component)));
  if (searchLike || input.interactionTests.some((test) => test.kind === 'search')) {
    items.push({ id: 'INF-SEARCH', title: '搜索/筛选能力可用', priority: 'P2', source: 'inferred', interactionKinds: ['search'] });
  }
  if (input.pageModel.forms.length > 0 || input.pageModel.inputs.some((inputComponent) => inputComponent.required)) {
    items.push({ id: 'INF-FORM-VALIDATION', title: '表单输入和校验不阻断用户', priority: 'P2', source: 'inferred', interactionKinds: ['form-validation'] });
  }
  if (input.pageModel.tables.length > 0 || input.pageModel.components.some((component) => component.type === 'list' || component.type === 'grid' || component.type === 'card')) {
    items.push({ id: 'INF-LIST-VISIBLE', title: '列表/卡片区域已渲染且数据正确性待业务验收', priority: 'P2', source: 'inferred', selectors: input.pageModel.components.filter((component) => component.type === 'table' || component.type === 'list' || component.type === 'grid' || component.type === 'card').slice(0, 5).map((component) => component.selector).filter((selector): selector is string => Boolean(selector)) });
  }
  if (input.networkRecords.some((record) => record.resourceType === 'xhr' || record.resourceType === 'fetch')) {
    items.push({ id: 'INF-API-LOAD', title: '页面关联接口基础健康', priority: 'P2', source: 'inferred', apiPatterns: [''] });
  }
  if (input.accessibilityChecks.length > 0) {
    items.push({ id: 'INF-A11Y-BASIC', title: '基础可访问性检查无阻断问题', priority: 'P3', source: 'inferred' });
  }
  return items;
}

function applySpecialInferredStatus(item: RequirementCoverageItem, input: { pageModel: PageModel; accessibilityChecks: AccessibilityCheckResult[]; networkRecords: NetworkRecord[] }): RequirementCoverageItem {
  if (item.id === 'INF-PAGE-LOAD') {
    const explicitFailure = /页面加载失败/i.test(input.pageModel.structureTree);
    const loaded = input.pageModel.stats.domNodes > 0 && !explicitFailure;
    const missingModel = input.pageModel.stats.domNodes === 0 && !input.pageModel.structureTree && !input.pageModel.stats.bodyTextSample;
    return {
      ...item,
      status: loaded ? 'passed' : explicitFailure ? 'failed' : 'not-covered',
      confidence: loaded ? 'high' : explicitFailure ? 'medium' : 'low',
      evidence: { ...item.evidence, notes: [...item.evidence.notes, loaded ? 'DOM 已采集且主体结构可见。' : missingModel ? '页面模型缺失或未采集，无法证明页面加载。' : 'DOM 未可靠采集。'] },
      gaps: loaded
        ? item.gaps.filter((gap) => !/未匹配|完整业务旅程/.test(gap))
        : explicitFailure
          ? [...item.gaps, '页面未可靠进入，无法继续业务验收。']
          : [...item.gaps, '页面加载能力未被当前证据覆盖。']
    };
  }
  if (item.id === 'INF-A11Y-BASIC') {
    const failed = input.accessibilityChecks.filter((check) => check.status === 'failed');
    const warning = input.accessibilityChecks.filter((check) => check.status === 'warning');
    return {
      ...item,
      status: failed.length > 0 ? 'failed' : warning.length > 0 ? 'partial' : 'passed',
      confidence: 'medium',
      evidence: { ...item.evidence, notes: [...item.evidence.notes, `可访问性检查：failed ${failed.length}，warning ${warning.length}。`] },
      gaps: failed.length > 0 ? [`${failed.length} 个可访问性失败项。`] : warning.length > 0 ? [`${warning.length} 个可访问性 warning。`] : []
    };
  }
  if (item.id === 'INF-API-LOAD') {
    const apiRecords = input.networkRecords.filter((record) => record.resourceType === 'xhr' || record.resourceType === 'fetch');
    const failed = apiRecords.filter((record) => record.failed || (record.status !== undefined && record.status >= 400));
    return {
      ...item,
      status: failed.length > 0 ? 'failed' : apiRecords.length > 0 ? 'partial' : 'not-covered',
      confidence: failed.length > 0 ? 'medium' : 'low',
      evidence: { ...item.evidence, networkRequestIds: apiRecords.map((record) => record.id), notes: [...item.evidence.notes, `采集到 ${apiRecords.length} 个 XHR/fetch 请求。`] },
      gaps: failed.length > 0 ? [`${failed.length} 个接口失败或返回 4xx/5xx。`] : ['接口基础健康不等于业务数据正确，仍需业务字段/数量/权限断言。']
    };
  }
  return item;
}

function summarize(items: RequirementCoverageItem[]): RequirementCoverageResult['summary'] {
  const count = (status: RequirementCoverageStatus) => items.filter((item) => item.status === status).length;
  const isHighPriorityGap = (item: RequirementCoverageItem) => (item.priority === 'P0' || item.priority === 'P1') && item.status !== 'passed' && item.status !== 'not-applicable';
  return {
    requirementCount: items.length,
    passedCount: count('passed'),
    failedCount: count('failed'),
    partialCount: count('partial'),
    notCoveredCount: count('not-covered'),
    notApplicableCount: count('not-applicable'),
    providedCount: items.filter((item) => item.source === 'provided').length,
    inferredCount: items.filter((item) => item.source === 'inferred').length,
    highPriorityGapCount: items.filter(isHighPriorityGap).length
  };
}

export function buildRequirementCoverage(input: {
  config: FrontLensConfig;
  pageModel: PageModel;
  networkRecords: NetworkRecord[];
  issues: Issue[];
  journeyTests: JourneyTestResult[];
  interactionTests: InteractionTestResult[];
  accessibilityChecks: AccessibilityCheckResult[];
}): RequirementCoverageResult {
  const config = input.config.requirements;
  if (!config.enabled) return makeEmptyCoverage(false, '需求覆盖矩阵未启用。');

  const providedItems = config.items.map((item, index) => buildItemFromConfig({ ...item, source: item.source ?? 'provided' }, index, input));
  const inferredConfigs = config.inferFromPage ? makeInferredItems(input) : [];
  const inferredItems = inferredConfigs.map((item, index) => applySpecialInferredStatus(buildItemFromConfig(item, index, input), input));
  const items = [...providedItems, ...inferredItems];
  if (items.length === 0) return makeEmptyCoverage(true, '未提供需求/验收标准，且未能从页面模型推断可验证能力。');

  const source = providedItems.length > 0 && inferredItems.length > 0 ? 'mixed' : providedItems.length > 0 ? 'provided' : 'inferred';
  const summary = summarize(items);
  const gaps: string[] = [];
  if (providedItems.length === 0) gaps.push('未提供显式 PRD/验收标准；以下仅为页面能力推断，不能代表 100% 业务验收。');
  if (summary.failedCount > 0) gaps.push(`${summary.failedCount} 项需求/能力验证失败。`);
  if (summary.partialCount > 0) gaps.push(`${summary.partialCount} 项只有部分证据，需要补业务旅程或断言。`);
  if (summary.notCoveredCount > 0) gaps.push(`${summary.notCoveredCount} 项未被当前自动化覆盖。`);
  if (summary.highPriorityGapCount > 0) gaps.push(`${summary.highPriorityGapCount} 项 P0/P1 需求未完全通过。`);

  return {
    enabled: true,
    checkedAt: new Date().toISOString(),
    source,
    summary,
    items,
    gaps
  };
}
