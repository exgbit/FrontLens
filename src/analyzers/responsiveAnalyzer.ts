import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

function normalizeFeature(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function hasConfiguredFeature(configured: string[] | undefined, aliases: string[]): boolean {
  if (!configured?.length) return false;
  const expected = new Set(aliases.map(normalizeFeature));
  return configured.some((feature) => expected.has(normalizeFeature(feature)));
}

function explicitRequirementRequiresTouchTarget(context: AnalyzerContext): boolean {
  if (!context.config.requirements.enabled) return false;
  return context.config.requirements.items.some((item) => {
    if (item.source === 'inferred') return false;
    const text = `${item.title} ${item.description ?? ''}`.toLowerCase();
    return /触控目标|点击区|移动端|mobile|touch target|tap target|wcag|响应式|responsive/.test(text);
  });
}

function shouldCreateSmallTapTargetIssue(context: AnalyzerContext): boolean {
  const productContext = context.config.productContext;
  const touchAliases = ['mobile-touch-target', 'touch-target', 'tap-target', '移动端点击区', '触控目标'];
  const touchScopeAliases = [...touchAliases, 'mobile', 'responsive', 'accessibility', 'a11y'];
  if (explicitRequirementRequiresTouchTarget(context)) return true;
  if (!productContext.enabled) return false;
  if (hasConfiguredFeature(productContext.outOfScopeFeatures, touchScopeAliases)) return false;
  if (hasConfiguredFeature(productContext.optionalFeatures, touchScopeAliases)) return false;
  if (hasConfiguredFeature(productContext.requiredFeatures, touchScopeAliases)) return true;
  if (productContext.deviceScope === 'mobile-first' || productContext.deviceScope === 'responsive') return true;
  if (productContext.accessibilityTarget === 'wcag-aa' || productContext.accessibilityTarget === 'wcag-aaa') return true;
  return false;
}

export function analyzeResponsive(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];

  for (const check of context.responsiveChecks) {
    if (check.horizontalOverflow || check.clippedInteractiveCount > 0 || check.tableOverflowCount > 0) {
      issues.push(
        factory.create({
          title: `响应式布局异常：${check.name} ${check.width}x${check.height}`,
          category: 'frontend-ui',
          severity: check.name === 'mobile' || check.name === 'tablet' ? 'medium' : 'low',
          confidence: 0.82,
          description: check.observations.join(' '),
          evidence: {
            screenshot: check.screenshot,
            details: check
          },
          reproduceSteps: ['打开目标页面', `将视口切换为 ${check.width}x${check.height}`, '观察是否存在横向滚动、元素溢出或表格溢出'],
          reason: '响应式布局异常会影响移动端、平板端和小屏用户的可用性，表格溢出还可能导致操作列不可见。',
          suggestion: {
            frontend: '为小屏增加响应式布局：表格横向滚动容器、操作列收纳、按钮换行、断点样式和合适的触控尺寸。',
            test: '补充 mobile/tablet/laptop 视口截图回归测试。',
            priority: check.name === 'mobile' || check.name === 'tablet' ? 'P2' : 'P3'
          }
        })
      );
      continue;
    }

    if (check.smallTapTargetCount >= 5 && (check.name === 'mobile' || check.name === 'tablet') && shouldCreateSmallTapTargetIssue(context)) {
      issues.push(
        factory.create({
          title: `触控目标尺寸偏小：${check.name} ${check.width}x${check.height}`,
          category: 'frontend-accessibility',
          severity: 'low',
          confidence: 0.74,
          description: `${check.smallTapTargetCount} 个交互元素宽度或高度小于 32px。`,
          evidence: {
            screenshot: check.screenshot,
            details: check
          },
          reproduceSteps: ['打开目标页面', `切换到 ${check.width}x${check.height} 视口`, '检查按钮、链接、输入框的触控尺寸'],
          reason: '触控目标过小会增加移动端误触和点击困难。',
          suggestion: {
            frontend: '移动端按钮/链接/表单控件建议提供至少 32px，最好 44px 的点击区域。',
            priority: 'P3'
          }
        })
      );
    }
  }

  return issues;
}
