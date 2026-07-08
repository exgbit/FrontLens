import type {
  AssertionSuggestionItem,
  AutomationSpecDraft,
  AutomationSpecDraftSource,
  AutomationSpecDraftStatus,
  AutomationSpecResult,
  JourneyStepResult,
  JourneyTestResult,
  QaResult,
  RequirementCoverageItem,
  RequirementPriority,
  TestCaseItem
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

type AutomationSpecInput = Pick<QaResult, 'summary' | 'requirementCoverage' | 'testCases' | 'journeyTests' | 'assertionSuggestions' | 'traceability' | 'qaSignoff'>;

type DraftSeed = Omit<AutomationSpecDraft, 'id' | 'playwright'> & { playwright?: string };

const MAX_DRAFTS = 24;
const SOURCE_ORDER: AutomationSpecDraftSource[] = ['requirement', 'journey', 'assertion-suggestion', 'test-case'];
const PRIORITY_ORDER: Record<RequirementPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const SOURCE_COUNT_ZERO: Record<AutomationSpecDraftSource, number> = {
  requirement: 0,
  'test-case': 0,
  journey: 0,
  'assertion-suggestion': 0
};

function uniq<T>(items: Array<T | undefined | null>): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))] as T[];
}

function nonEmpty(items: Array<string | undefined | null>): string[] {
  return uniq(items.map((item) => String(item ?? '').trim()).filter(Boolean));
}

function priorityScore(priority: RequirementPriority): number {
  return PRIORITY_ORDER[priority] ?? 9;
}

function statusScore(status: AutomationSpecDraftStatus): number {
  return status === 'ready' ? 0 : status === 'needs-input' ? 1 : 2;
}

function sourceScore(source: AutomationSpecDraftSource): number {
  return SOURCE_ORDER.indexOf(source) === -1 ? 9 : SOURCE_ORDER.indexOf(source);
}

function sanitizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || 'FrontLens generated regression draft';
}

function escapeComment(value: string): string {
  return value.replace(/\*\//g, '* /').replace(/\r?\n/g, ' ');
}

function indent(value: string, spaces = 4): string {
  const pad = ' '.repeat(spaces);
  return value.split('\n').map((line) => (line ? `${pad}${line}` : line)).join('\n');
}

function codeString(value: string): string {
  return JSON.stringify(value);
}

function locatorAssertion(selector: string): string {
  return `await expect(page.locator(${codeString(selector)}).first()).toBeVisible();`;
}

function textAssertion(text: string): string {
  return `await expect(page.getByText(${codeString(text)}, { exact: false }).first()).toBeVisible();`;
}

function urlAssertion(value: string): string {
  return `await expect(page).toHaveURL(new RegExp(${codeString(escapeRegExp(value))}));`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stepComment(step: string): string {
  return `// TODO(manual-review): ${escapeComment(step)}`;
}

function isGenericTarget(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === 'body' || normalized === 'html' || normalized === '#app' || normalized === 'main' || normalized === 'document';
}

function isExecutableSuggestion(item: AssertionSuggestionItem): boolean {
  if (item.action === 'expectRequest') return false;
  if (item.action === 'expectVisible' && isGenericTarget(item.target)) return false;
  if (item.action === 'expectText' && (!item.value || item.value.trim().length < 2)) return false;
  if (item.action === 'expectUrl' && !item.value && !item.target) return false;
  return item.confidence !== 'low';
}

function assertionCodeForSuggestion(item: AssertionSuggestionItem): string[] {
  if (item.action === 'expectVisible') return [locatorAssertion(item.target)];
  if (item.action === 'expectText') return item.value ? [textAssertion(item.value)] : [textAssertion(item.target)];
  if (item.action === 'expectUrl') return [urlAssertion(item.value ?? item.target)];
  return [
    stepComment(`Add action that triggers API request matching ${item.target}.`),
    `// const response = await page.waitForResponse((res) => res.url().includes(${codeString(item.target)}));`,
    '// expect(response.ok()).toBeTruthy();'
  ];
}

function journeyHasOnlySafePrereqAssertions(steps: JourneyStepResult[]): boolean {
  return steps.every((step) => ['goto', 'waitForLoad', 'waitMs', 'expectVisible', 'expectText', 'expectUrl'].includes(step.action));
}

function assertionCodeForJourneyStep(step: JourneyStepResult): string[] {
  if (step.action === 'expectVisible' && step.target && !isGenericTarget(step.target)) return [locatorAssertion(step.target)];
  if (step.action === 'expectText') {
    const value = step.value ?? step.target;
    return value ? [textAssertion(value)] : [];
  }
  if (step.action === 'expectUrl') {
    const value = step.value ?? step.target;
    return value ? [urlAssertion(value)] : [];
  }
  if (step.action === 'expectRequest' && step.target) {
    return [
      stepComment(`Add trigger and assert request matching ${step.target}.`),
      `// const response = await page.waitForResponse((res) => res.url().includes(${codeString(step.target ?? '')}));`,
      '// expect(response.ok()).toBeTruthy();'
    ];
  }
  return [];
}

function buildTestBody(seed: DraftSeed, targetUrl: string, assertionLines: string[]): string {
  const lines: string[] = [
    `// FrontLens draft source: ${seed.source}; evidence: ${seed.evidenceRefs.join(', ') || 'none'}`,
    `await page.goto(${codeString(targetUrl)});`
  ];
  for (const precondition of seed.preconditions.slice(0, 4)) lines.push(stepComment(`Precondition: ${precondition}`));
  if (assertionLines.length > 0) lines.push(...assertionLines);
  for (const step of seed.steps.slice(0, 8)) lines.push(stepComment(step));
  for (const expected of seed.expected.slice(0, 6)) lines.push(stepComment(`Expected: ${expected}`));
  if (seed.gaps.length > 0) lines.push(stepComment(`Gaps before execution: ${seed.gaps.slice(0, 3).join('；')}`));
  if (seed.status !== 'ready') {
    lines.push(stepComment('This draft is not counted as passed evidence until QA fills the TODOs and executes it.'));
  }
  return lines.join('\n');
}

function draftFromRequirement(requirement: RequirementCoverageItem, targetUrl: string): DraftSeed | undefined {
  const selectors = nonEmpty(requirement.evidence.selectors).filter((selector) => !isGenericTarget(selector)).slice(0, 6);
  if (selectors.length === 0 && requirement.status === 'not-applicable') return undefined;
  const gaps = [...requirement.gaps];
  const status: AutomationSpecDraftStatus = selectors.length > 0 ? 'ready' : 'needs-input';
  const expected = selectors.map((selector) => `Selector ${selector} is visible for requirement ${requirement.id}.`);
  if (selectors.length === 0) gaps.push('Requirement has no executable selectors/expectedTexts/journey assertions; add them before automation can verify it.');
  const seed: DraftSeed = {
    title: `Requirement ${requirement.id}: ${sanitizeTitle(requirement.title)}`,
    source: 'requirement',
    priority: requirement.priority,
    status,
    confidence: selectors.length > 0 ? requirement.confidence : 'low',
    requirementIds: [requirement.id],
    testCaseIds: [],
    journeyIds: requirement.evidence.journeyIds,
    issueIds: requirement.evidence.issueIds,
    evidenceRefs: nonEmpty([
      requirement.id,
      ...selectors.map((selector) => `selector:${selector}`),
      ...requirement.evidence.componentIds.map((id) => `component:${id}`),
      ...requirement.evidence.networkRequestIds.map((id) => `network:${id}`),
      ...requirement.evidence.issueIds.map((id) => `issue:${id}`)
    ]).slice(0, 30),
    preconditions: [],
    steps: selectors.length > 0 ? [] : ['Add concrete selectors, expectedTexts, apiPatterns, or journeySteps to the reviewed requirements config.'],
    expected,
    gaps: nonEmpty(gaps).slice(0, 8),
    nextSteps: selectors.length > 0
      ? ['Review selector stability, then copy the generated test into the target project Playwright suite and run it.']
      : ['Review qa-intake.config.json, enrich this requirement with executable assertions, rerun FrontLens, then regenerate automation specs.']
  };
  seed.playwright = buildTestBody(seed, targetUrl, selectors.map(locatorAssertion));
  return seed;
}

function draftFromAssertionSuggestion(item: AssertionSuggestionItem, targetUrl: string): DraftSeed {
  const executable = isExecutableSuggestion(item);
  const assertionLines = assertionCodeForSuggestion(item);
  const seed: DraftSeed = {
    title: `${item.action}: ${truncateMiddle(item.value ?? item.target, 90)}`,
    source: 'assertion-suggestion',
    priority: item.priority,
    status: executable ? 'ready' : 'needs-input',
    confidence: executable ? item.confidence : 'low',
    requirementIds: item.requirementId ? [item.requirementId] : [],
    testCaseIds: [],
    journeyIds: item.journeyId ? [item.journeyId] : [],
    issueIds: [],
    evidenceRefs: nonEmpty([item.id, ...item.evidenceRefs]).slice(0, 20),
    preconditions: [],
    steps: executable ? [] : ['Add the missing business action/selector/value before treating this as an executable regression.'],
    expected: [item.reason],
    gaps: executable ? [] : ['Suggestion is request-only, generic, low-confidence, or missing a stable expected value.'],
    nextSteps: [item.exampleStep, ...item.notes].filter(Boolean).slice(0, 6)
  };
  seed.playwright = buildTestBody(seed, targetUrl, assertionLines);
  return seed;
}

function draftFromJourney(journey: JourneyTestResult, targetUrl: string): DraftSeed | undefined {
  const assertionSteps = journey.steps.filter((step) => step.action.startsWith('expect'));
  if (assertionSteps.length === 0) return undefined;
  const assertionLines = assertionSteps.flatMap(assertionCodeForJourneyStep).filter(Boolean);
  const safe = journeyHasOnlySafePrereqAssertions(journey.steps);
  const status: AutomationSpecDraftStatus = assertionLines.some((line) => !line.trim().startsWith('//')) && safe && journey.status === 'passed'
    ? 'ready'
    : assertionLines.some((line) => !line.trim().startsWith('//'))
      ? 'needs-input'
      : 'blocked';
  const unsafeSteps = journey.steps
    .filter((step) => !['goto', 'waitForLoad', 'waitMs', 'expectVisible', 'expectText', 'expectUrl'].includes(step.action))
    .map((step) => `${step.action} ${step.target ?? ''} ${step.value ?? ''}`.trim());
  const seed: DraftSeed = {
    title: `Journey ${journey.id}: ${sanitizeTitle(journey.name)}`,
    source: 'journey',
    priority: journey.requirementIds?.length ? 'P1' : 'P2',
    status,
    confidence: status === 'ready' ? 'high' : status === 'needs-input' ? 'medium' : 'low',
    requirementIds: journey.requirementIds ?? [],
    testCaseIds: [],
    journeyIds: [journey.id],
    issueIds: journey.issue ? [journey.issue] : [],
    evidenceRefs: nonEmpty([journey.id, ...(journey.requirementIds ?? []), ...(journey.issue ? [journey.issue] : [])]).slice(0, 20),
    preconditions: journey.startUrl && journey.startUrl !== targetUrl ? [`Start URL from recorded journey: ${journey.startUrl}`] : [],
    steps: unsafeSteps,
    expected: assertionSteps.map((step) => `${step.action} ${step.target ?? step.value ?? ''}`.trim()).slice(0, 8),
    gaps: status === 'ready' ? [] : ['Journey contains action steps or request-only assertions; generated spec keeps them as TODO comments to avoid unsafe/destructive automation.'],
    nextSteps: status === 'ready'
      ? ['Run the generated spec against a stable environment and keep it as journey regression evidence.']
      : ['Review the TODO action steps, add safe locators/test data, then execute the spec before counting this journey as verified.']
  };
  seed.playwright = buildTestBody(seed, targetUrl, assertionLines);
  return seed;
}

function draftFromTestCase(testCase: TestCaseItem, targetUrl: string): DraftSeed | undefined {
  if (testCase.status === 'passed' && testCase.executionMode === 'static') return undefined;
  const isOpen = ['failed', 'blocked', 'needs-input', 'partial'].includes(testCase.status);
  if (!isOpen && !['requirement', 'journey', 'exception', 'accessibility'].includes(testCase.kind)) return undefined;
  const status: AutomationSpecDraftStatus = testCase.status === 'blocked' ? 'blocked' : 'needs-input';
  const seed: DraftSeed = {
    title: `Test case ${testCase.id}: ${sanitizeTitle(testCase.title)}`,
    source: 'test-case',
    priority: testCase.priority,
    status,
    confidence: testCase.confidence,
    requirementIds: testCase.requirementIds,
    testCaseIds: [testCase.id],
    journeyIds: testCase.journeyIds,
    issueIds: testCase.issueIds,
    evidenceRefs: nonEmpty([testCase.id, ...testCase.evidenceRefs]).slice(0, 30),
    preconditions: testCase.preconditions,
    steps: testCase.steps,
    expected: testCase.expected,
    gaps: nonEmpty([testCase.actual, ...testCase.notes]).slice(0, 8),
    nextSteps: testCase.nextSteps.length ? testCase.nextSteps : ['Convert the manual test case into stable Playwright selectors/assertions and run it.']
  };
  seed.playwright = buildTestBody(seed, targetUrl, []);
  return seed;
}

function finalizeDrafts(seeds: DraftSeed[], targetUrl: string): AutomationSpecDraft[] {
  const seen = new Set<string>();
  return seeds
    .filter(Boolean)
    .sort((left, right) => priorityScore(left.priority) - priorityScore(right.priority)
      || statusScore(left.status) - statusScore(right.status)
      || sourceScore(left.source) - sourceScore(right.source)
      || left.title.localeCompare(right.title))
    .filter((seed) => {
      const key = `${seed.source}:${seed.requirementIds.join(',')}:${seed.journeyIds.join(',')}:${seed.testCaseIds.join(',')}:${seed.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_DRAFTS)
    .map((seed, index) => {
      const id = `AUTO-${String(index + 1).padStart(3, '0')}`;
      return {
        ...seed,
        id,
        playwright: `test(${codeString(`${id} ${seed.title}`)}, async ({ page }) => {\n${indent(seed.playwright ?? buildTestBody(seed, targetUrl, []), 2)}\n});`
      };
    });
}

function buildSpecSource(targetUrl: string, drafts: AutomationSpecDraft[]): string {
  const body = drafts.map((draft) => indent(draft.playwright, 2)).join('\n\n');
  const fallback = `  test('AUTO-000 needs reviewed requirements or assertions', async ({ page }) => {\n    await page.goto(TARGET_URL);\n    test.info().annotations.push({ type: 'frontlens', description: 'No executable automation drafts were generated.' });\n  });`;
  return `import { test, expect } from '@playwright/test';

// Generated by FrontLens as a review-only automation draft.
// Do not treat this file as passed QA evidence until a tester reviews selectors,
// test data, auth state, destructive-action safety, and executes it in CI/local.
const TARGET_URL = process.env.FRONTLENS_TARGET_URL ?? ${codeString(targetUrl)};

test.describe('FrontLens generated regression drafts', () => {
${drafts.length ? body : fallback}
});
`;
}

export function buildAutomationSpecs(input: AutomationSpecInput): AutomationSpecResult {
  const targetUrl = input.summary.url;
  const seeds: DraftSeed[] = [];
  for (const requirement of input.requirementCoverage.items) {
    const draft = draftFromRequirement(requirement, targetUrl);
    if (draft) seeds.push(draft);
  }
  for (const journey of input.journeyTests) {
    const draft = draftFromJourney(journey, targetUrl);
    if (draft) seeds.push(draft);
  }
  for (const suggestion of input.assertionSuggestions.items) {
    seeds.push(draftFromAssertionSuggestion(suggestion, targetUrl));
  }
  for (const testCase of input.testCases.items) {
    const draft = draftFromTestCase(testCase, targetUrl);
    if (draft) seeds.push(draft);
  }

  const drafts = finalizeDrafts(seeds, targetUrl);
  const readyCount = drafts.filter((item) => item.status === 'ready').length;
  const blockedCount = drafts.filter((item) => item.status === 'blocked').length;
  const needsInputCount = drafts.filter((item) => item.status === 'needs-input').length;
  const sourceCounts = drafts.reduce<Record<AutomationSpecDraftSource, number>>((counts, item) => {
    counts[item.source] += 1;
    return counts;
  }, { ...SOURCE_COUNT_ZERO });
  const status: AutomationSpecResult['status'] = drafts.length === 0
    ? 'skipped'
    : readyCount > 0 && needsInputCount === 0 && blockedCount === 0
      ? 'ready'
      : readyCount > 0
        ? 'partial'
        : 'needs-input';
  const specFileName = 'automation/frontlens.spec.ts';
  return {
    generatedAt: new Date().toISOString(),
    status,
    targetUrl,
    specFileName,
    summary: {
      draftCount: drafts.length,
      readyCount,
      needsInputCount,
      blockedCount,
      requirementLinkedCount: drafts.filter((item) => item.requirementIds.length > 0).length,
      runtimeAssertionCount: drafts.filter((item) => item.playwright.includes('await expect(')).length,
      sourceCounts
    },
    drafts,
    specSource: buildSpecSource(targetUrl, drafts),
    notes: [
      'Automation specs are generated drafts, not proof of pass/fail by themselves.',
      'Ready means FrontLens found enough selector/text/url assertion material to create executable Playwright assertions; QA still must review stability, auth, and test data.',
      'Needs-input/blocked drafts intentionally keep risky action steps as TODO comments so the tool does not silently create destructive or misleading automation.'
    ]
  };
}

function cell(value: unknown): string {
  return markdownEscape(truncateMiddle(String(value ?? '-'), 140));
}

export function formatAutomationSpecs(result: AutomationSpecResult): string {
  const rows = result.drafts.map((item) => `| ${cell(item.id)} | ${item.priority} | ${item.source} | ${item.status}/${item.confidence} | ${cell(item.title)} | ${cell(item.requirementIds.join(', ') || '-')} | ${cell(item.nextSteps[0] ?? '-')} |`);
  const ready = result.drafts.filter((item) => item.status === 'ready').slice(0, 8);
  const todo = result.drafts.filter((item) => item.status !== 'ready').slice(0, 8);
  return `# FrontLens Automation Specs

## Status

- Status: **${result.status}**
- Drafts: **${result.summary.draftCount}**（ready ${result.summary.readyCount}, needs-input ${result.summary.needsInputCount}, blocked ${result.summary.blockedCount}）
- Requirement-linked drafts: **${result.summary.requirementLinkedCount}**
- Runtime assertion drafts: **${result.summary.runtimeAssertionCount}**
- Generated Playwright draft: \`${markdownEscape(result.specFileName)}\`

## Draft matrix

${rows.length ? ['| Draft | Pri | Source | Status | Title | Requirements | Next step |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No automation drafts were generated. Add reviewed requirements, assertion suggestions, or journey assertions first.'}

## Ready drafts

${ready.length ? ready.map((item) => `### ${markdownEscape(item.id)} ${markdownEscape(item.title)}\n\n\`\`\`ts\n${item.playwright}\n\`\`\``).join('\n\n') : 'No ready drafts. Use qa-intake/assertion-suggestions to add stable assertions.'}

## Needs input / blocked drafts

${todo.length ? todo.map((item) => `- **${markdownEscape(item.id)}** ${markdownEscape(item.status)} / ${markdownEscape(item.title)}：${markdownEscape(item.gaps[0] ?? item.nextSteps[0] ?? 'Review required.')}`).join('\n') : 'No needs-input or blocked drafts.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
