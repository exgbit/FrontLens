import type {
  ArtifactIntegrityEntry,
  EvidenceBundleArtifactRef,
  EvidenceBundleItem,
  EvidenceBundleItemStatus,
  EvidenceBundleResult,
  QaResult,
  RequirementPriority
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type EvidenceBundleInput = Pick<QaResult,
  | 'summary'
  | 'artifacts'
  | 'artifactIntegrity'
  | 'defectTickets'
  | 'testCases'
  | 'traceability'
  | 'automationSpecs'
  | 'qaSignoff'
>;

const MAX_DEFECT_TICKETS = 30;
const MAX_TEST_CASES = 24;
const MAX_TRACEABILITY_GAPS = 24;
const MAX_AUTOMATION_DRAFTS = 24;
const MAX_MISSING_ARTIFACTS = 30;
const PRIORITY_ORDER: Record<RequirementPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const KIND_ORDER: Record<EvidenceBundleItem['kind'], number> = {
  'defect-ticket': 0,
  'test-case': 1,
  'traceability-gap': 2,
  'automation-draft': 3,
  artifact: 4
};

type ItemSeed = Omit<EvidenceBundleItem, 'id' | 'artifactRefs' | 'status'> & {
  artifactRefs: EvidenceBundleArtifactRef[];
  status: EvidenceBundleItemStatus;
};

function uniq<T>(items: Array<T | undefined | null>): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))] as T[];
}

function nonEmpty(items: Array<string | undefined | null>): string[] {
  return uniq(items.map((item) => String(item ?? '').trim()).filter(Boolean));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function artifactRef(entry: ArtifactIntegrityEntry): EvidenceBundleArtifactRef {
  return {
    source: entry.source,
    path: entry.path,
    exists: entry.exists,
    sizeBytes: entry.sizeBytes,
    message: entry.message
  };
}

function dedupeArtifactRefs(refs: EvidenceBundleArtifactRef[]): EvidenceBundleArtifactRef[] {
  const seen = new Set<string>();
  const unique: EvidenceBundleArtifactRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source}:${normalizePath(ref.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function relatedArtifacts(input: EvidenceBundleInput, options: { sources?: string[]; issueIds?: string[]; paths?: string[] } = {}): EvidenceBundleArtifactRef[] {
  const sources = new Set(options.sources ?? []);
  const issueIds = new Set(options.issueIds ?? []);
  const paths = new Set((options.paths ?? []).map(normalizePath));
  const refs = input.artifactIntegrity.entries
    .filter((entry) => {
      if (sources.has(entry.source)) return true;
      if (entry.issueId && issueIds.has(entry.issueId)) return true;
      if ([...issueIds].some((issueId) => entry.source.includes(issueId))) return true;
      if (paths.has(normalizePath(entry.path))) return true;
      return Boolean(entry.absolutePath && paths.has(normalizePath(entry.absolutePath)));
    })
    .map(artifactRef);
  return dedupeArtifactRefs(refs);
}

function statusFromArtifacts(base: EvidenceBundleItemStatus, refs: EvidenceBundleArtifactRef[]): EvidenceBundleItemStatus {
  if (refs.some((ref) => ref.exists === false)) return 'missing-artifact';
  if (base === 'ready' && refs.length === 0) return 'needs-input';
  return base;
}

function priorityScore(priority: RequirementPriority): number {
  return PRIORITY_ORDER[priority] ?? 9;
}

function sortItems(items: EvidenceBundleItem[]): EvidenceBundleItem[] {
  return items.slice().sort((left, right) =>
    priorityScore(left.priority) - priorityScore(right.priority)
    || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || left.id.localeCompare(right.id)
  );
}

function withId(seeds: ItemSeed[]): EvidenceBundleItem[] {
  return sortItems(seeds.map((seed, index) => ({
    ...seed,
    id: `EVID-${String(index + 1).padStart(3, '0')}`
  })));
}

function buildDefectTicketItems(input: EvidenceBundleInput): ItemSeed[] {
  return input.defectTickets.items.slice(0, MAX_DEFECT_TICKETS).map((ticket) => {
    const artifactRefs = relatedArtifacts(input, {
      sources: ['artifacts.defectTickets', 'artifacts.defectTicketsLog', 'artifacts.evidenceReport', 'artifacts.jsonReport'],
      issueIds: ticket.issueIds,
      paths: ticket.artifactRefs
    });
    const base: EvidenceBundleItemStatus = ticket.proofStatus === 'proven' || ticket.proofStatus === 'probable' ? 'ready' : 'needs-input';
    return {
      kind: 'defect-ticket',
      priority: ticket.priority,
      title: `${ticket.id}: ${ticket.title}`,
      status: statusFromArtifacts(base, artifactRefs),
      owner: ticket.owner,
      evidenceRefs: nonEmpty(ticket.evidenceRefs).slice(0, 30),
      artifactRefs,
      issueIds: ticket.issueIds,
      requirementIds: ticket.requirements.map((item) => item.id),
      testCaseIds: [],
      defectTicketIds: [ticket.id],
      nextStep: ticket.verificationCommand || ticket.fixRecommendation || 'File the proof-ready defect ticket and attach listed artifacts.'
    };
  });
}

function buildTestCaseItems(input: EvidenceBundleInput): ItemSeed[] {
  return input.testCases.items
    .filter((item) => ['failed', 'blocked'].includes(item.status) || (['P0', 'P1'].includes(item.priority) && ['partial', 'needs-input'].includes(item.status)))
    .slice(0, MAX_TEST_CASES)
    .map((item) => {
      const artifactRefs = relatedArtifacts(input, {
        sources: ['artifacts.testCases', 'artifacts.testCasesLog', 'artifacts.evidenceReport', 'artifacts.jsonReport'],
        issueIds: item.issueIds
      });
      const base: EvidenceBundleItemStatus = ['failed', 'blocked'].includes(item.status) ? 'ready' : 'needs-input';
      return {
        kind: 'test-case',
        priority: item.priority,
        title: `${item.id}: ${item.title}`,
        status: statusFromArtifacts(base, artifactRefs),
        owner: item.owner,
        evidenceRefs: nonEmpty(item.evidenceRefs).slice(0, 30),
        artifactRefs,
        issueIds: item.issueIds,
        requirementIds: item.requirementIds,
        testCaseIds: [item.id],
        defectTicketIds: [],
        nextStep: item.nextSteps[0] || item.actual || 'Review the failed/blocked test case and attach runtime evidence before release sign-off.'
      };
    });
}

function buildTraceabilityGapItems(input: EvidenceBundleInput): ItemSeed[] {
  return input.traceability.requirements
    .filter((item) => ['P0', 'P1'].includes(item.priority) && ['failed', 'partial', 'not-covered', 'needs-input'].includes(item.status))
    .slice(0, MAX_TRACEABILITY_GAPS)
    .map((item) => {
      const artifactRefs = relatedArtifacts(input, {
        sources: ['artifacts.traceability', 'artifacts.traceabilityLog', 'artifacts.evidenceReport', 'artifacts.jsonReport'],
        issueIds: item.issueIds
      });
      return {
        kind: 'traceability-gap',
        priority: item.priority,
        title: `${item.id}: ${item.title}`,
        status: statusFromArtifacts('needs-input', artifactRefs),
        owner: item.defectTicketIds.length ? 'test' : 'product',
        evidenceRefs: nonEmpty(item.evidenceRefs).slice(0, 30),
        artifactRefs,
        issueIds: item.issueIds,
        requirementIds: [item.id],
        testCaseIds: item.testCaseIds,
        defectTicketIds: item.defectTicketIds,
        nextStep: item.nextSteps[0] || item.gaps[0] || 'Add reviewed requirements/assertions or link runtime evidence before claiming coverage.'
      };
    });
}

function buildAutomationDraftItems(input: EvidenceBundleInput): ItemSeed[] {
  return input.automationSpecs.drafts
    .filter((item) => item.status === 'ready' || ['P0', 'P1'].includes(item.priority))
    .slice(0, MAX_AUTOMATION_DRAFTS)
    .map((item) => {
      const artifactRefs = relatedArtifacts(input, {
        sources: ['artifacts.automationSpecs', 'artifacts.automationSpecFile', 'artifacts.automationSpecsLog', 'artifacts.evidenceReport', 'artifacts.jsonReport'],
        issueIds: item.issueIds
      });
      const base: EvidenceBundleItemStatus = item.status === 'ready' ? 'ready' : 'needs-input';
      return {
        kind: 'automation-draft',
        priority: item.priority,
        title: `${item.id}: ${item.title}`,
        status: statusFromArtifacts(base, artifactRefs),
        owner: 'test',
        evidenceRefs: nonEmpty(item.evidenceRefs).slice(0, 30),
        artifactRefs,
        issueIds: item.issueIds,
        requirementIds: item.requirementIds,
        testCaseIds: item.testCaseIds,
        defectTicketIds: [],
        nextStep: item.nextSteps[0] || 'Review selectors/test data and execute the generated Playwright draft before counting it as regression evidence.'
      };
    });
}

function buildMissingArtifactItems(input: EvidenceBundleInput): ItemSeed[] {
  return input.artifactIntegrity.missing
    .filter((entry) => !entry.source.startsWith('artifacts.evidenceBundle'))
    .slice(0, MAX_MISSING_ARTIFACTS)
    .map((entry) => ({
      kind: 'artifact',
      priority: 'P1',
      title: `${entry.source}: ${entry.path}`,
      status: 'missing-artifact',
      owner: 'test',
      evidenceRefs: entry.issueId ? [`issue:${entry.issueId}`] : [],
      artifactRefs: [artifactRef(entry)],
      issueIds: entry.issueId ? [entry.issueId] : [],
      requirementIds: [],
      testCaseIds: [],
      defectTicketIds: [],
      nextStep: entry.message || 'Regenerate the report artifacts or remove the broken reference before sharing the QA package.'
    }));
}

export function buildEvidenceBundle(input: EvidenceBundleInput): EvidenceBundleResult {
  const seeds: ItemSeed[] = [
    ...buildDefectTicketItems(input),
    ...buildTestCaseItems(input),
    ...buildTraceabilityGapItems(input),
    ...buildAutomationDraftItems(input),
    ...buildMissingArtifactItems(input)
  ];
  const items = withId(seeds).slice(0, MAX_DEFECT_TICKETS + MAX_TEST_CASES + MAX_TRACEABILITY_GAPS + MAX_AUTOMATION_DRAFTS + MAX_MISSING_ARTIFACTS);
  const missingArtifactCount = items.filter((item) => item.status === 'missing-artifact').length;
  const readyCount = items.filter((item) => item.status === 'ready').length;
  const needsInputCount = items.filter((item) => item.status === 'needs-input').length;
  const status: EvidenceBundleResult['status'] = items.length === 0
    ? 'empty'
    : missingArtifactCount > 0
      ? 'blocked'
      : needsInputCount > 0
        ? 'partial'
        : 'ready';

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      itemCount: items.length,
      readyCount,
      missingArtifactCount,
      defectTicketCount: items.filter((item) => item.kind === 'defect-ticket').length,
      failedOrBlockedTestCaseCount: input.testCases.summary.failedCount + input.testCases.summary.blockedCount,
      traceabilityGapCount: items.filter((item) => item.kind === 'traceability-gap').length,
      automationDraftCount: items.filter((item) => item.kind === 'automation-draft').length
    },
    items,
    artifactSummary: {
      presentCount: input.artifactIntegrity.presentCount,
      missingCount: input.artifactIntegrity.missingCount,
      skippedCount: input.artifactIntegrity.skippedCount
    },
    notes: [
      'Evidence bundle is a handoff index: it maps proof-ready defects, failed/blocked tests, high-priority traceability gaps, automation drafts, and local artifact availability.',
      'Only artifactRefs with exists=true should be cited as available local evidence; missing-artifact items must be regenerated or removed before sharing the package.',
      'Automation drafts remain review-only until a tester validates selectors, roles, test data, safety boundaries, and executes the generated spec.'
    ]
  };
}

function refsSummary(refs: EvidenceBundleArtifactRef[]): string {
  if (!refs.length) return '-';
  const present = refs.filter((ref) => ref.exists).length;
  const missing = refs.filter((ref) => !ref.exists).length;
  return `${present} present${missing ? ` / ${missing} missing` : ''}`;
}

function firstPaths(refs: EvidenceBundleArtifactRef[]): string {
  if (!refs.length) return '-';
  return refs.slice(0, 3).map((ref) => `${ref.exists ? 'ok' : 'missing'}:${truncateMiddle(ref.path, 70)}`).join('<br>');
}

export function formatEvidenceBundle(bundle: EvidenceBundleResult): string {
  const rows = bundle.items.slice(0, 80).map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.priority)} | ${markdownEscape(item.kind)} | ${markdownEscape(item.status)} | ${markdownEscape(item.owner)} | ${markdownEscape(truncateMiddle(item.title, 120))} | ${markdownEscape(refsSummary(item.artifactRefs))} | ${markdownEscape(truncateMiddle(item.nextStep, 150))} |`);
  const missingRows = bundle.items
    .filter((item) => item.status === 'missing-artifact')
    .slice(0, 30)
    .map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(truncateMiddle(item.title, 120))} | ${markdownEscape(firstPaths(item.artifactRefs))} | ${markdownEscape(truncateMiddle(item.nextStep, 140))} |`);
  const notes = bundle.notes.map((note) => `- ${markdownEscape(note)}`).join('\n');

  return `# FrontLens Evidence Bundle

## Summary

- Status: **${bundle.status}**
- Items: ${bundle.summary.itemCount}
- Ready / Missing artifacts: ${bundle.summary.readyCount} / ${bundle.summary.missingArtifactCount}
- Defect tickets / failed-or-blocked test cases / traceability gaps / automation drafts: ${bundle.summary.defectTicketCount} / ${bundle.summary.failedOrBlockedTestCaseCount} / ${bundle.summary.traceabilityGapCount} / ${bundle.summary.automationDraftCount}
- Artifact integrity present / missing / skipped: ${bundle.artifactSummary.presentCount} / ${bundle.artifactSummary.missingCount} / ${bundle.artifactSummary.skippedCount}

## Handoff items

${rows.length ? ['| ID | Pri | Kind | Status | Owner | Title | Artifacts | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : 'No proof-ready handoff items were generated. Add requirements, runtime journeys, source correlation, or defect proof before using this as a QA handoff.'}

## Missing artifacts

${missingRows.length ? ['| ID | Item | Paths | Next step |', '| --- | --- | --- | --- |', ...missingRows, ''].join('\n') : 'No missing local artifact references in the evidence bundle.'}

## Notes

${notes}
`;
}
