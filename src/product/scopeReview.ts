import type { FrontLensConfig, ProductContextConfig, ProductDecisionConfig, RequirementCoverageResult, ScopeReviewQuestion, ScopeReviewResult, PageProfileAssessment } from '../types.js';

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function cloneDecisions(decisions: ProductDecisionConfig[]): ProductDecisionConfig[] {
  return decisions.map((decision, index) => ({
    id: decision.id ?? `SCOPE-DECISION-${String(index + 1).padStart(3, '0')}`,
    title: decision.title,
    appliesTo: decision.appliesTo ? [...decision.appliesTo] : undefined,
    rationale: decision.rationale
  }));
}

function suggestedProductContext(input: {
  config: FrontLensConfig;
  pageProfile: PageProfileAssessment;
  title?: string;
}): ProductContextConfig {
  const existing = input.config.productContext;
  const suggestion = input.pageProfile.suggestedProductContext;
  const pageType = suggestion.pageType ?? (input.pageProfile.pageType === 'unknown' ? existing.pageType : input.pageProfile.pageType);
  return {
    enabled: true,
    productName: existing.productName,
    pageName: existing.pageName ?? input.title,
    pageType,
    deviceScope: suggestion.deviceScope ?? existing.deviceScope,
    accessibilityTarget: suggestion.accessibilityTarget ?? existing.accessibilityTarget,
    requiredFeatures: unique([...(existing.requiredFeatures ?? []), ...(suggestion.requiredFeatures ?? [])]),
    optionalFeatures: unique([...(existing.optionalFeatures ?? []), ...(suggestion.optionalFeatures ?? [])]),
    outOfScopeFeatures: unique([...(existing.outOfScopeFeatures ?? []), ...(suggestion.outOfScopeFeatures ?? [])]),
    decisions: cloneDecisions([...(existing.decisions ?? []), ...(suggestion.decisions ?? [])]),
    adrRefs: [...(existing.adrRefs ?? [])]
  };
}

function question(input: Omit<ScopeReviewQuestion, 'id'>, index: number): ScopeReviewQuestion {
  return {
    id: `SCOPE-Q-${String(index + 1).padStart(3, '0')}`,
    ...input
  };
}

export function buildScopeReview(input: {
  config: FrontLensConfig;
  pageProfile: PageProfileAssessment;
  requirementCoverage: RequirementCoverageResult;
  title?: string;
}): ScopeReviewResult {
  const productContext = suggestedProductContext(input);
  const rawQuestions: Array<Omit<ScopeReviewQuestion, 'id'>> = [];
  const providedRequirementCount = input.requirementCoverage.summary.providedCount;
  const inferredScope = input.pageProfile.status !== 'configured';

  if (providedRequirementCount === 0) {
    rawQuestions.push({
      category: 'requirement',
      question: '是否可以提供 PRD/验收标准，并把核心断言编码为 selectors、expectedTexts、apiPatterns 或 journeySteps？',
      impact: '缺少显式需求时，运行结果只能证明页面在当前证据范围内的行为，不能宣称业务功能 100% 通过。',
      defaultDisposition: '需求覆盖结论保持 coverage gap；业务验收置信度不超过 runtime-partial。'
    });
  }

  if (inferredScope) {
    for (const item of input.pageProfile.questions) {
      rawQuestions.push({
        category: 'product',
        question: item,
        impact: '产品范围未确认会让样式、导出、分页、刷新、移动触控等发现无法稳定区分缺陷与设计取舍。',
        defaultDisposition: '相关 raw finding 保持 conditional/product-decision，不进入必须修复队列。'
      });
    }
  }

  if (!productContext.pageType || productContext.pageType === 'unknown') {
    rawQuestions.push({
      category: 'product',
      question: '当前页面类型是什么，例如 credential-security、admin-data-list、dashboard、form-flow、detail-master、auth-login 或 public-content？',
      impact: '页面类型会影响分页、导出、SEO、触控、异常态、权限等规则是否属于当前页面必需能力。',
      defaultDisposition: '页面类型未知时，页面形态相关发现保持 conditional，不作为必须修复项。'
    });
  }

  if (productContext.deviceScope === 'unknown') {
    rawQuestions.push({
      category: 'device',
      question: '目标设备范围是什么：desktop-only、desktop-first、responsive 还是 mobile-first？',
      impact: '设备范围决定响应式、触控目标、横向滚动等发现是否属于缺陷。',
      defaultDisposition: '移动/触控类问题保持 conditional，除非阻断核心桌面任务。'
    });
  }

  if (productContext.accessibilityTarget === 'unknown') {
    rawQuestions.push({
      category: 'accessibility',
      question: '无障碍目标是 basic、WCAG AA 还是 WCAG AAA？',
      impact: '无障碍等级决定图标按钮命名、键盘导航、对比度和触控尺寸的验收强度。',
      defaultDisposition: '无明确等级时仅保留可复现的关键 a11y 阻断项为缺陷，其余为 should-fix/风险。'
    });
  }

  if (inferredScope && productContext.optionalFeatures.length > 0) {
    rawQuestions.push({
      category: 'feature',
      question: `以下能力是否确认为可选/降级：${productContext.optionalFeatures.join(', ')}？`,
      impact: '确认后这些能力相关发现不会污染核心缺陷列表；若提升为必需，需要进入 PRD 和 requirements。',
      defaultDisposition: '默认按 optional 处理，不作为发布阻断。'
    });
  }

  if (inferredScope && productContext.outOfScopeFeatures.length > 0) {
    rawQuestions.push({
      category: 'feature',
      question: `以下能力是否确认不在当前版本范围内：${productContext.outOfScopeFeatures.join(', ')}？`,
      impact: '确认后对应 raw finding 直接进入 non-actionable/product-decision。',
      defaultDisposition: '默认按 out-of-scope 处理，不生成 fix task。'
    });
  }

  if (input.pageProfile.pageType === 'credential-security' || input.pageProfile.pageType === 'auth-login') {
    rawQuestions.push({
      category: 'role',
      question: '是否需要提供管理员/只读/未登录等角色态来验证权限、危险操作和敏感信息展示？',
      impact: '没有角色矩阵时，只能把权限差异作为 review evidence，不能断言权限设计正确。',
      defaultDisposition: '权限相关结论保持 pass-with-risks，直到提供 role-matrix 期望。'
    });
  }

  const questions = rawQuestions.map(question);
  const needsInput = questions.length > 0 || input.pageProfile.status !== 'configured';
  const notes = [
    'Use this scope review before turning style/product/interaction observations into code defects.',
    'Copy configSnippet.productContext into FrontLens config after product/QA confirms the answers, then rerun QA.',
    needsInput
      ? 'Until these questions are answered, product-scope findings should stay conditional or non-actionable.'
      : 'Product scope is configured; use productContext as the source of truth for product/design triage.'
  ];

  return {
    generatedAt: new Date().toISOString(),
    status: needsInput ? 'needs-input' : 'configured',
    confidence: input.pageProfile.status === 'configured' && providedRequirementCount > 0 ? 'high' : input.pageProfile.confidence,
    pageType: input.pageProfile.pageType,
    summary: needsInput
      ? `Scope review needs input: ${questions.length} question(s) should be answered before full business/product sign-off.`
      : 'Scope review configured: productContext and provided requirements are available for professional triage.',
    questions,
    suggestedProductContext: productContext,
    configSnippet: {
      productContext
    },
    notes
  };
}

export function createEmptyScopeReview(config: FrontLensConfig): ScopeReviewResult {
  const productContext: ProductContextConfig = {
    enabled: true,
    productName: config.productContext.productName,
    pageName: config.productContext.pageName,
    pageType: config.productContext.pageType,
    deviceScope: config.productContext.deviceScope,
    accessibilityTarget: config.productContext.accessibilityTarget,
    requiredFeatures: [...config.productContext.requiredFeatures],
    optionalFeatures: [...config.productContext.optionalFeatures],
    outOfScopeFeatures: [...config.productContext.outOfScopeFeatures],
    decisions: cloneDecisions(config.productContext.decisions),
    adrRefs: [...config.productContext.adrRefs]
  };
  return {
    generatedAt: new Date().toISOString(),
    status: 'needs-input',
    confidence: 'low',
    pageType: 'unknown',
    summary: 'Scope review missing from report.',
    questions: [
      question({
        category: 'product',
        question: '请提供页面类型、必需/可选/不在范围内能力、目标设备、无障碍等级和 PRD/ADR。',
        impact: '缺少范围输入时，产品/样式/体验类发现不能稳定定责。',
        defaultDisposition: '保持 conditional 或 product-decision。'
      }, 0)
    ],
    suggestedProductContext: productContext,
    configSnippet: { productContext },
    notes: ['Older reports may not contain scopeReview; rerun QA with FrontLens 1.28+ to generate it.']
  };
}
