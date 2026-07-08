import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { chromium, firefox, webkit, type BrowserContextOptions, type Page } from 'playwright';
import type { BrowserName, JourneyConfig, JourneyStepConfig } from '../types.js';
import { ensureDir, writeJson, writeText } from '../utils/fs.js';
import { redactText } from '../utils/redact.js';

export interface JourneyRecordInput {
  url: string;
  outputPath: string;
  name?: string;
  browser?: BrowserName;
  headless?: boolean;
  timeoutMs?: number;
  maxSteps?: number;
  storageState?: string;
  sessionStorageState?: string;
  allowMutatingSteps?: boolean;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
}

export interface JourneyRecorderConfigFragment {
  journeys: {
    enabled: true;
    continueOnFailure: boolean;
    maxJourneys: number;
    maxStepsPerJourney: number;
    journeys: JourneyConfig[];
  };
}

export interface JourneyRecordResult {
  outputPath: string;
  reviewPath: string;
  eventCount: number;
  stepCount: number;
  dangerousStepCount: number;
  redactedValueCount: number;
  journey: JourneyConfig;
  config: JourneyRecorderConfigFragment;
}

export interface RecordedDomEvent {
  kind: 'click' | 'input' | 'change' | 'keydown';
  url: string;
  timestamp: string;
  tag: string;
  inputType?: string;
  id?: string;
  name?: string;
  role?: string;
  ariaLabel?: string;
  title?: string;
  placeholder?: string;
  testId?: string;
  text?: string;
  value?: string;
  checked?: boolean;
  key?: string;
  selector: string;
  isSensitive?: boolean;
}

interface SessionStorageStateFile {
  sessionStorage?: Array<{
    origin: string;
    items: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

function launcherFor(browserName: BrowserName) {
  switch (browserName) {
    case 'chromium':
      return chromium;
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
  }
}

function normalizeInput(input: JourneyRecordInput): Required<Pick<JourneyRecordInput, 'browser' | 'headless' | 'timeoutMs' | 'maxSteps' | 'waitUntil'>> & JourneyRecordInput {
  return {
    ...input,
    browser: input.browser ?? 'chromium',
    headless: input.headless ?? false,
    timeoutMs: input.timeoutMs ?? 300_000,
    maxSteps: input.maxSteps ?? 80,
    waitUntil: input.waitUntil ?? 'domcontentloaded'
  };
}

function compactText(value: string | undefined, max = 80): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function quoteTargetValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function roleTarget(event: RecordedDomEvent): string | undefined {
  const role = event.role?.trim();
  if (!role) return undefined;
  const name = compactText(event.ariaLabel ?? event.text ?? event.title ?? event.placeholder ?? event.name, 60);
  if (!name) return `role=${role}`;
  return `role=${role}[name="${quoteTargetValue(name)}"]`;
}

function cssTarget(event: RecordedDomEvent): string {
  return `css=${event.selector}`;
}

function preferredClickTarget(event: RecordedDomEvent): string {
  const roleBased = roleTarget(event);
  if (roleBased && /^(button|link|tab|menuitem|checkbox|radio|switch|option|combobox)$/i.test(event.role ?? '')) {
    return roleBased;
  }
  const text = compactText(event.ariaLabel ?? event.text ?? event.title, 70);
  if (text && text.length >= 2 && text.length <= 70) {
    return `text=${text}`;
  }
  return cssTarget(event);
}

function preferredFormTarget(event: RecordedDomEvent): string {
  if (event.testId || event.id || event.name || event.placeholder || event.ariaLabel) return cssTarget(event);
  return roleTarget(event) ?? cssTarget(event);
}

function isTextEntry(event: RecordedDomEvent): boolean {
  const tag = event.tag.toLowerCase();
  const type = (event.inputType ?? '').toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'image', 'range', 'color'].includes(type);
}

function isSelect(event: RecordedDomEvent): boolean {
  return event.tag.toLowerCase() === 'select';
}

function isCheckable(event: RecordedDomEvent): boolean {
  const type = (event.inputType ?? '').toLowerCase();
  return event.tag.toLowerCase() === 'input' && (type === 'checkbox' || type === 'radio');
}

function isDangerousText(value: string | undefined): boolean {
  return /(delete|remove|destroy|submit|save|create|update|upload|confirm|publish|approve|删除|移除|提交|保存|新增|创建|上传|确认|发布|审批|通过)/i.test(value ?? '');
}

function isSensitiveEvent(event: RecordedDomEvent): boolean {
  return Boolean(event.isSensitive || /(password|passwd|secret|token|access[-_]?key|api[-_]?key|client[-_]?secret|credential|凭证|密钥|密码|令牌)/i.test(`${event.inputType ?? ''} ${event.name ?? ''} ${event.id ?? ''} ${event.placeholder ?? ''} ${event.ariaLabel ?? ''}`));
}

function stepKey(step: JourneyStepConfig): string {
  return `${step.action}::${step.target ?? ''}`;
}

function coalesceSteps(steps: JourneyStepConfig[]): JourneyStepConfig[] {
  const output: JourneyStepConfig[] = [];
  for (const step of steps) {
    const previous = output[output.length - 1];
    if (previous && step.action === 'fill' && previous.action === 'fill' && stepKey(previous) === stepKey(step)) {
      output[output.length - 1] = step;
      continue;
    }
    if (previous && step.action === previous.action && step.target === previous.target && step.value === previous.value) {
      continue;
    }
    output.push(step);
  }
  return output;
}

function eventToStep(event: RecordedDomEvent, allowMutatingSteps: boolean): JourneyStepConfig | undefined {
  if (event.kind === 'keydown') {
    if (event.key !== 'Enter') return undefined;
    return {
      action: 'press',
      target: preferredFormTarget(event),
      value: 'Enter',
      allowMutating: allowMutatingSteps && isDangerousText(`${event.text ?? ''} ${event.ariaLabel ?? ''}`),
      description: '录制：按 Enter'
    };
  }

  if ((event.kind === 'input' || event.kind === 'change') && isCheckable(event)) {
    return {
      action: event.checked ? 'check' : 'uncheck',
      target: preferredFormTarget(event),
      description: `录制：${event.checked ? '勾选' : '取消勾选'}`
    };
  }

  if (event.kind === 'change' && isSelect(event)) {
    return {
      action: 'select',
      target: preferredFormTarget(event),
      value: event.value ?? '',
      description: '录制：选择下拉项'
    };
  }

  if ((event.kind === 'input' || event.kind === 'change') && isTextEntry(event)) {
    const sensitive = isSensitiveEvent(event);
    return {
      action: 'fill',
      target: preferredFormTarget(event),
      value: sensitive ? '<REDACTED>' : event.value ?? '',
      description: sensitive ? '录制：敏感输入已脱敏；回放前请替换为测试凭证/测试数据。' : '录制：填写输入框'
    };
  }

  if (event.kind === 'click') {
    const label = `${event.ariaLabel ?? ''} ${event.text ?? ''} ${event.title ?? ''}`;
    const dangerous = isDangerousText(label);
    return {
      action: 'click',
      target: preferredClickTarget(event),
      allowMutating: allowMutatingSteps && dangerous ? true : undefined,
      description: dangerous
        ? allowMutatingSteps
          ? '录制：点击可能写入/提交/删除的按钮，已标记 allowMutating=true。仅在隔离测试数据环境回放。'
          : '录制：点击可能写入/提交/删除的按钮；默认回放会被安全策略阻断，确认测试数据后再手动设置 allowMutating=true。'
        : '录制：点击'
    };
  }

  return undefined;
}

export function buildRecordedJourneyConfig(
  events: RecordedDomEvent[],
  input: Pick<JourneyRecordInput, 'url' | 'name' | 'maxSteps' | 'allowMutatingSteps'>
): JourneyRecorderConfigFragment {
  const maxSteps = input.maxSteps ?? 80;
  const steps = coalesceSteps(events.map((event) => eventToStep(event, Boolean(input.allowMutatingSteps))).filter((step): step is JourneyStepConfig => Boolean(step))).slice(0, maxSteps);
  const journey: JourneyConfig = {
    name: input.name?.trim() || 'Recorded business journey',
    startUrl: input.url,
    source: 'configured',
    steps: [{ action: 'waitForLoad', description: '等待录制页面加载完成' }, ...steps]
  };
  return {
    journeys: {
      enabled: true,
      continueOnFailure: false,
      maxJourneys: 1,
      maxStepsPerJourney: Math.max(1, journey.steps.length),
      journeys: [journey]
    }
  };
}

function reviewMarkdown(result: Omit<JourneyRecordResult, 'reviewPath'>): string {
  const rows = result.journey.steps.map((step, index) => `| ${index + 1} | ${step.action} | ${step.target ?? '-'} | ${step.value ? redactText(step.value) : '-'} | ${step.allowMutating ? 'yes' : 'no'} | ${step.description ?? '-'} |`);
  return `# FrontLens Journey Recording

- URL: ${result.journey.startUrl}
- Journey: ${result.journey.name}
- Raw events: ${result.eventCount}
- Generated steps: ${result.stepCount}
- Dangerous steps: ${result.dangerousStepCount}
- Redacted values: ${result.redactedValueCount}
- Config JSON: ${result.outputPath}

## Steps

${['| # | Action | Target | Value | allowMutating | Description |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n')}

## How to replay

\`\`\`bash
node dist/cli.js qa --url ${JSON.stringify(result.journey.startUrl ?? '')} --config ${JSON.stringify(result.outputPath)} --journeys --output "reports/frontlens/recorded-journey" --sme --json-summary
\`\`\`

## Review notes

- Add explicit \`expectVisible\`, \`expectText\`, or \`expectUrl\` assertions for the business success criteria; recorded clicks/fills prove the path executes, not that the business result is correct.
- Replace any \`<REDACTED>\` values with isolated test credentials or fixtures before replay.
- Keep mutating steps disabled until test data setup/cleanup is defined. If a step is intentionally safe in staging, set \`allowMutating=true\` only for that step.
`;
}

async function fileExists(filePath: string | undefined): Promise<boolean> {
  if (!filePath) return false;
  return access(filePath).then(() => true).catch(() => false);
}

async function loadSessionStorage(sessionStorageState: string | undefined): Promise<SessionStorageStateFile['sessionStorage']> {
  if (!sessionStorageState || !(await fileExists(sessionStorageState))) return undefined;
  try {
    const parsed = JSON.parse(await readFile(sessionStorageState, 'utf8')) as SessionStorageStateFile;
    return Array.isArray(parsed.sessionStorage) ? parsed.sessionStorage : undefined;
  } catch {
    return undefined;
  }
}

async function installRecorder(page: Page, onEvent: (event: RecordedDomEvent) => void | Promise<void>): Promise<void> {
  await page.exposeFunction('__frontlensRecord', async (event: RecordedDomEvent) => {
    await onEvent(event);
  });
  await page.addInitScript(() => {
    type RecorderWindow = Window & typeof globalThis & {
      __frontlensRecord?: (event: unknown) => void;
      __frontlensRecorderInstalled?: boolean;
    };
    const recorderWindow = window as RecorderWindow;
    if (recorderWindow.__frontlensRecorderInstalled) return;
    recorderWindow.__frontlensRecorderInstalled = true;

    const cssEscape = (value: string): string => {
      const cssApi = (window as Window & typeof globalThis & { CSS?: { escape?: (input: string) => string } }).CSS;
      if (cssApi?.escape) return cssApi.escape(value);
      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };

    const attr = (name: string, value: string | null | undefined): string | undefined => {
      if (!value) return undefined;
      return `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    };

    const isUnique = (selector: string): boolean => {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };

    const domPath = (element: Element): string => {
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 6) {
        const tag = current.tagName.toLowerCase();
        const currentTag = current.tagName;
        const parent: Element | null = current.parentElement;
        if (!parent) break;
        const siblings = Array.from(parent.children).filter((item) => item.tagName === currentTag);
        const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${tag}${nth}`);
        current = parent;
      }
      return parts.length ? parts.join(' > ') : element.tagName.toLowerCase();
    };

    const selectorFor = (element: Element): string => {
      const testId = element.getAttribute('data-testid') ?? element.getAttribute('data-test') ?? element.getAttribute('data-cy');
      const testAttr = element.hasAttribute('data-testid') ? 'data-testid' : element.hasAttribute('data-test') ? 'data-test' : element.hasAttribute('data-cy') ? 'data-cy' : undefined;
      if (testId && testAttr) {
        const selector = attr(testAttr, testId);
        if (selector && isUnique(selector)) return selector;
      }
      if (element.id) {
        const selector = `#${cssEscape(element.id)}`;
        if (isUnique(selector)) return selector;
      }
      const tag = element.tagName.toLowerCase();
      for (const [name, value] of [
        ['aria-label', element.getAttribute('aria-label')],
        ['name', element.getAttribute('name')],
        ['placeholder', element.getAttribute('placeholder')],
        ['title', element.getAttribute('title')]
      ] as const) {
        const selector = attr(name, value);
        if (selector && isUnique(`${tag}${selector}`)) return `${tag}${selector}`;
        if (selector && isUnique(selector)) return selector;
      }
      return domPath(element);
    };

    const labelText = (element: Element): string | undefined => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
        const labels = 'labels' in element && element.labels ? Array.from(element.labels).map((label) => label.textContent?.trim()).filter(Boolean).join(' ') : '';
        if (labels) return labels;
      }
      return undefined;
    };

    const inferRole = (element: Element): string | undefined => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.getAttribute('href')) return 'link';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = (element.getAttribute('type') ?? 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      return undefined;
    };

    const textOf = (element: Element): string | undefined => {
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 120);
      if (element instanceof HTMLInputElement) return element.value || undefined;
      return undefined;
    };

    const eventFor = (kind: RecordedDomEvent['kind'], element: Element, extra: Partial<RecordedDomEvent> = {}): RecordedDomEvent => {
      const input = element instanceof HTMLInputElement ? element : undefined;
      const textArea = element instanceof HTMLTextAreaElement ? element : undefined;
      const select = element instanceof HTMLSelectElement ? element : undefined;
      const value = input?.value ?? textArea?.value ?? select?.value;
      const inputType = input?.type ?? (textArea ? 'textarea' : select ? 'select' : undefined);
      const name = element.getAttribute('name') ?? undefined;
      const id = element.id || undefined;
      const ariaLabel = element.getAttribute('aria-label') ?? labelText(element);
      const placeholder = element.getAttribute('placeholder') ?? undefined;
      const title = element.getAttribute('title') ?? undefined;
      const isSensitive = /password|secret|token|access[-_]?key|api[-_]?key|client[-_]?secret|credential|凭证|密钥|密码|令牌/i.test(`${inputType ?? ''} ${name ?? ''} ${id ?? ''} ${placeholder ?? ''} ${ariaLabel ?? ''}`);
      return {
        kind,
        url: location.href,
        timestamp: new Date().toISOString(),
        tag: element.tagName.toLowerCase(),
        inputType,
        id,
        name,
        role: inferRole(element),
        ariaLabel: ariaLabel ?? undefined,
        title,
        placeholder,
        testId: element.getAttribute('data-testid') ?? element.getAttribute('data-test') ?? element.getAttribute('data-cy') ?? undefined,
        text: textOf(element),
        value,
        checked: input?.checked,
        selector: selectorFor(element),
        isSensitive,
        ...extra
      };
    };

    const send = (event: RecordedDomEvent): void => {
      recorderWindow.__frontlensRecord?.(event);
    };

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target.closest('button,a,[role],input,select,textarea,label,[data-testid],[data-test],[data-cy]') ?? event.target : undefined;
      if (!target) return;
      send(eventFor('click', target));
    }, true);

    document.addEventListener('input', (event) => {
      if (!(event.target instanceof Element)) return;
      send(eventFor('input', event.target));
    }, true);

    document.addEventListener('change', (event) => {
      if (!(event.target instanceof Element)) return;
      send(eventFor('change', event.target));
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      if (!(event.target instanceof Element)) return;
      send(eventFor('keydown', event.target, { key: event.key }));
    }, true);
  });
}

export async function recordJourney(inputArgs: JourneyRecordInput): Promise<JourneyRecordResult> {
  const input = normalizeInput(inputArgs);
  const outputPath = path.isAbsolute(input.outputPath) ? input.outputPath : path.resolve(process.cwd(), input.outputPath);
  await ensureDir(path.dirname(outputPath));

  const contextOptions: BrowserContextOptions = {
    storageState: input.storageState
  };
  const browser = await launcherFor(input.browser).launch({ headless: input.headless });
  const events: RecordedDomEvent[] = [];
  try {
    const context = await browser.newContext(contextOptions);
    const sessionStorageEntries = await loadSessionStorage(input.sessionStorageState);
    if (sessionStorageEntries?.length) {
      await context.addInitScript((entries: NonNullable<SessionStorageStateFile['sessionStorage']>) => {
        const match = entries.find((entry) => entry.origin === location.origin);
        if (!match) return;
        for (const item of match.items) {
          try {
            window.sessionStorage.setItem(item.name, item.value);
          } catch {
            // Ignore sessionStorage write errors.
          }
        }
      }, sessionStorageEntries);
    }
    const page = await context.newPage();
    await installRecorder(page, (event) => {
      events.push(event);
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        // Navigation is preserved in event URLs for review, but replay relies on the recorded clicks plus startUrl.
      }
    });
    await page.goto(input.url, { waitUntil: input.waitUntil, timeout: Math.min(input.timeoutMs, 60_000) });
    if (!input.headless) {
      console.log('FrontLens journey recorder is running. Interact with the browser, then close the page/window to finish recording.');
    }
    await Promise.race([
      page.waitForEvent('close').catch(() => undefined),
      context.waitForEvent('close').catch(() => undefined),
      page.waitForTimeout(input.timeoutMs)
    ]);
    await context.close().catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }

  const config = buildRecordedJourneyConfig(events, input);
  const journey = config.journeys.journeys[0];
  await writeJson(outputPath, config);
  const dangerousStepCount = journey.steps.filter((step) => isDangerousText(`${step.target ?? ''} ${step.description ?? ''}`)).length;
  const redactedValueCount = journey.steps.filter((step) => step.value === '<REDACTED>').length;
  const reviewPath = outputPath.replace(/\.json$/i, '.md');
  const partialResult = {
    outputPath,
    eventCount: events.length,
    stepCount: journey.steps.length,
    dangerousStepCount,
    redactedValueCount,
    journey,
    config
  };
  await writeText(reviewPath, reviewMarkdown(partialResult));
  return {
    ...partialResult,
    reviewPath
  };
}
