import type { FrontLensConfig, JourneyConfig, JourneyStepConfig, PageModel, RequirementConfigItem } from '../types.js';

const MAX_GENERATED_REQUIREMENT_JOURNEYS = 20;

function requirementId(item: RequirementConfigItem, index: number): string {
  return item.id?.trim() || `REQ-${String(index + 1).padStart(3, '0')}`;
}

function compactTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 96);
}

function makeUniqueName(baseName: string, existing: Set<string>): string {
  if (!existing.has(baseName)) return baseName;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} (${index})`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${baseName} (${Date.now()})`;
}

function makeSelectorSteps(item: RequirementConfigItem): JourneyStepConfig[] {
  return (item.selectors ?? [])
    .filter(Boolean)
    .map((selector) => ({
      action: 'expectVisible' as const,
      target: selector,
      description: `验收断言：需求关联选择器 ${selector} 可见`
    }));
}

function makeTextSteps(item: RequirementConfigItem): JourneyStepConfig[] {
  return (item.expectedTexts ?? [])
    .filter(Boolean)
    .map((text) => ({
      action: 'expectText' as const,
      value: text,
      description: `验收断言：页面出现期望文本「${text.slice(0, 40)}」`
    }));
}

function makeApiSteps(item: RequirementConfigItem): JourneyStepConfig[] {
  return (item.apiPatterns ?? [])
    .filter(Boolean)
    .map((pattern) => ({
      action: 'expectRequest' as const,
      target: pattern,
      value: '2xx',
      description: `验收断言：需求关联接口 ${pattern} 被调用且返回 2xx`
    }));
}

function makeRequirementSteps(item: RequirementConfigItem): JourneyStepConfig[] {
  const steps: JourneyStepConfig[] = [{ action: 'waitForLoad', description: '等待页面完成基础加载' }];
  steps.push(...(item.journeySteps ?? []));
  steps.push(...makeSelectorSteps(item));
  steps.push(...makeTextSteps(item));
  steps.push(...makeApiSteps(item));
  return steps;
}

function hasRunnableAssertion(item: RequirementConfigItem): boolean {
  return Boolean((item.journeySteps?.length ?? 0) > 0 || (item.selectors?.length ?? 0) > 0 || (item.expectedTexts?.length ?? 0) > 0 || (item.apiPatterns?.length ?? 0) > 0);
}

function hasExistingJourneyLink(item: RequirementConfigItem, existingNames: Set<string>): boolean {
  return (item.journeyNames ?? []).some((name) => existingNames.has(name));
}

/**
 * Convert explicit PRD/acceptance criteria into safe Playwright journey config.
 *
 * Design constraints:
 * - Generate only from explicit requirement fields (`journeySteps`, `selectors`, `expectedTexts`, `apiPatterns`).
 *   Free-text PRD is not guessed into clicks, so reports do not overclaim business validation.
 * - Keep normal journey safety enforcement. Mutating clicks/submits remain blocked unless the
 *   caller explicitly marks a step as allowed and disables request blocking.
 * - Link generated journeys back to requirements so coverage can be source/runtime aware.
 */
export function applyRequirementJourneySynthesis(config: FrontLensConfig, _pageModel?: PageModel): JourneyConfig[] {
  if (!config.requirements.enabled || !config.journeys.enabled || config.requirements.items.length === 0) return [];

  const existingNames = new Set(config.journeys.journeys.map((journey) => journey.name));
  const generated: JourneyConfig[] = [];

  for (const [index, item] of config.requirements.items.entries()) {
    if (generated.length >= MAX_GENERATED_REQUIREMENT_JOURNEYS) break;
    if (!hasRunnableAssertion(item)) continue;
    if (hasExistingJourneyLink(item, existingNames) && (item.journeySteps?.length ?? 0) === 0) continue;

    const id = requirementId(item, index);
    const baseName = `Requirement ${id}: ${compactTitle(item.title)}`;
    const name = makeUniqueName(baseName, existingNames);
    existingNames.add(name);

    const journey: JourneyConfig = {
      name,
      startUrl: item.journeyStartUrl,
      source: 'requirement-generated',
      requirementIds: [id],
      steps: makeRequirementSteps(item)
    };

    generated.push(journey);
    config.journeys.journeys.push(journey);
    item.journeyNames = [...new Set([...(item.journeyNames ?? []), name])];
  }

  if (generated.length > 0) {
    const runnableJourneyCount = config.journeys.journeys.filter((journey) => journey.enabled !== false).length;
    config.journeys.maxJourneys = Math.max(config.journeys.maxJourneys, runnableJourneyCount);
  }

  return generated;
}
