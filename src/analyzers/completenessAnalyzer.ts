import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

function hasButtonText(context: AnalyzerContext, pattern: RegExp): boolean {
  return context.pageModel.buttons.some((button) => pattern.test(`${button.label ?? ''} ${button.text ?? ''}`));
}

function isReliableDataTable(table: AnalyzerContext['pageModel']['tables'][number]): boolean {
  return table.visible && (table.tagName === 'table' || table.role === 'grid' || (table.rowCount ?? 0) > 0 || (table.headers?.length ?? 0) > 0 || table.confidence >= 0.8);
}

export function analyzeCompleteness(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  const tables = context.pageModel.tables.filter(isReliableDataTable);
  const hasTable = tables.length > 0;

  if (hasTable) {
    // Do not require refresh/export/download by default: these are product
    // decisions and many admin pages intentionally avoid exporting sensitive
    // data. Treat them as explicit journeys/requirements instead of defects.


    const hasSelection = tables.some((table) => table.hasSelection);
    const hasBatchButton = hasButtonText(context, /批量|全选|batch|bulk/i);
    if (!hasSelection && hasBatchButton) {
      issues.push(
        factory.create({
          title: '存在批量操作入口但表格缺少行选择',
          category: 'frontend-table',
          severity: 'medium',
          confidence: 0.78,
          description: '页面识别到批量操作按钮，但表格未识别到 checkbox/rowSelection。',
          evidence: {
            screenshot: context.artifacts.screenshot
          },
          reason: '批量操作需要明确选择对象，否则用户难以理解操作范围，也容易误操作。',
          suggestion: {
            frontend: '为表格增加 rowSelection，并在未选择时禁用批量按钮或给出提示。',
            test: '补充未选择、选择单行、全选、取消选择后的批量操作状态测试。',
            priority: 'P2'
          }
        })
      );
    }

    for (const table of tables) {
      if ((table.rowCount ?? 0) === 0 && !table.emptyStateText) {
        issues.push(
          factory.create({
            title: `表格缺少明确空状态：${table.id}`,
            category: 'frontend-table',
            severity: 'low',
            confidence: 0.62,
            description: '表格当前未识别到数据行，也未识别到“暂无数据/Empty”等空状态文本。',
            evidence: {
              screenshot: context.artifacts.screenshot,
              selector: table.selector,
              componentId: table.id
            },
            reason: '没有空状态会让用户无法区分“加载失败”“没有权限”“筛选无结果”和“确实没有数据”。',
            suggestion: {
              frontend: '为空列表提供明确 Empty 状态；筛选无结果时提示调整筛选条件；接口失败时展示错误状态。',
              priority: 'P3'
            }
          })
        );
      }
    }
  }

  const hasUpload = context.pageModel.components.some((component) => component.type === 'upload');
  if (hasUpload) {
    const body = context.pageModel.stats.bodyTextSample;
    if (!/大小|格式|类型|限制|MB|KB|jpg|png|pdf|文件|image|type|size|limit/i.test(body)) {
      issues.push(
        factory.create({
          title: '上传控件缺少格式或大小限制说明',
          category: 'frontend-interaction',
          severity: 'medium',
          confidence: 0.68,
          description: '页面存在上传控件，但可见文本中未识别到文件格式、大小或数量限制说明。',
          evidence: {
            screenshot: context.artifacts.screenshot
          },
          reason: '上传限制不明确会导致用户反复试错，也会增加后端校验失败。',
          suggestion: {
            frontend: '在上传区域展示支持格式、大小、数量限制，并在前端做预校验。',
            backend: '上传接口应校验 MIME、扩展名、大小和安全扫描结果，返回字段级错误信息。',
            priority: 'P2'
          }
        })
      );
    }
  }

  return issues;
}
