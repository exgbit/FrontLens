import { buildAssertionSuggestions } from '../journeys/assertionSuggestions.js';
import type { AssertionSuggestionItem, FrontLensConfig, JourneyStepConfig, QaIntakeQuestion, QaResult } from '../types.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function topQuestions(questions: QaIntakeQuestion[]): Array<{
  id: string;
  priority: QaIntakeQuestion['priority'];
  category: QaIntakeQuestion['category'];
  question: string;
  howToAnswer: string;
  blocksClaims: string[];
}> {
  return questions.slice(0, 10).map((item) => ({
    id: item.id,
    priority: item.priority,
    category: item.category,
    question: item.question,
    howToAnswer: item.howToAnswer,
    blocksClaims: item.blocksClaims
  }));
}

function safeSourceConfig(result: QaResult): FrontLensConfig['source'] {
  const source = clone(result.metadata.config.source);
  source.root = result.sourceAnalysis.root ?? source.root;
  return source;
}

function safeRequirementsConfig(result: QaResult): FrontLensConfig['requirements'] {
  const configured = result.metadata.config.requirements;
  const providedItems = configured.items.filter((item) => item.source !== 'inferred');
  return {
    enabled: true,
    inferFromPage: providedItems.length > 0 ? configured.inferFromPage : false,
    items: clone(providedItems)
  };
}

function suggestionStep(item: AssertionSuggestionItem): JourneyStepConfig {
  return item.value === undefined
    ? { action: item.action, target: item.target }
    : { action: item.action, target: item.target, value: item.value };
}

function assertionDrafts(suggestions: ReturnType<typeof buildAssertionSuggestions>): Array<{
  id: string;
  priority: AssertionSuggestionItem['priority'];
  source: AssertionSuggestionItem['source'];
  confidence: AssertionSuggestionItem['confidence'];
  journeyId?: string;
  requirementId?: string;
  step: JourneyStepConfig;
  reason: string;
  evidenceRefs: string[];
  notes: string[];
  copyTo: string;
}> {
  return suggestions.items.slice(0, 24).map((item) => ({
    id: item.id,
    priority: item.priority,
    source: item.source,
    confidence: item.confidence,
    journeyId: item.journeyId,
    requirementId: item.requirementId,
    step: suggestionStep(item),
    reason: item.reason,
    evidenceRefs: item.evidenceRefs,
    notes: item.notes,
    copyTo: item.requirementId
      ? `requirements.items[id=${item.requirementId}].journeySteps`
      : item.journeyId
        ? `journeys.journeys[name or id=${item.journeyId}].steps`
        : 'requirements.items[].journeySteps or journeys.journeys[].steps after QA review'
  }));
}

export function buildQaIntakeConfig(result: QaResult): Record<string, unknown> {
  const configPath = typeof result.artifacts.qaIntakeConfig === 'string' && result.artifacts.qaIntakeConfig.length > 0
    ? result.artifacts.qaIntakeConfig
    : 'qa-intake.config.json';
  const sourceRoot = result.sourceAnalysis.root ?? result.metadata.config.source.root;
  const rerunCommand = `node dist/cli.js qa --url ${quote(result.summary.url)} --config ${quote(configPath)} --output ${quote('reports/frontlens/with-qa-intake')} --sme --json-summary${sourceRoot ? ` --source-root ${quote(sourceRoot)}` : ''}`;
  const assertionSuggestions = buildAssertionSuggestions(result);
  const draftAssertionSteps = assertionDrafts(assertionSuggestions);
  return {
    _frontlensQaIntake: {
      generatedAt: new Date().toISOString(),
      status: result.qaIntake.status,
      purpose: 'Reviewable QA intake answer sheet. Edit the standard FrontLens config keys below, delete or keep this metadata block, then rerun QA with --config.',
      reviewRequired: true,
      rerunCommand,
      instructions: [
        'Fill requirements.items with explicit PRD/acceptance criteria, selectors, expectedTexts, apiPatterns, and safe journeySteps for P0/P1 flows.',
        'Confirm productContext with Product/QA/Design before using it to downgrade style/device/export/pagination/refresh observations.',
        'Fill testData records/setupSteps/cleanupSteps before validating create/edit/delete/upload/import/submit flows.',
        'Review draftAssertionSteps and copy only confirmed expect* steps into requirements.items[].journeySteps or journeys.journeys[].steps, then rerun; drafts are not pass evidence.',
        'Keep inferFromPage=false until explicit requirements are available if you want to avoid inferred business-pass claims.'
      ],
      topQuestions: topQuestions(result.qaIntake.topQuestions),
      assertionSuggestions: {
        status: assertionSuggestions.status,
        summary: assertionSuggestions.summary,
        draftAssertionStepCount: draftAssertionSteps.length,
        reviewRequired: true,
        howToUse: 'Copy confirmed draftAssertionSteps[].step into the matching requirement journeySteps or configured journey steps. Do not treat these drafts as passed evidence until FrontLens reruns them.'
      },
      draftAssertionSteps,
      blockedClaims: [...new Set(result.qaIntake.questions.flatMap((item) => item.blocksClaims))],
      sourceArtifacts: {
        qaIntake: result.artifacts.qaIntake,
        productContext: result.artifacts.productContext,
        assertionSuggestions: result.artifacts.assertionSuggestions,
        businessJourneys: result.artifacts.businessJourneys,
        qaPlan: result.artifacts.qaPlan,
        qaCoverage: result.artifacts.qaCoverage,
        testCases: result.artifacts.testCases,
        riskRegister: result.artifacts.riskRegister,
        riskAcceptance: result.artifacts.riskAcceptance
      }
    },
    productContext: clone(result.scopeReview.configSnippet.productContext),
    requirements: safeRequirementsConfig(result),
    journeys: clone(result.metadata.config.journeys),
    testData: clone(result.metadata.config.testData),
    safety: clone(result.metadata.config.safety),
    source: safeSourceConfig(result),
    report: {
      ...clone(result.metadata.config.report),
      profile: 'executive'
    }
  };
}
