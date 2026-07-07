import type { JourneyAssertionAuditFinding, JourneyAssertionAuditItem, JourneyAssertionAuditResult, JourneyStepAction, JourneyTestResult, QaResult } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

const assertionActions = new Set<JourneyStepAction>(['expectVisible', 'expectText', 'expectUrl', 'expectRequest']);
const actionActions = new Set<JourneyStepAction>(['click', 'fill', 'press', 'select', 'check', 'uncheck']);
const genericTargets = new Set(['body', 'html', '#app', 'css=body', 'css=html', 'css=#app']);
const genericTextPattern = /^(ok|yes|no|true|false|submit|button|click|loading|loaded|done|success|error)$/i;

function isAssertionAction(action: string): boolean {
  return assertionActions.has(action as JourneyStepAction);
}

function isActionStep(action: string): boolean {
  return actionActions.has(action as JourneyStepAction);
}

function isGenericAssertion(step: { action: JourneyStepAction; target?: string; value?: string }): boolean {
  const target = (step.target ?? '').trim().toLowerCase();
  const value = (step.value ?? '').trim();
  const genericTarget = genericTargets.has(target);
  if (step.action === 'expectVisible' && genericTargets.has(target)) return true;
  if (step.action === 'expectText' && (!value || value.length < 2)) return true;
  if (step.action === 'expectText' && genericTarget && (value.length <= 3 || genericTextPattern.test(value))) return true;
  if (step.action === 'expectUrl' && (!step.value || step.value === '*' || step.value === '/')) return true;
  return false;
}

function add(findings: JourneyAssertionAuditFinding[], input: Omit<JourneyAssertionAuditFinding, 'id'>): void {
  findings.push({ id: `JA-${String(findings.length + 1).padStart(3, '0')}`, ...input });
}

function auditJourney(journey: JourneyTestResult, linkedRequirementIds: string[] = []): JourneyAssertionAuditItem {
  const actionSteps = journey.steps.filter((step) => isActionStep(step.action));
  const assertionSteps = journey.steps.filter((step) => isAssertionAction(step.action));
  const passedAssertions = assertionSteps.filter((step) => step.status === 'passed');
  const failedAssertions = assertionSteps.filter((step) => step.status === 'failed');
  const weakAssertions = passedAssertions.filter(isGenericAssertion);
  const meaningfulAssertions = passedAssertions.filter((step) => !isGenericAssertion(step));
  const findings: JourneyAssertionAuditFinding[] = [];
  const requirementIds = [...new Set([...(journey.requirementIds ?? []), ...linkedRequirementIds])];
  const requirementBound = requirementIds.length > 0 || journey.source === 'requirement-generated';

  if (journey.status === 'failed') {
    add(findings, {
      severity: 'blocker',
      category: 'failed-journey',
      journeyId: journey.id,
      title: `Journey failed: ${journey.name}`,
      evidence: journey.issue ?? (failedAssertions.map((step) => `step ${step.index}: ${step.error ?? step.action}`).join('；') || 'Journey status is failed.'),
      recommendation: 'Fix the failing step or test data/auth setup, then rerun before using this journey as business evidence.'
    });
  }

  if ((journey.status === 'passed' || journey.status === 'warning') && assertionSteps.length === 0) {
    add(findings, {
      severity: requirementBound ? 'blocker' : 'warning',
      category: 'missing-assertion',
      journeyId: journey.id,
      title: `Passed journey has no assertion steps: ${journey.name}`,
      evidence: `${actionSteps.length} action step(s), 0 expect* step(s).`,
      recommendation: 'Add expectVisible/expectText/expectUrl/expectRequest assertions that prove the business result, not only that the click/fill path did not crash.'
    });
  }

  if (assertionSteps.length > 0 && passedAssertions.length === 0) {
    add(findings, {
      severity: 'blocker',
      category: 'failed-assertion',
      journeyId: journey.id,
      title: `Journey has assertions but none passed: ${journey.name}`,
      evidence: failedAssertions.map((step) => `step ${step.index} ${step.action}: ${step.error ?? 'failed'}`).join('；') || 'No passed assertion step.',
      recommendation: 'Repair selectors/expected text/API pattern, fix the app behavior, or downgrade this journey until a success assertion passes.'
    });
  } else if (failedAssertions.length > 0) {
    add(findings, {
      severity: 'blocker',
      category: 'failed-assertion',
      journeyId: journey.id,
      title: `Journey contains failed assertion step(s): ${journey.name}`,
      evidence: failedAssertions.map((step) => `step ${step.index} ${step.action}: ${step.error ?? 'failed'}`).join('；'),
      recommendation: 'Treat failed assertion steps as business-flow failures until app behavior or expected assertions are corrected.'
    });
  }

  if (passedAssertions.length > 0 && meaningfulAssertions.length === 0) {
    add(findings, {
      severity: requirementBound ? 'blocker' : 'warning',
      category: 'weak-assertion',
      journeyId: journey.id,
      title: `Journey assertions are generic and weak: ${journey.name}`,
      evidence: weakAssertions.map((step) => `step ${step.index} ${step.action} ${step.target ?? ''}`).join('；'),
      recommendation: 'Replace body/html/#app visibility or generic text checks with business-specific text, URL, selector, or request assertions.'
    });
  }

  const quality: JourneyAssertionAuditItem['quality'] = journey.status === 'skipped'
    ? 'skipped'
    : journey.status === 'failed' || failedAssertions.length > 0 || (assertionSteps.length > 0 && passedAssertions.length === 0)
      ? 'failed'
      : meaningfulAssertions.length > 0
        ? 'runtime-verified'
        : passedAssertions.length > 0
          ? 'weakly-asserted'
          : journey.status === 'passed'
            ? 'path-only'
            : 'runtime-partial';

  return {
    journeyId: journey.id,
    name: journey.name,
    source: journey.source ?? 'configured',
    status: journey.status,
    quality,
    requirementIds,
    stepCount: journey.steps.length,
    actionStepCount: actionSteps.length,
    assertionStepCount: assertionSteps.length,
    passedAssertionStepCount: passedAssertions.length,
    failedAssertionStepCount: failedAssertions.length,
    weakAssertionStepCount: weakAssertions.length,
    meaningfulAssertionStepCount: meaningfulAssertions.length,
    assertionActions: assertionSteps.map((step) => step.action),
    findings
  };
}

export function createSkippedJourneyAssertionAudit(reason = 'Journey assertion audit has not run yet.'): JourneyAssertionAuditResult {
  return {
    status: 'skipped',
    checkedAt: new Date().toISOString(),
    summary: {
      journeyCount: 0,
      passedJourneyCount: 0,
      pathOnlyJourneyCount: 0,
      weaklyAssertedJourneyCount: 0,
      runtimeVerifiedJourneyCount: 0,
      failedJourneyCount: 0,
      assertionStepCount: 0,
      meaningfulAssertionStepCount: 0,
      findingCount: 0,
      blockerCount: 0,
      warningCount: 0,
      infoCount: 0
    },
    items: [],
    findings: [],
    notes: [reason]
  };
}

export function buildJourneyAssertionAudit(result: Pick<QaResult, 'journeyTests' | 'requirementCoverage'>): JourneyAssertionAuditResult {
  if (result.journeyTests.length === 0) {
    return createSkippedJourneyAssertionAudit('No journey tests were executed. Record or configure business journeys before claiming runtime business validation.');
  }
  const requirementIdsByJourney = new Map<string, string[]>();
  for (const req of result.requirementCoverage.items.filter((item) => item.source === 'provided')) {
    for (const journeyId of req.evidence.journeyIds) {
      const existing = requirementIdsByJourney.get(journeyId) ?? [];
      existing.push(req.id);
      requirementIdsByJourney.set(journeyId, existing);
    }
  }
  const items = result.journeyTests.map((journey) => auditJourney(journey, requirementIdsByJourney.get(journey.id) ?? []));
  const findings = items.flatMap((item) => item.findings);
  const hasProvidedRequirements = result.requirementCoverage.summary.providedCount > 0;
  const hasRequirementBoundVerifiedJourney = items.some((item) => item.requirementIds.length > 0 && item.quality === 'runtime-verified');
  if (hasProvidedRequirements && !hasRequirementBoundVerifiedJourney) {
    add(findings, {
      severity: 'warning',
      category: 'requirement-binding',
      title: 'Provided requirements are not backed by a runtime-verified requirement-bound journey.',
      evidence: `provided requirements=${result.requirementCoverage.summary.providedCount}; requirement-bound runtime-verified journeys=0`,
      recommendation: 'Bind provided requirements to journeySteps with meaningful expect* assertions, or keep business validation as partial.'
    });
  }

  const blockerCount = findings.filter((item) => item.severity === 'blocker').length;
  const warningCount = findings.filter((item) => item.severity === 'warning').length;
  const infoCount = findings.filter((item) => item.severity === 'info').length;
  const status: JourneyAssertionAuditResult['status'] = blockerCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed';
  return {
    status,
    checkedAt: new Date().toISOString(),
    summary: {
      journeyCount: items.length,
      passedJourneyCount: items.filter((item) => item.status === 'passed').length,
      pathOnlyJourneyCount: items.filter((item) => item.quality === 'path-only').length,
      weaklyAssertedJourneyCount: items.filter((item) => item.quality === 'weakly-asserted').length,
      runtimeVerifiedJourneyCount: items.filter((item) => item.quality === 'runtime-verified').length,
      failedJourneyCount: items.filter((item) => item.quality === 'failed').length,
      assertionStepCount: items.reduce((count, item) => count + item.assertionStepCount, 0),
      meaningfulAssertionStepCount: items.reduce((count, item) => count + item.meaningfulAssertionStepCount, 0),
      findingCount: findings.length,
      blockerCount,
      warningCount,
      infoCount
    },
    items,
    findings,
    notes: [
      'Journey assertion audit distinguishes path replay from business validation.',
      'A passed click/fill journey without meaningful expectVisible/expectText/expectUrl/expectRequest assertions is path-only evidence, not a business pass.'
    ]
  };
}

export function formatJourneyAssertionAudit(audit: JourneyAssertionAuditResult): string {
  const itemRows = audit.items.map((item) => `| ${markdownEscape(item.journeyId)} | ${markdownEscape(item.name)} | ${markdownEscape(item.status)} | ${markdownEscape(item.quality)} | ${item.stepCount} | ${item.actionStepCount} | ${item.assertionStepCount} | ${item.meaningfulAssertionStepCount} | ${markdownEscape(item.requirementIds.join(', ') || '-')} |`);
  const findingRows = audit.findings.map((finding) => `| ${markdownEscape(finding.id)} | ${markdownEscape(finding.severity)} | ${markdownEscape(finding.category)} | ${markdownEscape(finding.journeyId ?? '-')} | ${markdownEscape(finding.title)} | ${markdownEscape(truncateMiddle(finding.evidence, 160))} | ${markdownEscape(finding.recommendation)} |`);
  return `# FrontLens Journey Assertion Audit

- Status: **${audit.status}**
- Journeys: ${audit.summary.journeyCount}（runtime-verified ${audit.summary.runtimeVerifiedJourneyCount}, weak ${audit.summary.weaklyAssertedJourneyCount}, path-only ${audit.summary.pathOnlyJourneyCount}, failed ${audit.summary.failedJourneyCount}）
- Assertions: ${audit.summary.meaningfulAssertionStepCount}/${audit.summary.assertionStepCount} meaningful
- Findings: ${audit.summary.findingCount}（blockers ${audit.summary.blockerCount}, warnings ${audit.summary.warningCount}, info ${audit.summary.infoCount}）

## Journey quality

${itemRows.length ? ['| Journey | Name | Status | Quality | Steps | Actions | Assertions | Meaningful assertions | Requirements |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...itemRows, ''].join('\n') : 'No journey tests were executed.'}

## Findings

${findingRows.length ? ['| ID | Severity | Category | Journey | Finding | Evidence | Recommendation |', '| --- | --- | --- | --- | --- | --- | --- |', ...findingRows, ''].join('\n') : 'No journey assertion quality issues found.'}

## Notes

${audit.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
