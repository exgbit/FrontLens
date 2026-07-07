import type { Issue, RequirementCoverageResult } from '../types.js';

export interface DataMismatchProofGate {
  status: 'proven' | 'needs-evidence';
  requirementEvidence: boolean;
  networkEvidence: boolean;
  uiEvidence: boolean;
  sourceEvidence: boolean;
  missingEvidence: string[];
  evidenceRefs: string[];
}

function detailsOf(issue: Issue): Record<string, unknown> {
  return issue.evidence.details && typeof issue.evidence.details === 'object' ? issue.evidence.details as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map((item) => String(item)).filter(Boolean);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    const number = numberValue(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function linkedProvidedRequirements(issue: Issue, requirementCoverage?: RequirementCoverageResult): string[] {
  if (!requirementCoverage?.items.length) return [];
  return requirementCoverage.items
    .filter((item) => item.source === 'provided')
    .filter((item) => item.status !== 'not-applicable')
    .filter((item) => item.evidence.issueIds.includes(issue.id) || (issue.evidence.networkRequestId ? item.evidence.networkRequestIds.includes(issue.evidence.networkRequestId) : false))
    .map((item) => item.id);
}

export function evaluateDataMismatchProof(issue: Issue, requirementCoverage?: RequirementCoverageResult): DataMismatchProofGate {
  const details = detailsOf(issue);
  const detailRequirementIds = stringArray(details.requirementIds);
  const coverageRequirementIds = linkedProvidedRequirements(issue, requirementCoverage);
  const explicitRequirementEvidence = details.requirementEvidence === 'provided' || details.requirementEvidence === 'explicit';
  const requirementEvidence = coverageRequirementIds.length > 0 || (detailRequirementIds.length > 0 && explicitRequirementEvidence);

  const maxReturnedArrayLength = numberValue(details.maxReturnedArrayLength);
  const responsePath = typeof details.responsePath === 'string' ? details.responsePath : '';
  const networkEvidence = Boolean(issue.evidence.networkRequestId && (maxReturnedArrayLength ?? 0) > 0 && responsePath);

  const renderedItemCount = firstNumber([
    details.maxRenderedItemCount,
    details.renderedItemCount,
    details.visibleItemCount,
    details.maxTableRows,
    details.rowCount
  ]);
  const tableIds = stringArray(details.tableIds);
  const tableSelectors = stringArray(details.tableSelectors);
  const uiSelectors = [
    ...tableSelectors,
    ...stringArray(details.uiSelectors),
    ...stringArray(details.listSelectors),
    ...stringArray(details.targetSelectors),
    ...stringArray(details.componentSelectors),
    ...stringArray(details.containerSelectors),
    ...stringArray(details.emptyStateSelectors)
  ];
  const uiRefs = [
    ...tableIds.map((id) => `table:${id}`),
    ...uiSelectors.map((selector) => `selector:${selector}`),
    typeof details.emptyStateSelector === 'string' ? `selector:${details.emptyStateSelector}` : '',
    typeof details.emptyStateText === 'string' ? `emptyState:${details.emptyStateText}` : ''
  ].filter(Boolean);
  const uiEvidence = Boolean((issue.evidence.screenshot || issue.evidence.dom || uiRefs.length) && renderedItemCount === 0 && uiRefs.length > 0);

  const sourceRuntimeConfidence = String(details.sourceRuntimeConfidence ?? '').toLowerCase();
  const sourceApiMatches = arrayValue(details.sourceApiMatches);
  const sourceStateSignals = arrayValue(details.sourceStateSignals);
  const sourceComponentIds = stringArray(details.sourceComponentIds);
  const sourceEvidence = Boolean(
    (sourceRuntimeConfidence === 'high' || sourceRuntimeConfidence === 'medium') &&
    (typeof details.sourceRuntimeLinkId === 'string' || sourceApiMatches.length > 0) &&
    sourceApiMatches.length > 0 &&
    (sourceStateSignals.length > 0 || sourceComponentIds.length > 0)
  );

  const missingEvidence = [
    requirementEvidence ? '' : 'requirementEvidence: 缺少明确 PRD/验收标准或 requirementCoverage 绑定，不能证明该 UI 必须展示该接口数据。',
    networkEvidence ? '' : 'networkEvidence: 缺少具体列表响应、响应路径、返回数量或 networkRequestId。',
    uiEvidence ? '' : 'uiEvidence: 缺少可见 DOM/截图与目标表格/列表/卡片区域 renderedItemCount=0 的绑定。',
    sourceEvidence ? '' : 'sourceEvidence: 缺少 medium/high sourceRuntimeCorrelation，以及源码 API + state/render 绑定。'
  ].filter(Boolean);

  const evidenceRefs = [
    ...detailRequirementIds.map((id) => `requirement:${id}`),
    ...coverageRequirementIds.map((id) => `requirement:${id}`),
    issue.evidence.networkRequestId ? `network:${issue.evidence.networkRequestId}` : '',
    responsePath ? `response:${responsePath}` : '',
    ...uiRefs,
    typeof details.sourceRuntimeLinkId === 'string' ? String(details.sourceRuntimeLinkId) : '',
    ...sourceApiMatches.map((_, index) => `sourceApiMatches[${index}]`),
    ...sourceStateSignals.map((_, index) => `sourceStateSignals[${index}]`)
  ].filter(Boolean);

  return {
    status: missingEvidence.length === 0 ? 'proven' : 'needs-evidence',
    requirementEvidence,
    networkEvidence,
    uiEvidence,
    sourceEvidence,
    missingEvidence,
    evidenceRefs
  };
}
