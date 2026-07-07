import type { DefectProofDimension, DefectProofItem, DefectProofResult, Issue, IssueDispositionItem, QaResult, RequirementCoverageItem, RootCauseGroup, SourceRuntimeLink } from '../types.js';

type DefectProofInput = Pick<QaResult, 'rootCauseGroups' | 'issues' | 'issueDisposition' | 'requirementCoverage' | 'sourceAnalysis' | 'sourceRuntimeCorrelation' | 'sourceHealth' | 'scopeReview' | 'environment'>;

type Strength = DefectProofDimension['strength'];

type DimensionKey = keyof DefectProofItem['dimensions'];

const WEIGHTS: Record<DimensionKey, number> = {
  userImpact: 15,
  runtimeEvidence: 20,
  sourceEvidence: 20,
  requirementEvidence: 15,
  productScope: 10,
  reproducibility: 10,
  ownerFixSurface: 10
};

const STRENGTH_SCORE: Record<Strength, number> = {
  strong: 1,
  medium: 0.65,
  weak: 0.35,
  missing: 0,
  'not-needed': 1
};

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function issueDetails(issue: Issue): Record<string, unknown> {
  return issue.evidence.details && typeof issue.evidence.details === 'object' ? issue.evidence.details as Record<string, unknown> : {};
}

function dimension(strength: Strength, reason: string, evidenceRefs: string[] = []): DefectProofDimension {
  return { strength, reason, evidenceRefs: uniq(evidenceRefs) };
}

function groupIssues(group: RootCauseGroup, issues: Issue[]): Issue[] {
  const ids = new Set(group.issueIds);
  return issues.filter((issue) => ids.has(issue.id));
}

function groupDispositions(group: RootCauseGroup, dispositions: IssueDispositionItem[]): IssueDispositionItem[] {
  const ids = new Set(group.issueIds);
  return dispositions.filter((item) => ids.has(item.issueId));
}

function linkedRequirements(group: RootCauseGroup, requirements: RequirementCoverageItem[]): RequirementCoverageItem[] {
  const issueIds = new Set(group.issueIds);
  return requirements.filter((item) => item.evidence.issueIds.some((id) => issueIds.has(id)) || item.evidence.journeyIds.some((id) => group.issueIds.includes(id)));
}

function linkedRuntimeLinks(group: RootCauseGroup, links: SourceRuntimeLink[]): SourceRuntimeLink[] {
  const networkIds = new Set(group.networkRequestIds);
  return links.filter((link) => networkIds.has(link.networkRequestId));
}

function userImpactDimension(group: RootCauseGroup, issues: Issue[]): DefectProofDimension {
  const highImpact = group.severity === 'critical' || group.severity === 'high';
  const hasUserFacingText = issues.some((issue) => /用户|页面|按钮|表单|列表|错误|无法|失败|空|blocked|broken|visible|click|render|load/i.test(`${issue.title} ${issue.description} ${issue.reason}`));
  if (highImpact && hasUserFacingText) return dimension('strong', '严重级别和描述均指向用户可感知影响。', group.issueIds);
  if (highImpact || hasUserFacingText || group.severity === 'medium') return dimension('medium', '存在用户影响信号，但仍应结合需求/路径确认影响范围。', group.issueIds);
  return dimension('weak', '影响主要来自低优先级或参考级观察，不足以单独支撑 must-fix。', group.issueIds);
}

function runtimeEvidenceDimension(group: RootCauseGroup, issues: Issue[]): DefectProofDimension {
  const refs = uniq([
    ...group.selectors.map((item) => `selector:${item}`),
    ...group.networkRequestIds.map((item) => `network:${item}`),
    ...group.consoleIds.map((item) => `console:${item}`),
    ...group.pageErrorIds.map((item) => `pageError:${item}`),
    ...group.resourceUrls.map((item) => `resource:${item}`),
    ...issues.flatMap((issue) => [issue.evidence.screenshot ? `${issue.id}.screenshot` : '', issue.evidence.dom ? `${issue.id}.dom` : '', issue.evidence.componentId ? `component:${issue.evidence.componentId}` : ''])
  ]);
  if (group.selectors.length || group.networkRequestIds.length || group.consoleIds.length || group.pageErrorIds.length) {
    return dimension('strong', '具备可定位的运行时证据（selector/network/console/pageError）。', refs);
  }
  if (refs.length || issues.some((issue) => issue.evidence.details)) {
    return dimension('medium', '存在运行时或规则细节证据，但定位链路不完整。', refs.length ? refs : group.issueIds);
  }
  return dimension('missing', '缺少可复核的运行时证据，不能作为已证明缺陷。', group.issueIds);
}

function sourceEvidenceDimension(input: DefectProofInput, group: RootCauseGroup, issues: Issue[], runtimeLinks: SourceRuntimeLink[]): DefectProofDimension {
  const sourceFiles = uniq(issues.map((issue) => String(issueDetails(issue).sourceFile ?? '')).filter(Boolean));
  const sourceLocations = group.sourceLocations.map((location) => `${location.file}:${location.line}${location.column !== undefined ? `:${location.column}` : ''}`);
  const strongLinks = runtimeLinks.filter((link) => link.confidence === 'high' || link.confidence === 'medium');
  if (sourceLocations.length) {
    return dimension('strong', '根因已包含可执行源码 file:line 定位。', sourceLocations.map((location) => `source:${location}`));
  }
  if (sourceFiles.length) {
    return dimension('strong', 'raw finding 已包含源码文件/行号证据。', sourceFiles.map((file) => `source:${file}`));
  }
  if (strongLinks.length) {
    return dimension('strong', '运行时请求已和源码 API/state/component 建立 medium/high 绑定。', strongLinks.map((link) => link.id));
  }
  if (group.owner !== 'frontend' && !group.categories.some((category) => category.startsWith('integration') || category.startsWith('frontend'))) {
    return dimension('not-needed', '该根因 owner 不是前端代码；源码文件证据不是判定它的必要条件。', [group.id]);
  }
  if (input.sourceHealth.status === 'failed') {
    return dimension('strong', 'sourceHealth 已失败，源码层存在可复核阻断。', ['sourceHealth']);
  }
  if (input.sourceAnalysis.status === 'passed') {
    return dimension('weak', '已提供源码索引，但当前根因尚未绑定到具体文件/状态信号。', ['sourceAnalysis']);
  }
  return dimension('missing', '缺少 sourceRoot/sourceRuntime 绑定；前端缺陷结论需要源码或状态流证据补强。', ['sourceAnalysis', 'sourceRuntimeCorrelation']);
}

function requirementEvidenceDimension(input: DefectProofInput, group: RootCauseGroup, requirements: RequirementCoverageItem[]): DefectProofDimension {
  if (requirements.length) {
    const passed = requirements.filter((item) => item.status === 'passed').length;
    return dimension(passed === requirements.length ? 'strong' : 'medium', '根因已关联到 requirementCoverage 条目，可判断是否违反明确验收标准。', requirements.map((item) => item.id));
  }
  if (input.requirementCoverage.summary.providedCount > 0) {
    return dimension('missing', '存在用户提供需求，但该根因没有关联到具体需求；需要确认是否违反验收标准。', ['requirementCoverage']);
  }
  if (group.categories.some((category) => category === 'security' || category.includes('source-health') || category.includes('performance'))) {
    return dimension('not-needed', '该类技术质量问题可不依赖业务 PRD 判定，但仍需保留影响范围说明。', [group.id]);
  }
  return dimension('weak', '未提供 PRD/验收标准；只能按通用可用性风险处理，不能宣称业务需求被违反。', ['requirementCoverage']);
}

function productScopeDimension(input: DefectProofInput, group: RootCauseGroup): DefectProofDimension {
  if (input.scopeReview.status === 'configured') {
    return dimension('strong', 'productContext/scopeReview 已配置，可区分缺陷、产品取舍和可选项。', ['scopeReview']);
  }
  const likelyProductSensitive = group.categories.some((category) => category === 'frontend-accessibility' || category === 'frontend-responsive' || category === 'seo' || category === 'frontend-ui');
  if (likelyProductSensitive) {
    return dimension('weak', '产品范围未确认，而该根因可能受样式、设备、a11y 或页面类型取舍影响。', ['scopeReview', 'pageProfile']);
  }
  return dimension('medium', '产品范围未完全确认，但该根因主要来自技术/异常证据，受产品取舍影响较小。', ['scopeReview']);
}

function reproducibilityDimension(issues: Issue[]): DefectProofDimension {
  const withSteps = issues.filter((issue) => issue.reproduceSteps.length > 0);
  if (withSteps.length === issues.length && issues.length > 0) return dimension('strong', '所有 raw finding 都包含复现步骤。', withSteps.map((issue) => issue.id));
  if (withSteps.length > 0) return dimension('medium', '部分 raw finding 包含复现步骤。', withSteps.map((issue) => issue.id));
  return dimension('missing', '缺少复现步骤，不能支撑专业缺陷登记。', []);
}

function ownerFixSurfaceDimension(group: RootCauseGroup, dispositions: IssueDispositionItem[]): DefectProofDimension {
  const actionable = dispositions.filter((item) => item.actionability === 'actionable');
  if (group.owner && group.suggestedFix && actionable.length > 0) {
    return dimension('strong', '已具备 owner、suggestedFix 和 actionable disposition。', uniq([group.id, ...actionable.map((item) => item.issueId)]));
  }
  if (group.owner && group.suggestedFix) return dimension('medium', '已有 owner/fix surface，但 actionability 仍需确认。', [group.id]);
  return dimension('missing', '缺少明确 owner 或修复面。', [group.id]);
}

function scoreOf(dimensions: DefectProofItem['dimensions']): number {
  const raw = (Object.entries(dimensions) as Array<[DimensionKey, DefectProofDimension]>).reduce((sum, [key, value]) => sum + WEIGHTS[key] * STRENGTH_SCORE[value.strength], 0);
  return Math.round(raw);
}

function statusOf(score: number, dimensions: DefectProofItem['dimensions'], dispositions: IssueDispositionItem[], group: RootCauseGroup): DefectProofItem['status'] {
  if (dispositions.length > 0 && dispositions.every((item) => item.actionability !== 'actionable')) return 'not-a-defect';
  const runtimeMissing = dimensions.runtimeEvidence.strength === 'missing';
  const ownerMissing = dimensions.ownerFixSurface.strength === 'missing';
  const sourceUnprovenForFrontend = group.owner === 'frontend' && (dimensions.sourceEvidence.strength === 'missing' || dimensions.sourceEvidence.strength === 'weak');
  const isDataMismatch = group.categories.includes('integration-data-mismatch');
  if (isDataMismatch) {
    const requirementUnproven = dimensions.requirementEvidence.strength === 'missing' || dimensions.requirementEvidence.strength === 'weak';
    const runtimeUnproven = dimensions.runtimeEvidence.strength === 'missing' || dimensions.runtimeEvidence.strength === 'weak';
    const sourceUnproven = dimensions.sourceEvidence.strength === 'missing' || dimensions.sourceEvidence.strength === 'weak';
    if (requirementUnproven || runtimeUnproven || sourceUnproven || ownerMissing) return 'needs-evidence';
  }
  if (sourceUnprovenForFrontend) return 'needs-evidence';
  if (score >= 80 && !runtimeMissing && !ownerMissing) return 'proven';
  if (score >= 60 && !runtimeMissing && !ownerMissing) return 'probable';
  return 'needs-evidence';
}

function missingEvidence(dimensions: DefectProofItem['dimensions']): string[] {
  return (Object.entries(dimensions) as Array<[DimensionKey, DefectProofDimension]>)
    .filter(([, value]) => value.strength === 'missing' || value.strength === 'weak')
    .map(([key, value]) => `${key}: ${value.reason}`);
}

function nextStepsFor(item: Omit<DefectProofItem, 'nextSteps'>): string[] {
  const steps: string[] = [];
  const d = item.dimensions;
  if (d.runtimeEvidence.strength === 'missing' || d.reproducibility.strength === 'missing') steps.push('补充可复现 journey/selector/screenshot/network/console 证据。');
  if (d.sourceEvidence.strength === 'missing' || d.sourceEvidence.strength === 'weak') steps.push('提供 sourceRoot 并建立 sourceRuntimeCorrelation，或补充源码 file:line。');
  if (d.requirementEvidence.strength === 'missing' || d.requirementEvidence.strength === 'weak') steps.push('关联 PRD/验收标准；若不是需求缺陷，降级为技术风险或观察项。');
  if (d.productScope.strength === 'weak') steps.push('回答 scopeReview / qaIntake 产品范围问题后再定责。');
  if (d.ownerFixSurface.strength === 'missing') steps.push('明确 owner 和修复面，否则不进入实现排期。');
  return uniq(steps);
}

function buildItem(input: DefectProofInput, group: RootCauseGroup): DefectProofItem {
  const issues = groupIssues(group, input.issues);
  const dispositions = groupDispositions(group, input.issueDisposition.items);
  const requirements = linkedRequirements(group, input.requirementCoverage.items);
  const runtimeLinks = linkedRuntimeLinks(group, input.sourceRuntimeCorrelation.links);
  const dimensions: DefectProofItem['dimensions'] = {
    userImpact: userImpactDimension(group, issues),
    runtimeEvidence: runtimeEvidenceDimension(group, issues),
    sourceEvidence: sourceEvidenceDimension(input, group, issues, runtimeLinks),
    requirementEvidence: requirementEvidenceDimension(input, group, requirements),
    productScope: productScopeDimension(input, group),
    reproducibility: reproducibilityDimension(issues),
    ownerFixSurface: ownerFixSurfaceDimension(group, dispositions)
  };
  const score = scoreOf(dimensions);
  const partial = {
    id: `PROOF-${group.id.replace(/^RC-/, '')}`,
    rootCauseGroupId: group.id,
    issueIds: group.issueIds,
    title: group.title,
    owner: group.owner,
    priority: group.priority,
    status: statusOf(score, dimensions, dispositions, group),
    confidence: score >= 80 ? 'high' as const : score >= 60 ? 'medium' as const : 'low' as const,
    score,
    dimensions,
    missingEvidence: missingEvidence(dimensions),
    evidenceRefs: uniq([
      group.id,
      ...group.issueIds,
      ...group.networkRequestIds.map((id) => `network:${id}`),
      ...group.sourceLocations.map((location) => `source:${location.file}:${location.line}`),
      ...runtimeLinks.map((link) => link.id),
      ...requirements.map((requirement) => requirement.id)
    ])
  };
  return {
    ...partial,
    nextSteps: nextStepsFor(partial)
  };
}

export function buildDefectProof(input: DefectProofInput): DefectProofResult {
  const items = input.rootCauseGroups.map((group) => buildItem(input, group));
  const provenCount = items.filter((item) => item.status === 'proven').length;
  const probableCount = items.filter((item) => item.status === 'probable').length;
  const needsEvidenceCount = items.filter((item) => item.status === 'needs-evidence').length;
  const notDefectCount = items.filter((item) => item.status === 'not-a-defect').length;
  const p0p1NeedsEvidence = items.some((item) => item.status === 'needs-evidence' && (item.priority === 'P0' || item.priority === 'P1'));
  const status: DefectProofResult['status'] = p0p1NeedsEvidence ? 'blocked' : needsEvidenceCount > 0 ? 'needs-evidence' : 'ready';
  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: status === 'ready'
      ? `Defect proof ready: ${provenCount} proven and ${probableCount} probable root-cause item(s).`
      : status === 'blocked'
        ? 'Defect proof blocked: at least one P0/P1 root cause lacks enough evidence for professional defect sign-off.'
        : `Defect proof needs evidence: ${needsEvidenceCount} root-cause item(s) require stronger proof before must-fix scheduling.`,
    counts: {
      total: items.length,
      proven: provenCount,
      probable: probableCount,
      needsEvidence: needsEvidenceCount,
      notDefect: notDefectCount
    },
    items,
    notes: [
      'A professional defect requires user impact, runtime evidence, source/owner fix surface, reproducibility, and requirement/product-scope context when applicable.',
      'Use defectProof before scheduling rootCauseGroups as must-fix work. Needs-evidence items should be confirmed or downgraded before release sign-off.'
    ]
  };
}

export function createEmptyDefectProof(): DefectProofResult {
  return {
    generatedAt: new Date().toISOString(),
    status: 'needs-evidence',
    summary: 'Defect proof missing from report; rerun FrontLens 1.31+ or inspect rootCauseGroups/issueDisposition manually.',
    counts: { total: 0, proven: 0, probable: 0, needsEvidence: 0, notDefect: 0 },
    items: [],
    notes: ['Older reports may not contain defectProof. Keep actionable root causes conservative until normalized or rerun.']
  };
}
