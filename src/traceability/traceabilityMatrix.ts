import type { QaResult, RequirementCoverageItem, RiskRegisterItem, RootCauseGroup, TestCaseItem, TraceabilityMatrixResult, TraceabilityOrphanItem, TraceabilityRequirementRow, TraceabilityRequirementStatus } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type TraceabilityInput = Pick<QaResult, 'requirementCoverage' | 'testCases' | 'rootCauseGroups' | 'defectTickets' | 'riskRegister' | 'qaSignoff'>;

function uniq<T>(items: Array<T | undefined | null>): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))] as T[];
}

function byRequirement<T extends { requirementIds?: string[] }>(items: T[], requirementId: string): T[] {
  return items.filter((item) => item.requirementIds?.includes(requirementId));
}

function rootCauseGroupsFor(requirement: RequirementCoverageItem, groups: RootCauseGroup[]): RootCauseGroup[] {
  const issueIds = new Set(requirement.evidence.issueIds);
  if (issueIds.size === 0) return [];
  return groups.filter((group) => group.issueIds.some((id) => issueIds.has(id)));
}

function risksFor(requirement: RequirementCoverageItem, risks: RiskRegisterItem[]): RiskRegisterItem[] {
  return risks.filter((risk) => risk.evidenceRefs.some((ref) => ref === requirement.id || ref.includes(requirement.id)));
}

function statusFor(requirement: RequirementCoverageItem, testCases: TestCaseItem[]): TraceabilityRequirementStatus {
  if (requirement.status === 'not-applicable') return 'not-applicable';
  if (requirement.status === 'passed') return 'covered';
  if (requirement.status === 'failed') return 'failed';
  if (requirement.status === 'not-covered') return 'not-covered';
  if (requirement.status === 'partial') return 'partial';
  if (testCases.length === 0) return 'needs-input';
  return 'partial';
}

function nextStepsFor(input: {
  requirement: RequirementCoverageItem;
  status: TraceabilityRequirementStatus;
  testCases: TestCaseItem[];
  defectTicketIds: string[];
}): string[] {
  const steps: string[] = [];
  if (input.defectTicketIds.length > 0) {
    steps.push(`先修复关联缺陷工单：${input.defectTicketIds.join(', ')}，再回归该需求。`);
  }
  if (input.status === 'needs-input' || input.status === 'not-covered') {
    steps.push('补充该需求的 selectors / expectedTexts / apiPatterns / journeySteps，并重跑 FrontLens。');
  }
  if (input.status === 'partial') {
    steps.push('补齐业务专属 expectVisible/expectText/expectUrl/expectRequest 断言，避免只证明路径未崩溃。');
  }
  if (input.status === 'failed') {
    steps.push('根据失败证据定位实现或后端契约问题，修复后执行 regressionPlan 对应命令。');
  }
  if (input.testCases.some((item) => item.status === 'needs-input' || item.status === 'blocked')) {
    steps.push('处理关联 testCases 中 blocked/needs-input 的前置条件、角色态或测试数据。');
  }
  if (steps.length === 0 && input.status === 'covered') steps.push('保持该需求的自动化/运行时证据，并在变更后重跑回归。');
  return uniq([...(input.requirement.gaps ?? []), ...steps]).slice(0, 8);
}

function rowFor(requirement: RequirementCoverageItem, input: TraceabilityInput): TraceabilityRequirementRow {
  const tests = byRequirement(input.testCases.items, requirement.id);
  const groups = rootCauseGroupsFor(requirement, input.rootCauseGroups);
  const tickets = input.defectTickets.items.filter((ticket) => ticket.requirements.some((req) => req.id === requirement.id));
  const risks = risksFor(requirement, input.riskRegister.items);
  const baseStatus = statusFor(requirement, tests);
  const status: TraceabilityRequirementStatus = tickets.length > 0 && baseStatus !== 'not-applicable' ? 'failed' : baseStatus;
  const testCaseIds = tests.map((item) => item.id);
  const defectTicketIds = tickets.map((item) => item.id);
  return {
    id: requirement.id,
    title: requirement.title,
    priority: requirement.priority,
    source: requirement.source,
    coverageStatus: requirement.status,
    status,
    confidence: requirement.confidence,
    testCaseIds,
    journeyIds: uniq([...requirement.evidence.journeyIds, ...tests.flatMap((item) => item.journeyIds)]),
    interactionTestIds: requirement.evidence.interactionTestIds,
    issueIds: uniq([...requirement.evidence.issueIds, ...tests.flatMap((item) => item.issueIds)]),
    rootCauseGroupIds: groups.map((item) => item.id),
    defectTicketIds,
    riskIds: risks.map((item) => item.id),
    evidenceRefs: uniq([
      requirement.id,
      ...requirement.evidence.selectors.map((item) => `selector:${item}`),
      ...requirement.evidence.componentIds.map((item) => `component:${item}`),
      ...requirement.evidence.networkRequestIds.map((item) => `network:${item}`),
      ...requirement.evidence.journeyIds.map((item) => `journey:${item}`),
      ...requirement.evidence.interactionTestIds.map((item) => `interaction:${item}`),
      ...requirement.evidence.issueIds.map((item) => `issue:${item}`),
      ...testCaseIds.map((item) => `testCase:${item}`),
      ...groups.map((item) => `rootCause:${item.id}`),
      ...defectTicketIds.map((item) => `defectTicket:${item}`),
      ...risks.map((item) => `risk:${item.id}`)
    ]).slice(0, 40),
    gaps: uniq(requirement.gaps).slice(0, 8),
    nextSteps: nextStepsFor({ requirement, status, testCases: tests, defectTicketIds })
  };
}

function orphanItems(input: TraceabilityInput): TraceabilityOrphanItem[] {
  const items: TraceabilityOrphanItem[] = [];
  for (const ticket of input.defectTickets.items.filter((item) => item.requirements.length === 0)) {
    items.push({
      id: `TRACE-ORPHAN-${items.length + 1}`,
      kind: 'defect-ticket',
      title: ticket.title,
      priority: ticket.priority,
      owner: ticket.owner,
      evidenceRefs: uniq([ticket.id, ticket.rootCauseGroupId, ...ticket.issueIds, ...ticket.evidenceRefs]).slice(0, 30),
      reason: '该 proof-ready 缺陷没有关联到已提供/推断需求，可能是横向质量问题，也可能缺少验收标准。',
      nextStep: '若这是业务验收范围，请补充对应 requirement；若是通用质量缺陷，按 defect-tickets 直接修复并补回归断言。'
    });
  }
  for (const testCase of input.testCases.items.filter((item) => item.kind === 'requirement' && item.requirementIds.length === 0)) {
    items.push({
      id: `TRACE-ORPHAN-${items.length + 1}`,
      kind: 'test-case',
      title: testCase.title,
      priority: testCase.priority,
      owner: testCase.owner,
      evidenceRefs: uniq([testCase.id, ...testCase.evidenceRefs]).slice(0, 20),
      reason: '需求类 test case 缺少 requirementIds，无法形成 PRD ↔ 测试 ↔ 证据链。',
      nextStep: '为该 test case 绑定 requirementId，或将其改为探索/非需求类测试。'
    });
  }
  return items;
}

export function buildTraceabilityMatrix(input: TraceabilityInput): TraceabilityMatrixResult {
  const requirements = input.requirementCoverage.items.map((requirement) => rowFor(requirement, input));
  const orphans = orphanItems(input);
  const coveredCount = requirements.filter((item) => item.status === 'covered').length;
  const partialCount = requirements.filter((item) => item.status === 'partial').length;
  const failedCount = requirements.filter((item) => item.status === 'failed').length;
  const notCoveredCount = requirements.filter((item) => item.status === 'not-covered').length;
  const notApplicableCount = requirements.filter((item) => item.status === 'not-applicable').length;
  const needsInputCount = requirements.filter((item) => item.status === 'needs-input').length;
  const highPriorityGapCount = requirements.filter((item) => (item.priority === 'P0' || item.priority === 'P1') && !['covered', 'not-applicable'].includes(item.status)).length;
  const providedRequirementCount = input.requirementCoverage.summary.providedCount;
  const orphanDefectCount = orphans.filter((item) => item.kind === 'defect-ticket').length;
  const status: TraceabilityMatrixResult['status'] = input.requirementCoverage.source === 'none' || providedRequirementCount === 0
    ? 'needs-input'
    : input.qaSignoff.status === 'blocked' || highPriorityGapCount > 0 || failedCount > 0
      ? 'blocked'
      : partialCount > 0 || notCoveredCount > 0 || needsInputCount > 0 || orphanDefectCount > 0
        ? 'partial'
        : 'ready';
  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      requirementCount: requirements.length,
      providedRequirementCount,
      coveredCount,
      partialCount,
      failedCount,
      notCoveredCount,
      notApplicableCount,
      needsInputCount,
      defectLinkedCount: requirements.filter((item) => item.defectTicketIds.length > 0).length,
      orphanDefectCount,
      highPriorityGapCount
    },
    requirements,
    orphanItems: orphans,
    notes: [
      'Traceability is the PRD → test case → runtime evidence → defect ticket linkage used for professional QA sign-off.',
      'A missing or inferred requirement source means business validation remains intake-needed even if the page smoke test passed.',
      'Proof-ready defect tickets without requirement links are still implementation work, but they cannot prove or disprove a specific PRD item until mapped.'
    ]
  };
}

function cell(value: unknown): string {
  return markdownEscape(truncateMiddle(String(value ?? '-'), 140));
}

export function formatTraceabilityMatrix(result: TraceabilityMatrixResult): string {
  const rows = result.requirements.map((item) => `| ${cell(item.id)} | ${item.priority} | ${item.source} | ${item.status} | ${item.coverageStatus}/${item.confidence} | ${cell(item.testCaseIds.join(', ') || '-')} | ${cell(item.defectTicketIds.join(', ') || '-')} | ${cell(item.nextSteps[0] ?? '-')} |`);
  const orphanRows = result.orphanItems.map((item) => `| ${cell(item.id)} | ${item.kind} | ${item.priority} | ${item.owner} | ${cell(item.title)} | ${cell(item.nextStep)} |`);
  return `# FrontLens Traceability Matrix

## Status

- Status: **${result.status}**
- Requirements: **${result.summary.requirementCount}**（provided ${result.summary.providedRequirementCount}, covered ${result.summary.coveredCount}, partial ${result.summary.partialCount}, failed ${result.summary.failedCount}, not-covered ${result.summary.notCoveredCount}）
- High-priority gaps: **${result.summary.highPriorityGapCount}**
- Defect-linked requirements / orphan defects: ${result.summary.defectLinkedCount} / ${result.summary.orphanDefectCount}

## Requirement traceability

${rows.length ? ['| Requirement | Pri | Source | Trace status | Coverage | Test cases | Defect tickets | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No requirements were provided or inferred. Add PRD/acceptance criteria before claiming business validation.'}

## Orphan proof-ready work

${orphanRows.length ? ['| ID | Kind | Pri | Owner | Title | Next step |', '| --- | --- | --- | --- | --- | --- |', ...orphanRows].join('\n') : 'No orphan proof-ready defects or requirement test cases.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
