import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

const dangerPattern = /删除|移除|禁用|停用|作废|清空|重置密码|delete|remove|disable|destroy|clear/i;

function normalizeFeature(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function configuredFeatureMatches(configured: string[] | undefined, aliases: string[]): boolean {
  if (!configured?.length) return false;
  const expected = new Set(aliases.map(normalizeFeature));
  return configured.some((feature) => expected.has(normalizeFeature(feature)));
}

function explicitRequirementRequiresSeo(context: AnalyzerContext): boolean {
  if (!context.config.requirements.enabled) return false;
  return context.config.requirements.items.some((item) => {
    if (item.source === 'inferred') return false;
    const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
    return /seo|搜索引擎|meta\s*description|页面描述|页面标题|document\.title|title\s*tag|open\s*graph|og:|分享|社交卡片/.test(text);
  });
}

function shouldCreateSeoIssue(context: AnalyzerContext): boolean {
  if (explicitRequirementRequiresSeo(context)) return true;
  const productContext = context.config.productContext;
  if (!productContext.enabled) return false;
  const aliases = ['seo', '搜索引擎优化', 'meta-description', 'open-graph', 'social-share'];
  if (configuredFeatureMatches(productContext.outOfScopeFeatures, aliases)) return false;
  if (configuredFeatureMatches(productContext.optionalFeatures, aliases)) return false;
  if (configuredFeatureMatches(productContext.requiredFeatures, aliases)) return true;
  return productContext.pageType === 'public-content';
}

export function analyzePageQuality(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  const { pageModel, artifacts } = context;
  const visibleButtons = pageModel.buttons.filter((button) => button.visible);
  const dangerousButtons = visibleButtons.filter((button) => dangerPattern.test(`${button.label ?? ''} ${button.text ?? ''}`));
  const hasConfirmComponent = pageModel.components.some((component) => component.type === 'popconfirm' || /确认|confirm/i.test(`${component.label ?? ''} ${component.text ?? ''}`));

  if (dangerousButtons.length > 0 && !hasConfirmComponent) {
    const labels = [...new Set(dangerousButtons.map((button) => button.label || button.text || button.id))];
    issues.push(
      factory.create({
        title: `危险操作确认机制未运行时验证：${labels.slice(0, 3).join('、')}`,
        category: 'frontend-interaction',
        severity: 'info',
        confidence: 0.5,
        description: `页面存在 ${dangerousButtons.length} 个删除/禁用/清空等危险操作入口，但静态 DOM 未识别到确认框；确认框也可能按需渲染，需要交互用例验证。`,
        evidence: {
          screenshot: artifacts.screenshot,
          dom: artifacts.domSnapshot,
          selector: dangerousButtons[0]?.selector,
          componentId: dangerousButtons[0]?.id,
          details: dangerousButtons.slice(0, 20).map((button) => ({
            id: button.id,
            label: button.label,
            text: button.text,
            selector: button.selector
          }))
        },
        reproduceSteps: ['打开目标页面', `定位危险操作入口：${labels.slice(0, 5).join('、')}`, '在授权的交互测试中点击并确认是否出现二次确认或撤销机制'],
        reason: '仅凭当前 DOM 不能断定缺陷；很多组件库会在点击后懒渲染 Popconfirm/Modal。本项只作为测试补充观察，不计入可执行缺陷。',
        suggestion: {
          product: '确认该危险操作是否按产品设计需要二次确认、撤销或审计提示。',
          test: '在允许破坏性/沙箱数据的前提下补充危险操作确认框、取消、确认、失败回滚用例。',
          priority: 'P3'
        }
      })
    );
  }

  // Product/design preferences such as "too many primary buttons", "missing
  // cancel button", or "table without pagination" are intentionally not emitted
  // as defects by default. They vary heavily by page type and product decisions,
  // and should be covered by explicit journey/product checks instead.

  if (context.config.analysis.performance && pageModel.stats.domNodes > 2500) {
    issues.push(
      factory.create({
        title: `DOM 节点数量偏高：${pageModel.stats.domNodes}`,
        category: 'frontend-performance',
        severity: pageModel.stats.domNodes > 6000 ? 'high' : 'medium',
        confidence: 0.82,
        description: `页面 DOM 节点数量为 ${pageModel.stats.domNodes}，可能影响渲染、样式计算和交互响应。`,
        evidence: {
          details: {
            domNodes: pageModel.stats.domNodes
          }
        },
        reason: '过多 DOM 节点会增加 layout/recalculate style 成本，复杂表格、树、弹窗缓存常见。',
        suggestion: {
          frontend: '表格/列表启用虚拟滚动；懒渲染弹窗/Tab 内容；减少隐藏但仍挂载的大块 DOM。',
          priority: pageModel.stats.domNodes > 6000 ? 'P1' : 'P2'
        }
      })
    );
  }

  if (context.config.analysis.seo && shouldCreateSeoIssue(context)) {
    if (!pageModel.title) {
      issues.push(
        factory.create({
          title: '页面缺少 Title',
          category: 'seo',
          severity: 'medium',
          confidence: 0.95,
          description: '页面 document.title 为空。',
          evidence: {
            dom: artifacts.domSnapshot
          },
          reason: 'Title 会影响浏览器标签、搜索结果和分享识别。',
          suggestion: {
            frontend: '为页面设置清晰、稳定、包含业务语义的 title。',
            priority: 'P2'
          }
        })
      );
    }
    if (!pageModel.meta.description) {
      issues.push(
        factory.create({
          title: '页面缺少 Meta Description',
          category: 'seo',
          severity: 'low',
          confidence: 0.9,
          description: '未发现 meta[name="description"]。',
          evidence: {
            dom: artifacts.domSnapshot
          },
          reason: 'Description 可提升搜索和分享摘要质量。',
          suggestion: {
            frontend: '为公开页面补充 meta description；后台系统可按需降低优先级。',
            priority: 'P3'
          }
        })
      );
    }
  }

  return issues;
}
