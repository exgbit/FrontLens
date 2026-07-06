import type { AnalyzerContext, InteractionTestResult, Issue, NetworkRecord } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';

function requestById(records: NetworkRecord[], id: string): NetworkRecord | undefined {
  return records.find((record) => record.id === id);
}

function requestPayload(record: NetworkRecord): string {
  return `${record.url}\n${record.postData ?? ''}`;
}

function apiRecordsForTest(context: AnalyzerContext, test: InteractionTestResult): NetworkRecord[] {
  return (test.observations.networkRequestIds ?? [])
    .map((id) => requestById(context.networkRecords, id))
    .filter((record): record is NetworkRecord => Boolean(record))
    .filter((record) => ['xhr', 'fetch'].includes(record.resourceType));
}

export function analyzeApiContracts(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];

  for (const test of context.interactionTests) {
    const records = apiRecordsForTest(context, test);

    if (test.kind === 'search' && records.length > 0) {
      const matched = records.some((record) => /frontlens/i.test(requestPayload(record)));
      if (!matched) {
        issues.push(
          factory.create({
            title: '搜索交互触发接口，但请求参数未包含搜索值',
            category: 'integration-filter-mismatch',
            severity: 'medium',
            confidence: 0.78,
            description: `搜索测试填写了 frontlens，并触发 ${records.length} 个接口请求，但未在 URL 或 Payload 中发现该值。`,
            evidence: {
              selector: test.selector,
              details: {
                interactionTestId: test.id,
                requestIds: records.map((record) => record.id),
                urls: records.map((record) => record.url)
              }
            },
            reproduceSteps: test.actions,
            reason: '搜索值没有进入接口参数时，后端无法按用户输入筛选，页面可能展示未筛选结果。',
            suggestion: {
              frontend: '检查搜索表单 state 与请求参数映射；点击搜索时应把输入值写入 query/payload，并将分页重置到第一页。',
              backend: '明确搜索字段名称和模糊匹配语义，避免前端字段名不一致。',
              test: '补充搜索接口参数断言。',
              priority: 'P2'
            }
          })
        );
      }
    }

    if (test.kind === 'reset' && records.length > 0) {
      const stillContainsSearch = records.some((record) => /frontlens/i.test(requestPayload(record)));
      if (stillContainsSearch) {
        issues.push(
          factory.create({
            title: '重置后接口请求仍包含旧搜索值',
            category: 'integration-filter-mismatch',
            severity: 'medium',
            confidence: 0.82,
            description: '重置测试后触发的新接口仍包含 frontlens，说明筛选条件未完全清理。',
            evidence: {
              selector: test.selector,
              details: {
                interactionTestId: test.id,
                requestIds: records.map((record) => record.id)
              }
            },
            reproduceSteps: test.actions,
            reason: '重置只清空输入框但没有清理请求参数，会导致页面看起来已重置但数据仍被筛选。',
            suggestion: {
              frontend: '重置时同步清理表单 state、URL query、store 中的筛选条件，并重新请求第一页数据。',
              backend: '忽略空筛选参数，并对旧参数缓存做好隔离。',
              priority: 'P2'
            }
          })
        );
      }
    }

    if (test.kind === 'pagination' && records.length > 0) {
      const hasPaginationParams = records.some((record) => /[?&](page|pageNum|pageNo|current|cursor|offset|limit|pageSize)=/i.test(record.url) || /pageNum|pageNo|current|cursor|offset|limit|pageSize/i.test(record.postData ?? ''));
      if (!hasPaginationParams) {
        const first = records[0];
        issues.push(
          factory.create({
            title: `分页交互触发接口，但未发现分页参数：${truncateMiddle(first.url, 90)}`,
            category: 'integration-pagination-mismatch',
            severity: 'medium',
            confidence: 0.76,
            description: `分页测试触发 ${records.length} 个接口请求，但未在 URL 或 Payload 中发现 page/pageSize/current/cursor/limit 等分页参数。`,
            evidence: {
              selector: test.selector,
              networkRequestId: first.id,
              details: {
                interactionTestId: test.id,
                requestIds: records.map((record) => record.id)
              }
            },
            reproduceSteps: test.actions,
            reason: '分页参数缺失可能导致后端始终返回第一页，或前端只能做本地分页。',
            suggestion: {
              frontend: '分页切换时传递 page/pageSize/current/cursor 等参数，并更新当前页状态。',
              backend: '列表接口建议统一分页参数和响应结构：{ records, total, page, pageSize }。',
              test: '补充分页参数、页码、total 和数据变化的端到端断言。',
              priority: 'P2'
            }
          })
        );
      }
    }

    if (test.kind === 'table-sort' && records.length > 0) {
      const hasSortParams = records.some((record) => /sort|order|orderby|orderBy|sortField|sortOrder/i.test(requestPayload(record)));
      if (!hasSortParams) {
        issues.push(
          factory.create({
            title: '表格排序触发接口，但未发现排序参数',
            category: 'integration-filter-mismatch',
            severity: 'low',
            confidence: 0.66,
            description: '排序测试触发接口请求，但未发现 sort/order/orderBy 等排序参数。',
            evidence: {
              selector: test.selector,
              details: {
                interactionTestId: test.id,
                requestIds: records.map((record) => record.id)
              }
            },
            reproduceSteps: test.actions,
            reason: '如果排序预期由后端执行，缺少排序参数会导致排序无效；如果是前端本地排序，可忽略。',
            suggestion: {
              frontend: '确认排序模式：后端排序时传递 sortField/sortOrder；本地排序时更新排序图标和数据顺序。',
              backend: '提供白名单排序字段，避免任意字段排序引发性能或安全问题。',
              priority: 'P3'
            }
          })
        );
      }
    }
  }

  return issues;
}
