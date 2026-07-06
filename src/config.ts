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
  config.p2.visual.baselineDir = resolveRelativePath(config.p2.visual.baselineDir, baseDir);
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
  'waitForLoad',
  'waitMs'
]);

function validateConfig(config: FrontLensConfig): FrontLensConfig {
  assert(isRecord(config.target), 'target must be an object.');
  assert(isRecord(config.browser), 'browser must be an object.');
  assert(isRecord(config.browser.viewport), 'browser.viewport must be an object.');
  assert(isRecord(config.auth), 'auth must be an object.');
  assert(isRecord(config.safety), 'safety must be an object.');
  assert(isRecord(config.security), 'security must be an object.');
  assert(isRecord(config.journeys), 'journeys must be an object.');
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
    assert(Array.isArray(journey.steps), `${journeyPath}.steps must be an array.`);
    journey.steps.forEach((step, stepIndex) => {
      const stepPath = `${journeyPath}.steps[${stepIndex}]`;
      assert(isRecord(step), `${stepPath} must be an object.`);
      assert(typeof step.action === 'string' && journeyStepActions.has(step.action), `${stepPath}.action must be one of ${[...journeyStepActions].join(', ')}.`);
      if (step.target !== undefined) assert(typeof step.target === 'string', `${stepPath}.target must be a string.`);
      if (step.value !== undefined) assert(typeof step.value === 'string', `${stepPath}.value must be a string.`);
      if (step.timeoutMs !== undefined) assertFiniteNumber(step.timeoutMs, `${stepPath}.timeoutMs`, 0);
      if (step.allowMutating !== undefined) assertBoolean(step.allowMutating, `${stepPath}.allowMutating`);
      if (step.description !== undefined) assert(typeof step.description === 'string', `${stepPath}.description must be a string.`);
    });
  });
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

  return validateConfig(config);
}
