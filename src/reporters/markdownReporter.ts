import path from 'node:path';
import type { Issue, QaResult, Severity } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';
import { writeText } from '../utils/fs.js';

const severityLabel: Record<Severity, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '信息'
};

const severityOrder: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4
};

function issuePriority(issue: Issue): number {
  return severityOrder[issue.severity] * 1000 + Number(issue.id.replace(/\D/g, '') || 0);
}

function formatMaybe(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  return String(value);
}

function formatDetails(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  try {
    const json = truncateMiddle(JSON.stringify(value, null, 2), 4000).replace(/```/g, '`​``');
    return `\n\n<details><summary>Evidence details</summary>\n\n\`\`\`json\n${json}\n\`\`\`\n\n</details>`;
  } catch {
    return '';
  }
}

function portablePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

function safeRelative(relativePath: string): string | undefined {
  if (relativePath === '') return '.';
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath) || isWindowsAbsolutePath(relativePath)) return undefined;
  return relativePath;
}

export function reportArtifactPath(outputDir: string | undefined, filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  if (path.isAbsolute(filePath) && outputDir) {
    const relative = path.relative(outputDir, filePath);
    const safe = safeRelative(relative);
    if (safe !== undefined) {
      return portablePath(safe);
    }
  }
  if (outputDir && isWindowsAbsolutePath(filePath) && isWindowsAbsolutePath(outputDir)) {
    const relative = path.win32.relative(outputDir, filePath);
    const safe = safeRelative(relative);
    if (safe !== undefined) {
      return portablePath(safe);
    }
  }
  if (outputDir) {
    const normalizedOutput = portablePath(outputDir).replace(/\/+$/, '');
    const normalizedFile = portablePath(filePath);
    if (normalizedFile === normalizedOutput) return '.';
    if (normalizedOutput && normalizedFile.startsWith(`${normalizedOutput}/`)) {
      return normalizedFile.slice(normalizedOutput.length + 1);
    }
  }
  return portablePath(filePath);
}

function reportPath(result: QaResult, filePath: string | undefined): string | undefined {
  return reportArtifactPath(result.artifacts.outputDir, filePath);
}

function formatIssueTable(issues: Issue[]): string {
  if (issues.length === 0) {
    return '未发现该类问题。\n';
  }

  const rows = issues
    .slice()
    .sort((a, b) => issuePriority(a) - issuePriority(b))
    .map(
      (issue) =>
        `| ${issue.id} | ${severityLabel[issue.severity]} | ${markdownEscape(issue.category)} | ${markdownEscape(issue.title)} | ${Math.round(issue.confidence * 100)}% |`
    );
  return ['| ID | 等级 | 类型 | 问题 | 置信度 |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
}

function formatIssueDetails(result: QaResult, issues: Issue[]): string {
  if (issues.length === 0) {
    return '';
  }

  return issues
    .slice()
    .sort((a, b) => issuePriority(a) - issuePriority(b))
    .map((issue) => {
      const evidenceLines = [
        issue.evidence.screenshot ? `- Screenshot: \`${reportPath(result, issue.evidence.screenshot)}\`` : undefined,
        issue.evidence.dom ? `- DOM: \`${reportPath(result, issue.evidence.dom)}\`` : undefined,
        issue.evidence.networkRequestId ? `- Network Request: \`${issue.evidence.networkRequestId}\`` : undefined,
        issue.evidence.consoleId ? `- Console: \`${issue.evidence.consoleId}\`` : undefined,
        issue.evidence.pageErrorId ? `- Page Error: \`${issue.evidence.pageErrorId}\`` : undefined,
        issue.evidence.pageErrorIds?.length ? `- Page Errors: \`${issue.evidence.pageErrorIds.join(', ')}\`` : undefined,
        issue.evidence.selector ? `- Selector: \`${issue.evidence.selector}\`` : undefined,
        issue.evidence.resourceUrl ? `- Resource: \`${issue.evidence.resourceUrl}\`` : undefined
      ]
        .filter(Boolean)
        .join('\n');

      const suggestions = [
        issue.suggestion.frontend ? `- 前端：${issue.suggestion.frontend}` : undefined,
        issue.suggestion.backend ? `- 后端接口：${issue.suggestion.backend}` : undefined,
        issue.suggestion.product ? `- 产品体验：${issue.suggestion.product}` : undefined,
        issue.suggestion.test ? `- 测试：${issue.suggestion.test}` : undefined
      ]
        .filter(Boolean)
        .join('\n');

      const steps = issue.reproduceSteps.map((step, index) => `${index + 1}. ${step}`).join('\n');

      return `### ${issue.id} ${issue.title}

- 严重等级：${severityLabel[issue.severity]}
- 问题类型：\`${issue.category}\`
- 置信度：${Math.round(issue.confidence * 100)}%
- 优先级：${issue.suggestion.priority ?? '-'}

**描述**

${issue.description}

**原因分析**

${issue.reason}

**复现步骤**

${steps}

**证据**

${evidenceLines || '- 详见报告 JSON 和采集产物。'}
${formatDetails(issue.evidence.details)}

**修改建议**

${suggestions || '- 暂无。'}
`;
    })
    .join('\n');
}

function formatNetworkSummary(result: QaResult): string {
  const failed = result.network.failedRequests.slice(0, 20);
  const slow = result.network.slowRequests.slice(0, 20);
  const duplicate = result.network.duplicatedRequests.slice(0, 20);

  const failedRows = failed.map((record) => `| ${record.id} | ${record.method} | ${record.status ?? '-'} | ${record.durationMs ?? '-'}ms | ${markdownEscape(truncateMiddle(record.url, 100))} |`);
  const slowRows = slow.map((record) => `| ${record.id} | ${record.method} | ${record.durationMs ?? '-'}ms | ${record.status ?? '-'} | ${markdownEscape(truncateMiddle(record.url, 100))} |`);
  const duplicateRows = duplicate.map((item) => `| ${markdownEscape(truncateMiddle(item.signature, 100))} | ${item.count} | ${item.requestIds.join(', ')} |`);

  return `## 十四、Network / 后端接口分析

- 请求总数：${result.network.requests.length}
- 失败请求：${result.network.failedRequests.length}
- 慢请求：${result.network.slowRequests.length}
- 重复请求组：${result.network.duplicatedRequests.length}
- 疑似参数异常请求：${result.network.suspiciousRequests.length}

### 失败请求

${failedRows.length ? ['| ID | Method | Status | Duration | URL |', '| --- | --- | --- | --- | --- |', ...failedRows].join('\n') : '未发现失败请求。'}

### 慢请求

${slowRows.length ? ['| ID | Method | Duration | Status | URL |', '| --- | --- | --- | --- | --- |', ...slowRows].join('\n') : '未发现慢请求。'}

### 重复请求

${duplicateRows.length ? ['| Signature | Count | Request IDs |', '| --- | --- | --- |', ...duplicateRows].join('\n') : '未发现明显重复请求。'}
`;
}

function formatConsoleSummary(result: QaResult): string {
  const errorRows = result.console.errors.slice(0, 30).map((record) => `| ${record.id} | ${record.type} | ${markdownEscape(truncateMiddle(record.text, 140))} | ${markdownEscape(record.location?.url ? truncateMiddle(record.location.url, 80) : '-')} |`);
  const pageErrorRows = result.console.pageErrors.slice(0, 30).map((record) => `| ${record.id} | ${markdownEscape(record.name ?? '-')} | ${markdownEscape(truncateMiddle(record.message, 160))} |`);

  return `## 十五、Console 分析

- Console 消息：${result.console.messages.length}
- Console Error：${result.console.errors.length}
- Console Warning：${result.console.warnings.length}
- Page Error：${result.console.pageErrors.length}

### Page Error

${pageErrorRows.length ? ['| ID | Name | Message |', '| --- | --- | --- |', ...pageErrorRows].join('\n') : '未发现 Page Error。'}

### Console Error

${errorRows.length ? ['| ID | Type | Text | URL |', '| --- | --- | --- | --- |', ...errorRows].join('\n') : '未发现 Console Error。'}
`;
}

function formatComponentSummary(result: QaResult): string {
  const components = result.pageModel.components;
  const byType = components.reduce<Record<string, number>>((acc, component) => {
    acc[component.type] = (acc[component.type] ?? 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `| ${type} | ${count} |`);

  return `## 二、页面结构

### 结构树

\`\`\`text
${result.pageModel.structureTree}
\`\`\`

### 页面元信息

- Title：${formatMaybe(result.pageModel.title)}
- URL：${result.pageModel.url}
- H1：${result.pageModel.meta.h1.length ? result.pageModel.meta.h1.join(' / ') : '-'}
- Meta Description：${formatMaybe(result.pageModel.meta.description)}
- DOM 节点数：${result.pageModel.stats.domNodes}

### 组件识别统计

${rows.length ? ['| 类型 | 数量 |', '| --- | --- |', ...rows].join('\n') : '未识别到组件。'}

### 关键组件

- 表单：${result.pageModel.forms.length}
- 表格/数据网格：${result.pageModel.tables.length}
- 输入控件：${result.pageModel.inputs.length}
- 按钮：${result.pageModel.buttons.length}
- 图片：${result.pageModel.images.length}
- 链接：${result.pageModel.links.length}
`;
}

function formatPhaseErrors(result: QaResult): string {
  if (result.metadata.phaseErrors.length === 0) {
    return '';
  }
  const rows = result.metadata.phaseErrors.map((error) => `| ${markdownEscape(error.phase)} | ${markdownEscape(error.message)} | ${error.timestamp} |`);
  return `## 采集阶段异常\n\n| Phase | Message | Time |\n| --- | --- | --- |\n${rows.join('\n')}\n`;
}

function formatInteractionTests(result: QaResult): string {
  if (result.interactionTests.length === 0) {
    return `## 三、安全交互测试

未执行安全交互测试。
`;
  }

  const rows = result.interactionTests.map((test) => {
    const network = test.observations.networkRequestIds?.join(', ') || '-';
    const consoleIds = test.observations.consoleIds?.join(', ') || '-';
    return `| ${test.id} | ${test.kind} | ${test.status} | ${markdownEscape(test.target)} | ${markdownEscape(test.issue ?? '-')} | ${markdownEscape(network)} | ${markdownEscape(consoleIds)} |`;
  });

  return `## 三、安全交互测试

默认尽量只执行非破坏性交互：搜索、筛选重置、分页、查看/详情、刷新等。上传、下载/导出、创建、编辑、删除、真实提交需通过 safety 配置显式开启；本节按实际执行动作列出证据。

| ID | 类型 | 状态 | 目标 | 观察/问题 | 新请求 | 新 Console |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatResponsiveChecks(result: QaResult): string {
  if (result.responsiveChecks.length === 0) {
    return `## 四、响应式测试

未执行响应式测试。
`;
  }

  const rows = result.responsiveChecks.map((check) => {
    const status = check.horizontalOverflow || check.clippedInteractiveCount > 0 || check.tableOverflowCount > 0 ? '异常' : check.smallTapTargetCount > 0 ? '注意' : '通过';
    return `| ${check.name} | ${check.width}x${check.height} | ${status} | ${check.horizontalOverflow ? '是' : '否'} | ${check.clippedInteractiveCount} | ${check.smallTapTargetCount} | ${check.tableOverflowCount} | ${check.screenshot ? `\`${reportPath(result, check.screenshot)}\`` : '-'} |`;
  });

  return `## 四、响应式测试

| 视口 | 尺寸 | 状态 | 横向溢出 | 溢出交互元素 | 小触控目标 | 表格溢出 | 截图 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatAccessibilityChecks(result: QaResult): string {
  if (result.accessibilityChecks.length === 0) {
    return `## 五、Accessibility

未执行 Accessibility 检查。
`;
  }

  const rows = result.accessibilityChecks.map((check) => `| ${check.id} | ${check.rule} | ${check.status} | ${severityLabel[check.severity]} | ${check.count} | ${markdownEscape(check.title)} |`);
  return `## 五、Accessibility

| ID | 规则 | 状态 | 等级 | 数量 | 标题 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatPermissionChecks(result: QaResult): string {
  if (result.permissionChecks.length === 0) {
    return `## 六、权限测试

未执行权限检查。
`;
  }

  const rows = result.permissionChecks.map((check) => `| ${check.id} | ${check.rule} | ${check.status} | ${severityLabel[check.severity]} | ${check.count} | ${markdownEscape(check.title)} |`);
  return `## 六、权限测试

| ID | 规则 | 状态 | 等级 | 数量 | 标题 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatSecuritySummary(result: QaResult): string {
  const security = result.security;
  if (!security.enabled) {
    return `## 七、安全扫描

未启用安全扫描。可使用 \`--security\` 或配置 \`security.enabled=true\` 开启。
`;
  }

  const failingChecks = security.checks
    .filter((check) => check.status === 'failed' || check.status === 'warning')
    .slice(0, 30)
    .map((check) => `| ${check.id} | ${check.category} | ${check.status} | ${severityLabel[check.severity]} | ${markdownEscape(check.title)} |`);

  return `## 七、安全扫描

- 模式：${security.mode}
- 安全评分：**${security.score}/100**
- 状态：${security.status}
- 检查项：${security.summary.checkCount}
- Failed / Warning / Passed / Skipped：${security.summary.failedCount} / ${security.summary.warningCount} / ${security.summary.passedCount} / ${security.summary.skippedCount}
- 高 / 中 / 低 / 信息风险：${security.summary.highCount} / ${security.summary.mediumCount} / ${security.summary.lowCount} / ${security.summary.infoCount}

### 未通过安全检查

${failingChecks.length ? ['| ID | 分类 | 状态 | 等级 | 标题 |', '| --- | --- | --- | --- | --- |', ...failingChecks].join('\n') : '未发现未通过的安全检查。'}
`;
}

function formatJourneySummary(result: QaResult): string {
  if (result.journeyTests.length === 0) {
    return `## 八、用户旅程测试

未配置用户旅程测试。可通过 \`journeys.enabled=true\` 和 \`journeys.journeys[]\` 开启。
`;
  }
  const rows = result.journeyTests.map((journey) => `| ${journey.id} | ${markdownEscape(journey.name)} | ${journey.status} | ${journey.steps.length} | ${markdownEscape(journey.finalUrl ?? '-')} | ${markdownEscape(journey.issue ?? '-')} |`);
  return `## 八、用户旅程测试

| ID | 名称 | 状态 | 步骤数 | 最终 URL | 问题 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatContractRealtimeSummary(result: QaResult): string {
  const endpointRows = result.apiContract.endpoints.slice(0, 20).map((endpoint) => `| ${endpoint.method} | ${markdownEscape(endpoint.path)} | ${endpoint.requestCount} | ${endpoint.statusCodes.join(', ') || '-'} | ${endpoint.issues.length} |`);
  const gqlRows = result.realtime.graphql.slice(0, 20).map((item) => `| ${item.id} | ${item.operationType} | ${markdownEscape(item.operationName ?? '-')} | ${item.status ?? '-'} | ${item.hasErrors ? '是' : '否'} | ${item.networkRequestId} |`);
  return `## 九、API Contract / Realtime

### API Schema / Contract

- Enabled：${result.apiContract.enabled}
- Schema：${result.apiContract.schemaPath ?? 'traffic-inferred'}
- Endpoints：${result.apiContract.summary.endpointCount}
- Undocumented / StatusMismatch / SchemaMismatch：${result.apiContract.summary.undocumentedCount} / ${result.apiContract.summary.statusMismatchCount} / ${result.apiContract.summary.schemaMismatchCount}

${endpointRows.length ? ['| Method | Path | Requests | Status | Findings |', '| --- | --- | --- | --- | --- |', ...endpointRows].join('\n') : '未发现 API endpoint。'}

### GraphQL / WebSocket / SSE

- GraphQL operations：${result.realtime.summary.graphqlOperationCount}，errors：${result.realtime.summary.graphqlErrorCount}
- WebSocket：${result.realtime.summary.webSocketCount}，errors：${result.realtime.summary.webSocketErrorCount}
- SSE：${result.realtime.summary.sseCount}

${gqlRows.length ? ['| ID | Type | Operation | Status | Errors | Request |', '| --- | --- | --- | --- | --- | --- |', ...gqlRows].join('\n') : '未发现 GraphQL operation。'}
`;
}

function formatP2Summary(result: QaResult): string {
  const budgets = result.p2.budgets.map((item) => `| ${item.metric} | ${item.actual}${item.unit} | ${item.budget}${item.unit} | ${item.status} |`);
  const network = result.p2.networkProfiles.map((item) => `| ${item.profile} | ${item.status} | ${markdownEscape(item.observations.join('; ') || item.error || '-')} | ${item.screenshot ? `\`${reportPath(result, item.screenshot)}\`` : '-'} |`);
  return `## 十、P2 测试增强

- Visual：${result.p2.visual.status}，${result.p2.visual.message ?? '-'}
- Visual current：${result.p2.visual.currentScreenshot ? `\`${reportPath(result, result.p2.visual.currentScreenshot)}\`` : '-'}

### 性能预算

${budgets.length ? ['| Metric | Actual | Budget | Status |', '| --- | --- | --- | --- |', ...budgets].join('\n') : '未启用性能预算。'}

### 网络环境模拟

${network.length ? ['| Profile | Status | Observations | Screenshot |', '| --- | --- | --- | --- |', ...network].join('\n') : '未启用网络环境模拟。'}
`;
}

function formatExceptionSimulations(result: QaResult): string {
  if (result.exceptionSimulations.length === 0) {
    return `## 十一、异常模拟测试

未启用异常模拟测试。可使用 \`--simulate-exceptions\` 或配置 \`exception.enabled=true\` 开启。
`;
  }

  const rows = result.exceptionSimulations.map((item) => `| ${item.id} | ${item.kind} | ${item.status} | ${markdownEscape(item.target ?? '-')} | ${markdownEscape(item.issue ?? '-')} | ${item.observations.bodyHasErrorFeedback === undefined ? '-' : item.observations.bodyHasErrorFeedback ? '是' : '否'} |`);
  return `## 十一、异常模拟测试

| ID | 场景 | 状态 | 目标 | 观察/问题 | 页面错误反馈 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

function formatAiAnalysis(result: QaResult): string {
  if (!result.aiAnalysis.enabled) {
    return `## 十二、AI 综合分析

未启用 AI 分析。可在配置中设置 \`analysis.ai=true\` 开启。
`;
  }

  const suggestions = result.aiAnalysis.suggestions.length > 0 ? result.aiAnalysis.suggestions.map((item) => `- ${item}`).join('\n') : '- 暂无。';
  return `## 十二、AI 综合分析

- Provider：${result.aiAnalysis.provider}
- Status：${result.aiAnalysis.status}
- Context：${result.aiAnalysis.contextPath ? `\`${result.aiAnalysis.contextPath}\`` : '-'}
- Raw Output：${result.aiAnalysis.rawOutputPath ? `\`${result.aiAnalysis.rawOutputPath}\`` : '-'}

${result.aiAnalysis.summary ?? result.aiAnalysis.error ?? '暂无 AI 摘要。'}

### AI 建议

${suggestions}
`;
}

function formatPerformanceSummary(result: QaResult): string {
  const perf = result.performance;
  return `### Performance Metrics

| 指标 | 值 |
| --- | --- |
| FCP | ${perf.paint.firstContentfulPaintMs ?? '-'} ms |
| FP | ${perf.paint.firstPaintMs ?? '-'} ms |
| DOMContentLoaded | ${perf.navigation?.domContentLoadedMs ?? '-'} ms |
| Load | ${perf.navigation?.loadMs ?? '-'} ms |
| Long Tasks | ${perf.longTasks.count} 个 / ${perf.longTasks.totalDurationMs} ms |
| CLS | ${perf.layoutShift.score} |
| Resource Transfer | ${Math.round(perf.resources.totalTransferSize / 1024)} KB |
| DOM Nodes | ${perf.dom.nodeCount} |
| DOM Max Depth | ${perf.dom.maxDepth} |
| DOM Mutations | ${perf.mutations?.count ?? '-'} |
| JS Heap Used | ${perf.memory?.usedJSHeapSize ? `${Math.round(perf.memory.usedJSHeapSize / 1024 / 1024)} MB` : '-'} |
`;
}

function formatCoverageSummary(result: QaResult): string {
  const coverage = result.coverage;
  if (!coverage.enabled || coverage.status !== 'passed') {
    return `### Chromium Coverage / 未使用资源

- Status：${coverage.status}
- Message：${coverage.message ?? (coverage.enabled ? 'Coverage 未采集。' : 'Coverage 未启用。')}
`;
  }

  const rows = coverage.topUnused.slice(0, 20).map((entry) => `| ${entry.type.toUpperCase()} | ${Math.round(entry.totalBytes / 1024)}KB | ${Math.round(entry.unusedBytes / 1024)}KB | ${entry.unusedPercent}% | ${markdownEscape(truncateMiddle(entry.url, 100))} |`);
  return `### Chromium Coverage / 未使用资源

| 类型 | Total | Used | Unused | Unused% |
| --- | --- | --- | --- | --- |
| JS | ${Math.round(coverage.totals.js.totalBytes / 1024)}KB | ${Math.round(coverage.totals.js.usedBytes / 1024)}KB | ${Math.round(coverage.totals.js.unusedBytes / 1024)}KB | ${coverage.totals.js.unusedPercent}% |
| CSS | ${Math.round(coverage.totals.css.totalBytes / 1024)}KB | ${Math.round(coverage.totals.css.usedBytes / 1024)}KB | ${Math.round(coverage.totals.css.unusedBytes / 1024)}KB | ${coverage.totals.css.unusedPercent}% |
| All | ${Math.round(coverage.totals.all.totalBytes / 1024)}KB | ${Math.round(coverage.totals.all.usedBytes / 1024)}KB | ${Math.round(coverage.totals.all.unusedBytes / 1024)}KB | ${coverage.totals.all.unusedPercent}% |

#### Top 未使用资源

${rows.length ? ['| 类型 | Total | Unused | Unused% | URL |', '| --- | --- | --- | --- | --- |', ...rows].join('\n') : '未发现明显未使用资源。'}
`;
}

function formatOptimizationSummary(result: QaResult): string {
  const frontend = result.issues.filter((issue) => issue.suggestion.frontend).slice(0, 12);
  const backend = result.issues.filter((issue) => issue.suggestion.backend).slice(0, 12);
  const test = result.issues.filter((issue) => issue.suggestion.test).slice(0, 12);

  const formatList = (issues: Issue[], selector: (issue: Issue) => string | undefined): string =>
    issues.length
      ? issues.map((issue) => `- **${issue.id}** ${issue.title}：${selector(issue)}`).join('\n')
      : '- 暂无。';

  return `## 十七、修改与优化建议

### 前端修改建议

${formatList(frontend, (issue) => issue.suggestion.frontend)}

### 后端接口修改建议

${formatList(backend, (issue) => issue.suggestion.backend)}

### 测试补充建议

${formatList(test, (issue) => issue.suggestion.test)}
`;
}

function formatFixTasks(result: QaResult): string {
  const rows = result.fixTasks.slice(0, 50).map((task) => `| ${task.id} | ${task.priority} | ${task.owner} | ${task.type} | ${markdownEscape(task.title)} | ${task.issueIds.join(', ')} |`);
  return `## 十八、机器可执行 Fix Tasks

${rows.length ? ['| ID | 优先级 | Owner | Type | Title | Issues |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : '暂无可执行修复任务。'}
`;
}

function formatArtifacts(result: QaResult): string {
  const entries = Object.entries(result.artifacts).filter(([, value]) => typeof value === 'string' && value);
  return `## 十九、证据索引

${entries.map(([key, value]) => `- ${key}: \`${reportPath(result, value as string)}\``).join('\n')}
`;
}

export async function writeMarkdownReport(result: QaResult): Promise<void> {
  const outputPath = path.join(result.artifacts.outputDir, 'report.md');
  result.artifacts.markdownReport = outputPath;

  const frontendIssues = result.issues.filter((issue) => issue.category.startsWith('frontend') || issue.category === 'resource-loading' || issue.category === 'resource-performance' || issue.category === 'console-error' || issue.category === 'seo');
  const backendIssues = result.issues.filter((issue) => issue.category.startsWith('backend'));
  const integrationIssues = result.issues.filter((issue) => issue.category.startsWith('integration'));
  const securityIssues = result.issues.filter((issue) => issue.category === 'security');

  const markdown = `# FrontLens QA Report

## 一、测试概览

- URL：${result.summary.url}
- 页面标题：${formatMaybe(result.summary.title)}
- 浏览器：${result.summary.browser}
- 视口：${result.summary.viewport.width}x${result.summary.viewport.height}
- 测试时间：${result.summary.testedAt}
- 总耗时：${result.metadata.durationMs}ms
- Result Schema：${result.metadata.schemaVersion}
- 采集阶段异常：${result.metadata.phaseErrors.length}
- 最终评分：**${result.summary.score}/100**
- 安全评分：**${result.security.score}/100**（${result.security.status}）
- API Contract：${result.apiContract.summary.endpointCount} endpoints / ${result.apiContract.summary.schemaMismatchCount + result.apiContract.summary.statusMismatchCount + result.apiContract.summary.undocumentedCount} findings
- Realtime：GraphQL ${result.realtime.summary.graphqlOperationCount} / WS ${result.realtime.summary.webSocketCount} / SSE ${result.realtime.summary.sseCount}
- Fix Tasks：${result.fixTasks.length}
- 问题总数：${result.summary.issueCount}
- 严重 / 高 / 中 / 低 / 信息：${result.summary.criticalCount} / ${result.summary.highCount} / ${result.summary.mediumCount} / ${result.summary.lowCount} / ${result.summary.infoCount}

${formatPhaseErrors(result)}

## 核心问题列表

${formatIssueTable(result.issues)}

${formatComponentSummary(result)}

${formatInteractionTests(result)}

${formatResponsiveChecks(result)}

${formatAccessibilityChecks(result)}

${formatPermissionChecks(result)}

${formatSecuritySummary(result)}

${formatJourneySummary(result)}

${formatContractRealtimeSummary(result)}

${formatP2Summary(result)}

${formatExceptionSimulations(result)}

${formatAiAnalysis(result)}

## 十三、问题详情

### 前端问题

${formatIssueTable(frontendIssues)}

${formatIssueDetails(result, frontendIssues)}

### 后端接口问题

${formatIssueTable(backendIssues)}

${formatIssueDetails(result, backendIssues)}

### 前后端联动问题

${formatIssueTable(integrationIssues)}

${formatIssueDetails(result, integrationIssues)}

### 安全扫描问题

${formatIssueTable(securityIssues)}

${formatIssueDetails(result, securityIssues)}

${formatNetworkSummary(result)}

${formatConsoleSummary(result)}

## 十六、资源与性能分析

- 资源总数：${result.resources.entries.length}
- 加载失败资源：${result.resources.failed.length}
- 慢资源：${result.resources.slow.length}
- 大资源：${result.resources.large.length}
- 重复资源：${result.resources.duplicated.length}
- 响应式视口：${result.responsiveChecks.length}
- Accessibility 规则：${result.accessibilityChecks.length}
- 权限规则：${result.permissionChecks.length}
- 异常模拟场景：${result.exceptionSimulations.length}
- 安全检查项：${result.security.summary.checkCount}
- 用户旅程：${result.journeyTests.length}
- API Contract Endpoints：${result.apiContract.summary.endpointCount}
- Realtime：GraphQL ${result.realtime.summary.graphqlOperationCount} / WS ${result.realtime.summary.webSocketCount} / SSE ${result.realtime.summary.sseCount}
- Coverage：${result.coverage.status}${result.coverage.status === 'passed' ? ` / 未使用 ${result.coverage.totals.all.unusedPercent}%` : ''}

${formatPerformanceSummary(result)}

${formatCoverageSummary(result)}

${formatOptimizationSummary(result)}

${formatFixTasks(result)}

${formatArtifacts(result)}
`;

  await writeText(outputPath, markdown);
}
