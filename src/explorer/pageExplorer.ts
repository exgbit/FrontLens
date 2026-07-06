import type { Page } from 'playwright';
import type { ComponentRecord, PageModel } from '../types.js';
import { createId } from '../utils/id.js';
import { compactText } from '../utils/text.js';
import { redactText, redactUrl } from '../utils/redact.js';

type RawComponent = Omit<ComponentRecord, 'id'>;

interface RawPageExtraction {
  meta: PageModel['meta'];
  breadcrumbs: string[];
  headings: Array<{ level: number; text: string }>;
  components: RawComponent[];
  stats: PageModel['stats'];
}

function buildStructureTree(title: string, model: Pick<PageModel, 'breadcrumbs' | 'components' | 'forms' | 'tables' | 'buttons' | 'inputs'>): string {
  const lines: string[] = [];
  lines.push(title || '页面');

  if (model.breadcrumbs.length > 0) {
    lines.push(`├── 面包屑：${model.breadcrumbs.join(' / ')}`);
  }

  const hasSearchButton = model.buttons.some((button) => /搜索|查询|筛选|filter|search/i.test(button.label ?? button.text ?? ''));
  const hasResetButton = model.buttons.some((button) => /重置|清空|reset|clear/i.test(button.label ?? button.text ?? ''));
  if (model.inputs.length > 0 || hasSearchButton || hasResetButton) {
    lines.push('├── 筛选/输入区');
    if (model.inputs.length > 0) {
      lines.push(`│   ├── 输入控件：${model.inputs.length} 个`);
    }
    if (hasSearchButton) {
      lines.push('│   ├── 搜索/查询按钮');
    }
    if (hasResetButton) {
      lines.push('│   └── 重置按钮');
    }
  }

  if (model.forms.length > 0) {
    lines.push(`├── 表单：${model.forms.length} 个`);
  }

  if (model.tables.length > 0) {
    lines.push(`├── 表格/数据网格：${model.tables.length} 个`);
  }

  const paginationCount = model.components.filter((component) => component.type === 'pagination').length;
  if (paginationCount > 0) {
    lines.push(`├── 分页：${paginationCount} 个`);
  }

  const dialogCount = model.components.filter((component) => component.type === 'dialog' || component.type === 'modal' || component.type === 'drawer').length;
  if (dialogCount > 0) {
    lines.push(`├── 弹窗/抽屉：${dialogCount} 个`);
  }

  if (model.buttons.length > 0) {
    lines.push(`└── 操作按钮：${model.buttons.length} 个`);
  }

  return lines.join('\n');
}

export class PageExplorer {
  async explore(page: Page): Promise<PageModel> {
    const title = await page.title();
    const url = redactUrl(page.url());
    const extracted = await page.evaluate<RawPageExtraction>(() => {
      const componentSelectors = [
        'button',
        'a',
        'input',
        'textarea',
        'select',
        'form',
        'table',
        '[role]',
        '[aria-label]',
        '[contenteditable="true"]',
        '[class*="breadcrumb" i]',
        '[class*="menu" i]',
        '[class*="tabs" i]',
        '[class*="tab-" i]',
        '[class*="card" i]',
        '[class*="form" i]',
        '[class*="input" i]',
        '[class*="select" i]',
        '[class*="checkbox" i]',
        '[class*="radio" i]',
        '[class*="date" i]',
        '[class*="picker" i]',
        '[class*="cascader" i]',
        '[class*="tree" i]',
        '[class*="upload" i]',
        '[class*="table" i]',
        '[class*="list" i]',
        '[class*="grid" i]',
        '[class*="pagination" i]',
        '[class*="dropdown" i]',
        '[class*="drawer" i]',
        '[class*="dialog" i]',
        '[class*="modal" i]',
        '[class*="tooltip" i]',
        '[class*="popconfirm" i]',
        '[class*="switch" i]',
        '[class*="badge" i]',
        '[class*="tag" i]',
        '[class*="steps" i]',
        '[class*="timeline" i]',
        'img'
      ].join(',');

      const cssEscape = (value: string): string => {
        const css = (window as unknown as { CSS?: { escape?: (input: string) => string } }).CSS;
        if (css?.escape) {
          return css.escape(value);
        }
        return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      };

      const compact = (value: string | null | undefined, maxLength = 180): string => {
        const text = (value ?? '').replace(/\s+/g, ' ').trim();
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
      };

      const isVisible = (element: Element): boolean => {
        if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
          return false;
        }
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };

      const getAttributes = (element: Element): Record<string, string> => {
        const keep = [
          'id',
          'class',
          'role',
          'type',
          'name',
          'placeholder',
          'aria-label',
          'aria-labelledby',
          'aria-expanded',
          'aria-disabled',
          'aria-selected',
          'tabindex',
          'data-testid',
          'data-test',
          'data-cy',
          'data-permission',
          'data-auth',
          'data-role',
          'permission',
          'href',
          'alt',
          'title'
        ];
        const attrs: Record<string, string> = {};
        for (const name of keep) {
          const value = element.getAttribute(name);
          if (value !== null && value !== '') {
            attrs[name] = compact(value, 240);
          }
        }
        return attrs;
      };

      const selectorFor = (element: Element): string => {
        if (element.id) {
          return `#${cssEscape(element.id)}`;
        }
        for (const attr of ['data-testid', 'data-test', 'data-cy']) {
          const value = element.getAttribute(attr);
          if (value) {
            return `[${attr}="${value.replace(/"/g, '\\"')}"]`;
          }
        }
        const aria = element.getAttribute('aria-label');
        if (aria) {
          return `${element.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        }

        const path: string[] = [];
        let current: Element | null = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
          const tag = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (!parent) {
            path.unshift(tag);
            break;
          }
          const currentTag = current.tagName;
          const siblings = Array.from(parent.children).filter((sibling: Element) => sibling.tagName === currentTag);
          const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
          path.unshift(`${tag}${nth}`);
          current = parent;
          if (path.length >= 5) {
            break;
          }
        }
        return path.join(' > ');
      };

      const getAssociatedLabel = (element: Element): string => {
        const aria = element.getAttribute('aria-label');
        if (aria) {
          return aria;
        }
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const labelText = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? '')
            .join(' ');
          if (labelText.trim()) {
            return compact(labelText);
          }
        }
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
          if (element.labels && element.labels.length > 0) {
            return compact(Array.from(element.labels).map((label) => label.textContent ?? '').join(' '));
          }
          if (element.id) {
            const explicit = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
            if (explicit?.textContent) {
              return compact(explicit.textContent);
            }
          }
          const nearest = element.closest('label');
          if (nearest?.textContent) {
            return compact(nearest.textContent);
          }
        }
        return '';
      };

      const hasClass = (element: Element, pattern: RegExp): boolean => pattern.test(element.className?.toString() ?? '');
      const hasAttrText = (element: Element, pattern: RegExp): boolean => {
        const attrs = [
          element.getAttribute('role'),
          element.getAttribute('aria-label'),
          element.getAttribute('placeholder'),
          element.getAttribute('title'),
          element.getAttribute('type'),
          element.className?.toString()
        ];
        return attrs.some((value) => pattern.test(value ?? ''));
      };

      const classify = (element: Element): RawComponent['type'] => {
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role') ?? '';
        const type = element.getAttribute('type') ?? '';
        const text = compact(element.textContent, 120);

        if (tag === 'img') return 'image';
        if (tag === 'input' && /file/i.test(type)) return 'upload';
        if (tag === 'button' || role === 'button' || (tag === 'input' && /button|submit|reset/i.test(type))) return 'button';
        if (tag === 'input' && /checkbox/i.test(type)) return 'checkbox';
        if (tag === 'input' && /radio/i.test(type)) return 'radio';
        if (tag === 'select' || role === 'combobox' || hasAttrText(element, /select|选择|下拉/i)) return 'select';
        if (tag === 'input' && /date|time|month|week/i.test(type)) return 'datepicker';
        if (tag === 'input' || tag === 'textarea' || role === 'textbox' || element.getAttribute('contenteditable') === 'true') return 'input';
        if (tag === 'form' || hasClass(element, /(^|\s)(ant|el|n|arco|Mui)?-?form/i)) return 'form';
        if (tag === 'table' || role === 'table') return 'table';
        if (role === 'grid' || hasClass(element, /(^|\s|[-_])(data[-_]?grid|ag-grid|table|data-table|el-table|ant-table|n-data-table|v-data-table|MuiDataGrid)(\s|[-_]|$)/i)) return role === 'grid' ? 'grid' : 'table';
        if (tag === 'a' && !hasClass(element, /button|btn/i)) return 'link';
        if (hasAttrText(element, /breadcrumb|面包屑/i)) return 'breadcrumb';
        if (role === 'menu' || hasAttrText(element, /menu|菜单/i)) return 'menu';
        if (role === 'tab' || role === 'tablist' || hasAttrText(element, /tabs?|标签页/i)) return 'tab';
        if (hasAttrText(element, /card|卡片/i)) return 'card';
        if (hasAttrText(element, /date-picker|datepicker|日期/i)) return 'datepicker';
        if (hasAttrText(element, /cascader|级联/i)) return 'cascader';
        if (role === 'tree' || hasAttrText(element, /tree|树/i)) return 'tree';
        if (hasAttrText(element, /upload|上传/i) || /上传|选择文件|browse/i.test(text)) return 'upload';
        if (role === 'list' || hasAttrText(element, /list|列表/i)) return 'list';
        if (hasAttrText(element, /pagination|pager|分页|上一页|下一页/i)) return 'pagination';
        if (hasAttrText(element, /dropdown|下拉/i)) return 'dropdown';
        if (hasAttrText(element, /drawer|抽屉/i)) return 'drawer';
        if (role === 'dialog' || hasAttrText(element, /dialog|弹窗|modal/i)) return hasAttrText(element, /modal/i) ? 'modal' : 'dialog';
        if (hasAttrText(element, /tooltip|提示/i)) return 'tooltip';
        if (hasAttrText(element, /popconfirm|确认/i)) return 'popconfirm';
        if (role === 'switch' || hasAttrText(element, /switch|开关/i)) return 'switch';
        if (hasAttrText(element, /badge|徽标/i)) return 'badge';
        if (hasAttrText(element, /tag|标签/i)) return 'tag';
        if (hasAttrText(element, /steps?|步骤/i)) return 'steps';
        if (hasAttrText(element, /timeline|时间线/i)) return 'timeline';
        return 'unknown';
      };

      const estimateConfidence = (element: Element, type: RawComponent['type']): number => {
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role');
        if (type === 'unknown') return 0.2;
        if (
          (type === 'button' && tag === 'button') ||
          (type === 'input' && (tag === 'input' || tag === 'textarea')) ||
          (type === 'select' && tag === 'select') ||
          (type === 'form' && tag === 'form') ||
          (type === 'table' && tag === 'table') ||
          (type === 'image' && tag === 'img') ||
          (type === 'link' && tag === 'a') ||
          (type === 'dialog' && role === 'dialog')
        ) {
          return 0.95;
        }
        if (role) {
          return 0.82;
        }
        return 0.65;
      };

      const extractRowsAndColumns = (
        element: Element
      ): {
        rowCount?: number;
        columnCount?: number;
        headers?: string[];
        hasHorizontalOverflow?: boolean;
        hasOperationColumn?: boolean;
        hasSelection?: boolean;
        emptyStateText?: string;
      } => {
        const rows = element.querySelectorAll('tbody tr, [role="row"]').length;
        const headerNodes = Array.from(element.querySelectorAll('thead th, [role="columnheader"]'));
        const headers = headerNodes.map((node) => compact(node.textContent, 80)).filter(Boolean).slice(0, 40);
        const columns = headerNodes.length;
        const text = compact(element.textContent, 500);
        return {
          rowCount: rows || undefined,
          columnCount: columns || undefined,
          headers,
          hasHorizontalOverflow:
            element instanceof HTMLElement ? element.scrollWidth > element.clientWidth + 2 || Array.from(element.querySelectorAll<HTMLElement>('*')).some((node) => node.scrollWidth > node.clientWidth + 20) : undefined,
          hasOperationColumn: headers.some((header) => /操作|动作|action|operation/i.test(header)) || /详情|编辑|删除|查看|操作|action|edit|delete|view/i.test(text),
          hasSelection: Boolean(element.querySelector('input[type="checkbox"], [role="checkbox"], .selection, [class*="selection" i]')),
          emptyStateText: rows === 0 && /暂无|无数据|空|empty|no data|not found/i.test(text) ? text : undefined
        };
      };

      const seen = new Set<Element>();
      const components: RawComponent[] = [];
      for (const element of Array.from(document.querySelectorAll(componentSelectors))) {
        if (seen.has(element)) continue;
        seen.add(element);
        const type = classify(element);
        if (type === 'unknown') continue;

        const rect = element.getBoundingClientRect();
        const visible = isVisible(element);
        const attrs = getAttributes(element);
        const label = compact(getAssociatedLabel(element) || element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('alt') || element.getAttribute('aria-label') || element.textContent, 180);
        const inputLike = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
        const tableStats = type === 'table' || type === 'grid' ? extractRowsAndColumns(element) : {};

        components.push({
          type,
          label,
          text: compact(element.textContent, 220),
          selector: selectorFor(element),
          role: element.getAttribute('role') ?? undefined,
          tagName: element.tagName.toLowerCase(),
          visible,
          disabled:
            element.hasAttribute('disabled') ||
            element.getAttribute('aria-disabled') === 'true' ||
            (inputLike ? (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled : false),
          required:
            element.hasAttribute('required') ||
            element.getAttribute('aria-required') === 'true' ||
            (inputLike ? (element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required : false),
          placeholder: element.getAttribute('placeholder') ?? undefined,
          value: inputLike ? compact((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value, 100) : undefined,
          attributes: attrs,
          boundingBox: visible
            ? {
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            : undefined,
          childrenCount: element.children.length,
          ...tableStats,
          confidence: estimateConfidence(element, type)
        });
      }

      const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? undefined;
      const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined;
      const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? undefined;
      const openGraph: Record<string, string> = {};
      for (const node of Array.from(document.querySelectorAll('meta[property^="og:"]'))) {
        const property = node.getAttribute('property');
        const content = node.getAttribute('content');
        if (property && content) {
          openGraph[property] = content;
        }
      }

      const breadcrumbs = Array.from(document.querySelectorAll('[aria-label*="breadcrumb" i], [class*="breadcrumb" i], nav[aria-label*="breadcrumb" i]'))
        .flatMap((node) =>
          Array.from(node.querySelectorAll('a, span, li, [role="link"]'))
            .map((item) => compact(item.textContent, 80))
            .filter(Boolean)
        )
        .filter((value, index, array) => value && array.indexOf(value) === index)
        .slice(0, 12);

      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
        .map((node) => ({
          level: Number(node.tagName.slice(1)),
          text: compact(node.textContent, 160)
        }))
        .filter((item) => item.text);

      const bodyText = compact(document.body?.innerText, 2000);

      return {
        meta: {
          description: metaDescription,
          canonical,
          h1: headings.filter((item) => item.level === 1).map((item) => item.text),
          viewport,
          openGraph
        },
        breadcrumbs,
        headings,
        components,
        stats: {
          domNodes: document.querySelectorAll('*').length,
          visibleTextLength: document.body?.innerText?.length ?? 0,
          bodyTextSample: bodyText
        }
      };
    });

    const components = extracted.components.map((component, index) => {
      const attributes = Object.fromEntries(
        Object.entries(component.attributes).map(([key, value]) => [key, key === 'href' ? redactUrl(value) : redactText(value)])
      );
      return {
        ...component,
        id: createId('CMP', index + 1),
        label: compactText(redactText(component.label ?? ''), 180),
        text: compactText(redactText(component.text ?? ''), 220),
        value: component.value ? redactText(component.value) : component.value,
        attributes
      };
    });

    const forms = components.filter((component) => component.type === 'form');
    const tables = components.filter((component) => component.type === 'table' || component.type === 'grid');
    const buttons = components.filter((component) => component.type === 'button');
    const inputs = components.filter((component) =>
      ['input', 'select', 'checkbox', 'radio', 'datepicker', 'cascader', 'switch', 'upload'].includes(component.type)
    );
    const images = components.filter((component) => component.type === 'image');
    const links = components.filter((component) => component.type === 'link');

    const partial = {
      breadcrumbs: extracted.breadcrumbs,
      components,
      forms,
      tables,
      buttons,
      inputs
    };

    return {
      url,
      title,
      meta: extracted.meta,
      breadcrumbs: extracted.breadcrumbs,
      headings: extracted.headings,
      structureTree: buildStructureTree(title, partial),
      components,
      forms,
      tables,
      buttons,
      inputs,
      images,
      links,
      stats: {
        ...extracted.stats,
        bodyTextSample: redactText(extracted.stats.bodyTextSample)
      }
    };
  }
}
