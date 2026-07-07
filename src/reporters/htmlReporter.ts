import path from 'node:path';
import type { QaResult } from '../types.js';
import { writeText } from '../utils/fs.js';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function issueBadge(severity: string): string {
  const colors: Record<string, string> = {
    critical: '#7f1d1d',
    high: '#b42318',
    medium: '#b54708',
    low: '#175cd3',
    info: '#475467'
  };
  return `<span class="badge" style="background:${colors[severity] ?? '#475467'}">${escapeHtml(severity)}</span>`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function writeHtmlReport(result: QaResult): Promise<void> {
  const outputPath = path.join(result.artifacts.outputDir, 'report.html');
  result.artifacts.htmlReport = outputPath;

  const issueRows = result.issues
    .map(
      (issue) => `<tr>
        <td>${escapeHtml(issue.id)}</td>
        <td>${issueBadge(issue.severity)}</td>
        <td>${escapeHtml(issue.category)}</td>
        <td>${escapeHtml(issue.title)}</td>
        <td>${Math.round(issue.confidence * 100)}%</td>
        <td>${escapeHtml(issue.suggestion.priority ?? '-')}</td>
      </tr>`
    )
    .join('\n');

  const issueDetails = result.issues
    .map(
      (issue) => `<details class="issue-detail">
        <summary>${escapeHtml(issue.id)} · ${escapeHtml(issue.title)}</summary>
        <p><strong>Reason:</strong> ${escapeHtml(issue.reason)}</p>
        <p><strong>Description:</strong> ${escapeHtml(issue.description)}</p>
        <p><strong>Reproduce:</strong></p>
        <ol>${issue.reproduceSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('\n')}</ol>
        <p><strong>Suggestion:</strong></p>
        <pre>${escapeHtml(safeJson(issue.suggestion))}</pre>
        <p><strong>Evidence:</strong></p>
        <pre>${escapeHtml(safeJson(issue.evidence))}</pre>
      </details>`
    )
    .join('\n');

  const interactionRows = result.interactionTests
    .map(
      (test) => `<tr>
        <td>${escapeHtml(test.id)}</td>
        <td>${escapeHtml(test.kind)}</td>
        <td>${escapeHtml(test.status)}</td>
        <td>${escapeHtml(test.target)}</td>
        <td>${escapeHtml(test.issue ?? '-')}</td>
      </tr>`
    )
    .join('\n');

  const journeyRows = result.journeyTests
    .map(
      (journey) => `<tr>
        <td>${escapeHtml(journey.id)}</td>
        <td>${escapeHtml(journey.name)}</td>
        <td>${escapeHtml(journey.status)}</td>
        <td>${journey.steps.length}</td>
        <td>${escapeHtml(journey.finalUrl ?? '-')}</td>
        <td>${escapeHtml(journey.issue ?? '-')}</td>
      </tr>`
    )
    .join('\n');

  const contractRows = result.apiContract.endpoints
    .slice(0, 50)
    .map((endpoint) => `<tr><td>${escapeHtml(endpoint.method)}</td><td>${escapeHtml(endpoint.path)}</td><td>${endpoint.requestCount}</td><td>${escapeHtml(endpoint.statusCodes.join(', ') || '-')}</td><td>${endpoint.issues.length}</td></tr>`)
    .join('\n');

  const realtimeRows = result.realtime.graphql
    .slice(0, 50)
    .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.operationType)}</td><td>${escapeHtml(item.operationName ?? '-')}</td><td>${item.status ?? '-'}</td><td>${item.hasErrors ? 'yes' : 'no'}</td><td>${escapeHtml(item.networkRequestId)}</td></tr>`)
    .join('\n');

  const p2BudgetRows = result.p2.budgets.map((item) => `<tr><td>${escapeHtml(item.metric)}</td><td>${item.actual}${escapeHtml(item.unit)}</td><td>${item.budget}${escapeHtml(item.unit)}</td><td>${escapeHtml(item.status)}</td></tr>`).join('\n');

  const fixTaskRows = result.fixTasks
    .slice(0, 80)
    .map((task) => `<tr><td>${escapeHtml(task.id)}</td><td>${escapeHtml(task.priority)}</td><td>${escapeHtml(task.owner)}</td><td>${escapeHtml(task.type)}</td><td>${escapeHtml(task.title)}</td><td>${escapeHtml(task.issueIds.join(', '))}</td></tr>`)
    .join('\n');

  const responsiveRows = result.responsiveChecks
    .map(
      (check) => `<tr>
        <td>${escapeHtml(check.name)}</td>
        <td>${check.width}x${check.height}</td>
        <td>${check.horizontalOverflow ? 'yes' : 'no'}</td>
        <td>${check.clippedInteractiveCount}</td>
        <td>${check.smallTapTargetCount}</td>
        <td>${check.tableOverflowCount}</td>
        <td>${check.screenshot ? `<a href="${escapeHtml(path.relative(result.artifacts.outputDir, check.screenshot))}">screenshot</a>` : '-'}</td>
      </tr>`
    )
    .join('\n');

  const accessibilityRows = result.accessibilityChecks
    .map(
      (check) => `<tr>
        <td>${escapeHtml(check.id)}</td>
        <td>${escapeHtml(check.rule)}</td>
        <td>${escapeHtml(check.status)}</td>
        <td>${escapeHtml(check.severity)}</td>
        <td>${check.count}</td>
        <td>${escapeHtml(check.title)}</td>
      </tr>`
    )
    .join('\n');

  const permissionRows = result.permissionChecks
    .map(
      (check) => `<tr>
        <td>${escapeHtml(check.id)}</td>
        <td>${escapeHtml(check.rule)}</td>
        <td>${escapeHtml(check.status)}</td>
        <td>${escapeHtml(check.severity)}</td>
        <td>${check.count}</td>
        <td>${escapeHtml(check.title)}</td>
      </tr>`
    )
    .join('\n');

  const securityRows = result.security.checks
    .filter((check) => check.status === 'failed' || check.status === 'warning')
    .map(
      (check) => `<tr>
        <td>${escapeHtml(check.id)}</td>
        <td>${escapeHtml(check.category)}</td>
        <td>${escapeHtml(check.status)}</td>
        <td>${escapeHtml(check.severity)}</td>
        <td>${escapeHtml(check.title)}</td>
        <td><pre>${escapeHtml(safeJson(check.evidence))}</pre></td>
      </tr>`
    )
    .join('\n');

  const exceptionRows = result.exceptionSimulations
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.id)}</td>
        <td>${escapeHtml(item.kind)}</td>
        <td>${escapeHtml(item.status)}</td>
        <td>${escapeHtml(item.target ?? '-')}</td>
        <td>${escapeHtml(item.issue ?? '-')}</td>
      </tr>`
    )
    .join('\n');

  const coverageRows = result.coverage.topUnused
    .slice(0, 20)
    .map(
      (entry) => `<tr>
        <td>${escapeHtml(entry.type.toUpperCase())}</td>
        <td>${Math.round(entry.totalBytes / 1024)} KB</td>
        <td>${Math.round(entry.unusedBytes / 1024)} KB</td>
        <td>${entry.unusedPercent}%</td>
        <td>${escapeHtml(entry.url)}</td>
      </tr>`
    )
    .join('\n');

  const aiSuggestions = result.aiAnalysis.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
  const qualityGateRows = [
    ...result.qualityGate.reasons.map((item) => `<tr><td>reason</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.qualityGate.coverageGaps.map((item) => `<tr><td>coverage-gap</td><td>${escapeHtml(item)}</td></tr>`)
  ].join('\n');
  const phaseErrorRows = result.metadata.phaseErrors
    .map((item) => `<tr><td>${escapeHtml(item.phase)}</td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.timestamp)}</td></tr>`)
    .join('\n');
  const artifactRows = Object.entries(result.artifacts)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(Array.isArray(value) ? value.join(', ') : String(value ?? '-'))}</td></tr>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FrontLens QA Report</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #101828; }
      main { max-width: 1180px; margin: 0 auto; padding: 32px; }
      section { background: white; border: 1px solid #eaecf0; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 2px #1018280d; }
      h1, h2 { margin-top: 0; }
      .score { font-size: 40px; font-weight: 700; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .metric { background: #f9fafb; border-radius: 10px; padding: 12px; }
      .metric strong { display: block; font-size: 22px; }
      table { width: 100%; border-collapse: collapse; font-size: 14px; }
      th, td { border-bottom: 1px solid #eaecf0; padding: 8px; text-align: left; vertical-align: top; }
      th { color: #475467; background: #f9fafb; }
      .badge { color: white; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
      pre { background: #101828; color: #f2f4f7; padding: 16px; border-radius: 10px; overflow: auto; }
      details.issue-detail { border: 1px solid #eaecf0; border-radius: 10px; padding: 12px; margin: 10px 0; }
      details.issue-detail summary { cursor: pointer; font-weight: 600; }
      a { color: #175cd3; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>FrontLens QA Report</h1>
        <div class="score">${result.summary.score}/100</div>
        <p>${escapeHtml(result.summary.url)}</p>
        <div class="grid">
          <div class="metric"><span>Issues</span><strong>${result.summary.issueCount}</strong></div>
          <div class="metric"><span>Critical</span><strong>${result.summary.criticalCount}</strong></div>
          <div class="metric"><span>High</span><strong>${result.summary.highCount}</strong></div>
          <div class="metric"><span>Medium</span><strong>${result.summary.mediumCount}</strong></div>
          <div class="metric"><span>Low</span><strong>${result.summary.lowCount}</strong></div>
          <div class="metric"><span>Security</span><strong>${result.security.score}/100</strong></div>
          <div class="metric"><span>Fix Tasks</span><strong>${result.fixTasks.length}</strong></div>
          <div class="metric"><span>QA Gate</span><strong>${escapeHtml(result.qualityGate.status)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.qualityGate.confidence)}</strong></div>
          <div class="metric"><span>Phase errors</span><strong>${result.metadata.phaseErrors.length}</strong></div>
        </div>
      </section>

      <section>
        <h2>QA Gate / 专业验收结论</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.qualityGate.status)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.qualityGate.confidence)}</strong></div>
          <div class="metric"><span>Actionable</span><strong>${result.qualityGate.actionableIssueCount}</strong></div>
          <div class="metric"><span>Reference</span><strong>${result.qualityGate.referenceIssueCount}</strong></div>
          <div class="metric"><span>Blockers</span><strong>${result.qualityGate.blockingIssueCount}</strong></div>
          <div class="metric"><span>Coverage gaps</span><strong>${result.qualityGate.coverageGapCount}</strong></div>
        </div>
        <p>${escapeHtml(result.qualityGate.summary)}</p>
        <table>
          <thead><tr><th>Type</th><th>Reason / Gap</th></tr></thead>
          <tbody>${qualityGateRows || '<tr><td colspan="2">No quality gate notes</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>页面结构</h2>
        <pre>${escapeHtml(result.pageModel.structureTree)}</pre>
      </section>

      <section>
        <h2>采集阶段异常</h2>
        <table>
          <thead><tr><th>Phase</th><th>Message</th><th>Time</th></tr></thead>
          <tbody>${phaseErrorRows || '<tr><td colspan="3">No phase errors</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>问题列表</h2>
        <table>
          <thead><tr><th>ID</th><th>Severity</th><th>Category</th><th>Title</th><th>Confidence</th><th>Priority</th></tr></thead>
          <tbody>${issueRows || '<tr><td colspan="6">No issues</td></tr>'}</tbody>
        </table>
        <h3>问题详情</h3>
        ${issueDetails || '<p>No issue details</p>'}
      </section>

      <section>
        <h2>安全交互测试</h2>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Status</th><th>Target</th><th>Issue</th></tr></thead>
          <tbody>${interactionRows || '<tr><td colspan="5">No interaction tests</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>用户旅程测试</h2>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Steps</th><th>Final URL</th><th>Issue</th></tr></thead>
          <tbody>${journeyRows || '<tr><td colspan="6">No journey tests</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>API Contract / Realtime</h2>
        <div class="grid">
          <div class="metric"><span>Endpoints</span><strong>${result.apiContract.summary.endpointCount}</strong></div>
          <div class="metric"><span>Contract findings</span><strong>${result.apiContract.summary.undocumentedCount + result.apiContract.summary.statusMismatchCount + result.apiContract.summary.schemaMismatchCount}</strong></div>
          <div class="metric"><span>GraphQL</span><strong>${result.realtime.summary.graphqlOperationCount}</strong></div>
          <div class="metric"><span>WebSocket</span><strong>${result.realtime.summary.webSocketCount}</strong></div>
          <div class="metric"><span>SSE</span><strong>${result.realtime.summary.sseCount}</strong></div>
        </div>
        <h3>API endpoints</h3>
        <table><thead><tr><th>Method</th><th>Path</th><th>Requests</th><th>Status</th><th>Findings</th></tr></thead><tbody>${contractRows || '<tr><td colspan="5">No API endpoints</td></tr>'}</tbody></table>
        <h3>GraphQL operations</h3>
        <table><thead><tr><th>ID</th><th>Type</th><th>Operation</th><th>Status</th><th>Errors</th><th>Request</th></tr></thead><tbody>${realtimeRows || '<tr><td colspan="6">No GraphQL operations</td></tr>'}</tbody></table>
      </section>

      <section>
        <h2>响应式测试</h2>
        <table>
          <thead><tr><th>Name</th><th>Size</th><th>Overflow</th><th>Clipped</th><th>Small targets</th><th>Table overflow</th><th>Screenshot</th></tr></thead>
          <tbody>${responsiveRows || '<tr><td colspan="7">No responsive checks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Accessibility</h2>
        <table>
          <thead><tr><th>ID</th><th>Rule</th><th>Status</th><th>Severity</th><th>Count</th><th>Title</th></tr></thead>
          <tbody>${accessibilityRows || '<tr><td colspan="6">No accessibility checks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>权限测试</h2>
        <table>
          <thead><tr><th>ID</th><th>Rule</th><th>Status</th><th>Severity</th><th>Count</th><th>Title</th></tr></thead>
          <tbody>${permissionRows || '<tr><td colspan="6">No permission checks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>安全扫描</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.security.status)}</strong></div>
          <div class="metric"><span>Score</span><strong>${result.security.score}/100</strong></div>
          <div class="metric"><span>Failed</span><strong>${result.security.summary.failedCount}</strong></div>
          <div class="metric"><span>Warnings</span><strong>${result.security.summary.warningCount}</strong></div>
          <div class="metric"><span>Checks</span><strong>${result.security.summary.checkCount}</strong></div>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Category</th><th>Status</th><th>Severity</th><th>Title</th><th>Evidence</th></tr></thead>
          <tbody>${securityRows || '<tr><td colspan="6">No failed or warning security checks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>异常模拟测试</h2>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Status</th><th>Target</th><th>Issue</th></tr></thead>
          <tbody>${exceptionRows || '<tr><td colspan="5">No exception simulations</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Performance</h2>
        <div class="grid">
          <div class="metric"><span>FCP</span><strong>${result.performance.paint.firstContentfulPaintMs ?? '-'} ms</strong></div>
          <div class="metric"><span>Load</span><strong>${result.performance.navigation?.loadMs ?? '-'} ms</strong></div>
          <div class="metric"><span>Long Tasks</span><strong>${result.performance.longTasks.count}</strong></div>
          <div class="metric"><span>CLS</span><strong>${result.performance.layoutShift.score}</strong></div>
          <div class="metric"><span>Transfer</span><strong>${Math.round(result.performance.resources.totalTransferSize / 1024)} KB</strong></div>
          <div class="metric"><span>DOM Nodes</span><strong>${result.performance.dom.nodeCount}</strong></div>
        </div>
      </section>

      <section>
        <h2>P2 测试增强</h2>
        <div class="grid">
          <div class="metric"><span>Visual</span><strong>${escapeHtml(result.p2.visual.status)}</strong></div>
          <div class="metric"><span>Budgets</span><strong>${result.p2.budgets.length}</strong></div>
          <div class="metric"><span>Network profiles</span><strong>${result.p2.networkProfiles.length}</strong></div>
        </div>
        <p>${escapeHtml(result.p2.visual.message ?? '')}</p>
        <table>
          <thead><tr><th>Metric</th><th>Actual</th><th>Budget</th><th>Status</th></tr></thead>
          <tbody>${p2BudgetRows || '<tr><td colspan="4">No budgets</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Chromium Coverage / 未使用资源</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.coverage.status)}</strong></div>
          <div class="metric"><span>JS unused</span><strong>${result.coverage.totals.js.unusedPercent}%</strong></div>
          <div class="metric"><span>CSS unused</span><strong>${result.coverage.totals.css.unusedPercent}%</strong></div>
          <div class="metric"><span>All unused</span><strong>${result.coverage.totals.all.unusedPercent}%</strong></div>
        </div>
        <p>${escapeHtml(result.coverage.message ?? '')}</p>
        <table>
          <thead><tr><th>Type</th><th>Total</th><th>Unused</th><th>Unused%</th><th>URL</th></tr></thead>
          <tbody>${coverageRows || '<tr><td colspan="5">No coverage offenders</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>AI 综合分析</h2>
        <p><strong>${escapeHtml(result.aiAnalysis.status)}</strong> / ${escapeHtml(result.aiAnalysis.provider)}</p>
        <p>${escapeHtml(result.aiAnalysis.summary ?? result.aiAnalysis.error ?? 'AI analysis disabled.')}</p>
        <ul>${aiSuggestions || '<li>No AI suggestions</li>'}</ul>
      </section>

      <section>
        <h2>机器可执行 Fix Tasks</h2>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Owner</th><th>Type</th><th>Title</th><th>Issues</th></tr></thead>
          <tbody>${fixTaskRows || '<tr><td colspan="6">No fix tasks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Artifact Index</h2>
        <table>
          <thead><tr><th>Name</th><th>Path / Value</th></tr></thead>
          <tbody>${artifactRows || '<tr><td colspan="2">No artifacts</td></tr>'}</tbody>
        </table>
      </section>
    </main>
  </body>
</html>`;

  await writeText(outputPath, html);
}
