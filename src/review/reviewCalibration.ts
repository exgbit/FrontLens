import type {
  FrontLensConfig,
  Issue,
  IssueDispositionItem,
  ProductContextConfig,
  QaResult,
  ReviewCalibrationIssueAction,
  ReviewCalibrationIssueDecision,
  ReviewCalibrationResult,
  ReviewCalibrationSignal,
  ReviewCalibrationSignalKind
} from '../types.js';
import { evaluateDataMismatchProof } from '../proof/dataMismatchProof.js';

interface BuildReviewCalibrationOptions {
  feedbackText?: string;
}

const knownSignalKinds: ReviewCalibrationSignalKind[] = [
  'desktop-first',
  'style-is-design',
  'touch-target-optional',
  'export-out-of-scope',
  'pagination-out-of-scope',
  'manual-refresh-optional',
  'data-mismatch-needs-proof',
  'dev-server-noise',
  'source-required',
  'error-state-required',
  'a11y-button-name-required',
  'route-lazy-load-required'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function issueText(issue: Issue): string {
  return normalizeText(`${issue.id} ${issue.title} ${issue.category} ${issue.description} ${issue.reason} ${issue.suggestion.frontend ?? ''} ${issue.suggestion.product ?? ''} ${JSON.stringify(issue.evidence.details ?? {})}`);
}

function evidenceRefs(issue: Issue): string[] {
  return [
    issue.evidence.networkRequestId ? `network:${issue.evidence.networkRequestId}` : undefined,
    issue.evidence.consoleId ? `console:${issue.evidence.consoleId}` : undefined,
    issue.evidence.pageErrorId ? `pageError:${issue.evidence.pageErrorId}` : undefined,
    issue.evidence.selector ? `selector:${issue.evidence.selector}` : undefined,
    issue.evidence.componentId ? `component:${issue.evidence.componentId}` : undefined,
    issue.evidence.screenshot ? `screenshot:${issue.evidence.screenshot}` : undefined,
    issue.evidence.dom ? `dom:${issue.evidence.dom}` : undefined
  ].filter((item): item is string => Boolean(item));
}

function addSignal(signals: ReviewCalibrationSignal[], signal: Omit<ReviewCalibrationSignal, 'id'>): void {
  if (signals.some((item) => item.kind === signal.kind)) return;
  signals.push({ id: `RC-SIGNAL-${String(signals.length + 1).padStart(3, '0')}`, ...signal });
}

function isSignalKind(value: unknown): value is ReviewCalibrationSignalKind {
  return typeof value === 'string' && knownSignalKinds.includes(value as ReviewCalibrationSignalKind);
}

function confidenceOf(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium';
}

function signalPatch(kind: ReviewCalibrationSignalKind): Partial<ProductContextConfig> | undefined {
  if (kind === 'desktop-first') return { deviceScope: 'desktop-first' };
  if (kind === 'style-is-design') {
    return {
      optionalFeatures: ['visual-design', 'style'],
      decisions: [{
        id: 'RC-STYLE-DESIGN',
        title: '样式/视觉密度属于产品/设计取舍，除非阻断核心任务或违反明确 a11y/PRD 才进入缺陷。',
        appliesTo: ['visual-design', 'style'],
        rationale: '来自人工复核反馈。'
      }]
    };
  }
  if (kind === 'touch-target-optional') {
    return {
      deviceScope: 'desktop-first',
      optionalFeatures: ['mobile-touch-target', 'touch-target'],
      decisions: [{
        id: 'RC-TOUCH-OPTIONAL',
        title: 'PC-first 页面中移动触控尺寸为降级优化项，不默认作为发布阻断。',
        appliesTo: ['mobile-touch-target', 'touch-target'],
        rationale: '来自人工复核反馈。'
      }]
    };
  }
  if (kind === 'export-out-of-scope') {
    return {
      outOfScopeFeatures: ['export', 'download'],
      decisions: [{
        id: 'RC-EXPORT-OOS',
        title: '导出/下载不属于当前页面验收范围。',
        appliesTo: ['export', 'download'],
        rationale: '来自人工复核反馈。'
      }]
    };
  }
  if (kind === 'pagination-out-of-scope') {
    return {
      outOfScopeFeatures: ['pagination'],
      decisions: [{
        id: 'RC-PAGINATION-OOS',
        title: '分页不属于当前页面验收范围，除非 PRD 明确要求。',
        appliesTo: ['pagination'],
        rationale: '来自人工复核反馈。'
      }]
    };
  }
  if (kind === 'manual-refresh-optional') {
    return {
      optionalFeatures: ['manual-refresh', 'refresh'],
      decisions: [{
        id: 'RC-REFRESH-OPTIONAL',
        title: '手动刷新入口为产品体验优化项，除非 PRD 要求不作为缺陷。',
        appliesTo: ['manual-refresh', 'refresh'],
        rationale: '来自人工复核反馈。'
      }]
    };
  }
  if (kind === 'error-state-required') return { requiredFeatures: ['error-state', 'error-feedback', 'retry'] };
  if (kind === 'a11y-button-name-required') return { requiredFeatures: ['button-accessible-name'] };
  if (kind === 'route-lazy-load-required') return { optionalFeatures: ['route-lazy-load', 'performance-budget'] };
  return undefined;
}

function signalTitle(kind: ReviewCalibrationSignalKind): string {
  const titles: Record<ReviewCalibrationSignalKind, string> = {
    'desktop-first': '桌面优先，移动端降级/自适应',
    'style-is-design': '样式/视觉类问题需要产品确认，不默认当缺陷',
    'touch-target-optional': '移动触控目标为可选/降级项',
    'export-out-of-scope': '导出/下载不在当前页面范围',
    'pagination-out-of-scope': '分页不在当前页面范围或不适用当前布局',
    'manual-refresh-optional': '手动刷新入口为可选项',
    'data-mismatch-needs-proof': 'API/UI 数据不一致必须满足四段证据门槛',
    'dev-server-noise': 'Vite/dev server 指标属于环境噪音',
    'source-required': '前端缺陷需要源码关联',
    'error-state-required': '接口异常错误态/重试属于必需能力',
    'a11y-button-name-required': '图标按钮可访问名称属于应修问题',
    'route-lazy-load-required': '路由懒加载/拆包为真实性能优化项'
  };
  return titles[kind];
}

function addAppliedConfigSignal(signals: ReviewCalibrationSignal[], kind: ReviewCalibrationSignalKind, source: Record<string, unknown> = {}): void {
  addSignal(signals, {
    kind,
    title: typeof source.title === 'string' && source.title.trim() ? source.title : signalTitle(kind),
    confidence: confidenceOf(source.confidence),
    rationale: '来自已应用的 review-calibration.config.json / _frontlensReviewCalibration；按已确认的人工复核策略继续校准本次结果。',
    productContextPatch: signalPatch(kind)
  });
}

function appliedCalibrationConfig(result: QaResult): Record<string, unknown> | undefined {
  const config = result.metadata.config as unknown as Record<string, unknown>;
  return isRecord(config._frontlensReviewCalibration) ? config._frontlensReviewCalibration : undefined;
}

function addSignalsFromAppliedConfig(signals: ReviewCalibrationSignal[], result: QaResult): boolean {
  const config = appliedCalibrationConfig(result);
  if (!config) return false;
  const rawSignals = Array.isArray(config.signals) ? config.signals : [];
  for (const rawSignal of rawSignals) {
    if (!isRecord(rawSignal) || !isSignalKind(rawSignal.kind)) continue;
    addAppliedConfigSignal(signals, rawSignal.kind, rawSignal);
  }
  const policies = isRecord(config.policies) ? config.policies : {};
  if (policies.requireSourceForFrontendDefects === true) addAppliedConfigSignal(signals, 'source-required');
  if (policies.treatDevServerMetricsAsNonProduction === true) addAppliedConfigSignal(signals, 'dev-server-noise');
  if (policies.dataMismatchRequiresFourPartProof === true) addAppliedConfigSignal(signals, 'data-mismatch-needs-proof');
  if (policies.doNotPromoteStyleToDefectWithoutProductConfirmation === true) addAppliedConfigSignal(signals, 'style-is-design');
  return signals.length > 0 || rawSignals.length > 0 || Object.keys(policies).length > 0;
}

function inferSignals(feedbackText: string | undefined, result: QaResult): ReviewCalibrationSignal[] {
  const signals: ReviewCalibrationSignal[] = [];
  const text = normalizeText(feedbackText ?? '');
  if (!text) return signals;

  if (/\bpc\b|desktop|桌面|pc为主|pc first|desktop-first|移动.*降级|mobile.*degrad/.test(text)) {
    addSignal(signals, {
      kind: 'desktop-first',
      title: '桌面优先，移动端降级/自适应',
      confidence: 'high',
      rationale: '反馈明确提到 PC/desktop 优先或移动端降级，应把移动触控/响应式细节按产品范围校准。',
      productContextPatch: { deviceScope: 'desktop-first' }
    });
  }
  if (/样式|风格|视觉|设计如此|产品.*设计|product.*design|style|visual/.test(text)) {
    addSignal(signals, {
      kind: 'style-is-design',
      title: '样式/视觉类问题需要产品确认，不默认当缺陷',
      confidence: 'high',
      rationale: '反馈指出部分样式风格属于产品需求或设计取舍。',
      productContextPatch: {
        optionalFeatures: ['visual-design', 'style'],
        decisions: [
          {
            id: 'RC-STYLE-DESIGN',
            title: '样式/视觉密度属于产品/设计取舍，除非阻断核心任务或违反明确 a11y/PRD 才进入缺陷。',
            appliesTo: ['visual-design', 'style'],
            rationale: '来自人工复核反馈。'
          }
        ]
      }
    });
  }
  if (/触控|tap target|touch target|点击区|移动端.*可不修|移动.*不.*优先|<32px|小按钮/.test(text)) {
    addSignal(signals, {
      kind: 'touch-target-optional',
      title: '移动触控目标为可选/降级项',
      confidence: 'medium',
      rationale: '反馈提到触控目标或移动端点击区优先级存疑。',
      productContextPatch: {
        deviceScope: 'desktop-first',
        optionalFeatures: ['mobile-touch-target', 'touch-target'],
        decisions: [
          {
            id: 'RC-TOUCH-OPTIONAL',
            title: 'PC-first 页面中移动触控尺寸为降级优化项，不默认作为发布阻断。',
            appliesTo: ['mobile-touch-target', 'touch-target'],
            rationale: '来自人工复核反馈。'
          }
        ]
      }
    });
  }
  if (/导出.*(不需要|不支持|不在|反模式)|export.*(out|not required|unsupported)|下载.*(不需要|不支持|不在)/.test(text)) {
    addSignal(signals, {
      kind: 'export-out-of-scope',
      title: '导出/下载不在当前页面范围',
      confidence: 'high',
      rationale: '反馈明确认为导出/下载不是当前页面应修能力。',
      productContextPatch: {
        outOfScopeFeatures: ['export', 'download'],
        decisions: [
          {
            id: 'RC-EXPORT-OOS',
            title: '导出/下载不属于当前页面验收范围。',
            appliesTo: ['export', 'download'],
            rationale: '来自人工复核反馈。'
          }
        ]
      }
    });
  }
  if (/分页.*(不需要|不适用|不在|不是)|pagination.*(out|not required|not applicable)|卡片.*不.*分页/.test(text)) {
    addSignal(signals, {
      kind: 'pagination-out-of-scope',
      title: '分页不在当前页面范围或不适用当前布局',
      confidence: 'high',
      rationale: '反馈明确认为分页不适用或不是当前需求。',
      productContextPatch: {
        outOfScopeFeatures: ['pagination'],
        decisions: [
          {
            id: 'RC-PAGINATION-OOS',
            title: '分页不属于当前页面验收范围，除非 PRD 明确要求。',
            appliesTo: ['pagination'],
            rationale: '来自人工复核反馈。'
          }
        ]
      }
    });
  }
  if (/刷新.*(可选|低优先|不需要|看产品)|manual refresh|refresh.*optional/.test(text)) {
    addSignal(signals, {
      kind: 'manual-refresh-optional',
      title: '手动刷新入口为可选项',
      confidence: 'medium',
      rationale: '反馈提到手动刷新入口低优先级或需产品决定。',
      productContextPatch: {
        optionalFeatures: ['manual-refresh', 'refresh'],
        decisions: [
          {
            id: 'RC-REFRESH-OPTIONAL',
            title: '手动刷新入口为产品体验优化项，除非 PRD 要求不作为缺陷。',
            appliesTo: ['manual-refresh', 'refresh'],
            rationale: '来自人工复核反馈。'
          }
        ]
      }
    });
  }
  if (/接口有数据.*(正常|误报)|页面显示空.*误报|data mismatch.*false|空.*经.*正常|不要.*假设|证据不足|四.*part|源码.*绑定|source.*runtime/.test(text)) {
    addSignal(signals, {
      kind: 'data-mismatch-needs-proof',
      title: 'API/UI 数据不一致必须满足四段证据门槛',
      confidence: 'high',
      rationale: '反馈指出“接口有数据但页面为空”类结论容易发散，必须补 PRD/Network/UI/源码绑定后才能升级。'
    });
  }
  if (/vite dev|dev server|hmr|\/\@vite|源码模式|开发服务器|source module|模块请求/.test(text)) {
    addSignal(signals, {
      kind: 'dev-server-noise',
      title: 'Vite/dev server 指标属于环境噪音',
      confidence: 'high',
      rationale: '反馈提到 dev server/HMR/源码模块请求不能作为生产性能或安全结论。'
    });
  }
  if (/结合.*源码|source-root|源码.*分析|代码.*核对|file:line|source.*correlation/.test(text)) {
    addSignal(signals, {
      kind: 'source-required',
      title: '前端缺陷需要源码关联',
      confidence: 'high',
      rationale: '反馈要求后续分析结合前端代码，保留缺陷需 runtime/source 双证据。'
    });
  }
  if (/错误态|异常.*反馈|失败.*反馈|重试|api-?500|api-?404|timeout|no feedback|error state/.test(text)) {
    addSignal(signals, {
      kind: 'error-state-required',
      title: '接口异常错误态/重试属于必需能力',
      confidence: 'high',
      rationale: '反馈确认接口失败静默/无重试是真问题。',
      productContextPatch: { requiredFeatures: ['error-state', 'error-feedback', 'retry'] }
    });
  }
  if (/aria|accessible name|无障碍名称|图标按钮|button name|a11y/.test(text)) {
    addSignal(signals, {
      kind: 'a11y-button-name-required',
      title: '图标按钮可访问名称属于应修问题',
      confidence: 'high',
      rationale: '反馈确认图标按钮缺少 aria-label/title 是真实 a11y 问题。',
      productContextPatch: { requiredFeatures: ['button-accessible-name'] }
    });
  }
  if (/懒加载|lazy|拆包|bundle|codemirror|未使用.*js|route.*lazy|code split/.test(text)) {
    addSignal(signals, {
      kind: 'route-lazy-load-required',
      title: '路由懒加载/拆包为真实性能优化项',
      confidence: 'medium',
      rationale: '反馈确认静态路由 import 导致页面加载无关模块。',
      productContextPatch: { optionalFeatures: ['route-lazy-load', 'performance-budget'] }
    });
  }

  if (signals.length === 0 && result.scopeReview.status === 'needs-input') {
    addSignal(signals, {
      kind: 'source-required',
      title: '复核反馈未被结构化识别，保守要求源码/需求证据后再定责',
      confidence: 'low',
      rationale: '已提供反馈但未匹配到内置产品/证据模式。'
    });
  }
  return signals;
}

function hasSignal(signals: ReviewCalibrationSignal[], kind: ReviewCalibrationSignalKind): boolean {
  return signals.some((item) => item.kind === kind);
}

function dispositionFor(result: QaResult, issue: Issue): IssueDispositionItem | undefined {
  return result.issueDisposition.items.find((item) => item.issueId === issue.id);
}

function classifyBySignals(issue: Issue, signals: ReviewCalibrationSignal[], result: QaResult): { action?: ReviewCalibrationIssueAction; reason?: string; matchedSignals?: ReviewCalibrationSignalKind[]; confidence?: 'high' | 'medium' | 'low' } {
  const text = issueText(issue);

  if (hasSignal(signals, 'dev-server-noise') && (/vite|hmr|\/\@vite|source map|源码模块|dev server|websocket|模块请求/.test(text) || (issue.category === 'security' && /debug|stack|source|\/src\//.test(text)))) {
    return { action: 'out-of-scope', reason: '命中 dev-server-noise 反馈：Vite/HMR/源码模块请求不作为应用生产缺陷。', matchedSignals: ['dev-server-noise'], confidence: 'high' };
  }
  if (hasSignal(signals, 'export-out-of-scope') && /导出|下载|export|download/.test(text)) {
    return { action: 'out-of-scope', reason: '命中 export-out-of-scope 反馈：导出/下载不在当前页面验收范围。', matchedSignals: ['export-out-of-scope'], confidence: 'high' };
  }
  if (hasSignal(signals, 'pagination-out-of-scope') && /分页|pagination|pager|page-size|pagesize/.test(text)) {
    return { action: 'out-of-scope', reason: '命中 pagination-out-of-scope 反馈：分页不在当前页面范围或不适用当前布局。', matchedSignals: ['pagination-out-of-scope'], confidence: 'high' };
  }
  if (hasSignal(signals, 'touch-target-optional') && /触控目标|tap target|touch target|点击区|smalltap|<32|mobile/.test(text)) {
    return { action: 'downgrade', reason: '命中 touch-target-optional 反馈：PC-first 页面移动触控尺寸按可选优化处理。', matchedSignals: ['touch-target-optional'], confidence: 'medium' };
  }
  if (hasSignal(signals, 'desktop-first') && /触控目标|tap target|touch target|点击区|smalltap|<32|mobile|响应式/.test(text)) {
    return { action: 'downgrade', reason: '命中 desktop-first 反馈：桌面优先页面的移动触控/响应式细节默认按降级优化处理。', matchedSignals: ['desktop-first'], confidence: 'medium' };
  }
  if (hasSignal(signals, 'style-is-design') && /样式|风格|视觉|style|visual|颜色|密度|button hierarchy/.test(text)) {
    return { action: 'ask-product', reason: '命中 style-is-design 反馈：样式/视觉问题需产品/设计确认，除非阻断核心任务或违反明确验收。', matchedSignals: ['style-is-design'], confidence: 'medium' };
  }
  if (hasSignal(signals, 'manual-refresh-optional') && /刷新|refresh|reload/.test(text)) {
    return { action: 'downgrade', reason: '命中 manual-refresh-optional 反馈：手动刷新入口按产品体验优化处理。', matchedSignals: ['manual-refresh-optional'], confidence: 'medium' };
  }
  if (hasSignal(signals, 'data-mismatch-needs-proof') && issue.category === 'integration-data-mismatch') {
    const proof = evaluateDataMismatchProof(issue, result.requirementCoverage);
    if (proof.status !== 'proven') {
      return { action: 'needs-evidence', reason: `命中 data-mismatch-needs-proof 反馈：API/UI 数据不一致未满足四段证据门槛，缺口：${proof.missingEvidence.join('；') || '未知'}。`, matchedSignals: ['data-mismatch-needs-proof'], confidence: 'high' };
    }
  }
  if (hasSignal(signals, 'error-state-required') && (/错误态|异常反馈|失败反馈|no feedback|error state|api-?500|api-?404|timeout/.test(text) || issue.category === 'integration-no-feedback')) {
    return { action: 'keep', reason: '命中 error-state-required 反馈：接口异常错误态/重试属于真实用户影响，应保留为实现缺陷候选。', matchedSignals: ['error-state-required'], confidence: 'high' };
  }
  if (hasSignal(signals, 'a11y-button-name-required') && (/aria|accessible name|button name|无障碍名称|图标按钮/.test(text) || issue.category === 'frontend-accessibility')) {
    return { action: 'keep', reason: '命中 a11y-button-name-required 反馈：图标按钮缺少可访问名称属于应修 a11y 问题。', matchedSignals: ['a11y-button-name-required'], confidence: 'high' };
  }
  if (hasSignal(signals, 'route-lazy-load-required') && (/懒加载|lazy|bundle|未使用.*js|route|codemirror|coverage/.test(text) || issue.category === 'frontend-performance' || issue.category === 'resource-performance')) {
    return { action: 'keep', reason: '命中 route-lazy-load-required 反馈：路由懒加载/拆包属于真实性能优化项。', matchedSignals: ['route-lazy-load-required'], confidence: 'medium' };
  }

  return {};
}

function actionFromDisposition(disposition: IssueDispositionItem | undefined): { action: ReviewCalibrationIssueAction; reason: string; confidence: 'high' | 'medium' | 'low' } {
  if (!disposition) return { action: 'review', reason: '缺少 issueDisposition，需人工复核。', confidence: 'low' };
  if (disposition.status === 'confirmed' && disposition.actionability === 'actionable') {
    return { action: 'keep', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
  }
  if (disposition.status === 'deployment-only') {
    return { action: 'out-of-scope', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
  }
  if (disposition.status === 'product-decision') {
    return { action: 'ask-product', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
  }
  if (disposition.status === 'tool-limitation' || disposition.status === 'reference') {
    return { action: 'downgrade', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
  }
  if (disposition.status === 'insufficient-evidence' || disposition.status === 'needs-source-confirmation') {
    return { action: 'needs-evidence', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
  }
  return { action: disposition.actionability === 'actionable' ? 'keep' : 'review', reason: `沿用现有处置：${disposition.reason}`, confidence: disposition.confidence };
}

function buildIssueDecisions(result: QaResult, signals: ReviewCalibrationSignal[]): ReviewCalibrationIssueDecision[] {
  return result.issues.map((issue) => {
    const disposition = dispositionFor(result, issue);
    const bySignals = classifyBySignals(issue, signals, result);
    const fallback = actionFromDisposition(disposition);
    return {
      issueId: issue.id,
      title: issue.title,
      category: issue.category,
      severity: issue.severity,
      action: bySignals.action ?? fallback.action,
      owner: disposition?.owner ?? issue.ownerHint ?? 'frontend',
      confidence: bySignals.confidence ?? fallback.confidence,
      reason: bySignals.reason ?? fallback.reason,
      evidenceRefs: evidenceRefs(issue),
      matchedSignals: bySignals.matchedSignals ?? []
    };
  });
}

function mergeProductContext(base: ProductContextConfig, signals: ReviewCalibrationSignal[]): ProductContextConfig {
  const merged = clone(base);
  for (const signal of signals) {
    const patch = signal.productContextPatch;
    if (!patch) continue;
    if (patch.deviceScope) merged.deviceScope = patch.deviceScope;
    if (patch.accessibilityTarget) merged.accessibilityTarget = patch.accessibilityTarget;
    if (patch.pageType) merged.pageType = patch.pageType;
    if (patch.requiredFeatures) merged.requiredFeatures = unique([...merged.requiredFeatures, ...patch.requiredFeatures]);
    if (patch.optionalFeatures) merged.optionalFeatures = unique([...merged.optionalFeatures, ...patch.optionalFeatures]);
    if (patch.outOfScopeFeatures) merged.outOfScopeFeatures = unique([...merged.outOfScopeFeatures, ...patch.outOfScopeFeatures]);
    if (patch.adrRefs) merged.adrRefs = unique([...merged.adrRefs, ...patch.adrRefs]);
    if (patch.decisions) {
      const existingIds = new Set(merged.decisions.map((item) => item.id).filter(Boolean));
      for (const decision of patch.decisions) {
        if (decision.id && existingIds.has(decision.id)) continue;
        merged.decisions.push(decision);
      }
    }
  }
  merged.enabled = true;
  return merged;
}

function baseProductContext(result: QaResult): ProductContextConfig {
  const configured = result.metadata.config.productContext;
  const suggested = result.scopeReview.configSnippet.productContext;
  return {
    enabled: true,
    productName: configured.productName ?? suggested.productName,
    pageName: configured.pageName ?? suggested.pageName ?? result.summary.title,
    pageType: configured.pageType && configured.pageType !== 'unknown' ? configured.pageType : suggested.pageType,
    deviceScope: configured.deviceScope !== 'unknown' ? configured.deviceScope : suggested.deviceScope,
    accessibilityTarget: configured.accessibilityTarget !== 'unknown' ? configured.accessibilityTarget : suggested.accessibilityTarget,
    requiredFeatures: unique([...(configured.requiredFeatures ?? []), ...(suggested.requiredFeatures ?? [])]),
    optionalFeatures: unique([...(configured.optionalFeatures ?? []), ...(suggested.optionalFeatures ?? [])]),
    outOfScopeFeatures: unique([...(configured.outOfScopeFeatures ?? []), ...(suggested.outOfScopeFeatures ?? [])]),
    decisions: [...(configured.decisions ?? []), ...(suggested.decisions ?? [])],
    adrRefs: unique([...(configured.adrRefs ?? []), ...(suggested.adrRefs ?? [])])
  };
}

function buildConfigPatch(result: QaResult, signals: ReviewCalibrationSignal[], issueDecisions: ReviewCalibrationIssueDecision[], feedbackProvided: boolean, calibrationSource: ReviewCalibrationResult['calibrationSource']): Record<string, unknown> {
  const productContext = mergeProductContext(baseProductContext(result), signals);
  const providedRequirementItems = result.metadata.config.requirements.items.filter((item) => item.source !== 'inferred');
  const sourceRoot = result.sourceAnalysis.root ?? result.metadata.config.source.root;
  const config: Record<string, unknown> = {
    _frontlensReviewCalibration: {
      generatedAt: new Date().toISOString(),
      purpose: 'Reusable reviewer/product feedback calibration. Keep this block as an audit trail; FrontLens uses standard productContext/requirements/source keys, and skills should read this block for triage policy.',
      feedbackProvided,
      calibrationSource,
      signals: signals.map((item) => ({ id: item.id, kind: item.kind, title: item.title, confidence: item.confidence })),
      policies: {
        requireSourceForFrontendDefects: hasSignal(signals, 'source-required'),
        treatDevServerMetricsAsNonProduction: hasSignal(signals, 'dev-server-noise'),
        dataMismatchRequiresFourPartProof: hasSignal(signals, 'data-mismatch-needs-proof'),
        doNotPromoteStyleToDefectWithoutProductConfirmation: hasSignal(signals, 'style-is-design')
      },
      issueActionSummary: Object.fromEntries(['keep', 'downgrade', 'out-of-scope', 'needs-evidence', 'ask-product', 'review'].map((action) => [action, issueDecisions.filter((item) => item.action === action).map((item) => item.issueId)]))
    },
    productContext,
    requirements: {
      enabled: true,
      inferFromPage: hasSignal(signals, 'data-mismatch-needs-proof') ? false : result.metadata.config.requirements.inferFromPage,
      items: clone(providedRequirementItems)
    },
    report: {
      ...clone(result.metadata.config.report),
      profile: 'executive'
    }
  };
  if (sourceRoot || hasSignal(signals, 'source-required')) {
    config.source = {
      ...clone(result.metadata.config.source),
      enabled: true,
      root: sourceRoot
    };
  }
  return config;
}

function summarizeFeedback(feedbackText: string | undefined, signals: ReviewCalibrationSignal[], calibrationSource: ReviewCalibrationResult['calibrationSource']): string {
  if (!feedbackText?.trim()) {
    if (calibrationSource === 'config') {
      return `Applied existing review-calibration config（signals: ${signals.map((item) => item.kind).join(', ') || 'none'}）.`;
    }
    return 'No reviewer feedback provided yet; this artifact is a reusable intake/template for calibration.';
  }
  const compact = feedbackText.replace(/\s+/g, ' ').trim();
  const snippet = compact.length > 220 ? `${compact.slice(0, 219).trimEnd()}…` : compact;
  return `${snippet}（recognized signals: ${signals.map((item) => item.kind).join(', ') || 'none'}）`;
}

function questionsFor(result: QaResult, signals: ReviewCalibrationSignal[], calibrationContextProvided: boolean): string[] {
  const questions: string[] = [];
  if (!calibrationContextProvided) {
    questions.push('请把人工复核/产品/设计/测试反馈粘贴给 `frontlens review-calibration --report <result.json> --feedback-file <feedback.md>`，再生成可复用 rerun config。');
  }
  if (!hasSignal(signals, 'source-required') && result.sourceAnalysis.status === 'skipped') {
    questions.push('是否要求后续所有前端缺陷必须带 sourceRoot 和 file:line？如是，请在 rerun config 中配置 source.root。');
  }
  if (!hasSignal(signals, 'data-mismatch-needs-proof') && result.issues.some((issue) => issue.category === 'integration-data-mismatch')) {
    questions.push('API/UI 数据不一致类结论是否必须提供 PRD、Network list path/count、可见空态、source-runtime 绑定四段证据？');
  }
  if (!hasSignal(signals, 'desktop-first') && (result.scopeReview.suggestedProductContext.deviceScope === 'desktop-first' || result.pageProfile.suggestedProductContext.deviceScope === 'desktop-first')) {
    questions.push('目标设备是否确认 desktop-first？这会影响移动触控、横向滚动和响应式问题的优先级。');
  }
  if (!hasSignal(signals, 'style-is-design')) {
    questions.push('哪些样式/视觉/交互密度属于产品设计如此？确认后应写入 productContext.decisions，避免重复报 must-fix。');
  }
  return questions.slice(0, 8);
}

function countAction(issueDecisions: ReviewCalibrationIssueDecision[], action: ReviewCalibrationIssueAction): number {
  return issueDecisions.filter((item) => item.action === action).length;
}

export function buildReviewCalibration(result: QaResult, options: BuildReviewCalibrationOptions = {}): ReviewCalibrationResult {
  const feedbackProvided = Boolean(options.feedbackText?.trim());
  const signals = inferSignals(options.feedbackText, result);
  const appliedConfig = addSignalsFromAppliedConfig(signals, result);
  const calibrationSource: ReviewCalibrationResult['calibrationSource'] = feedbackProvided ? 'feedback' : appliedConfig ? 'config' : 'none';
  const calibrationContextProvided = calibrationSource !== 'none';
  const issueDecisions = buildIssueDecisions(result, signals);
  const configPatch = buildConfigPatch(result, signals, issueDecisions, feedbackProvided, calibrationSource);
  const questions = questionsFor(result, signals, calibrationContextProvided);
  const status: ReviewCalibrationResult['status'] = !calibrationContextProvided ? 'needs-feedback' : questions.length > 0 || signals.length === 0 ? 'needs-input' : 'ready';
  return {
    generatedAt: new Date().toISOString(),
    status,
    calibrationSource,
    targetUrl: result.summary.url,
    feedbackProvided,
    feedbackSummary: summarizeFeedback(options.feedbackText, signals, calibrationSource),
    summary: {
      signalCount: signals.length,
      keepCount: countAction(issueDecisions, 'keep'),
      downgradeCount: countAction(issueDecisions, 'downgrade'),
      outOfScopeCount: countAction(issueDecisions, 'out-of-scope'),
      needsEvidenceCount: countAction(issueDecisions, 'needs-evidence'),
      askProductCount: countAction(issueDecisions, 'ask-product'),
      reviewCount: countAction(issueDecisions, 'review'),
      configPatchKeys: Object.keys(configPatch),
      questionCount: questions.length
    },
    signals,
    issueDecisions,
    configPatch,
    questions,
    nextSteps: [
      'Review and edit review-calibration.config.json; keep only confirmed product/QA/design decisions.',
      'Rerun FrontLens with `--config review-calibration.config.json` and sourceRoot/requirements when available.',
      'When reporting, retain only keep/proof-ready frontend defects; move downgrade/out-of-scope/needs-evidence rows out of the must-fix queue.',
      'For data mismatch claims, require explicit requirement + Network list response + visible UI empty state + source/runtime binding before filing a bug.'
    ],
    notes: [
      'Reviewer feedback is treated as a calibration input, not as automatic proof that a defect is fixed or false.',
      'The generated config is page/run-specific and compatible with different page types because it writes standard productContext/requirements/source keys instead of hard-coded selectors.',
      calibrationSource === 'config'
        ? 'An existing review-calibration config is applied, so future agents should preserve these decisions instead of asking for the same feedback again.'
        : 'If feedback is missing and no review-calibration config is applied, this artifact intentionally stays needs-feedback so future agents ask for context instead of guessing.'
    ]
  };
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

function truncate(value: string, max = 160): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function formatReviewCalibration(calibration: ReviewCalibrationResult): string {
  const signalRows = calibration.signals.map((item) => `| ${escapeMarkdown(item.id)} | ${escapeMarkdown(item.kind)} | ${escapeMarkdown(item.confidence)} | ${escapeMarkdown(truncate(item.title, 100))} | ${escapeMarkdown(truncate(item.rationale, 180))} |`);
  const issueRows = calibration.issueDecisions.slice(0, 40).map((item) => `| ${escapeMarkdown(item.issueId)} | ${escapeMarkdown(item.action)} | ${escapeMarkdown(item.owner)} | ${escapeMarkdown(item.confidence)} | ${escapeMarkdown(truncate(item.title, 90))} | ${escapeMarkdown(item.matchedSignals.join(', ') || '-')} | ${escapeMarkdown(truncate(item.reason, 170))} |`);
  const configJson = JSON.stringify(calibration.configPatch, null, 2).replace(/```/g, '`​``');
  const questionRows = calibration.questions.map((item) => `- ${escapeMarkdown(item)}`);
  const nextRows = calibration.nextSteps.map((item) => `- ${escapeMarkdown(item)}`);
  return `# FrontLens Review Calibration

## Status

- Status：**${calibration.status}**
- Calibration source：${escapeMarkdown(calibration.calibrationSource)}
- Target：${escapeMarkdown(calibration.targetUrl)}
- Feedback provided：${calibration.feedbackProvided}
- Feedback summary：${escapeMarkdown(calibration.feedbackSummary)}
- Signals：${calibration.summary.signalCount}
- Keep / Downgrade / Out-of-scope / Needs-evidence / Ask-product / Review：${calibration.summary.keepCount} / ${calibration.summary.downgradeCount} / ${calibration.summary.outOfScopeCount} / ${calibration.summary.needsEvidenceCount} / ${calibration.summary.askProductCount} / ${calibration.summary.reviewCount}

## Recognized reviewer/product signals

${signalRows.length ? ['| ID | Kind | Confidence | Title | Rationale |', '| --- | --- | --- | --- | --- |', ...signalRows, ''].join('\n') : 'No structured feedback signals yet. Provide reviewer feedback before using this as a rerun contract.'}

## Calibrated issue actions

${issueRows.length ? ['| Issue | Action | Owner | Confidence | Title | Matched signals | Reason |', '| --- | --- | --- | --- | --- | --- | --- |', ...issueRows, ''].join('\n') : 'No issues available to calibrate.'}

## Questions before applying

${questionRows.length ? questionRows.join('\n') : 'No extra questions. Review the config patch and rerun.'}

## Rerun config patch

Copy this JSON into a FrontLens config file or use the generated \`review-calibration.config.json\` artifact if available.

\`\`\`json
${configJson}
\`\`\`

## Next steps

${nextRows.join('\n')}

## Guardrail

Do not convert raw findings into must-fix defects solely because they appear in the scanner output. Use this calibration with issueDisposition, defectProof, sourceRuntimeCorrelation, productContext, and explicit requirements.
`;
}
