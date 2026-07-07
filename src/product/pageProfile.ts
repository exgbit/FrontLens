import type { FrontLensConfig, PageModel, PageProfileAssessment, PageProfileSuggestion, PageProfileType, ProductContextConfig } from '../types.js';

function textCorpus(pageModel: PageModel, config: FrontLensConfig): string {
  return [
    config.target.url,
    pageModel.url,
    pageModel.title,
    pageModel.meta.description,
    pageModel.meta.h1.join(' '),
    pageModel.breadcrumbs.join(' '),
    pageModel.headings.map((item) => item.text).join(' '),
    pageModel.components.map((item) => `${item.type} ${item.label ?? ''} ${item.text ?? ''} ${item.placeholder ?? ''}`).join(' '),
    pageModel.stats.bodyTextSample
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function hasExplicitProductContext(context: ProductContextConfig): boolean {
  return Boolean(
    context.enabled &&
      (context.productName ||
        context.pageName ||
        (context.pageType && context.pageType !== 'unknown') ||
        context.deviceScope !== 'unknown' ||
        context.accessibilityTarget !== 'basic' ||
        context.requiredFeatures.length > 0 ||
        context.optionalFeatures.length > 0 ||
        context.outOfScopeFeatures.length > 0 ||
        context.decisions.length > 0 ||
        context.adrRefs.length > 0)
  );
}

function normalizePageType(value: string | undefined): PageProfileType {
  const normalized = (value ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  if (normalized === 'credential-security' || normalized === 'credential' || normalized === 'credentials' || normalized === 'security-credential') return 'credential-security';
  if (normalized === 'admin-data-list' || normalized === 'data-list' || normalized === 'table' || normalized === 'list') return 'admin-data-list';
  if (normalized === 'admin-dashboard' || normalized === 'dashboard' || normalized === 'overview') return 'admin-dashboard';
  if (normalized === 'form-flow' || normalized === 'form' || normalized === 'wizard') return 'form-flow';
  if (normalized === 'detail-master' || normalized === 'master-detail' || normalized === 'detail') return 'detail-master';
  if (normalized === 'auth-login' || normalized === 'login' || normalized === 'signin' || normalized === 'sign-in') return 'auth-login';
  if (normalized === 'public-content' || normalized === 'marketing' || normalized === 'content') return 'public-content';
  return 'unknown';
}

function emptySuggestion(): PageProfileSuggestion {
  return {
    requiredFeatures: [],
    optionalFeatures: [],
    outOfScopeFeatures: [],
    decisions: []
  };
}

export function createEmptyPageProfileAssessment(): PageProfileAssessment {
  return {
    checkedAt: new Date().toISOString(),
    status: 'unknown',
    pageType: 'unknown',
    confidence: 'low',
    source: 'none',
    signals: [],
    suggestedProductContext: emptySuggestion(),
    caveats: ['Page profile assessment missing from report.'],
    questions: ['Provide productContext or PRD/ADR scope so style, pagination, export, refresh, and mobile findings can be triaged without guesswork.']
  };
}

function suggestionFor(pageType: PageProfileType, pageModel: PageModel): PageProfileSuggestion {
  const hasSearch = pageModel.inputs.some((input) => /搜索|search|filter|筛选|query/i.test(`${input.label ?? ''} ${input.placeholder ?? ''} ${input.text ?? ''}`));
  switch (pageType) {
    case 'credential-security':
      return {
        pageType,
        deviceScope: 'desktop-first',
        accessibilityTarget: 'basic',
        requiredFeatures: ['error-state', 'permission-feedback', 'secret-masking', 'copy-feedback'],
        optionalFeatures: ['mobile-touch-target', 'manual-refresh'],
        outOfScopeFeatures: [],
        decisions: [
          {
            title: 'Confirm whether exporting credentials/secrets is intentionally unsupported for this page.',
            appliesTo: ['export', 'download']
          }
        ]
      };
    case 'admin-data-list':
      return {
        pageType,
        deviceScope: 'desktop-first',
        accessibilityTarget: 'basic',
        requiredFeatures: ['loading-state', 'empty-state', 'error-state', ...(hasSearch ? ['search'] : [])],
        optionalFeatures: ['pagination', 'export', 'mobile-touch-target', 'manual-refresh'],
        outOfScopeFeatures: [],
        decisions: []
      };
    case 'admin-dashboard':
      return {
        pageType,
        deviceScope: 'desktop-first',
        accessibilityTarget: 'basic',
        requiredFeatures: ['loading-state', 'error-state', 'metric-data-accuracy'],
        optionalFeatures: ['mobile-touch-target', 'seo', 'export'],
        outOfScopeFeatures: [],
        decisions: []
      };
    case 'form-flow':
      return {
        pageType,
        deviceScope: 'responsive',
        accessibilityTarget: 'basic',
        requiredFeatures: ['form-validation', 'submit-feedback', 'duplicate-submit-guard', 'error-state'],
        optionalFeatures: ['mobile-touch-target'],
        outOfScopeFeatures: [],
        decisions: []
      };
    case 'detail-master':
      return {
        pageType,
        deviceScope: 'desktop-first',
        accessibilityTarget: 'basic',
        requiredFeatures: ['selection-state', 'detail-state', 'empty-state', 'error-state'],
        optionalFeatures: ['manual-refresh', 'mobile-touch-target', 'export'],
        outOfScopeFeatures: [],
        decisions: []
      };
    case 'auth-login':
      return {
        pageType,
        deviceScope: 'responsive',
        accessibilityTarget: 'wcag-aa',
        requiredFeatures: ['form-validation', 'auth-error-feedback', 'keyboard-focus', 'password-security'],
        optionalFeatures: ['seo'],
        outOfScopeFeatures: [],
        decisions: []
      };
    case 'public-content':
      return {
        pageType,
        deviceScope: 'responsive',
        accessibilityTarget: 'wcag-aa',
        requiredFeatures: ['seo', 'responsive', 'accessibility', 'image-alt'],
        optionalFeatures: ['performance-budget'],
        outOfScopeFeatures: [],
        decisions: []
      };
    default:
      return emptySuggestion();
  }
}

function questionsFor(pageType: PageProfileType): string[] {
  switch (pageType) {
    case 'credential-security':
      return [
        '凭证/密钥是否必须脱敏显示，并禁止导出或下载？',
        '复制、启停、改名、授权刷新等操作是否需要二次确认、审计提示或角色权限矩阵？',
        'PC-first、移动端降级是否是明确 ADR？'
      ];
    case 'admin-data-list':
      return [
        '分页、排序、导出、批量操作哪些是当前版本必需，哪些是可选？',
        '搜索/筛选是否必须触发接口参数变化，还是允许本地过滤？',
        '移动端是否正式支持，还是仅自适应降级？'
      ];
    case 'admin-dashboard':
      return [
        '指标口径、时间范围、空数据和接口失败的展示规则是什么？',
        '图表/指标是否需要导出、刷新或下钻？',
        '性能预算应以 dev、preview 还是生产 CDN 为准？'
      ];
    case 'form-flow':
      return [
        '必填、边界值、重复提交、提交失败和成功反馈的验收标准是什么？',
        '是否允许在测试环境执行真实创建/编辑/提交动作？',
        '是否需要多角色/多状态表单权限验证？'
      ];
    case 'detail-master':
      return [
        '左侧列表和右侧详情的空态、选中态、加载失败态如何区分？',
        '详情操作是否需要刷新、导出、权限控制或二次确认？',
        '默认选中第一项还是保持空详情，是否有 PRD 约束？'
      ];
    case 'auth-login':
      return [
        '账号密码错误、锁定、过期、MFA/Captcha 的错误提示和安全策略是什么？',
        '是否需要键盘-only、读屏和移动端登录验收？',
        '是否允许保存/复用登录态做后续角色矩阵测试？'
      ];
    case 'public-content':
      return [
        'SEO、分享卡片、图片 alt、移动端布局是否是发布阻断项？',
        'Core Web Vitals / CDN / 缓存预算以哪个环境为准？',
        '是否需要跨浏览器和无障碍 AA 验收？'
      ];
    default:
      return [
        '该页面的类型、目标设备、必需功能、可选功能和不在范围内功能是什么？',
        '哪些样式/交互属于产品设计取舍，哪些属于发布阻断缺陷？'
      ];
  }
}

function confidenceFor(score: number): PageProfileAssessment['confidence'] {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

export function buildPageProfileAssessment(input: {
  config: FrontLensConfig;
  pageModel: PageModel;
}): PageProfileAssessment {
  const configured = hasExplicitProductContext(input.config.productContext);
  const configuredPageType = input.config.productContext.pageType;
  if (configured) {
    const pageType = normalizePageType(configuredPageType);
    const suggestion: PageProfileSuggestion = {
      pageType: pageType === 'unknown' ? undefined : pageType,
      deviceScope: input.config.productContext.deviceScope,
      accessibilityTarget: input.config.productContext.accessibilityTarget,
      requiredFeatures: [...input.config.productContext.requiredFeatures],
      optionalFeatures: [...input.config.productContext.optionalFeatures],
      outOfScopeFeatures: [...input.config.productContext.outOfScopeFeatures],
      decisions: [...input.config.productContext.decisions]
    };
    return {
      checkedAt: new Date().toISOString(),
      status: 'configured',
      pageType,
      configuredPageType,
      confidence: 'high',
      source: 'productContext',
      signals: [
        `productContext.deviceScope=${input.config.productContext.deviceScope}`,
        `productContext.accessibilityTarget=${input.config.productContext.accessibilityTarget}`,
        `required=${input.config.productContext.requiredFeatures.length}`,
        `optional=${input.config.productContext.optionalFeatures.length}`,
        `outOfScope=${input.config.productContext.outOfScopeFeatures.length}`,
        `decisions=${input.config.productContext.decisions.length}`
      ],
      suggestedProductContext: suggestion,
      caveats: ['Explicit productContext is present and should be used as the source of truth for product/design triage.'],
      questions: questionsFor(pageType)
    };
  }

  const text = textCorpus(input.pageModel, input.config);
  const componentTypes = new Set(input.pageModel.components.map((item) => item.type));
  const scores: Record<PageProfileType, { score: number; signals: string[] }> = {
    'credential-security': { score: 0, signals: [] },
    'admin-data-list': { score: 0, signals: [] },
    'admin-dashboard': { score: 0, signals: [] },
    'form-flow': { score: 0, signals: [] },
    'detail-master': { score: 0, signals: [] },
    'auth-login': { score: 0, signals: [] },
    'public-content': { score: 0, signals: [] },
    unknown: { score: 0, signals: [] }
  };
  const add = (type: PageProfileType, score: number, signal: string): void => {
    scores[type].score += score;
    scores[type].signals.push(signal);
  };

  if (/credential|credentials|凭证|密钥|secret|token|授权|api[-\s]?key|password/.test(text)) add('credential-security', 3, 'credential/security keywords in URL/text/components');
  if (/login|sign[-\s]?in|登录|密码/.test(text) && input.pageModel.inputs.length > 0) add('auth-login', 3, 'login/password keywords with inputs');
  if (input.pageModel.tables.length > 0 || componentTypes.has('table')) add('admin-data-list', 3, 'table component detected');
  if (componentTypes.has('list') || componentTypes.has('grid')) add('admin-data-list', 2, 'list/grid component detected');
  if (/搜索|筛选|search|filter|query|分页|pagination|排序|sort/.test(text)) add('admin-data-list', 2, 'list interaction keywords detected');
  if (/dashboard|overview|概览|看板|趋势|指标|chart|metric|统计/.test(text)) add('admin-dashboard', 3, 'dashboard/metric keywords detected');
  if (input.pageModel.forms.length > 0 || componentTypes.has('form')) add('form-flow', 3, 'form component detected');
  if (/提交|保存|新增|编辑|submit|save|create|edit/.test(text) && input.pageModel.inputs.length >= 2) add('form-flow', 2, 'submit/save keywords with multiple inputs');
  if (componentTypes.has('card') && (componentTypes.has('list') || componentTypes.has('grid') || componentTypes.has('tab'))) add('detail-master', 2, 'card with list/grid/tab suggests master-detail layout');
  if (/详情|detail|选中|selected|主从|站点|店铺/.test(text) && componentTypes.has('card')) add('detail-master', 2, 'detail/master-detail keywords with cards');
  if ((input.pageModel.images.length >= 2 || input.pageModel.links.length >= 8) && input.pageModel.forms.length === 0 && input.pageModel.tables.length === 0) add('public-content', 2, 'content-heavy page with images/links and no forms/tables');
  if (input.pageModel.meta.description || input.pageModel.meta.openGraph && Object.keys(input.pageModel.meta.openGraph).length > 0) add('public-content', 1, 'SEO/social metadata detected');

  const ranked = (Object.entries(scores) as Array<[PageProfileType, { score: number; signals: string[] }]>).filter(([type]) => type !== 'unknown').sort((a, b) => b[1].score - a[1].score);
  const [bestType, best] = ranked[0] ?? ['unknown', scores.unknown];
  const pageType = best.score > 0 ? bestType : 'unknown';
  const status: PageProfileAssessment['status'] = best.score >= 2 ? 'inferred' : 'unknown';
  const suggestion = suggestionFor(pageType, input.pageModel);
  return {
    checkedAt: new Date().toISOString(),
    status,
    pageType,
    confidence: confidenceFor(best.score),
    source: status === 'inferred' ? 'heuristic' : 'none',
    signals: best.signals.slice(0, 10),
    suggestedProductContext: suggestion,
    caveats: status === 'inferred'
      ? ['Heuristic page profile is only a scope prompt; do not use it as confirmed PRD/ADR.', 'Use suggestedProductContext to ask focused product questions, then rerun with explicit productContext for final triage.']
      : ['No reliable page profile was inferred; product/design findings should remain conditional until PRD/ADR/productContext is supplied.'],
    questions: questionsFor(pageType)
  };
}
