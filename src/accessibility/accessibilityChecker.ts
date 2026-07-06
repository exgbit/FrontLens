import type { Page } from 'playwright';
import type { AccessibilityCheckResult } from '../types.js';

interface RawNode {
  selector: string;
  text?: string;
  tagName?: string;
  details?: unknown;
}

interface RawAccessibilityReport {
  missingAltImages: RawNode[];
  unlabeledControls: RawNode[];
  unnamedButtons: RawNode[];
  unnamedLinks: RawNode[];
  positiveTabIndex: RawNode[];
  unfocusableInteractive: RawNode[];
  unnamedDialogs: RawNode[];
  contrastIssues: RawNode[];
}

function createCheck(input: {
  id: string;
  rule: AccessibilityCheckResult['rule'];
  title: string;
  description: string;
  nodes: RawNode[];
  severity: AccessibilityCheckResult['severity'];
  suggestion: AccessibilityCheckResult['suggestion'];
}): AccessibilityCheckResult {
  return {
    id: input.id,
    rule: input.rule,
    status: input.nodes.length > 0 ? 'failed' : 'passed',
    severity: input.severity,
    title: input.title,
    description: input.description,
    count: input.nodes.length,
    nodes: input.nodes.slice(0, 50),
    suggestion: input.suggestion
  };
}

export class AccessibilityChecker {
  async check(page: Page): Promise<AccessibilityCheckResult[]> {
    const raw = await page.evaluate<RawAccessibilityReport>(() => {
      const compact = (value: string | null | undefined, max = 120): string => {
        const text = (value ?? '').replace(/\s+/g, ' ').trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
      };

      const cssEscape = (value: string): string => {
        const css = (window as unknown as { CSS?: { escape?: (input: string) => string } }).CSS;
        return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      };

      const selectorFor = (element: Element): string => {
        if (element.id) return `#${cssEscape(element.id)}`;
        const testId = element.getAttribute('data-testid') ?? element.getAttribute('data-test') ?? element.getAttribute('data-cy');
        if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.body && path.length < 5) {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (!parent) {
            path.unshift(tag);
            break;
          }
          const sameTag = Array.from(parent.children).filter((child) => child.tagName === current!.tagName);
          const nth = sameTag.length > 1 ? `:nth-of-type(${sameTag.indexOf(current) + 1})` : '';
          path.unshift(`${tag}${nth}`);
          current = parent;
        }
        return path.join(' > ');
      };

      const visible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };

      const node = (element: Element, details?: unknown): RawNode => ({
        selector: selectorFor(element),
        text: compact(element.textContent ?? element.getAttribute('aria-label') ?? element.getAttribute('alt') ?? ''),
        tagName: element.tagName.toLowerCase(),
        details
      });

      const accessibleName = (element: Element): string => {
        const aria = element.getAttribute('aria-label');
        if (aria) return compact(aria);
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ');
          if (text.trim()) return compact(text);
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          if (element.labels && element.labels.length > 0) return compact(Array.from(element.labels).map((label) => label.textContent ?? '').join(' '));
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (element.placeholder) return compact(element.placeholder);
          }
          if (element.title) return compact(element.title);
        }
        if (element instanceof HTMLImageElement) return compact(element.alt || element.title);
        return compact(element.textContent || element.getAttribute('title') || '');
      };

      const parseRgb = (value: string): [number, number, number] | null => {
        const match = value.match(/rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)/);
        if (!match) return null;
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (alpha === 0) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3])];
      };

      const luminance = ([r, g, b]: [number, number, number]): number => {
        const convert = (channel: number): number => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
      };

      const contrast = (fg: [number, number, number], bg: [number, number, number]): number => {
        const a = luminance(fg);
        const b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };

      const effectiveBackground = (element: Element): [number, number, number] => {
        let current: Element | null = element;
        while (current) {
          const color = parseRgb(window.getComputedStyle(current).backgroundColor);
          if (color) return color;
          current = current.parentElement;
        }
        return [255, 255, 255];
      };

      const missingAltImages = Array.from(document.querySelectorAll('img'))
        .filter((element) => visible(element) && !element.hasAttribute('alt'))
        .map((element) => node(element));

      const controls = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'))
        .filter((element) => visible(element));
      const unlabeledControls = controls.filter((element) => !accessibleName(element)).map((element) => node(element));

      const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]')).filter((element) => visible(element));
      const unnamedButtons = buttons.filter((element) => !accessibleName(element)).map((element) => node(element));

      const links = Array.from(document.querySelectorAll('a[href], [role="link"]')).filter((element) => visible(element));
      const unnamedLinks = links.filter((element) => !accessibleName(element)).map((element) => node(element));

      const positiveTabIndex = Array.from(document.querySelectorAll('[tabindex]'))
        .filter((element) => visible(element) && Number(element.getAttribute('tabindex')) > 0)
        .map((element) => node(element, { tabindex: element.getAttribute('tabindex') }));

      const nativeFocusable = (element: Element): boolean => {
        const tag = element.tagName.toLowerCase();
        if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) return !element.disabled;
        if (element instanceof HTMLAnchorElement) return Boolean(element.href);
        return tag === 'summary' || element instanceof HTMLIFrameElement;
      };
      const interactiveRoles = /^(button|link|menuitem|tab|switch|checkbox|radio|option)$/i;
      const customInteractive = Array.from(document.querySelectorAll('[role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="option"], [onclick]'))
        .filter((element) => visible(element) && !nativeFocusable(element));
      const unfocusableInteractive = customInteractive
        .filter((element) => {
          const tabIndex = element.getAttribute('tabindex');
          const role = element.getAttribute('role') ?? '';
          return (interactiveRoles.test(role) || element.hasAttribute('onclick')) && (tabIndex === null || Number(tabIndex) < 0);
        })
        .map((element) => node(element, { role: element.getAttribute('role'), tabindex: element.getAttribute('tabindex') }));

      const unnamedDialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog, [class*="modal" i], [class*="drawer" i]'))
        .filter((element) => visible(element) && !accessibleName(element))
        .map((element) => node(element));

      const contrastIssues = Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => visible(element) && compact(element.innerText || element.textContent, 200).length > 0 && element.children.length <= 3)
        .slice(0, 1000)
        .map((element) => {
          const style = window.getComputedStyle(element);
          const fg = parseRgb(style.color);
          if (!fg) return null;
          const bg = effectiveBackground(element);
          const ratio = contrast(fg, bg);
          const fontSize = Number.parseFloat(style.fontSize || '14');
          const fontWeight = Number.parseFloat(style.fontWeight || '400');
          const large = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
          const threshold = large ? 3 : 4.5;
          if (ratio >= threshold) return null;
          return node(element, { ratio: Number(ratio.toFixed(2)), threshold, color: style.color, backgroundColor: style.backgroundColor, fontSize, fontWeight });
        })
        .filter((item): item is RawNode => Boolean(item))
        .slice(0, 50);

      return {
        missingAltImages,
        unlabeledControls,
        unnamedButtons,
        unnamedLinks,
        positiveTabIndex,
        unfocusableInteractive,
        unnamedDialogs,
        contrastIssues
      };
    });

    return [
      createCheck({
        id: 'A11Y-001',
        rule: 'image-alt',
        title: '图片缺少 Alt 文本',
        description: '可见图片应提供 alt；装饰性图片应显式设置 alt=""。',
        nodes: raw.missingAltImages,
        severity: 'low',
        suggestion: { frontend: '为内容图片提供描述性 alt；装饰图片设置 alt=""。', priority: 'P3' }
      }),
      createCheck({
        id: 'A11Y-002',
        rule: 'form-label',
        title: '表单控件缺少可访问名称',
        description: '输入框、选择器等表单控件需要 label、aria-label、aria-labelledby 或可理解的 placeholder。',
        nodes: raw.unlabeledControls,
        severity: 'medium',
        suggestion: { frontend: '为表单控件添加显式 label，并用 aria-describedby 关联错误提示。', test: '补充 Accessibility 自动检查。', priority: 'P2' }
      }),
      createCheck({
        id: 'A11Y-003',
        rule: 'button-name',
        title: '按钮缺少可访问名称',
        description: '按钮需要文本、aria-label 或 title，图标按钮尤其需要可访问名称。',
        nodes: raw.unnamedButtons,
        severity: 'medium',
        suggestion: { frontend: '为图标按钮增加 aria-label 或 Tooltip，并确保 accessible name 不为空。', priority: 'P2' }
      }),
      createCheck({
        id: 'A11Y-004',
        rule: 'link-name',
        title: '链接缺少可访问名称',
        description: '链接需要可读文本或 aria-label。',
        nodes: raw.unnamedLinks,
        severity: 'medium',
        suggestion: { frontend: '为链接提供明确文本，避免空链接或仅依赖背景图。', priority: 'P2' }
      }),
      createCheck({
        id: 'A11Y-005',
        rule: 'positive-tabindex',
        title: '存在正 tabindex',
        description: '正 tabindex 会打乱键盘导航顺序。',
        nodes: raw.positiveTabIndex,
        severity: 'low',
        suggestion: { frontend: '避免使用 tabindex > 0，使用 DOM 顺序和 tabindex=0 管理焦点。', priority: 'P3' }
      }),
      createCheck({
        id: 'A11Y-006',
        rule: 'focusability',
        title: '自定义交互控件不可聚焦',
        description: '使用 role 或 click handler 实现的自定义交互控件需要进入键盘 Tab 顺序。',
        nodes: raw.unfocusableInteractive,
        severity: 'medium',
        suggestion: { frontend: '优先使用原生 button/a/input；自定义控件需设置 tabindex=0 并支持键盘激活。', priority: 'P2' }
      }),
      createCheck({
        id: 'A11Y-007',
        rule: 'dialog-name',
        title: '弹窗/抽屉缺少可访问名称',
        description: 'Dialog/Drawer 需要 aria-label 或 aria-labelledby。',
        nodes: raw.unnamedDialogs,
        severity: 'medium',
        suggestion: { frontend: '为弹窗设置 aria-labelledby 指向标题，或提供 aria-label。', priority: 'P2' }
      }),
      createCheck({
        id: 'A11Y-008',
        rule: 'color-contrast',
        title: '文本颜色对比度不足',
        description: '普通文本对比度建议至少 4.5:1，大文本至少 3:1。',
        nodes: raw.contrastIssues,
        severity: 'low',
        suggestion: { frontend: '调整文本色或背景色，满足 WCAG AA 对比度要求。', priority: 'P3' }
      })
    ];
  }
}
