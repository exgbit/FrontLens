import type { DefectProofItem, DefectTicketItem, DefectTicketResult, Issue, QaResult, RequirementCoverageItem, RootCauseGroup } from '../types.js';
import { isProofReadyStatus, proofItemForGroup } from '../proof/proofReadiness.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type DefectTicketInput = Pick<QaResult, 'rootCauseGroups' | 'issues' | 'defectProof' | 'requirementCoverage'>;

function uniq<T>(items: Array<T | undefined | null>): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))] as T[];
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function issueMap(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.id, issue]));
}

function issuesFor(group: RootCauseGroup, byId: Map<string, Issue>): Issue[] {
  return group.issueIds.map((id) => byId.get(id)).filter((item): item is Issue => Boolean(item));
}

function requirementsFor(group: RootCauseGroup, requirements: RequirementCoverageItem[]): RequirementCoverageItem[] {
  const issueIds = new Set(group.issueIds);
  return requirements.filter((item) => item.evidence.issueIds.some((id) => issueIds.has(id)));
}

function joined(values: string[], fallback: string, maxItems = 4): string {
  const cleaned = uniq(values.map(cleanText)).filter(Boolean).slice(0, maxItems);
  return cleaned.length ? cleaned.join('；') : fallback;
}

function actualBehavior(group: RootCauseGroup, issues: Issue[]): string {
  return joined(
    [group.summary, ...issues.flatMap((issue) => [issue.description, issue.reason])],
    group.title,
    5
  );
}

function expectedBehavior(group: RootCauseGroup, requirements: RequirementCoverageItem[]): string {
  const requirementText = requirements.map((item) => `${item.id}: ${item.title}`);
  if (requirementText.length) return `应满足已提供验收标准：${requirementText.slice(0, 4).join('；')}`;
  return group.suggestedFix || '应满足对应用户任务的可用性、反馈和技术质量要求。';
}

function reproduceSteps(group: RootCauseGroup, issues: Issue[]): string[] {
  const steps = uniq(issues.flatMap((issue) => issue.reproduceSteps.map(cleanText))).filter(Boolean).slice(0, 10);
  return steps.length ? steps : ['打开目标页面并执行报告中的对应用户路径。', `复测命令：${group.verificationCommand}`];
}

function artifactRefs(issues: Issue[]): string[] {
  return uniq(issues.flatMap((issue) => [issue.evidence.screenshot, issue.evidence.dom])).filter(Boolean).slice(0, 12);
}

function evidenceRefs(group: RootCauseGroup, proof: DefectProofItem | undefined, issues: Issue[]): string[] {
  return uniq([
    group.id,
    proof?.id,
    ...group.issueIds,
    ...group.selectors.map((item) => `selector:${item}`),
    ...group.networkRequestIds.map((item) => `network:${item}`),
    ...group.consoleIds.map((item) => `console:${item}`),
    ...group.pageErrorIds.map((item) => `pageError:${item}`),
    ...group.resourceUrls.map((item) => `resource:${item}`),
    ...group.sourceLocations.map((item) => `source:${item.file}:${item.line}${item.column !== undefined ? `:${item.column}` : ''}`),
    ...issues.flatMap((issue) => [issue.evidence.networkRequestId ? `${issue.id}.network:${issue.evidence.networkRequestId}` : '', issue.evidence.selector ? `${issue.id}.selector:${issue.evidence.selector}` : ''])
  ].filter(Boolean)).slice(0, 24);
}

function acceptanceCriteria(group: RootCauseGroup, requirements: RequirementCoverageItem[]): string[] {
  const criteria = [
    '根因对应的 proof-ready issueIds 在复测结果中不再出现。',
    '复测后 defectProof 不再将该 root cause 标记为 proven/probable open defect。',
    `运行验证命令成功：${group.verificationCommand}`
  ];
  if (requirements.length) {
    criteria.push(`关联验收项恢复通过或不再失败：${requirements.map((item) => item.id).join(', ')}。`);
  }
  if (group.sourceLocations.length) {
    criteria.push(`修复提交需覆盖源码位置：${group.sourceLocations.slice(0, 4).map((item) => `${item.file}:${item.line}`).join('；')}。`);
  }
  return criteria;
}

function notesFor(proof: DefectProofItem | undefined): string[] {
  const notes = [
    '该 ticket 只来自 defectProof=proven/probable 的 root cause；产品取舍、部署项、工具局限和 needs-evidence 观察不会生成 ticket。'
  ];
  if (proof?.status === 'probable') notes.push('Proof status is probable: 修复前可先按 evidenceRefs 做一次人工复核。');
  return notes;
}

function buildTicket(group: RootCauseGroup, proof: DefectProofItem | undefined, issues: Issue[], requirements: RequirementCoverageItem[], index: number): DefectTicketItem {
  return {
    id: `TICKET-${String(index + 1).padStart(3, '0')}`,
    rootCauseGroupId: group.id,
    proofId: proof?.id,
    proofStatus: proof?.status ?? 'proven',
    proofScore: proof?.score ?? 100,
    confidence: proof?.confidence ?? 'high',
    issueIds: group.issueIds,
    owner: group.owner,
    priority: group.priority,
    severity: group.severity,
    title: group.title,
    impact: joined(issues.map((issue) => issue.reason || issue.description), group.summary, 3),
    actualBehavior: actualBehavior(group, issues),
    expectedBehavior: expectedBehavior(group, requirements),
    reproduceSteps: reproduceSteps(group, issues),
    sourceLocations: group.sourceLocations,
    requirements: requirements.map((item) => ({ id: item.id, title: item.title, priority: item.priority, status: item.status })),
    evidenceRefs: evidenceRefs(group, proof, issues),
    artifactRefs: artifactRefs(issues),
    fixRecommendation: group.suggestedFix,
    acceptanceCriteria: acceptanceCriteria(group, requirements),
    verificationCommand: group.verificationCommand,
    notes: notesFor(proof)
  };
}

export function buildDefectTickets(input: DefectTicketInput): DefectTicketResult {
  const byIssueId = issueMap(input.issues);
  const proofReadyGroups = input.rootCauseGroups.filter((group) => {
    if (group.status !== 'actionable') return false;
    const proof = proofItemForGroup(input.defectProof, group.id);
    return proof ? isProofReadyStatus(proof.status) : false;
  });
  const items = proofReadyGroups.map((group, index) => {
    const proof = proofItemForGroup(input.defectProof, group.id);
    return buildTicket(group, proof, issuesFor(group, byIssueId), requirementsFor(group, input.requirementCoverage.items), index);
  });
  const suppressedNeedsEvidence = input.defectProof.items.filter((item) => item.status === 'needs-evidence').length;
  const suppressedNotDefect = input.defectProof.items.filter((item) => item.status === 'not-a-defect').length;
  const status: DefectTicketResult['status'] = items.length > 0 ? 'ready' : suppressedNeedsEvidence > 0 ? 'needs-evidence' : 'empty';
  const proven = items.filter((item) => item.proofStatus === 'proven').length;
  const probable = items.filter((item) => item.proofStatus === 'probable').length;
  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: status === 'ready'
      ? `Defect tickets ready: ${items.length} proof-ready ticket(s), ${proven} proven and ${probable} probable.`
      : status === 'needs-evidence'
        ? `No defect ticket generated: ${suppressedNeedsEvidence} root-cause item(s) still need evidence before bug filing.`
        : 'No proof-ready implementation defect tickets were found.',
    counts: {
      total: items.length,
      proven,
      probable,
      sourceLocated: items.filter((item) => item.sourceLocations.length > 0).length,
      requirementLinked: items.filter((item) => item.requirements.length > 0).length,
      suppressedNeedsEvidence,
      suppressedNotDefect
    },
    items,
    notes: [
      'Defect tickets are the Jira/Linear-ready queue. Use them before raw issues or generic suggestions when assigning implementation work.',
      'Each ticket must remain backed by defectProof proven/probable evidence; needs-evidence observations should be handled through qa-intake/qa-plan instead.'
    ]
  };
}

function cell(value: unknown): string {
  return markdownEscape(truncateMiddle(String(value ?? '-'), 140));
}

export function formatDefectTickets(result: DefectTicketResult): string {
  const rows = result.items.map((item) => `| ${item.id} | ${item.priority} | ${item.owner} | ${item.proofStatus}/${item.proofScore} | ${cell(item.title)} | ${cell(item.issueIds.join(', '))} | ${cell(item.sourceLocations.map((location) => `${location.file}:${location.line}`).join('；') || '-')} | ${cell(item.verificationCommand)} |`);
  const detailBlocks = result.items.slice(0, 12).map((item) => `### ${markdownEscape(item.id)} · ${markdownEscape(item.title)}

- Owner / priority / severity：${item.owner} / ${item.priority} / ${item.severity}
- Proof：${item.proofStatus} / score ${item.proofScore} / confidence ${item.confidence}
- Expected：${markdownEscape(item.expectedBehavior)}
- Actual：${markdownEscape(item.actualBehavior)}
- Impact：${markdownEscape(item.impact)}
- Evidence：${markdownEscape(item.evidenceRefs.slice(0, 12).join('；') || '-')}
- Artifacts：${markdownEscape(item.artifactRefs.join('；') || '-')}
- Source：${markdownEscape(item.sourceLocations.map((location) => `${location.file}:${location.line}`).join('；') || '-')}
- Requirements：${markdownEscape(item.requirements.map((req) => `${req.id}/${req.status}`).join('；') || '-')}
- Fix：${markdownEscape(item.fixRecommendation)}
- Verify：\`${markdownEscape(item.verificationCommand)}\`

**Reproduce**

${item.reproduceSteps.map((step, index) => `${index + 1}. ${markdownEscape(step)}`).join('\n')}

**Acceptance criteria**

${item.acceptanceCriteria.map((criterion) => `- ${markdownEscape(criterion)}`).join('\n')}
`);
  return `# FrontLens Defect Tickets

## Status

- Status: **${result.status}**
- Summary: ${markdownEscape(result.summary)}
- Tickets: **${result.counts.total}**（proven ${result.counts.proven}, probable ${result.counts.probable}）
- Source-located / requirement-linked: ${result.counts.sourceLocated} / ${result.counts.requirementLinked}
- Suppressed needs-evidence / not-defect: ${result.counts.suppressedNeedsEvidence} / ${result.counts.suppressedNotDefect}

## Ticket queue

${rows.length ? ['| Ticket | Pri | Owner | Proof | Title | Issues | Source | Verify |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No proof-ready implementation defect tickets. Use qa-intake/defect-proof for evidence gaps instead.'}

## Ticket details

${detailBlocks.length ? detailBlocks.join('\n') : 'No ticket details.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
