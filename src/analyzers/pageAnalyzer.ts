import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

const dangerPattern = /删除|移除|禁用|停用|作废|清空|重置密码|delete|remove|disable|destroy|clear/i;
const primaryPattern = /primary|主要|提交|保存|确定|新增|创建|submit|save|ok|confirm|create/i;
const cancelPattern = /取消|关闭|返回|cancel|close|back/i;

export function analyzePageQuality(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  const { pageModel, artifacts } = context;
  const visibleButtons = pageModel.buttons.filter((button) => button.visible);
  const primaryButtons = visibleButtons.filter((button) => {
    const haystack = `${button.label ?? ''} ${button.text ?? ''} ${button.attributes.class ?? ''} ${button.attributes.type ?? ''}`;
    return primaryPattern.test(haystack);
  });
  const dangerousButtons = visibleButtons.filter((button) => dangerPattern.test(`${button.label ?? ''} ${button.text ?? ''}`));
  const hasConfirmComponent = pageModel.components.some((component) => component.type === 'popconfirm' || /确认|confirm/i.test(`${component.label ?? ''} ${component.text ?? ''}`));

  if (primaryButtons.length > 3) {
    issues.push(
      factory.create({
        title: `疑似主按钮过多：${primaryButtons.length} 个`,
        category: 'frontend-ui',
        severity: 'medium',
        confidence: 0.68,
        description: `当前可视区域识别到 ${primaryButtons.length} 个疑似主操作按钮，可能削弱操作层级。`,
        evidence: {
          screenshot: artifacts.screenshot,
          details: primaryButtons.map((button) => ({
            id: button.id,
            label: button.label,
            selector: button.selector
          }))
        },
        reproduceSteps: ['打开目标页面', '观察页面主操作区域和按钮层级'],
        reason: '主按钮过多会导致用户难以判断首要动作，也可能违反设计系统中“一屏一个主操作”的原则。',
        suggestion: {
          frontend: '收敛主按钮数量，仅保留当前任务最重要的操作为 primary，其余调整为 default/link/secondary。',
          product: '重新梳理页面任务优先级，将低频操作收纳到更多操作或批量操作中。',
          priority: 'P2'
        }
      })
    );
  }

  if (visibleButtons.length > 30) {
    issues.push(
      factory.create({
        title: `按钮数量偏多：${visibleButtons.length} 个`,
        category: 'frontend-ui',
        severity: 'medium',
        confidence: 0.72,
        description: `页面识别到 ${visibleButtons.length} 个可见按钮，信息和操作密度可能过高。`,
        evidence: {
          screenshot: artifacts.screenshot,
          details: {
            buttonCount: visibleButtons.length
          }
        },
        reason: '按钮过多会增加用户认知负担，尤其在表格操作列中容易造成误点。',
        suggestion: {
          frontend: '将低频操作合并到 Dropdown/更多操作；批量操作放在选择后出现；危险操作与普通操作视觉分离。',
          product: '按用户任务频率重新排列操作优先级。',
          priority: 'P2'
        }
      })
    );
  }

  if (dangerousButtons.length > 0 && !hasConfirmComponent) {
    const labels = [...new Set(dangerousButtons.map((button) => button.label || button.text || button.id))];
    issues.push(
      factory.create({
        title: `危险操作可能缺少二次确认：${labels.slice(0, 3).join('、')}`,
        category: 'frontend-interaction',
        severity: 'high',
        confidence: 0.74,
        description: `页面存在 ${dangerousButtons.length} 个删除/禁用/清空等危险操作按钮，但当前 DOM 未识别到确认框或 Popconfirm 组件。`,
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
        reproduceSteps: ['打开目标页面', `定位危险操作按钮：${labels.slice(0, 5).join('、')}`, '确认点击前是否有二次确认或撤销机制'],
        reason: '危险操作如果没有确认或撤销机制，容易导致误删除、误停用等不可逆业务影响。',
        suggestion: {
          frontend: '为危险按钮增加 Popconfirm/Modal 二次确认，使用 danger 样式，并在确认文案中说明影响范围。',
          backend: '危险接口建议实现幂等、审计日志和明确错误返回；必要时支持软删除或撤销。',
          test: '补充危险操作确认框、取消、确认、失败回滚的测试用例。',
          priority: 'P1'
        }
      })
    );
  }

  const submitLikeButtons = visibleButtons.filter((button) => /保存|提交|确定|submit|save|confirm/i.test(`${button.label ?? ''} ${button.text ?? ''}`));
  const formsWithNoCancel = pageModel.forms.length > 0 && submitLikeButtons.length > 0 && !visibleButtons.some((button) => cancelPattern.test(`${button.label ?? ''} ${button.text ?? ''}`));
  if (formsWithNoCancel) {
    issues.push(
      factory.create({
        title: '表单区域未发现明显取消/返回操作',
        category: 'frontend-form',
        severity: 'low',
        confidence: 0.6,
        description: '页面存在表单，但未识别到取消、关闭或返回按钮。',
        evidence: {
          screenshot: artifacts.screenshot,
          details: {
            forms: pageModel.forms.map((form) => ({ id: form.id, selector: form.selector }))
          }
        },
        reason: '缺少取消/返回操作会增加用户退出成本，尤其在新增/编辑场景中影响体验。',
        suggestion: {
          frontend: '在表单底部或弹窗 footer 增加取消/返回按钮，并确保不会触发保存。',
          product: '明确表单流程中的退出路径和未保存变更提示策略。',
          priority: 'P3'
        }
      })
    );
  }

  if (pageModel.tables.length > 0) {
    const hasPagination = pageModel.components.some((component) => component.type === 'pagination');
    if (!hasPagination) {
      issues.push(
        factory.create({
          title: '表格页面未发现分页控件',
          category: 'frontend-table',
          severity: 'low',
          confidence: 0.64,
          description: '页面存在表格/数据网格，但未识别到分页控件。',
          evidence: {
            screenshot: artifacts.screenshot,
            details: {
              tables: pageModel.tables.map((table) => ({ id: table.id, rowCount: table.rowCount, columnCount: table.columnCount }))
            }
          },
          reason: '数据量较大时缺少分页会导致加载慢、DOM 过大和操作困难。若该表格为小型静态表，可忽略。',
          suggestion: {
            frontend: '数据列表类表格建议提供分页、刷新、空状态和加载状态。',
            backend: '列表接口建议统一支持 page/pageSize/total。',
            priority: 'P3'
          }
        })
      );
    }
  }

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

  if (context.config.analysis.seo) {
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
