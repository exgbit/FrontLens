import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type {
  ArtifactIndex,
  ComponentRecord,
  ConsoleRecord,
  FrontLensConfig,
  InteractionTestKind,
  InteractionTestResult,
  NetworkRecord,
  PageErrorRecord,
  PageModel
} from '../types.js';
import { compactText } from '../utils/text.js';
import { isActionableConsoleError } from '../utils/console.js';
import { saveDownloadArtifact } from '../downloads/downloadArtifact.js';

interface SafeInteractionTesterOptions {
  config: FrontLensConfig;
  artifacts: ArtifactIndex;
  getNetworkRecords: () => NetworkRecord[];
  getConsoleRecords: () => ConsoleRecord[];
  getPageErrors: () => PageErrorRecord[];
}

interface Snapshot {
  url: string;
  bodyText: string;
  networkIds: Set<string>;
  consoleIds: Set<string>;
  pageErrorIds: Set<string>;
}

const SEARCH_PATTERN = /搜索|查询|筛选|检索|search|filter|query/i;
const RESET_PATTERN = /重置|清空|reset|clear/i;
const FIRST_PAGE_PATTERN = /首页|第一页|first|«/i;
const PREV_PAGE_PATTERN = /上一页|上页|prev|previous|‹|</i;
const NEXT_PAGE_PATTERN = /下一页|下页|next|›|»|>/i;
const LAST_PAGE_PATTERN = /末页|尾页|最后一页|last|»/i;
const VIEW_PATTERN = /详情|查看|预览|明细|view|detail|preview/i;
const REFRESH_PATTERN = /刷新|重新加载|refresh|reload/i;
const DOWNLOAD_PATTERN = /导出|下载|download|export/i;
const UNSAFE_ACTION_PATTERN = /新增|创建|添加|编辑|修改|删除|移除|禁用|停用|保存|提交|确定|上传|导入|导出|清空|重置密码|create|add|edit|update|delete|remove|disable|save|submit|confirm|upload|import|destroy/i;
const DANGEROUS_RESET_PATTERN = /重置(密码|密钥|令牌|token|权限|账户|账号)|reset\s+(password|secret|key|token|credential|account|user)|清空(数据|缓存|记录|全部|所有)|clear\s+(data|cache|records?|all|everything)/i;

function labelOf(component: ComponentRecord): string {
  return compactText(component.label || component.text || component.attributes.title || component.attributes['aria-label'] || component.id, 120);
}

function isDisabled(component: ComponentRecord): boolean {
  return Boolean(component.disabled || component.attributes['aria-disabled'] === 'true' || /disabled/i.test(component.attributes.class ?? ''));
}

function isTextInput(component: ComponentRecord): boolean {
  const type = (component.attributes.type ?? 'text').toLowerCase();
  return component.type === 'input' && /^(text|search|email|tel|url)$/.test(type);
}

function newIds<T extends { id: string }>(items: T[], before: Set<string>): string[] {
  return items.filter((item) => !before.has(item.id)).map((item) => item.id);
}

function newConsoleErrorIds(items: ConsoleRecord[], before: Set<string>): string[] {
  return items.filter((item) => isActionableConsoleError(item) && !before.has(item.id)).map((item) => item.id);
}

export class SafeInteractionTester {
  private counter = 0;

  constructor(private readonly options: SafeInteractionTesterOptions) {}

  async run(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const results: InteractionTestResult[] = [];
    const maxActions = this.options.config.exploration.maxActionsPerPage;

    for (const test of [
      () => this.testSearchAndReset(page, pageModel),
      () => this.testFormValidation(page, pageModel),
      () => this.testPagination(page, pageModel),
      () => this.testTableSort(page, pageModel),
      () => this.testTableSelection(page, pageModel),
      () => this.testRefresh(page, pageModel),
      () => this.testRapidClick(page, pageModel),
      () => this.testUpload(page, pageModel),
      () => this.testDownload(page, pageModel),
      () => this.testSafeDialog(page, pageModel)
    ]) {
      if (results.length >= maxActions) {
        break;
      }
      const batch = await test().catch((error: unknown) => [
        this.createResult({
          kind: 'search',
          target: 'safe interaction batch',
          status: 'failed',
          startedAt: new Date().toISOString(),
          actions: [],
          before: undefined,
          issue: '安全交互测试执行异常。',
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ]);
      results.push(...batch);
    }

    return results;
  }

  private async snapshot(page: Page): Promise<Snapshot> {
    const bodyText = await page.locator('body').innerText({ timeout: 1_000 }).catch(() => '');
    return {
      url: page.url(),
      bodyText: compactText(bodyText, 3000),
      networkIds: new Set(this.options.getNetworkRecords().map((record) => record.id)),
      consoleIds: new Set(this.options.getConsoleRecords().map((record) => record.id)),
      pageErrorIds: new Set(this.options.getPageErrors().map((record) => record.id))
    };
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);
  }

  private createResult(input: {
    kind: InteractionTestKind;
    target: string;
    selector?: string;
    status: InteractionTestResult['status'];
    startedAt: string;
    actions: string[];
    before?: Snapshot;
    issue?: string;
    suggestion?: InteractionTestResult['suggestion'];
    observations?: InteractionTestResult['observations'];
  }): InteractionTestResult {
    const endedAt = new Date().toISOString();
    return {
      id: `IT-${String(++this.counter).padStart(3, '0')}`,
      kind: input.kind,
      target: input.target,
      selector: input.selector,
      status: input.status,
      startedAt: input.startedAt,
      endedAt,
      durationMs: Math.max(0, new Date(endedAt).getTime() - new Date(input.startedAt).getTime()),
      actions: input.actions,
      observations: {
        beforeUrl: input.before?.url,
        ...input.observations
      },
      issue: input.issue,
      suggestion: input.suggestion
    };
  }

  private async testSearchAndReset(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const results: InteractionTestResult[] = [];
    const searchButton = pageModel.buttons.find((button) => button.visible && !isDisabled(button) && SEARCH_PATTERN.test(labelOf(button)));
    const textInput = pageModel.inputs.find((input) => input.visible && isTextInput(input) && input.selector);

    if (!searchButton?.selector || !textInput?.selector) {
      results.push(
        this.createResult({
          kind: 'search',
          target: '搜索/筛选',
          selector: searchButton?.selector,
          status: 'skipped',
          startedAt: new Date().toISOString(),
          actions: [],
          observations: {
            details: '未同时识别到搜索按钮和可填写文本输入框。'
          }
        })
      );
      return results;
    }

    const searchStarted = new Date().toISOString();
    const beforeSearch = await this.snapshot(page);
    const searchActions: string[] = [];
    const value = 'frontlens';

    try {
      await page.locator(textInput.selector).first().fill(value, { timeout: 2_000 });
      searchActions.push(`填写输入框 ${textInput.selector} = ${value}`);
      await page.locator(searchButton.selector).first().click({ timeout: 3_000 });
      searchActions.push(`点击搜索按钮 ${searchButton.selector}`);
      await this.settle(page);

      const afterText = compactText(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''), 3000);
      const networkIds = newIds(this.options.getNetworkRecords(), beforeSearch.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), beforeSearch.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), beforeSearch.pageErrorIds);
      const afterUrl = page.url();
      const hasErrors = consoleIds.length > 0 || pageErrorIds.length > 0;
      const changed = afterUrl !== beforeSearch.url || afterText !== beforeSearch.bodyText || networkIds.length > 0;

      results.push(
        this.createResult({
          kind: 'search',
          target: labelOf(searchButton),
          selector: searchButton.selector,
          status: hasErrors ? 'failed' : changed ? 'passed' : 'warning',
          startedAt: searchStarted,
          actions: searchActions,
          before: beforeSearch,
          issue: hasErrors
            ? '点击搜索后出现新的 Console/Page Error。'
            : changed
              ? undefined
              : '点击搜索后未观察到 URL、页面文本或 Network 请求变化。',
          suggestion: hasErrors
            ? {
                frontend: '检查搜索按钮 click handler、请求异常处理和状态更新逻辑。',
                backend: '如果错误来自搜索接口，检查筛选参数校验和接口响应。',
                priority: 'P1'
              }
            : changed
              ? undefined
              : {
                  frontend: '确认搜索按钮绑定了筛选逻辑；如果是本地筛选，应有结果区域、空状态或筛选条件反馈。',
                  backend: '列表接口建议接收并记录清晰的筛选参数。',
                  priority: 'P3'
                },
          observations: {
            afterUrl,
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            urlChanged: afterUrl !== beforeSearch.url,
            bodyTextChanged: afterText !== beforeSearch.bodyText,
            valueChanged: changed
          }
        })
      );
    } catch (error: unknown) {
      results.push(
        this.createResult({
          kind: 'search',
          target: labelOf(searchButton),
          selector: searchButton.selector,
          status: 'failed',
          startedAt: searchStarted,
          actions: searchActions,
          before: beforeSearch,
          issue: '搜索交互执行失败。',
          suggestion: {
            frontend: '检查搜索输入框和搜索按钮是否可交互，避免被遮挡、禁用或缺少事件绑定。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      );
    }

    const resetButton = pageModel.buttons.find((button) => button.visible && !isDisabled(button) && RESET_PATTERN.test(labelOf(button)) && button.selector);
    if (!resetButton?.selector) {
      results.push(
        this.createResult({
          kind: 'reset',
          target: '重置',
          status: 'skipped',
          startedAt: new Date().toISOString(),
          actions: [],
          observations: {
            details: '未识别到重置按钮。'
          }
        })
      );
      return results;
    }
    if (DANGEROUS_RESET_PATTERN.test(labelOf(resetButton))) {
      results.push(
        this.createResult({
          kind: 'reset',
          target: labelOf(resetButton),
          selector: resetButton.selector,
          status: 'skipped',
          startedAt: new Date().toISOString(),
          actions: [],
          observations: {
            details: '按钮文案疑似破坏性清空操作，默认安全策略跳过点击。'
          }
        })
      );
      return results;
    }

    const resetStarted = new Date().toISOString();
    const beforeReset = await this.snapshot(page);
    const resetActions: string[] = [];
    try {
      const beforeValue = await page.locator(textInput.selector).first().inputValue({ timeout: 1_000 }).catch(() => value);
      if (!beforeValue) {
        await page.locator(textInput.selector).first().fill(value, { timeout: 2_000 });
        resetActions.push(`重新填写输入框 ${textInput.selector} = ${value}`);
      }

      await page.locator(resetButton.selector).first().click({ timeout: 3_000 });
      resetActions.push(`点击重置按钮 ${resetButton.selector}`);
      await this.settle(page);
      const afterValue = await page.locator(textInput.selector).first().inputValue({ timeout: 1_000 }).catch(() => '');
      const networkIds = newIds(this.options.getNetworkRecords(), beforeReset.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), beforeReset.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), beforeReset.pageErrorIds);
      const resetOk = afterValue === '' || afterValue === textInput.value;

      results.push(
        this.createResult({
          kind: 'reset',
          target: labelOf(resetButton),
          selector: resetButton.selector,
          status: resetOk && consoleIds.length === 0 && pageErrorIds.length === 0 ? 'passed' : 'failed',
          startedAt: resetStarted,
          actions: resetActions,
          before: beforeReset,
          issue: resetOk ? undefined : '点击重置后输入框未恢复为空或默认值。',
          suggestion: resetOk
            ? undefined
            : {
                frontend: '重置操作应清空筛选条件、恢复默认状态，并通常将分页重置到第一页。',
                backend: '重置后再次请求列表时应移除空筛选参数。',
                priority: 'P2'
              },
          observations: {
            afterUrl: page.url(),
            beforeValue,
            afterValue,
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds
          }
        })
      );
    } catch (error: unknown) {
      results.push(
        this.createResult({
          kind: 'reset',
          target: labelOf(resetButton),
          selector: resetButton.selector,
          status: 'failed',
          startedAt: resetStarted,
          actions: resetActions,
          before: beforeReset,
          issue: '重置交互执行失败。',
          suggestion: {
            frontend: '检查重置按钮是否正确绑定表单 reset 或状态清理逻辑。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      );
    }

    return results;
  }

  private async testFormValidation(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const form = pageModel.forms.find((item) => item.visible && item.selector);
    const startedAt = new Date().toISOString();
    if (!form?.selector) {
      return [
        this.createResult({
          kind: 'form-validation',
          target: '表单校验',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: { details: '未识别到可测试的表单。' }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      const validation = await page.locator(form.selector).first().evaluate((formElement) => {
        const form = formElement instanceof HTMLFormElement ? formElement : formElement.closest('form');
        const root = form ?? formElement;
        const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).filter((control) => {
          const type = control instanceof HTMLInputElement ? control.type : '';
          return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'reset' && !control.disabled;
        });
        const submitButtons = Array.from(root.querySelectorAll('button, input[type="submit"], [role="button"]')).filter((button) => /保存|提交|确定|创建|新增|submit|save|confirm|create/i.test(button.textContent ?? button.getAttribute('value') ?? button.getAttribute('aria-label') ?? ''));
        const originalValues = controls.map((control) => control.value);

        const fieldSummaries = controls.map((control) => {
          const input = control as HTMLInputElement;
          return {
            name: control.getAttribute('name') ?? control.id ?? '',
            type: input.type || control.tagName.toLowerCase(),
            required: control.required || control.getAttribute('aria-required') === 'true',
            minLength: input.minLength > 0 ? input.minLength : undefined,
            maxLength: input.maxLength > 0 ? input.maxLength : undefined,
            min: input.min || undefined,
            max: input.max || undefined,
            pattern: input.pattern || undefined,
            autocomplete: input.autocomplete || undefined
          };
        });

        for (const control of controls) {
          const input = control as HTMLInputElement;
          if (control.required || control.getAttribute('aria-required') === 'true') {
            control.value = '';
          } else if (input.type === 'email') {
            control.value = 'invalid-email';
          } else if (input.type === 'number') {
            control.value = 'not-a-number';
          } else if (input.pattern) {
            control.value = 'frontlens-invalid-pattern';
          } else if (input.minLength > 0) {
            control.value = 'x';
          } else if (input.maxLength > 0) {
            control.value = 'x'.repeat(input.maxLength + 5);
          }
        }

        const invalidControls = controls.filter((control) => typeof control.checkValidity === 'function' && !control.checkValidity());
        const formValid = form ? form.checkValidity() : invalidControls.length === 0;
        const validationMessages = invalidControls.slice(0, 10).map((control) => ({
          name: control.getAttribute('name') ?? control.id ?? '',
          message: control.validationMessage,
          type: (control as HTMLInputElement).type || control.tagName.toLowerCase()
        }));

        controls.forEach((control, index) => {
          control.value = originalValues[index] ?? '';
        });

        return {
          fieldCount: controls.length,
          submitButtonCount: submitButtons.length,
          requiredCount: fieldSummaries.filter((field) => field.required).length,
          constrainedCount: fieldSummaries.filter((field) => field.required || field.minLength || field.maxLength || field.min || field.max || field.pattern || ['email', 'number', 'date', 'password', 'tel', 'url'].includes(field.type)).length,
          formValidAfterInvalidInput: formValid,
          invalidCount: invalidControls.length,
          validationMessages,
          fields: fieldSummaries
        };
      });

      actions.push(`检查表单校验约束 ${form.selector}`);
      const hasFormErrorText = /必填|不能为空|格式|错误|长度|invalid|required|error/i.test(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''));
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const noValidation = validation.fieldCount > 0 && validation.submitButtonCount > 0 && validation.constrainedCount === 0 && !hasFormErrorText;
      const invalidNotCaught = validation.constrainedCount > 0 && validation.invalidCount === 0 && validation.formValidAfterInvalidInput;

      return [
        this.createResult({
          kind: 'form-validation',
          target: labelOf(form) || '表单校验',
          selector: form.selector,
          status: consoleIds.length > 0 || pageErrorIds.length > 0 || invalidNotCaught ? 'failed' : noValidation ? 'warning' : 'passed',
          startedAt,
          actions,
          before,
          issue:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? '表单校验检查过程中出现新的 Console/Page Error。'
              : invalidNotCaught
                ? '表单存在校验约束，但注入无效值后未被浏览器原生校验捕获。'
                : noValidation
                  ? '表单存在输入控件和提交按钮，但未发现必填、格式、长度、范围或 pattern 等校验约束。'
                  : undefined,
          suggestion:
            noValidation || invalidNotCaught
              ? {
                  frontend: '为表单补充 required、type、min/max、minLength/maxLength、pattern 或业务校验，并在提交前展示字段级错误提示。',
                  backend: '接口侧也应做同等校验，返回字段级错误码和错误信息。',
                  test: '补充必填、长度、格式、数字、日期、邮箱、手机号、密码、特殊字符和重复提交测试。',
                  priority: invalidNotCaught ? 'P1' : 'P2'
                }
              : undefined,
          observations: {
            consoleIds,
            pageErrorIds,
            details: validation
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'form-validation',
          target: labelOf(form) || '表单校验',
          selector: form.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '表单校验测试执行失败。',
          suggestion: {
            frontend: '检查表单 DOM、控件可访问性和校验逻辑是否稳定。',
            priority: 'P2'
          },
          observations: { error: error instanceof Error ? error.message : String(error) }
        })
      ];
    }
  }

  private async testPagination(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const hasPagination = pageModel.components.some((component) => component.type === 'pagination');
    const startedAt = new Date().toISOString();

    if (!hasPagination) {
      return [
        this.createResult({
          kind: 'pagination',
          target: '分页',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到分页控件。'
          }
        })
      ];
    }

    const results: InteractionTestResult[] = [];
    const buttonPlans = [
      { target: '下一页', pattern: NEXT_PAGE_PATTERN, requireEnabled: true },
      { target: '上一页', pattern: PREV_PAGE_PATTERN, requireEnabled: false },
      { target: '首页', pattern: FIRST_PAGE_PATTERN, requireEnabled: false },
      { target: '最后一页', pattern: LAST_PAGE_PATTERN, requireEnabled: false }
    ];
    const usedSelectors = new Set<string>();

    for (const plan of buttonPlans) {
      const button = pageModel.buttons.find((item) => item.visible && item.selector && !usedSelectors.has(item.selector) && (!plan.requireEnabled || !isDisabled(item)) && plan.pattern.test(labelOf(item)));
      if (!button?.selector) {
        results.push(
          this.createResult({
            kind: 'pagination',
            target: plan.target,
            status: 'skipped',
            startedAt: new Date().toISOString(),
            actions: [],
            observations: {
              details: `未识别到${plan.target}按钮。`
            }
          })
        );
        continue;
      }
      usedSelectors.add(button.selector);
      results.push(await this.clickPaginationButton(page, button, plan.target));
    }

    results.push(await this.testPageSizeChange(page));
    return results;
  }

  private async clickPaginationButton(page: Page, button: ComponentRecord, target: string): Promise<InteractionTestResult> {
    const startedAt = new Date().toISOString();
    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      const locator = page.locator(button.selector ?? '').first();
      const disabled = await locator.evaluate((element) => {
        const htmlElement = element as HTMLElement & { disabled?: boolean };
        return Boolean(htmlElement.disabled || htmlElement.getAttribute('aria-disabled') === 'true' || htmlElement.classList.contains('disabled'));
      }).catch(() => false);
      if (disabled) {
        return this.createResult({
          kind: 'pagination',
          target,
          selector: button.selector,
          status: 'skipped',
          startedAt,
          actions,
          before,
          observations: { details: `${target}按钮当前为禁用状态。` }
        });
      }
      await locator.click({ timeout: 3_000 });
      actions.push(`点击分页按钮 ${button.selector}`);
      await this.settle(page);
      const afterText = compactText(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''), 3000);
      const afterUrl = page.url();
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const changed = afterUrl !== before.url || afterText !== before.bodyText || networkIds.length > 0;
      const hasErrors = consoleIds.length > 0 || pageErrorIds.length > 0;

      return this.createResult({
        kind: 'pagination',
        target,
        selector: button.selector,
        status: hasErrors ? 'failed' : changed ? 'passed' : 'warning',
        startedAt,
        actions,
        before,
        issue: hasErrors ? '点击分页后出现新的 Console/Page Error。' : changed ? undefined : '点击分页后未观察到 URL、页面文本或 Network 请求变化。',
        suggestion: hasErrors
          ? {
              frontend: '检查分页点击后的状态更新、接口请求和异常处理。',
              backend: '检查分页接口参数 page/pageSize/total 的兼容性。',
              priority: 'P1'
            }
          : changed
            ? undefined
            : {
                frontend: '确认分页按钮在可点击状态下会更新页码、列表数据或请求参数；不可翻页时应禁用。',
                backend: '列表接口建议返回稳定 total/page/pageSize，前端根据 total 禁用无效分页。',
                priority: 'P3'
              },
        observations: {
          afterUrl,
          networkRequestIds: networkIds,
          consoleIds,
          pageErrorIds,
          urlChanged: afterUrl !== before.url,
          bodyTextChanged: afterText !== before.bodyText
        }
      });
    } catch (error: unknown) {
      return this.createResult({
        kind: 'pagination',
        target,
        selector: button.selector,
        status: 'failed',
        startedAt,
        actions,
        before,
        issue: '分页交互执行失败。',
        suggestion: {
          frontend: '检查分页按钮是否被遮挡、禁用状态是否正确，以及 click handler 是否稳定。',
          priority: 'P2'
        },
        observations: {
          error: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  private async testPageSizeChange(page: Page): Promise<InteractionTestResult> {
    const startedAt = new Date().toISOString();
    const before = await this.snapshot(page);
    const actions: string[] = [];
    const candidates = await page
      .locator('select')
      .evaluateAll((elements) =>
        elements
          .map((element, index) => {
            const select = element as HTMLSelectElement;
            const label = `${select.getAttribute('aria-label') ?? ''} ${select.name} ${select.id} ${select.className} ${select.closest('label')?.textContent ?? ''}`;
            const options = Array.from(select.options).map((option) => ({ value: option.value, text: option.textContent ?? '' }));
            return { index, label, options, disabled: select.disabled, value: select.value };
          })
          .filter((item) => !item.disabled && item.options.length > 1 && (/(page|size|limit|每页|条\/页|分页)/i.test(item.label) || item.options.some((option) => /^\s*\d+\s*(条|\/页|\/ page|page)?\s*$/i.test(option.text))))
      )
      .catch(() => [] as Array<{ index: number; label: string; value?: string; options: Array<{ value: string; text: string }> }>);

    const candidate = candidates[0];
    if (!candidate) {
      return this.createResult({
        kind: 'pagination',
        target: '修改 PageSize',
        status: 'skipped',
        startedAt,
        actions,
        before,
        observations: { details: '未识别到可修改的 PageSize 控件。' }
      });
    }

    try {
      const option = candidate.options.find((item) => item.value && item.value !== candidate.value) ?? candidate.options.find((item) => item.value) ?? candidate.options[1];
      await page.locator('select').nth(candidate.index).selectOption(option.value, { timeout: 3_000 });
      actions.push(`修改 PageSize: select:nth(${candidate.index}) -> ${option.value}`);
      await this.settle(page);
      const afterText = compactText(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''), 3000);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const changed = afterText !== before.bodyText || page.url() !== before.url || networkIds.length > 0;
      const hasErrors = consoleIds.length > 0 || pageErrorIds.length > 0;
      return this.createResult({
        kind: 'pagination',
        target: '修改 PageSize',
        status: hasErrors ? 'failed' : changed ? 'passed' : 'warning',
        startedAt,
        actions,
        before,
        issue: hasErrors ? '修改 PageSize 后出现新的 Console/Page Error。' : changed ? undefined : '修改 PageSize 后未观察到页码、数据或请求变化。',
        suggestion: changed
          ? undefined
          : {
              frontend: '确认 PageSize 变更会重置到第一页并重新请求/渲染数据。',
              backend: '列表接口应接收 pageSize/limit 参数并返回匹配 total。',
              priority: 'P3'
            },
        observations: {
          afterUrl: page.url(),
          networkRequestIds: networkIds,
          consoleIds,
          pageErrorIds,
          bodyTextChanged: afterText !== before.bodyText,
          details: candidate
        }
      });
    } catch (error: unknown) {
      return this.createResult({
        kind: 'pagination',
        target: '修改 PageSize',
        status: 'failed',
        startedAt,
        actions,
        before,
        issue: 'PageSize 修改测试执行失败。',
        suggestion: {
          frontend: '检查 PageSize 控件是否可访问、是否被遮挡或缺少 change handler。',
          priority: 'P2'
        },
        observations: { error: error instanceof Error ? error.message : String(error) }
      });
    }
  }

  private async testTableSort(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const table = pageModel.tables.find((item) => item.visible && item.selector);
    const startedAt = new Date().toISOString();
    if (!table?.selector) {
      return [
        this.createResult({
          kind: 'table-sort',
          target: '表格排序',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到可测试的表格。'
          }
        })
      ];
    }

    const sortTarget = await page
      .locator(table.selector)
      .evaluate((element) => {
        const headers = Array.from(element.querySelectorAll('th, [role="columnheader"]'));
        const candidate = headers.find((header) => {
          const cls = header.className?.toString() ?? '';
          const text = header.textContent ?? '';
          return (
            header.hasAttribute('aria-sort') ||
            Boolean(header.querySelector('button, [role="button"], [class*="sort" i]')) ||
            /sort|sortable|排序/i.test(cls) ||
            /排序/.test(text)
          );
        });
        if (!candidate) return null;
        candidate.setAttribute('data-frontlens-sort-target', 'true');
        return {
          text: (candidate.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
        };
      })
      .catch(() => null);

    if (!sortTarget) {
      return [
        this.createResult({
          kind: 'table-sort',
          target: '表格排序',
          selector: table.selector,
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到排序表头或排序按钮。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      await page.locator('[data-frontlens-sort-target="true"]').first().click({ timeout: 3_000 });
      actions.push(`点击排序表头：${sortTarget.text || table.selector}`);
      await this.settle(page);

      const afterText = compactText(await page.locator('body').innerText({ timeout: 1_000 }).catch(() => ''), 3000);
      const afterUrl = page.url();
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const changed = afterUrl !== before.url || afterText !== before.bodyText || networkIds.length > 0;
      const hasErrors = consoleIds.length > 0 || pageErrorIds.length > 0;

      return [
        this.createResult({
          kind: 'table-sort',
          target: sortTarget.text || '表格排序',
          selector: '[data-frontlens-sort-target="true"]',
          status: hasErrors ? 'failed' : changed ? 'passed' : 'warning',
          startedAt,
          actions,
          before,
          issue: hasErrors ? '点击表格排序后出现新的 Console/Page Error。' : changed ? undefined : '点击排序表头后未观察到表格内容、URL 或 Network 请求变化。',
          suggestion: hasErrors
            ? {
                frontend: '检查排序点击后的状态更新、排序参数和错误处理。',
                backend: '如果排序走后端接口，检查 sort/order/orderBy 参数解析。',
                priority: 'P1'
              }
            : changed
              ? undefined
              : {
                  frontend: '确认排序表头在可点击时会改变排序状态、图标或数据顺序；不可排序列不应展示排序样式。',
                  backend: '后端列表接口建议明确支持 sortField/sortOrder 等参数。',
                  priority: 'P3'
                },
          observations: {
            afterUrl,
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            urlChanged: afterUrl !== before.url,
            bodyTextChanged: afterText !== before.bodyText
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'table-sort',
          target: sortTarget.text || '表格排序',
          selector: '[data-frontlens-sort-target="true"]',
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '表格排序交互执行失败。',
          suggestion: {
            frontend: '检查排序表头点击区域、排序状态和事件绑定。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }

  private async testTableSelection(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const table = pageModel.tables.find((item) => item.visible && item.selector);
    const startedAt = new Date().toISOString();
    if (!table?.selector) {
      return [
        this.createResult({
          kind: 'table-selection',
          target: '表格选择',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到可测试的表格。'
          }
        })
      ];
    }

    const checkbox = page.locator(`${table.selector} tbody input[type="checkbox"], ${table.selector} tbody [role="checkbox"], ${table.selector} [role="row"]:not(:first-child) input[type="checkbox"], ${table.selector} [role="row"]:not(:first-child) [role="checkbox"]`).first();
    if ((await checkbox.count().catch(() => 0)) === 0) {
      return [
        this.createResult({
          kind: 'table-selection',
          target: '表格选择',
          selector: table.selector,
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到表格行选择 checkbox。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      const beforeChecked = await checkbox.isChecked({ timeout: 1_000 }).catch(() => false);
      await checkbox.click({ timeout: 3_000 });
      actions.push(`点击表格选择框：${table.selector}`);
      await page.waitForTimeout(300).catch(() => undefined);
      const afterChecked = await checkbox.isChecked({ timeout: 1_000 }).catch(() => !beforeChecked);
      if (afterChecked !== beforeChecked) {
        await checkbox.click({ timeout: 2_000 }).catch(() => undefined);
        actions.push('恢复表格选择框原始状态');
      }
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const changed = beforeChecked !== afterChecked;

      return [
        this.createResult({
          kind: 'table-selection',
          target: '表格选择',
          selector: `${table.selector} input[type="checkbox"]`,
          status: consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : changed ? 'passed' : 'warning',
          startedAt,
          actions,
          before,
          issue:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? '点击表格选择框后出现新的 Console/Page Error。'
              : changed
                ? undefined
                : '点击表格选择框后选中状态未变化。',
          suggestion: changed
            ? undefined
            : {
                frontend: '检查表格 rowSelection/checkbox 受控状态，确保选择后有清晰反馈并启用批量操作。',
                priority: 'P3'
              },
          observations: {
            beforeValue: String(beforeChecked),
            afterValue: String(afterChecked),
            consoleIds,
            pageErrorIds,
            valueChanged: changed
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'table-selection',
          target: '表格选择',
          selector: `${table.selector} input[type="checkbox"]`,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '表格选择交互执行失败。',
          suggestion: {
            frontend: '检查选择框是否可点击、是否被遮挡，以及 rowSelection 状态更新逻辑。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }

  private async testRefresh(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const button = pageModel.buttons.find((item) => item.visible && !isDisabled(item) && item.selector && REFRESH_PATTERN.test(labelOf(item)));
    const startedAt = new Date().toISOString();
    if (!button?.selector) {
      return [
        this.createResult({
          kind: 'refresh',
          target: '刷新',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到刷新按钮。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      await page.locator(button.selector).first().click({ timeout: 3_000 });
      actions.push(`点击刷新按钮 ${button.selector}`);
      await this.settle(page);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      return [
        this.createResult({
          kind: 'refresh',
          target: labelOf(button),
          selector: button.selector,
          status: consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : networkIds.length > 0 ? 'passed' : 'warning',
          startedAt,
          actions,
          before,
          issue:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? '点击刷新后出现新的 Console/Page Error。'
              : networkIds.length > 0
                ? undefined
                : '点击刷新后未观察到新的请求或页面状态变化。',
          suggestion: networkIds.length > 0
            ? undefined
            : {
                frontend: '刷新按钮应重新拉取当前查询条件下的数据，并提供 Loading/禁用状态。',
                backend: '列表接口应支持按当前筛选/分页参数重新查询。',
                priority: 'P3'
              },
          observations: {
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'refresh',
          target: labelOf(button),
          selector: button.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '刷新交互执行失败。',
          suggestion: {
            frontend: '检查刷新按钮点击区域和数据重载逻辑。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }

  private async testDownload(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const button = pageModel.buttons.find((item) => item.visible && !isDisabled(item) && item.selector && DOWNLOAD_PATTERN.test(labelOf(item)));
    const startedAt = new Date().toISOString();
    if (!button?.selector) {
      return [
        this.createResult({
          kind: 'download',
          target: '下载/导出',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到下载或导出按钮。'
          }
        })
      ];
    }

    if (!this.options.config.safety.allowDownload) {
      return [
        this.createResult({
          kind: 'download',
          target: labelOf(button),
          selector: button.selector,
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '默认安全策略禁止真实下载/导出点击；设置 safety.allowDownload=true 后才会点击下载/导出按钮。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 4_000 }).catch(() => null);
      await page.locator(button.selector).first().click({ timeout: 3_000 });
      actions.push(`点击下载/导出按钮 ${button.selector}`);
      const download = await downloadPromise;
      await this.settle(page);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const failure = download ? await download.failure().catch(() => null) : null;
      const savedDownload = download && !failure
        ? await saveDownloadArtifact(download, this.options.artifacts.outputDir, `IT-${String(this.counter + 1).padStart(3, '0')}`).catch((error: unknown) => ({
            failure: error instanceof Error ? error.message : String(error)
          }))
        : undefined;
      if (savedDownload && 'path' in savedDownload) {
        this.options.artifacts.downloadDir = path.dirname(savedDownload.path);
        this.options.artifacts.downloadedFiles = [...(this.options.artifacts.downloadedFiles ?? []), savedDownload.path];
      }
      const downloadSaveFailure = savedDownload && 'failure' in savedDownload ? savedDownload.failure : undefined;
      const contentFailure = savedDownload && 'path' in savedDownload && savedDownload.content.parseStatus === 'failed' ? savedDownload.content.issue ?? '下载文件内容解析失败。' : undefined;
      const hasDownload = Boolean(download && !failure && savedDownload && 'path' in savedDownload && savedDownload.sizeBytes > 0 && !contentFailure);
      const hasNetwork = networkIds.length > 0;
      const emptyDownload = Boolean(savedDownload && 'path' in savedDownload && savedDownload.sizeBytes === 0);
      const issue =
        consoleIds.length > 0 || pageErrorIds.length > 0
          ? '点击下载/导出后出现新的 Console/Page Error。'
          : failure
            ? `下载失败：${failure}`
            : downloadSaveFailure
              ? `下载文件保存失败：${downloadSaveFailure}`
              : emptyDownload
                ? '下载文件为空。'
                : contentFailure
                  ? contentFailure
                : hasDownload
                  ? undefined
                  : hasNetwork
                    ? '点击下载/导出后仅观察到网络请求，未保存到可校验的下载文件。'
                    : '点击下载/导出后未观察到 download 事件或新的网络请求。';
      const status: InteractionTestResult['status'] = consoleIds.length > 0 || pageErrorIds.length > 0 || failure || downloadSaveFailure || emptyDownload || contentFailure ? 'failed' : hasDownload ? 'passed' : 'warning';

      return [
        this.createResult({
          kind: 'download',
          target: labelOf(button),
          selector: button.selector,
          status,
          startedAt,
          actions,
          before,
          issue,
          suggestion:
            !failure && hasDownload
              ? undefined
              : {
                  frontend: '检查下载按钮是否正确绑定导出逻辑，并在导出中/失败时给出提示。',
                  backend: '导出接口应返回正确 Content-Disposition 文件名、Content-Type 和错误响应。',
                  priority: 'P3'
                },
          observations: {
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            downloadSuggestedFilename: download?.suggestedFilename(),
            downloadPath: savedDownload && 'path' in savedDownload ? savedDownload.path : undefined,
            downloadSizeBytes: savedDownload && 'path' in savedDownload ? savedDownload.sizeBytes : undefined,
            downloadSha256: savedDownload && 'path' in savedDownload ? savedDownload.sha256 : undefined,
            downloadContent: savedDownload && 'path' in savedDownload ? savedDownload.content : undefined,
            downloadFailure: failure
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'download',
          target: labelOf(button),
          selector: button.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '下载/导出交互执行失败。',
          suggestion: {
            frontend: '检查下载按钮是否可点击、是否需要权限或筛选条件，以及失败提示。',
            backend: '检查导出接口可用性、权限和文件名响应头。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }

  private async testUpload(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const upload = pageModel.components.find((item) => item.visible && item.type === 'upload' && item.selector);
    const startedAt = new Date().toISOString();
    if (!upload?.selector) {
      return [
        this.createResult({
          kind: 'upload',
          target: '上传',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到上传控件。'
          }
        })
      ];
    }

    if (!this.options.config.safety.allowUpload) {
      return [
        this.createResult({
          kind: 'upload',
          target: labelOf(upload),
          selector: upload.selector,
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '默认安全策略禁止真实上传测试；设置 safety.allowUpload=true 后才会执行 setInputFiles。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    const samplePath = path.join('/tmp', `frontlens-upload-${Date.now()}.txt`);
    try {
      await writeFile(samplePath, 'FrontLens upload test file\n', 'utf8');
      const inputSelector = upload.tagName === 'input' ? upload.selector : `${upload.selector} input[type="file"]`;
      const input = page.locator(inputSelector).first();
      if ((await input.count().catch(() => 0)) === 0) {
        return [
          this.createResult({
            kind: 'upload',
            target: labelOf(upload),
            selector: upload.selector,
            status: 'warning',
            startedAt,
            actions,
            before,
            issue: '识别到上传控件，但未找到 input[type=file]，暂无法安全设置测试文件。',
            suggestion: {
              frontend: '上传组件建议保留可访问的 input[type=file]，并标注格式、大小、数量限制。',
              priority: 'P3'
            },
            observations: {
              details: { uploadComponent: upload }
            }
          })
        ];
      }

      await input.setInputFiles(samplePath, { timeout: 3_000 });
      actions.push(`设置上传测试文件 ${path.basename(samplePath)}`);
      await this.settle(page);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const newRequests = this.options.getNetworkRecords().filter((record) => networkIds.includes(record.id));
      const hasUploadRequest = newRequests.some((record) => /POST|PUT|PATCH/i.test(record.method) || /upload|file|multipart|form-data/i.test(`${record.url} ${record.requestHeaders['content-type'] ?? ''}`));

      return [
        this.createResult({
          kind: 'upload',
          target: labelOf(upload),
          selector: upload.selector,
          status: consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : hasUploadRequest || networkIds.length > 0 ? 'passed' : 'warning',
          startedAt,
          actions,
          before,
          issue:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? '设置上传文件后出现新的 Console/Page Error。'
              : hasUploadRequest || networkIds.length > 0
                ? undefined
                : '设置上传文件后未观察到上传请求或页面反馈。',
          suggestion:
            hasUploadRequest || networkIds.length > 0
              ? undefined
              : {
                  frontend: '上传选择文件后应展示文件名、校验状态、上传进度或错误提示。',
                  backend: '上传接口应返回明确文件 ID、URL、大小、类型和错误码。',
                  priority: 'P2'
                },
          observations: {
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            details: {
              sampleFile: path.basename(samplePath),
              hasUploadRequest
            }
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'upload',
          target: labelOf(upload),
          selector: upload.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '上传测试执行失败。',
          suggestion: {
            frontend: '检查上传控件是否可交互、格式/大小校验和错误提示是否完整。',
            backend: '检查上传接口权限、大小限制、MIME 校验和错误返回结构。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    } finally {
      await unlink(samplePath).catch(() => undefined);
    }
  }

  private async testRapidClick(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const button = pageModel.buttons.find((item) => item.visible && !isDisabled(item) && item.selector && (SEARCH_PATTERN.test(labelOf(item)) || REFRESH_PATTERN.test(labelOf(item)) || NEXT_PAGE_PATTERN.test(labelOf(item))));
    const startedAt = new Date().toISOString();
    if (!button?.selector) {
      return [
        this.createResult({
          kind: 'rapid-click',
          target: '快速重复点击',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到适合快速点击测试的安全按钮。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      const locator = page.locator(button.selector).first();
      await locator.click({ timeout: 3_000 });
      await locator.click({ timeout: 3_000 });
      actions.push(`快速连续点击按钮两次 ${button.selector}`);
      await this.settle(page);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);
      const newRequests = this.options.getNetworkRecords().filter((record) => networkIds.includes(record.id) && ['xhr', 'fetch'].includes(record.resourceType));
      const signatures = newRequests.map((record) => `${record.method} ${record.url} ${record.postData ?? ''}`);
      const duplicateCount = signatures.length - new Set(signatures).size;
      const hasErrors = consoleIds.length > 0 || pageErrorIds.length > 0;

      return [
        this.createResult({
          kind: 'rapid-click',
          target: labelOf(button),
          selector: button.selector,
          status: hasErrors ? 'failed' : duplicateCount > 0 || newRequests.length >= 2 ? 'warning' : 'passed',
          startedAt,
          actions,
          before,
          issue: hasErrors
            ? '快速重复点击后出现新的 Console/Page Error。'
            : duplicateCount > 0 || newRequests.length >= 2
              ? '快速重复点击触发了多个接口请求，可能缺少 Loading 禁用、防抖或请求去重。'
              : undefined,
          suggestion:
            duplicateCount > 0 || newRequests.length >= 2
              ? {
                  frontend: '对按钮点击增加 Loading 禁用、防抖、请求去重或 AbortController，避免重复提交/重复查询。',
                  backend: '对关键接口增加幂等保护、限流和重复请求识别。',
                  test: '补充快速点击和重复点击测试。',
                  priority: 'P2'
                }
              : undefined,
          observations: {
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            details: {
              apiRequestCount: newRequests.length,
              duplicateCount
            }
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'rapid-click',
          target: labelOf(button),
          selector: button.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '快速重复点击测试执行失败。',
          suggestion: {
            frontend: '检查按钮在点击后是否立即进入 Loading/disabled 状态，以及重复点击时的状态一致性。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }

  private async testSafeDialog(page: Page, pageModel: PageModel): Promise<InteractionTestResult[]> {
    const button = pageModel.buttons.find((item) => {
      const label = labelOf(item);
      return item.visible && !isDisabled(item) && item.selector && VIEW_PATTERN.test(label) && !UNSAFE_ACTION_PATTERN.test(label);
    });
    const startedAt = new Date().toISOString();

    if (!button?.selector) {
      return [
        this.createResult({
          kind: 'dialog',
          target: '查看/详情',
          status: 'skipped',
          startedAt,
          actions: [],
          observations: {
            details: '未识别到安全的查看/详情按钮。'
          }
        })
      ];
    }

    const before = await this.snapshot(page);
    const actions: string[] = [];
    try {
      await page.locator(button.selector).first().click({ timeout: 3_000 });
      actions.push(`点击安全查看按钮 ${button.selector}`);
      await this.settle(page);
      const afterUrl = page.url();
      const dialogDetected = await page
        .locator('[role="dialog"], [class*="modal" i], [class*="drawer" i], [class*="dialog" i]')
        .evaluateAll((elements) =>
          elements.some((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          })
        )
        .catch(() => false);
      const networkIds = newIds(this.options.getNetworkRecords(), before.networkIds);
      const consoleIds = newConsoleErrorIds(this.options.getConsoleRecords(), before.consoleIds);
      const pageErrorIds = newIds(this.options.getPageErrors(), before.pageErrorIds);

      if (dialogDetected) {
        await page.keyboard.press('Escape').catch(() => undefined);
        actions.push('按 Escape 尝试关闭弹窗/抽屉');
        await page.waitForTimeout(300).catch(() => undefined);
      } else if (afterUrl !== before.url) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 3_000 }).catch(() => undefined);
        actions.push('检测到详情页跳转，执行 goBack 返回原页面');
      }

      return [
        this.createResult({
          kind: 'dialog',
          target: labelOf(button),
          selector: button.selector,
          status: consoleIds.length > 0 || pageErrorIds.length > 0 ? 'failed' : dialogDetected || afterUrl !== before.url || networkIds.length > 0 ? 'passed' : 'warning',
          startedAt,
          actions,
          before,
          issue:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? '点击查看/详情后出现新的 Console/Page Error。'
              : dialogDetected || afterUrl !== before.url || networkIds.length > 0
                ? undefined
                : '点击查看/详情后未观察到弹窗、跳转或请求变化。',
          suggestion:
            consoleIds.length > 0 || pageErrorIds.length > 0
              ? {
                  frontend: '检查详情弹窗/页面打开时的数据加载、空值保护和关闭逻辑。',
                  backend: '如果详情接口报错，检查 ID 参数、权限和响应结构。',
                  priority: 'P1'
                }
              : undefined,
          observations: {
            afterUrl,
            dialogDetected,
            networkRequestIds: networkIds,
            consoleIds,
            pageErrorIds,
            urlChanged: afterUrl !== before.url
          }
        })
      ];
    } catch (error: unknown) {
      return [
        this.createResult({
          kind: 'dialog',
          target: labelOf(button),
          selector: button.selector,
          status: 'failed',
          startedAt,
          actions,
          before,
          issue: '查看/详情交互执行失败。',
          suggestion: {
            frontend: '检查查看/详情按钮是否可点击、是否有遮挡，以及弹窗/路由打开逻辑是否稳定。',
            priority: 'P2'
          },
          observations: {
            error: error instanceof Error ? error.message : String(error)
          }
        })
      ];
    }
  }
}
