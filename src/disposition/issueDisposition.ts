import type { FrontLensConfig, Issue, IssueDispositionItem, IssueDispositionResult, RequirementCoverageResult, RootCauseGroup } from '../types.js';
import { evaluateDataMismatchProof } from '../proof/dataMismatchProof.js';

type Status = IssueDispositionItem['status'];
type Actionability = IssueDispositionItem['actionability'];
type Bucket = IssueDispositionItem['bucket'];
type Owner = IssueDispositionItem['owner'];
type EvidenceStrength = IssueDispositionItem['evidenceStrength'];

function detailsOf(issue: Issue): Record<string, unknown> {
  return issue.evidence.details && typeof issue.evidence.details === 'object' ? issue.evidence.details as Record<string, unknown> : {};
}

function textOf(issue: Issue): string {
  return `${issue.title} ${issue.category} ${issue.description} ${issue.reason}`.toLowerCase();
}

function ruleText(issue: Issue): string {
  const details = detailsOf(issue);
  return `${String(details.category ?? '')} ${String(details.rule ?? '')} ${issue.title}`.toLowerCase();
}

function normalizeFeature(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const featureAliases: Record<string, string[]> = {
  'touch-target': ['tap-target', 'mobile-touch-target', '触控目标', '移动端点击区', 'mobile', 'responsive', 'accessibility', 'a11y'],
  'mobile-touch-target': ['touch-target', 'tap-target', '触控目标', '移动端点击区', 'mobile', 'responsive', 'accessibility', 'a11y'],
  mobile: ['移动端', 'mobile-touch-target', 'touch-target', 'responsive'],
  responsive: ['响应式', 'mobile', 'touch-target'],
  export: ['导出', 'download', '下载'],
  download: ['下载', 'export', '导出'],
  导出: ['export', 'download', '下载'],
  下载: ['download', 'export', '导出'],
  'manual-refresh': ['refresh', '刷新', 'reload'],
  refresh: ['manual-refresh', '刷新', 'reload'],
  刷新: ['refresh', 'manual-refresh', 'reload'],
  pagination: ['分页', 'paging', 'pager', 'page'],
  分页: ['pagination', 'paging', 'pager'],
  seo: ['搜索引擎优化'],
  'visual-design': ['style', '视觉', '视觉密度', '样式', '颜色', '按钮层级'],
  style: ['visual-design', '视觉', '样式'],
  'color-contrast': ['颜色对比度', 'contrast', 'wcag', 'accessibility', 'a11y', 'visual-design'],
  'empty-state': ['空状态', 'empty', 'no-data'],
  'error-state': ['错误态', '异常反馈', '失败反馈', 'error-feedback'],
  search: ['搜索', 'filter', '筛选', 'query'],
  filter: ['筛选', 'search', '搜索'],
  sort: ['排序', 'table-sort'],
  offline: ['离线', '断网']
};

function expandFeature(value: string): Set<string> {
  const normalized = normalizeFeature(value);
  const expanded = new Set<string>([normalized]);
  for (const alias of featureAliases[normalized] ?? []) expanded.add(normalizeFeature(alias));
  for (const [key, aliases] of Object.entries(featureAliases)) {
    if (aliases.map(normalizeFeature).includes(normalized)) {
      expanded.add(normalizeFeature(key));
      for (const alias of aliases) expanded.add(normalizeFeature(alias));
    }
  }
  return expanded;
}

function issueFeatureCandidates(issue: Issue): string[] {
  const text = textOf(issue);
  const features = new Set<string>();
  const add = (...items: string[]) => items.forEach((item) => features.add(item));
  if (/触控目标|tap target|smalltap|touch target|mobile|tablet|移动端|响应式/.test(text)) add('touch-target', 'mobile-touch-target', 'mobile', 'responsive');
  if (/导出|下载|export|download/.test(text)) add('export', 'download');
  if (/刷新|refresh|reload|手动刷新/.test(text)) add('manual-refresh', 'refresh');
  if (/分页|pagination|pager|page-size|pagesize|page\/pagesize/.test(text)) add('pagination');
  if (/seo|搜索引擎/.test(text)) add('seo');
  if (/视觉|视觉密度|样式|style|颜色|按钮层级|button hierarchy/.test(text)) add('visual-design', 'style');
  if (/颜色对比度|color-contrast|contrast/.test(text)) add('color-contrast');
  if (/empty state|空状态|暂无|no data/.test(text)) add('empty-state');
  if (/错误态|error state|异常反馈|失败反馈|error feedback/.test(text)) add('error-state');
  if (/搜索|筛选|search|filter|query/.test(text)) add('search', 'filter');
  if (/排序|sort|table-sort/.test(text)) add('sort');
  if (/断网|离线|offline/.test(text)) add('offline');
  return [...features];
}

function hasFeature(configured: string[] | undefined, candidates: string[]): boolean {
  if (!configured?.length || candidates.length === 0) return false;
  const candidateSet = new Set(candidates.flatMap((candidate) => [...expandFeature(candidate)]));
  return configured.some((feature) => [...expandFeature(feature)].some((item) => candidateSet.has(item)));
}

function matchedProductDecisions(issue: Issue, config: FrontLensConfig): string[] {
  if (!config.productContext.enabled) return [];
  const candidates = issueFeatureCandidates(issue);
  return config.productContext.decisions
    .filter((decision) => decision.appliesTo?.length && hasFeature(decision.appliesTo, candidates))
    .map((decision) => decision.id ? `${decision.id}: ${decision.title}` : decision.title);
}

type ProductContextDecision = {
  state: 'required' | 'optional' | 'out-of-scope' | 'none';
  features: string[];
  notes: string[];
};

function productDecisionForIssue(issue: Issue, config: FrontLensConfig): ProductContextDecision {
  if (!config.productContext.enabled) return { state: 'none', features: [], notes: [] };
  const context = config.productContext;
  const features = issueFeatureCandidates(issue);
  const notes = matchedProductDecisions(issue, config);
  if (hasFeature(context.requiredFeatures, features)) return { state: 'required', features, notes };
  if (hasFeature(context.outOfScopeFeatures, features)) return { state: 'out-of-scope', features, notes };
  if (hasFeature(context.optionalFeatures, features)) return { state: 'optional', features, notes };

  const isMobileTouchIssue = hasFeature(['mobile-touch-target'], features);
  if (isMobileTouchIssue) {
    if (context.deviceScope === 'desktop-only') return { state: 'out-of-scope', features, notes: [...notes, 'deviceScope=desktop-only'] };
    if (context.deviceScope === 'desktop-first') return { state: 'optional', features, notes: [...notes, 'deviceScope=desktop-first'] };
    if (context.deviceScope === 'mobile-first' || context.accessibilityTarget === 'wcag-aa' || context.accessibilityTarget === 'wcag-aaa') return { state: 'required', features, notes: [...notes, `deviceScope=${context.deviceScope}`, `accessibilityTarget=${context.accessibilityTarget}`] };
    if (context.deviceScope === 'responsive') return { state: 'optional', features, notes: [...notes, 'deviceScope=responsive'] };
  }

  return { state: 'none', features, notes };
}

function contextNote(decision: ProductContextDecision): string {
  const featureText = decision.features.length ? `匹配特性：${decision.features.map(normalizeFeature).join(', ')}。` : '';
  const noteText = decision.notes.length ? `上下文：${decision.notes.join('；')}。` : '';
  return `${featureText}${noteText}`;
}

function hasEvidence(issue: Issue): boolean {
  return Boolean(
    issue.evidence.screenshot ||
    issue.evidence.dom ||
    issue.evidence.networkRequestId ||
    issue.evidence.consoleId ||
    issue.evidence.pageErrorId ||
    issue.evidence.pageErrorIds?.length ||
    issue.evidence.selector ||
    issue.evidence.componentId ||
    issue.evidence.resourceUrl ||
    issue.evidence.details
  );
}

function ownerFor(issue: Issue, fallback: Owner = 'frontend'): Owner {
  if (issue.ownerHint) return issue.ownerHint;
  if (issue.category === 'security') {
    const rule = ruleText(issue);
    if (/xss|mixed-content|subresource-integrity|third-party/.test(rule)) return 'frontend';
    if (/headers|transport|fingerprint|cookie/.test(rule)) return 'security';
    return 'security';
  }
  if (issue.suggestion.backend && !issue.suggestion.frontend) return 'backend';
  if (issue.category.startsWith('backend')) return 'backend';
  if (issue.suggestion.product && !issue.suggestion.frontend && !issue.suggestion.backend) return 'product';
  if (issue.suggestion.test && !issue.suggestion.frontend && !issue.suggestion.backend) return 'test';
  return fallback;
}

function confidenceFor(status: Status, issue: Issue): IssueDispositionItem['confidence'] {
  if (status === 'confirmed') return issue.confidence >= 0.8 ? 'high' : 'medium';
  if (status === 'needs-source-confirmation' || status === 'insufficient-evidence') return 'medium';
  if (status === 'deployment-only') return 'high';
  if (status === 'product-decision' || status === 'tool-limitation' || status === 'reference') return 'high';
  return 'medium';
}

function makeItem(
  issue: Issue,
  input: {
    status: Status;
    bucket: Bucket;
    actionability: Actionability;
    owner?: Owner;
    evidenceStrength?: EvidenceStrength;
    reason: string;
    nextStep: string;
    rootCauseGroupId?: string;
  }
): IssueDispositionItem {
  return {
    issueId: issue.id,
    fingerprint: issue.fingerprint,
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    status: input.status,
    bucket: input.bucket,
    actionability: input.actionability,
    owner: input.owner ?? ownerFor(issue),
    evidenceStrength: input.evidenceStrength ?? (hasEvidence(issue) ? 'medium' : 'weak'),
    confidence: confidenceFor(input.status, issue),
    reason: input.reason,
    nextStep: input.nextStep,
    rootCauseGroupId: input.rootCauseGroupId
  };
}

function classifySecurity(issue: Issue, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  if (issue.category !== 'security') return undefined;
  const rule = ruleText(issue);
  if (/headers|content-security-policy|csp|nosniff|frame|referrer|coop|corp|hsts|transport|https|fingerprint|server/.test(rule)) {
    return makeItem(issue, {
      status: 'deployment-only',
      bucket: 'deployment-security-config',
      actionability: 'conditional',
      owner: 'security',
      evidenceStrength: 'strong',
      reason: '证据指向响应头、TLS/HSTS 或服务指纹，通常由网关/CDN/nginx/后端部署层负责，不应作为前端代码缺陷处理。',
      nextStep: '生产发布前由部署/安全负责人配置并用 preview/生产域名复测；若前端仓库拥有部署配置，再关联对应配置文件修复。',
      rootCauseGroupId
    });
  }
  if (/sensitive-data|cookie|mixed-content|xss|subresource-integrity|third-party/.test(rule)) {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'deployment-security-config',
      actionability: 'actionable',
      owner: ownerFor(issue, 'security'),
      evidenceStrength: hasEvidence(issue) ? 'strong' : 'medium',
      reason: '安全扫描发现具有直接风险的敏感数据、Cookie、Mixed Content、XSS/SRI 或第三方依赖信号，需要安全/前后端共同处置。',
      nextStep: '核对 security.checks 的具体证据，区分前端代码、接口响应和部署配置后修复并复测 security 模块。',
      rootCauseGroupId
    });
  }
  return makeItem(issue, {
    status: 'needs-source-confirmation',
    bucket: 'deployment-security-config',
    actionability: 'conditional',
    owner: 'security',
    reason: '安全规则需要结合部署环境和源码/网关归属确认，不能仅凭关键词当作前端代码缺陷。',
    nextStep: '查看 security.checks[].evidence 并确认 owner，再决定是否修复代码或部署配置。',
    rootCauseGroupId
  });
}

function classifyException(issue: Issue, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  const details = detailsOf(issue);
  if (!details.exceptionSimulationId) return undefined;
  const text = textOf(issue);
  if (/断网 reload 未能加载 spa|无法评估应用内离线反馈|offline/.test(text) && issue.severity === 'info') {
    return makeItem(issue, {
      status: 'tool-limitation',
      bucket: 'tool-limitation',
      actionability: 'non-actionable',
      owner: 'test',
      evidenceStrength: 'medium',
      reason: '断网时 SPA 入口未加载属于测试方法限制，不能证明应用内离线反馈缺失。',
      nextStep: '若产品要求离线体验，改用已加载页面后的离线 journey 或 Service Worker/PWA 专项测试。',
      rootCauseGroupId
    });
  }
  if (/console\/page error|page error|刷新失败|路由|白屏|runtime/i.test(`${issue.title} ${issue.description}`)) {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: 'actionable',
      owner: 'frontend',
      evidenceStrength: 'strong',
      reason: '异常模拟产生了可见运行时错误、Page Error 或路由失败，属于可复现的韧性缺陷。',
      nextStep: '定位相关 view/composable/router 错误处理路径，补错误边界、空值保护、错误态和回归用例。',
      rootCauseGroupId
    });
  }
  if (issue.category === 'integration-no-feedback') {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: 'actionable',
      owner: 'frontend',
      evidenceStrength: hasEvidence(issue) ? 'strong' : 'medium',
      reason: '异常模拟复现接口失败/超时后页面缺少错误反馈，属于用户可感知的韧性缺陷候选；是否进入实现排期继续由 defectProof 校验源码、需求、产品范围和复现链路。',
      nextStep: '结合源码核对 API 调用链、error state 渲染和 retry 入口；defectProof 为 proven/probable 后合并为一个错误态根因修复，否则保留为证据补充项。',
      rootCauseGroupId
    });
  }
  return undefined;
}

function classifyProductOrSpec(issue: Issue, config: FrontLensConfig, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  const text = textOf(issue);
  const contextDecision = productDecisionForIssue(issue, config);
  const errorStateLike = hasFeature(['error-state'], issueFeatureCandidates(issue)) || /错误态|error state|异常反馈|失败反馈|no feedback|error ref/.test(text);
  const productLike = /触控目标|tap target|smalltap|按钮层级|视觉密度|style|seo|导出|下载|刷新|分页控件|未发现分页参数|empty state|空状态/.test(text);
  if (errorStateLike && contextDecision.state === 'none') {
    return undefined;
  }
  if (productLike && contextDecision.state === 'out-of-scope') {
    return makeItem(issue, {
      status: 'product-decision',
      bucket: 'product-decision',
      actionability: 'non-actionable',
      owner: 'product',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: `产品上下文将该能力标为不在当前页面/版本范围内，不应作为代码缺陷处理。${contextNote(contextDecision)}`,
      nextStep: '若产品范围变化，先更新 productContext/PRD，再重新运行 QA；当前报告中仅保留为非缺陷观察。',
      rootCauseGroupId
    });
  }
  if (productLike && contextDecision.state === 'optional') {
    return makeItem(issue, {
      status: 'product-decision',
      bucket: 'product-decision',
      actionability: 'conditional',
      owner: 'product',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: `产品上下文将该能力标为可选/降级能力，默认不进入必须修复缺陷。${contextNote(contextDecision)}`,
      nextStep: '由产品/设计决定是否提升为需求；若提升，再补明确验收标准和回归。',
      rootCauseGroupId
    });
  }
  if (productLike && contextDecision.state === 'required') {
    const strong = hasEvidence(issue) && issue.confidence >= 0.75;
    return makeItem(issue, {
      status: strong ? 'confirmed' : 'needs-source-confirmation',
      bucket: 'real-frontend-fix',
      actionability: strong && issue.severity !== 'low' ? 'actionable' : 'conditional',
      owner: ownerFor(issue),
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: `产品上下文将该能力标为必需，不能按“产品决策/样式取舍”降级。${contextNote(contextDecision)}`,
      nextStep: '用 PRD/productContext 对应验收标准、运行证据和源码共同复核；确认后修复并补回归。',
      rootCauseGroupId
    });
  }
  if (issue.severity === 'info') {
    return makeItem(issue, {
      status: issue.suggestion.product ? 'product-decision' : 'reference',
      bucket: issue.suggestion.product ? 'product-decision' : 'reference',
      actionability: 'non-actionable',
      owner: issue.suggestion.product ? 'product' : ownerFor(issue, 'test'),
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: '该项是参考观察或产品体验建议，不应进入必须修复缺陷列表。',
      nextStep: issue.suggestion.product ? '由产品/设计确认是否纳入需求；确认前不作为代码缺陷。' : '保留为观察项；如要提升为缺陷，需要补充明确需求和运行证据。',
      rootCauseGroupId
    });
  }
  if (/触控目标|tap target|smalltap|按钮层级|视觉密度|style|seo|导出|下载|刷新|分页控件|未发现分页参数|empty state|空状态/.test(text)) {
    const isHardOverflow = /横向滚动|元素溢出|clipped|overflow/.test(text) && !/触控目标|tap target/.test(text);
    if (!isHardOverflow) {
      return makeItem(issue, {
        status: /疑似|未发现|空状态|分页参数/.test(text) ? 'insufficient-evidence' : 'product-decision',
        bucket: /疑似|未发现|空状态|分页参数/.test(text) ? 'coverage-gap' : 'product-decision',
        actionability: 'conditional',
        owner: /seo|触控|视觉|按钮层级|导出|下载|刷新/.test(text) ? 'product' : ownerFor(issue),
        evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
        reason: '该类结论依赖产品需求、页面类型、设备范围或更强绑定证据，默认不能作为必须修复项。',
        nextStep: '只有在 PRD/ADR/a11y 标准或核心任务阻塞明确要求时才升级为缺陷；否则放入产品决策/参考观察。',
        rootCauseGroupId
      });
    }
  }
  return undefined;
}

interface IssueDispositionContext {
  requirementCoverage?: RequirementCoverageResult;
}

function classifyIntegration(issue: Issue, context: IssueDispositionContext, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  if (!issue.category.startsWith('integration')) return undefined;
  if (issue.category === 'integration-data-mismatch') {
    const proof = evaluateDataMismatchProof(issue, context.requirementCoverage);
    if (proof.status === 'proven') {
      return makeItem(issue, {
        status: 'confirmed',
        bucket: 'real-frontend-fix',
        actionability: 'actionable',
        owner: 'frontend',
        evidenceStrength: 'strong',
        reason: 'API/UI 数据不一致已满足专业证据门槛：明确需求、具体列表响应、可见空 UI 状态和源码 API/state/render 绑定均已证明。',
        nextStep: '按 sourceRuntimeLink 指向的 API 调用、状态写入和列表/表格渲染链路修复，并补充 expectRequest + expectVisible/expectText/row-count 回归断言。',
        rootCauseGroupId
      });
    }
    return makeItem(issue, {
      status: 'needs-source-confirmation',
      bucket: 'coverage-gap',
      actionability: 'conditional',
      owner: 'test',
      evidenceStrength: issue.evidence.networkRequestId && issue.evidence.screenshot ? 'medium' : 'weak',
      reason: `“接口有数据但页面为空”是高风险推断；必须同时证明需求、Network、可见 UI 空态和源码数据流绑定。缺口：${proof.missingEvidence.join('；') || '未知'}`,
      nextStep: '补齐 PRD/requirementCoverage、具体响应路径/数量、目标 DOM/截图 renderedItemCount=0、medium/high sourceRuntimeCorrelation 和源码 API/state/render file:line 后再升级为缺陷。',
      rootCauseGroupId
    });
  }
  if (issue.category === 'integration-no-feedback') {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: 'actionable',
      owner: 'frontend',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: '真实页面加载或交互中发现接口异常且页面文本无错误/重试/权限反馈，用户会误判为空数据或无响应。',
      nextStep: '按源码核对错误态渲染和重试入口；若异常请求来自 exception/P2/offline 模块，则按异常模拟规则降级。',
      rootCauseGroupId
    });
  }
  if (/filter|pagination|journey/.test(issue.category) && issue.confidence < 0.75) {
    return makeItem(issue, {
      status: 'needs-source-confirmation',
      bucket: 'coverage-gap',
      actionability: 'conditional',
      owner: ownerFor(issue),
      reason: '筛选/分页/旅程类信号可能受页面类型、参数命名或本地状态影响，需要源码或需求确认。',
      nextStep: '确认该能力属于当前页面需求，并用具体交互、URL/query、接口参数和 DOM 变化复核。',
      rootCauseGroupId
    });
  }
  return makeItem(issue, {
    status: 'confirmed',
    bucket: 'real-frontend-fix',
    actionability: issue.severity === 'low' ? 'conditional' : 'actionable',
    owner: ownerFor(issue),
    evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
    reason: '前后端联动问题具有用户可见影响，但仍应结合需求和源码确定最终 owner。',
    nextStep: '对齐请求参数、响应字段、loading/empty/error 状态和用户旅程断言。',
    rootCauseGroupId
  });
}

function classifyAccessibility(issue: Issue, config: FrontLensConfig, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  if (issue.category !== 'frontend-accessibility') return undefined;
  const text = textOf(issue);
  const details = detailsOf(issue);
  if (/触控目标|tap target/.test(text)) {
    const contextDecision = productDecisionForIssue(issue, config);
    if (contextDecision.state === 'required') {
      return makeItem(issue, {
        status: hasEvidence(issue) ? 'confirmed' : 'needs-source-confirmation',
        bucket: 'real-frontend-fix',
        actionability: issue.severity === 'low' ? 'conditional' : 'actionable',
        owner: 'frontend',
        evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
        reason: `移动端/触控或严格 a11y 已在 productContext 中纳入范围，触控目标不能作为 PC-first 取舍降级。${contextNote(contextDecision)}`,
        nextStep: '在目标断点扩大点击区，保留 PC 信息密度，并补移动/触屏回归。',
        rootCauseGroupId
      });
    }
    return makeItem(issue, {
      status: 'product-decision',
      bucket: 'product-decision',
      actionability: 'conditional',
      owner: 'product',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: '小触控目标在 PC-first 或管理后台页面常是信息密度取舍；是否必须修复取决于移动端支持范围和显式 a11y 标准。',
      nextStep: '若移动端/触屏是目标范围，再在 <768 断点扩大点击区并补响应式回归；否则作为可选优化。',
      rootCauseGroupId
    });
  }
  if (String(details.rule ?? '') === 'color-contrast' || /颜色对比度|color-contrast|contrast/.test(text)) {
    const features = ['color-contrast', 'accessibility', 'a11y'];
    const strictScope =
      config.productContext.enabled &&
      (config.productContext.accessibilityTarget === 'wcag-aa' ||
        config.productContext.accessibilityTarget === 'wcag-aaa' ||
        hasFeature(config.productContext.requiredFeatures, features));
    if (strictScope) {
      return makeItem(issue, {
        status: hasEvidence(issue) ? 'confirmed' : 'needs-source-confirmation',
        bucket: 'real-frontend-fix',
        actionability: issue.severity === 'low' ? 'conditional' : 'actionable',
        owner: 'frontend',
        evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
        reason: '产品范围或无障碍目标明确要求 WCAG/颜色对比度，不能按视觉偏好降级。',
        nextStep: '按 evidence.nodes 定位文本和背景色，调整设计 token/主题变量，并补 a11y/视觉回归。',
        rootCauseGroupId
      });
    }
    return makeItem(issue, {
      status: 'product-decision',
      bucket: 'product-decision',
      actionability: 'conditional',
      owner: 'product',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: '颜色对比度在未声明 WCAG AA/AAA 或严格 a11y 目标时属于产品/设计范围敏感项；应先确认无障碍等级再排期。',
      nextStep: '若产品确认 WCAG AA/AAA 或公共页面可访问性目标，再升级为前端样式修复；否则保留为可选设计优化。',
      rootCauseGroupId
    });
  }
  return makeItem(issue, {
    status: 'confirmed',
    bucket: 'real-frontend-fix',
    actionability: issue.severity === 'low' ? 'conditional' : 'actionable',
    owner: 'frontend',
    evidenceStrength: issue.evidence.selector ? 'strong' : 'medium',
    reason: '可访问名称、label、键盘焦点等硬性 a11y 问题可由 DOM/selector 复现，属于前端可执行缺陷。',
    nextStep: '按 selector 定位组件，补 aria-label/label/focus/键盘行为，并增加 a11y 回归。',
    rootCauseGroupId
  });
}

function classifyPerformance(issue: Issue, rootCauseGroupId?: string): IssueDispositionItem | undefined {
  if (!['frontend-performance', 'resource-performance', 'resource-loading'].includes(String(issue.category))) return undefined;
  const text = `${textOf(issue)} ${issue.evidence.resourceUrl ?? ''}`.toLowerCase();
  const details = detailsOf(issue);
  if (typeof details.sourceFindingId === 'string' && typeof details.sourceFile === 'string') {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: 'actionable',
      owner: 'frontend',
      evidenceStrength: 'strong',
      reason: '该性能项来自 sourceAnalysis 的源码 file:line 证据，不依赖 dev-server 请求数或传输体积；属于可复核的源码级优化点。',
      nextStep: '按 sourceFile/line 修复静态路由导入、重型依赖或首屏静态引入，并用 build + preview 的 bundle/coverage 回归确认收益。',
      rootCauseGroupId
    });
  }
  if (/\/src\/|@vite\/client|node_modules\/\.vite|hmr|vite dev/.test(text)) {
    return makeItem(issue, {
      status: 'tool-limitation',
      bucket: 'tool-limitation',
      actionability: 'non-actionable',
      owner: 'test',
      evidenceStrength: 'strong',
      reason: '证据来自 Vite dev server 源码模块/HMR，不能作为生产性能或安全结论。',
      nextStep: '使用 build + preview 或生产构建复测；dev module graph 只能作为源码懒加载线索。',
      rootCauseGroupId
    });
  }
  if (typeof details.metric === 'string' || typeof details.actual === 'number' || issue.category === 'resource-loading') {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: issue.severity === 'low' ? 'conditional' : 'actionable',
      owner: 'frontend',
      evidenceStrength: hasEvidence(issue) ? 'strong' : 'medium',
      reason: '性能预算或资源加载问题有明确运行时指标/资源证据。',
      nextStep: '在生产构建确认后做路由拆包、懒加载、资源压缩或静态资源修复，并保留预算回归。',
      rootCauseGroupId
    });
  }
  return makeItem(issue, {
    status: 'needs-source-confirmation',
    bucket: 'coverage-gap',
    actionability: 'conditional',
    owner: 'frontend',
    evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
    reason: '性能/Coverage 结论需要区分 dev 与 production，并结合源码确认是否是首屏必须加载。',
    nextStep: '检查构建产物、路由懒加载、重型依赖和实际性能预算；确认后再列为修复。',
    rootCauseGroupId
  });
}

function classifyDefault(issue: Issue, rootCauseGroupId?: string): IssueDispositionItem {
  if (issue.category.startsWith('backend')) {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'backend-api-fix',
      actionability: 'actionable',
      owner: 'backend',
      evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
      reason: '后端/API 类问题有网络、契约、状态码或响应证据，默认由后端/API owner 处置； synthetic traffic 需在 triage 中另行排除。',
      nextStep: '核对 Network/API contract 证据和真实环境请求，修复接口契约、状态码、性能或权限语义。',
      rootCauseGroupId
    });
  }
  if (issue.category === 'console-error' || issue.category === 'frontend-routing') {
    return makeItem(issue, {
      status: 'confirmed',
      bucket: 'real-frontend-fix',
      actionability: 'actionable',
      owner: 'frontend',
      evidenceStrength: hasEvidence(issue) ? 'strong' : 'medium',
      reason: '运行时 Console/Page Error 或路由失败通常直接影响用户可用性。',
      nextStep: '定位堆栈/路由/组件源码，补空值保护、错误边界和回归用例。',
      rootCauseGroupId
    });
  }
  const status: Status = issue.confidence >= 0.8 && hasEvidence(issue) ? 'confirmed' : 'insufficient-evidence';
  return makeItem(issue, {
    status,
    bucket: status === 'confirmed' ? 'real-frontend-fix' : 'coverage-gap',
    actionability: status === 'confirmed' && issue.severity !== 'low' ? 'actionable' : 'conditional',
    owner: ownerFor(issue),
    evidenceStrength: hasEvidence(issue) ? 'medium' : 'weak',
    reason: status === 'confirmed' ? '该问题具备运行时证据和较高置信度，可进入修复候选。' : '该问题证据或置信度不足，需补充源码、需求或运行时复验后再定责。',
    nextStep: status === 'confirmed' ? '按 evidence 定位源码并补回归。' : '补充更强证据；不要在最终报告中当作核心缺陷。',
    rootCauseGroupId
  });
}

function summarize(items: IssueDispositionItem[]): IssueDispositionResult['summary'] {
  const count = <T extends string>(value: T, selector: (item: IssueDispositionItem) => T): number => items.filter((item) => selector(item) === value).length;
  const bucketCounts = items.reduce<Record<Bucket, number>>((acc, item) => {
    acc[item.bucket] = (acc[item.bucket] ?? 0) + 1;
    return acc;
  }, {} as Record<Bucket, number>);
  const statusCounts = items.reduce<Record<Status, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {} as Record<Status, number>);
  return {
    totalCount: items.length,
    actionableCount: count('actionable', (item) => item.actionability),
    conditionalCount: count('conditional', (item) => item.actionability),
    nonActionableCount: count('non-actionable', (item) => item.actionability),
    confirmedCount: count('confirmed', (item) => item.status),
    needsSourceConfirmationCount: count('needs-source-confirmation', (item) => item.status),
    deploymentOnlyCount: count('deployment-only', (item) => item.status),
    productDecisionCount: count('product-decision', (item) => item.status),
    toolLimitationCount: count('tool-limitation', (item) => item.status),
    insufficientEvidenceCount: count('insufficient-evidence', (item) => item.status),
    referenceCount: count('reference', (item) => item.status),
    bucketCounts,
    statusCounts
  };
}

export function buildIssueDisposition(issues: Issue[], config: FrontLensConfig, rootCauseGroups: RootCauseGroup[] = [], context: IssueDispositionContext = {}): IssueDispositionResult {
  const groupByIssueId = new Map<string, string>();
  for (const group of rootCauseGroups) {
    for (const issueId of group.issueIds) groupByIssueId.set(issueId, group.id);
  }
  const items = issues.map((issue) => {
    const rootCauseGroupId = groupByIssueId.get(issue.id);
    return (
      classifySecurity(issue, rootCauseGroupId) ??
      classifyException(issue, rootCauseGroupId) ??
      classifyProductOrSpec(issue, config, rootCauseGroupId) ??
      classifyIntegration(issue, context, rootCauseGroupId) ??
      classifyAccessibility(issue, config, rootCauseGroupId) ??
      classifyPerformance(issue, rootCauseGroupId) ??
      classifyDefault(issue, rootCauseGroupId)
    );
  });

  return {
    checkedAt: new Date().toISOString(),
    targetUrl: config.target.url,
    summary: summarize(items),
    items
  };
}

export function filterActionableIssues(issues: Issue[], disposition: IssueDispositionResult): Issue[] {
  const actionableIds = new Set(disposition.items.filter((item) => item.actionability === 'actionable').map((item) => item.issueId));
  return issues.filter((issue) => actionableIds.has(issue.id));
}
