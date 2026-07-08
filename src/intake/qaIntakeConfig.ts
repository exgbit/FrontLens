import type { FrontLensConfig, QaIntakeQuestion, QaResult } from '../types.js';

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

export function buildQaIntakeConfig(result: QaResult): Record<string, unknown> {
  const configPath = typeof result.artifacts.qaIntakeConfig === 'string' && result.artifacts.qaIntakeConfig.length > 0
    ? result.artifacts.qaIntakeConfig
    : 'qa-intake.config.json';
  const sourceRoot = result.sourceAnalysis.root ?? result.metadata.config.source.root;
  const rerunCommand = `node dist/cli.js qa --url ${quote(result.summary.url)} --config ${quote(configPath)} --output ${quote('reports/frontlens/with-qa-intake')} --no-trace --json${sourceRoot ? ` --source-root ${quote(sourceRoot)}` : ''}`;
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
        'Keep inferFromPage=false until explicit requirements are available if you want to avoid inferred business-pass claims.'
      ],
      topQuestions: topQuestions(result.qaIntake.topQuestions),
      blockedClaims: [...new Set(result.qaIntake.questions.flatMap((item) => item.blocksClaims))],
      sourceArtifacts: {
        qaIntake: result.artifacts.qaIntake,
        productContext: result.artifacts.productContext,
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
