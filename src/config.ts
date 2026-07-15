import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createDefaultConfig } from './defaultConfig.js';
import { deepMerge } from './utils/deepMerge.js';
import type { BrowserName, FrontLensConfig, QaRunInput } from './types.js';

async function loadConfigFile(configPath: string): Promise<{ config: unknown; baseDir: string }> {
  const absolutePath = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  const baseDir = path.dirname(absolutePath);
  if (absolutePath.endsWith('.json')) {
    return { config: JSON.parse(await readFile(absolutePath, 'utf8')) as unknown, baseDir };
  }

  const mtime = await stat(absolutePath).then((item) => item.mtimeMs).catch(() => Date.now());
  const moduleUrl = `${pathToFileURL(absolutePath).href}?frontlens_mtime=${mtime}`;
  const mod = (await import(moduleUrl)) as { default?: unknown; config?: unknown };
  return { config: mod.default ?? mod.config ?? mod, baseDir };
}

async function loadRequirementsFile(requirementsPath: string): Promise<unknown> {
  const absolutePath = path.isAbsolute(requirementsPath) ? requirementsPath : path.resolve(process.cwd(), requirementsPath);
  return JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;
}

function extractRequirementsConfig(value: unknown): unknown {
  if (Array.isArray(value)) return { enabled: true, inferFromPage: false, items: value };
  if (!isRecord(value)) return value;
  if (isRecord(value.requirements) || Array.isArray(value.requirements)) {
    const base = extractRequirementsConfig(value.requirements);
    if (!isRecord(base) || !Array.isArray(base.items)) return base;
    const changeImpact = isRecord(value.changeImpact) ? value.changeImpact : undefined;
    const targets = changeImpact && Array.isArray(changeImpact.regressionTargets) ? changeImpact.regressionTargets : [];
    const changeItems = targets.flatMap((raw): Record<string, unknown>[] => {
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.title !== 'string') return [];
      return [{
        id: raw.id,
        title: raw.title,
        description: typeof raw.reason === 'string' ? raw.reason : 'Git 变更影响分析生成的原业务回归目标。',
        priority: raw.priority,
        source: 'inferred',
        preconditions: Array.isArray(raw.steps) ? raw.steps.slice(0, 1) : [],
        businessRules: typeof raw.reason === 'string' ? [raw.reason] : [],
        acceptanceCriteria: Array.isArray(raw.expected) ? raw.expected : [],
        apiPatterns: Array.isArray(raw.apiPatterns) ? raw.apiPatterns : [],
        sourceScope: [
          ...(Array.isArray(raw.changedFiles) ? raw.changedFiles : []),
          ...(Array.isArray(raw.dependentFiles) ? raw.dependentFiles : [])
        ],
        ambiguities: ['静态影响分析只定义回归范围；必须执行并保留独立证据。']
      }];
    });
    return { ...base, items: [...base.items, ...changeItems] };
  }
  if (Array.isArray(value.items)) return { enabled: true, inferFromPage: Boolean(value.inferFromPage), items: value.items };
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid FrontLens config: ${message}`);
  }
}

function isBrowserName(value: unknown): value is BrowserName {
  return value === 'chromium' || value === 'firefox' || value === 'webkit';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveRelativePath(value: string | undefined, baseDir: string): string | undefined {
  if (!value || path.isAbsolute(value)) return value;
  return path.resolve(baseDir, value);
}

function resolveRelativePathArray(values: string[], baseDir: string): string[] {
  return values.map((value) => resolveRelativePath(value, baseDir) ?? value);
}

function resolveConfigRelativePaths(config: FrontLensConfig, baseDir: string): void {
  config.auth.storageState = resolveRelativePath(config.auth.storageState, baseDir);
  config.auth.sessionStorageState = resolveRelativePath(config.auth.sessionStorageState, baseDir);
  config.contract.schemaPath = resolveRelativePath(config.contract.schemaPath, baseDir);
  config.source.root = resolveRelativePath(config.source.root, baseDir);
  config.p2.visual.baselineDir = resolveRelativePath(config.p2.visual.baselineDir, baseDir);
  config.productContext.adrRefs = resolveRelativePathArray(config.productContext.adrRefs, baseDir);
  config.plugins.analyzers = resolveRelativePathArray(config.plugins.analyzers, baseDir);
  config.plugins.reporters = resolveRelativePathArray(config.plugins.reporters, baseDir);
  config.plugins.rules = resolveRelativePathArray(config.plugins.rules, baseDir);
}

function assertBoolean(value: unknown, pathName: string): asserts value is boolean {
  assert(typeof value === 'boolean', `${pathName} must be boolean.`);
}

function assertFiniteNumber(value: unknown, pathName: string, min = 0): asserts value is number {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min, `${pathName} must be a finite number >= ${min}.`);
}

function assertStringArray(value: unknown, pathName: string): asserts value is string[] {
  assert(Array.isArray(value) && value.every((item) => typeof item === 'string'), `${pathName} must be an array of strings.`);
}

const journeyStepActions = new Set([
  'goto',
  'click',
  'fill',
  'press',
  'select',
  'check',
  'uncheck',
  'expectVisible',
  'expectText',
  'expectUrl',
  'expectRequest',
  'waitForLoad',
  'waitMs'
]);

const interactionKinds = new Set([
  'search',
  'reset',
  'pagination',
  'dialog',
  'tab',
  'table-sort',
  'table-selection',
  'refresh',
  'download',
  'rapid-click',
  'upload',
  'form-validation'
]);

function validateJourneyStep(step: unknown, stepPath: string): void {
  assert(isRecord(step), `${stepPath} must be an object.`);
  assert(typeof step.action === 'string' && journeyStepActions.has(step.action), `${stepPath}.action must be one of ${[...journeyStepActions].join(', ')}.`);
  if (step.target !== undefined) assert(typeof step.target === 'string', `${stepPath}.target must be a string.`);
  if (step.value !== undefined) assert(typeof step.value === 'string', `${stepPath}.value must be a string.`);
  if (step.timeoutMs !== undefined) assertFiniteNumber(step.timeoutMs, `${stepPath}.timeoutMs`, 0);
  if (step.allowMutating !== undefined) assertBoolean(step.allowMutating, `${stepPath}.allowMutating`);
  if (step.description !== undefined) assert(typeof step.description === 'string', `${stepPath}.description must be a string.`);
}

function validateConfig(config: FrontLensConfig): FrontLensConfig {
  assert(isRecord(config.target), 'target must be an object.');
  assert(isRecord(config.browser), 'browser must be an object.');
  assert(isRecord(config.browser.viewport), 'browser.viewport must be an object.');
  assert(isRecord(config.auth), 'auth must be an object.');
  assert(isRecord(config.safety), 'safety must be an object.');
  assert(isRecord(config.security), 'security must be an object.');
  assert(isRecord(config.journeys), 'journeys must be an object.');
  assert(isRecord(config.requirements), 'requirements must be an object.');
  assert(isRecord(config.productContext), 'productContext must be an object.');
  assert(isRecord(config.testData), 'testData must be an object.');
  assert(isRecord(config.source), 'source must be an object.');
  assert(isRecord(config.contract), 'contract must be an object.');
  assert(isRecord(config.realtime), 'realtime must be an object.');
  assert(isRecord(config.p2), 'p2 must be an object.');
  assert(isRecord(config.p2.visual), 'p2.visual must be an object.');
  assert(isRecord(config.p2.budgets), 'p2.budgets must be an object.');
  assert(isRecord(config.p2.networkProfiles), 'p2.networkProfiles must be an object.');
  assert(isRecord(config.exploration), 'exploration must be an object.');
  assert(isRecord(config.analysis), 'analysis must be an object.');
  assert(isRecord(config.responsive), 'responsive must be an object.');
  assert(isRecord(config.exception), 'exception must be an object.');
  assert(isRecord(config.plugins), 'plugins must be an object.');
  assert(isRecord(config.ai), 'ai must be an object.');
  assert(isRecord(config.report), 'report must be an object.');
  assert(typeof config.target.url === 'string' && config.target.url.length > 0, 'target.url is required.');
  assert(isBrowserName(config.browser.name), 'browser.name must be chromium, firefox, or webkit.');
  assertBoolean(config.browser.headless, 'browser.headless');
  assertBoolean(config.browser.ignoreHTTPSErrors, 'browser.ignoreHTTPSErrors');
  assertFiniteNumber(config.browser.viewport.width, 'browser.viewport.width', 1);
  assertFiniteNumber(config.browser.viewport.height, 'browser.viewport.height', 1);
  assertFiniteNumber(config.browser.timeoutMs, 'browser.timeoutMs', 1);
  assert(['load', 'domcontentloaded', 'networkidle', 'commit'].includes(config.browser.waitUntil), 'browser.waitUntil must be load, domcontentloaded, networkidle, or commit.');
  assertFiniteNumber(config.browser.extraWaitMs, 'browser.extraWaitMs');

  for (const key of ['allowCreate', 'allowEdit', 'allowDelete', 'allowUpload', 'allowDownload', 'allowSubmit', 'blockMutatingRequests'] as const) {
    assertBoolean(config.safety[key], `safety.${key}`);
  }
  if (config.safety.readOnlyPostPatterns !== undefined) assertStringArray(config.safety.readOnlyPostPatterns, 'safety.readOnlyPostPatterns');
  assertBoolean(config.security.enabled, 'security.enabled');
  assert(config.security.mode === 'passive' || config.security.mode === 'active', 'security.mode must be passive or active.');
  for (const key of ['checkHeaders', 'checkCookies', 'checkSensitiveData', 'checkMixedContent', 'checkThirdPartyResources', 'checkXssPassive', 'checkCsrfHints', 'checkApiLeaks', 'activeProbing'] as const) {
    assertBoolean(config.security[key], `security.${key}`);
  }
  assertBoolean(config.journeys.enabled, 'journeys.enabled');
  assertBoolean(config.journeys.continueOnFailure, 'journeys.continueOnFailure');
  assertFiniteNumber(config.journeys.maxJourneys, 'journeys.maxJourneys', 0);
  assertFiniteNumber(config.journeys.maxStepsPerJourney, 'journeys.maxStepsPerJourney', 0);
  assert(Array.isArray(config.journeys.journeys), 'journeys.journeys must be an array.');
  (config.journeys.journeys as unknown[]).forEach((journey, journeyIndex) => {
    const journeyPath = `journeys.journeys[${journeyIndex}]`;
    assert(isRecord(journey), `${journeyPath} must be an object.`);
    assert(typeof journey.name === 'string' && journey.name.trim().length > 0, `${journeyPath}.name must be a non-empty string.`);
    if (journey.startUrl !== undefined) assert(typeof journey.startUrl === 'string', `${journeyPath}.startUrl must be a string.`);
    if (journey.enabled !== undefined) assertBoolean(journey.enabled, `${journeyPath}.enabled`);
    if (journey.source !== undefined) assert(journey.source === 'configured' || journey.source === 'requirement-generated' || journey.source === 'inferred', `${journeyPath}.source must be configured, requirement-generated, or inferred.`);
    if (journey.requirementIds !== undefined) assertStringArray(journey.requirementIds, `${journeyPath}.requirementIds`);
    assert(Array.isArray(journey.steps), `${journeyPath}.steps must be an array.`);
    journey.steps.forEach((step, stepIndex) => validateJourneyStep(step, `${journeyPath}.steps[${stepIndex}]`));
  });
  assertBoolean(config.requirements.enabled, 'requirements.enabled');
  assertBoolean(config.requirements.inferFromPage, 'requirements.inferFromPage');
  assert(Array.isArray(config.requirements.items), 'requirements.items must be an array.');
  (config.requirements.items as unknown[]).forEach((item, index) => {
    const itemPath = `requirements.items[${index}]`;
    assert(isRecord(item), `${itemPath} must be an object.`);
    if (item.id !== undefined) assert(typeof item.id === 'string' && item.id.trim().length > 0, `${itemPath}.id must be a non-empty string.`);
    assert(typeof item.title === 'string' && item.title.trim().length > 0, `${itemPath}.title must be a non-empty string.`);
    if (item.description !== undefined) assert(typeof item.description === 'string', `${itemPath}.description must be a string.`);
    if (item.priority !== undefined) assert(item.priority === 'P0' || item.priority === 'P1' || item.priority === 'P2' || item.priority === 'P3', `${itemPath}.priority must be P0, P1, P2, or P3.`);
    if (item.source !== undefined) assert(item.source === 'provided' || item.source === 'inferred', `${itemPath}.source must be provided or inferred.`);
    if (item.selectors !== undefined) assertStringArray(item.selectors, `${itemPath}.selectors`);
    if (item.journeyNames !== undefined) assertStringArray(item.journeyNames, `${itemPath}.journeyNames`);
    if (item.journeyStartUrl !== undefined) assert(typeof item.journeyStartUrl === 'string', `${itemPath}.journeyStartUrl must be a string.`);
    if (item.expectedTexts !== undefined) assertStringArray(item.expectedTexts, `${itemPath}.expectedTexts`);
    if (item.journeySteps !== undefined) {
      assert(Array.isArray(item.journeySteps), `${itemPath}.journeySteps must be an array.`);
      item.journeySteps.forEach((step, stepIndex) => validateJourneyStep(step, `${itemPath}.journeySteps[${stepIndex}]`));
    }
    if (item.apiPatterns !== undefined) assertStringArray(item.apiPatterns, `${itemPath}.apiPatterns`);
    for (const field of ['roles', 'preconditions', 'businessRules', 'acceptanceCriteria', 'stateTransitions', 'frontendScope', 'backendScope', 'apiScope', 'sourceScope', 'ambiguities', 'sourceRefs'] as const) {
      if (item[field] !== undefined) assertStringArray(item[field], `${itemPath}.${field}`);
    }
    if (item.interactionKinds !== undefined) {
      assert(Array.isArray(item.interactionKinds) && item.interactionKinds.every((kind) => typeof kind === 'string' && interactionKinds.has(kind)), `${itemPath}.interactionKinds must contain supported interaction kinds.`);
    }
  });

  assertBoolean(config.productContext.enabled, 'productContext.enabled');
  if (config.productContext.productName !== undefined) assert(typeof config.productContext.productName === 'string', 'productContext.productName must be a string.');
  if (config.productContext.pageName !== undefined) assert(typeof config.productContext.pageName === 'string', 'productContext.pageName must be a string.');
  if (config.productContext.pageType !== undefined) assert(typeof config.productContext.pageType === 'string', 'productContext.pageType must be a string.');
  assert(
    config.productContext.deviceScope === 'unknown' ||
      config.productContext.deviceScope === 'desktop-only' ||
      config.productContext.deviceScope === 'desktop-first' ||
      config.productContext.deviceScope === 'responsive' ||
      config.productContext.deviceScope === 'mobile-first',
    'productContext.deviceScope must be unknown, desktop-only, desktop-first, responsive, or mobile-first.'
  );
  assert(
    config.productContext.accessibilityTarget === 'unknown' ||
      config.productContext.accessibilityTarget === 'basic' ||
      config.productContext.accessibilityTarget === 'wcag-aa' ||
      config.productContext.accessibilityTarget === 'wcag-aaa',
    'productContext.accessibilityTarget must be unknown, basic, wcag-aa, or wcag-aaa.'
  );
  assertStringArray(config.productContext.requiredFeatures, 'productContext.requiredFeatures');
  assertStringArray(config.productContext.optionalFeatures, 'productContext.optionalFeatures');
  assertStringArray(config.productContext.outOfScopeFeatures, 'productContext.outOfScopeFeatures');
  assertStringArray(config.productContext.adrRefs, 'productContext.adrRefs');
  assert(Array.isArray(config.productContext.decisions), 'productContext.decisions must be an array.');
  (config.productContext.decisions as unknown[]).forEach((decision, index) => {
    const decisionPath = `productContext.decisions[${index}]`;
    assert(isRecord(decision), `${decisionPath} must be an object.`);
    if (decision.id !== undefined) assert(typeof decision.id === 'string', `${decisionPath}.id must be a string.`);
    assert(typeof decision.title === 'string' && decision.title.trim().length > 0, `${decisionPath}.title must be a non-empty string.`);
    if (decision.appliesTo !== undefined) assertStringArray(decision.appliesTo, `${decisionPath}.appliesTo`);
    if (decision.rationale !== undefined) assert(typeof decision.rationale === 'string', `${decisionPath}.rationale must be a string.`);
  });

  assertBoolean(config.testData.enabled, 'testData.enabled');
  assert(config.testData.environment === 'unknown' || config.testData.environment === 'local' || config.testData.environment === 'staging' || config.testData.environment === 'production', 'testData.environment must be unknown, local, staging, or production.');
  assertBoolean(config.testData.allowProductionWrites, 'testData.allowProductionWrites');
  assertStringArray(config.testData.notes, 'testData.notes');
  assert(Array.isArray(config.testData.records), 'testData.records must be an array.');
  (config.testData.records as unknown[]).forEach((record, index) => {
    const recordPath = `testData.records[${index}]`;
    assert(isRecord(record), `${recordPath} must be an object.`);
    assert(typeof record.id === 'string' && record.id.trim().length > 0, `${recordPath}.id must be a non-empty string.`);
    assert(typeof record.title === 'string' && record.title.trim().length > 0, `${recordPath}.title must be a non-empty string.`);
    assert(record.state === 'existing' || record.state === 'seeded' || record.state === 'generated' || record.state === 'unknown', `${recordPath}.state must be existing, seeded, generated, or unknown.`);
    if (record.requiredFor !== undefined) assertStringArray(record.requiredFor, `${recordPath}.requiredFor`);
    if (record.expectedTexts !== undefined) assertStringArray(record.expectedTexts, `${recordPath}.expectedTexts`);
    if (record.apiPatterns !== undefined) assertStringArray(record.apiPatterns, `${recordPath}.apiPatterns`);
    if (record.cleanupOperationId !== undefined) assert(typeof record.cleanupOperationId === 'string', `${recordPath}.cleanupOperationId must be a string.`);
    if (record.sensitive !== undefined) assertBoolean(record.sensitive, `${recordPath}.sensitive`);
    if (record.owner !== undefined) assert(typeof record.owner === 'string', `${recordPath}.owner must be a string.`);
  });
  const validateOperation = (operation: unknown, operationPath: string): void => {
    assert(isRecord(operation), `${operationPath} must be an object.`);
    assert(typeof operation.id === 'string' && operation.id.trim().length > 0, `${operationPath}.id must be a non-empty string.`);
    assert(typeof operation.title === 'string' && operation.title.trim().length > 0, `${operationPath}.title must be a non-empty string.`);
    assert(operation.type === 'manual' || operation.type === 'api' || operation.type === 'script' || operation.type === 'sql' || operation.type === 'fixture', `${operationPath}.type must be manual, api, script, sql, or fixture.`);
    if (operation.target !== undefined) assert(typeof operation.target === 'string', `${operationPath}.target must be a string.`);
    if (operation.command !== undefined) assert(typeof operation.command === 'string', `${operationPath}.command must be a string.`);
    if (operation.endpoint !== undefined) assert(typeof operation.endpoint === 'string', `${operationPath}.endpoint must be a string.`);
    if (operation.method !== undefined) assert(typeof operation.method === 'string', `${operationPath}.method must be a string.`);
    if (operation.destructive !== undefined) assertBoolean(operation.destructive, `${operationPath}.destructive`);
    if (operation.rollbackOperationId !== undefined) assert(typeof operation.rollbackOperationId === 'string', `${operationPath}.rollbackOperationId must be a string.`);
  };
  assert(Array.isArray(config.testData.setupSteps), 'testData.setupSteps must be an array.');
  config.testData.setupSteps.forEach((operation, index) => validateOperation(operation, `testData.setupSteps[${index}]`));
  assert(Array.isArray(config.testData.cleanupSteps), 'testData.cleanupSteps must be an array.');
  config.testData.cleanupSteps.forEach((operation, index) => validateOperation(operation, `testData.cleanupSteps[${index}]`));

  assertBoolean(config.source.enabled, 'source.enabled');
  if (config.source.root !== undefined) assert(typeof config.source.root === 'string', 'source.root must be a string.');
  assertFiniteNumber(config.source.maxFiles, 'source.maxFiles', 0);
  assertFiniteNumber(config.source.maxBytesPerFile, 'source.maxBytesPerFile', 1024);
  assertStringArray(config.source.include, 'source.include');
  assertStringArray(config.source.exclude, 'source.exclude');
  assertBoolean(config.source.runScripts, 'source.runScripts');
  assertStringArray(config.source.scriptNames, 'source.scriptNames');
  assertFiniteNumber(config.source.scriptTimeoutMs, 'source.scriptTimeoutMs', 1);
  assertFiniteNumber(config.source.maxScriptOutputBytes, 'source.maxScriptOutputBytes', 256);

  assertBoolean(config.contract.enabled, 'contract.enabled');
  if (config.contract.schemaPath !== undefined) assert(typeof config.contract.schemaPath === 'string', 'contract.schemaPath must be a string.');
  assertBoolean(config.contract.inferFromTraffic, 'contract.inferFromTraffic');
  assertBoolean(config.contract.strict, 'contract.strict');
  assertFiniteNumber(config.contract.maxBodyExamples, 'contract.maxBodyExamples', 1);
  assertBoolean(config.realtime.enabled, 'realtime.enabled');
  assertBoolean(config.realtime.captureWebSocket, 'realtime.captureWebSocket');
  assertBoolean(config.realtime.captureSse, 'realtime.captureSse');
  assertFiniteNumber(config.realtime.maxMessages, 'realtime.maxMessages', 0);
  assertBoolean(config.p2.enabled, 'p2.enabled');
  assertBoolean(config.p2.visual.enabled, 'p2.visual.enabled');
  assertFiniteNumber(config.p2.visual.diffThresholdRatio, 'p2.visual.diffThresholdRatio');
  assertBoolean(config.p2.budgets.enabled, 'p2.budgets.enabled');
  for (const key of ['fcpMs', 'loadMs', 'totalTransferKb', 'domNodes', 'longTaskCount', 'cls'] as const) {
    if (config.p2.budgets[key] !== undefined) assertFiniteNumber(config.p2.budgets[key], `p2.budgets.${key}`);
  }
  assertBoolean(config.p2.networkProfiles.enabled, 'p2.networkProfiles.enabled');
  assert(Array.isArray(config.p2.networkProfiles.profiles), 'p2.networkProfiles.profiles must be an array.');
  assert(config.p2.networkProfiles.profiles.every((profile) => profile === 'offline' || profile === 'slow-3g'), 'p2.networkProfiles.profiles must contain only offline or slow-3g.');

  assertFiniteNumber(config.exploration.maxDepth, 'exploration.maxDepth');
  assertFiniteNumber(config.exploration.maxPages, 'exploration.maxPages', 1);
  assertFiniteNumber(config.exploration.maxActionsPerPage, 'exploration.maxActionsPerPage');
  assertStringArray(config.exploration.include, 'exploration.include');
  assertStringArray(config.exploration.exclude, 'exploration.exclude');

  for (const [key, value] of Object.entries(config.analysis)) {
    if (typeof value === 'boolean') {
      continue;
    }
    assertFiniteNumber(value, `analysis.${key}`);
  }

  assert(
    Array.isArray(config.responsive.viewports) &&
      config.responsive.viewports.every((viewport) => typeof viewport.name === 'string' && Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0),
    'responsive.viewports must contain {name,width,height}.'
  );
  assertBoolean(config.exception.enabled, 'exception.enabled');
  assertFiniteNumber(config.exception.delayMs, 'exception.delayMs');
  assertStringArray(config.plugins.analyzers, 'plugins.analyzers');
  assertStringArray(config.plugins.reporters, 'plugins.reporters');
  assertStringArray(config.plugins.rules, 'plugins.rules');
  assert(config.ai.provider === 'heuristic' || config.ai.provider === 'command', 'ai.provider must be heuristic or command.');
  assertFiniteNumber(config.ai.maxIssues, 'ai.maxIssues', 1);
  assertFiniteNumber(config.ai.maxContextBytes, 'ai.maxContextBytes', 1024);
  assert(
    Array.isArray(config.report.formats) && config.report.formats.every((format) => format === 'json' || format === 'markdown' || format === 'html'),
    'report.formats must contain only json, markdown, html.'
  );
  assert(
    config.report.profile === 'executive' || config.report.profile === 'professional' || config.report.profile === 'full',
    'report.profile must be executive, professional, or full.'
  );
  assert(typeof config.report.outputDir === 'string' && config.report.outputDir.length > 0, 'report.outputDir is required.');
  assertBoolean(config.report.trace, 'report.trace');
  assertBoolean(config.report.screenshot, 'report.screenshot');
  assertBoolean(config.report.video, 'report.video');
  assertBoolean(config.report.domSnapshot, 'report.domSnapshot');
  return config;
}

export async function loadConfig(input: QaRunInput): Promise<FrontLensConfig> {
  let config = createDefaultConfig(input.url);

  if (input.configPath) {
    const fileConfig = await loadConfigFile(input.configPath);
    config = deepMerge(config as unknown as Record<string, unknown>, fileConfig.config) as unknown as FrontLensConfig;
    validateConfig(config);
    resolveConfigRelativePaths(config, fileConfig.baseDir);
  }

  config.target.url = input.url || config.target.url;

  if (input.outputDir) {
    config.report.outputDir = input.outputDir;
  }
  if (input.browser) {
    config.browser.name = input.browser;
  }
  if (input.headless !== undefined) {
    config.browser.headless = input.headless;
  }
  if (input.ignoreHTTPSErrors !== undefined) {
    config.browser.ignoreHTTPSErrors = input.ignoreHTTPSErrors;
  }
  if (input.storageState) {
    config.auth.storageState = input.storageState;
  }
  if (input.sessionStorageState) {
    config.auth.sessionStorageState = input.sessionStorageState;
  }
  if (input.trace !== undefined) {
    config.report.trace = input.trace;
  }
  if (input.video !== undefined) {
    config.report.video = input.video;
  }
  if (input.screenshot !== undefined) {
    config.report.screenshot = input.screenshot;
  }
  if (input.reportProfile !== undefined) {
    config.report.profile = input.reportProfile;
  }
  if (input.simulateExceptions !== undefined) {
    config.exception.enabled = input.simulateExceptions;
  }
  if (input.ai !== undefined) {
    config.analysis.ai = input.ai;
  }
  if (input.coverage !== undefined) {
    config.analysis.coverage = input.coverage;
  }
  if (input.blockMutatingRequests !== undefined) {
    config.safety.blockMutatingRequests = input.blockMutatingRequests;
  }
  if (input.security !== undefined) {
    config.security.enabled = input.security;
  }
  if (input.journeys !== undefined) {
    config.journeys.enabled = input.journeys;
  }
  if (input.contract !== undefined) {
    config.contract.enabled = input.contract;
  }
  if (input.realtime !== undefined) {
    config.realtime.enabled = input.realtime;
  }
  if (input.p2 !== undefined) {
    config.p2.enabled = input.p2;
  }
  if (input.requirementsPath) {
    const requirements = extractRequirementsConfig(await loadRequirementsFile(input.requirementsPath));
    config.requirements = deepMerge(config.requirements as unknown as Record<string, unknown>, requirements) as unknown as FrontLensConfig['requirements'];
    config.requirements.enabled = true;
  }
  if (input.sourceRoot) {
    config.source.root = path.isAbsolute(input.sourceRoot) ? input.sourceRoot : path.resolve(process.cwd(), input.sourceRoot);
    config.source.enabled = true;
  }
  if (input.sourceRunScripts !== undefined) {
    config.source.runScripts = input.sourceRunScripts;
  }
  if (input.sourceScripts !== undefined && input.sourceScripts.length > 0) {
    config.source.scriptNames = input.sourceScripts;
  }
  if (input.sourceScriptTimeoutMs !== undefined) {
    config.source.scriptTimeoutMs = input.sourceScriptTimeoutMs;
  }

  return validateConfig(config);
}
