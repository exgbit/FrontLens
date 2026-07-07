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

function truncateText(value: string, max = 180): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
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
      (test) => {
        const content = test.observations.downloadContent;
        const contentSummary = content ? `, ${content.kind}/${content.parseStatus}${content.rowCount !== undefined ? `, rows ${content.rowCount}` : ''}${content.columnCount !== undefined ? `, cols ${content.columnCount}` : ''}` : '';
        const download = test.observations.downloadPath ? `<a href="${escapeHtml(path.relative(result.artifacts.outputDir, test.observations.downloadPath))}">${escapeHtml(test.observations.downloadSuggestedFilename ?? 'download')}</a> (${test.observations.downloadSizeBytes ?? 0} bytes${escapeHtml(contentSummary)})` : '-';
        return `<tr>
        <td>${escapeHtml(test.id)}</td>
        <td>${escapeHtml(test.kind)}</td>
        <td>${escapeHtml(test.status)}</td>
        <td>${escapeHtml(test.target)}</td>
        <td>${escapeHtml(test.issue ?? '-')}</td>
        <td>${download}</td>
      </tr>`;
      }
    )
    .join('\n');

  const journeyRows = result.journeyTests
    .map(
      (journey) => `<tr>
        <td>${escapeHtml(journey.id)}</td>
        <td>${escapeHtml(journey.name)}</td>
        <td>${escapeHtml(journey.status)}</td>
        <td>${escapeHtml(journey.source ?? 'configured')}</td>
        <td>${escapeHtml(journey.requirementIds?.join(',') || '-')}</td>
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

  const regressionPlanRows = result.regressionPlan.items
    .slice(0, 80)
    .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.title)}</td></tr>`)
    .join('\n');

  const professionalSummaryRows = [
    ...result.professionalSummary.mustFix,
    ...result.professionalSummary.shouldFix.slice(0, 20),
    ...result.professionalSummary.coverageGaps.slice(0, 10),
    ...result.professionalSummary.nonDefectObservations.slice(0, 10),
    ...result.professionalSummary.nextActions.slice(0, 10)
  ]
    .slice(0, 60)
    .map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.kind)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.action)}</td></tr>`)
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
  const qaSignoffRows = [
    ...result.qaSignoff.blockers.map((item) => `<tr><td>blocker</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.qaSignoff.risks.map((item) => `<tr><td>risk</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.qaSignoff.coverageGaps.map((item) => `<tr><td>gap</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.qaSignoff.requiredFollowups.map((item) => `<tr><td>follow-up</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.qaSignoff.evidence.map((item) => `<tr><td>evidence</td><td>${escapeHtml(item)}</td></tr>`)
  ].join('\n');
  const environmentRows = [
    ...result.environment.warnings.map((item) => `<tr><td>warning</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.environment.recommendations.map((item) => `<tr><td>recommendation</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.environment.evidence.map((item) => `<tr><td>evidence</td><td>${escapeHtml(item)}</td></tr>`)
  ].join('\n');
  const pageProfileRows = [
    ...result.pageProfile.caveats.map((item) => `<tr><td>caveat</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.pageProfile.questions.map((item) => `<tr><td>question</td><td>${escapeHtml(item)}</td></tr>`),
    ...result.pageProfile.signals.map((item) => `<tr><td>signal</td><td>${escapeHtml(item)}</td></tr>`)
  ].join('\n');
  const rootCauseRows = result.rootCauseGroups
    .slice(0, 80)
    .map((group) => {
      const evidence = [
        group.issueIds.length ? `issues:${group.issueIds.join(',')}` : '',
        group.networkRequestIds.length ? `network:${group.networkRequestIds.slice(0, 5).join(',')}` : '',
        group.consoleIds.length ? `console:${group.consoleIds.slice(0, 5).join(',')}` : '',
        group.pageErrorIds.length ? `pageError:${group.pageErrorIds.slice(0, 5).join(',')}` : '',
        group.selectors.length ? `selector:${truncateText(group.selectors.slice(0, 3).join(' / '), 120)}` : ''
      ].filter(Boolean).join('; ') || '-';
      return `<tr><td>${escapeHtml(group.id)}</td><td>${escapeHtml(group.priority)}</td><td>${issueBadge(group.severity)}</td><td>${escapeHtml(group.status)}</td><td>${escapeHtml(group.owner)}</td><td>${escapeHtml(group.title)}</td><td>${group.issueCount}</td><td>${escapeHtml(truncateText(evidence, 180))}</td><td>${escapeHtml(truncateText(group.suggestedFix, 220))}</td></tr>`;
    })
    .join('\n');
  const dispositionRows = result.issueDisposition.items
    .slice(0, 100)
    .map((item) => `<tr><td>${escapeHtml(item.issueId)}</td><td>${escapeHtml(item.actionability)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.bucket)}</td><td>${escapeHtml(item.owner)}</td><td>${escapeHtml(item.evidenceStrength)}</td><td>${escapeHtml(truncateText(item.reason, 220))}</td><td>${escapeHtml(truncateText(item.nextStep, 220))}</td></tr>`)
    .join('\n');
  const requirementRows = result.requirementCoverage.items
    .map((item) => {
      const evidence = [
        item.evidence.journeyIds.length ? `journey:${item.evidence.journeyIds.join(',')}` : '',
        item.evidence.interactionTestIds.length ? `interaction:${item.evidence.interactionTestIds.join(',')}` : '',
        item.evidence.networkRequestIds.length ? `network:${item.evidence.networkRequestIds.slice(0, 5).join(',')}` : '',
        item.evidence.selectors.length ? `selector:${item.evidence.selectors.slice(0, 3).join(',')}` : ''
      ].filter(Boolean).join(' / ') || '-';
      return `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.priority)}</td><td>${escapeHtml(item.source)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.confidence)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(evidence)}</td><td>${escapeHtml(item.gaps.join('；') || '-')}</td></tr>`;
    })
    .join('\n');
  const sourceFindingRows = result.sourceAnalysis.findings
    .slice(0, 50)
    .map((finding) => {
      const locations = finding.locations.slice(0, 4).map((location) => `${location.file}:${location.line}`).join(', ');
      return `<tr><td>${escapeHtml(finding.id)}</td><td>${escapeHtml(finding.kind)}</td><td>${issueBadge(finding.severity)}</td><td>${escapeHtml(finding.title)}</td><td>${escapeHtml(locations || '-')}</td></tr>`;
    })
    .join('\n');
  const sourceRuntimeRows = result.sourceRuntimeCorrelation.links
    .slice(0, 50)
    .map((link) => {
      const sourceMatches = link.sourceMatches.slice(0, 3).map((match) => `${match.file}:${match.line}${match.path ? ` ${match.path}` : ''}`).join('；') || '-';
      const listHints = link.responseListHints.slice(0, 3).map((hint) => `${hint.path}(${hint.length})`).join('；') || '-';
      return `<tr><td>${escapeHtml(link.id)}</td><td>${escapeHtml(`${link.method} ${truncateText(link.path, 90)}`)}</td><td>${escapeHtml(String(link.status ?? '-'))}</td><td>${escapeHtml(link.confidence)}</td><td>${escapeHtml(sourceMatches)}</td><td>${escapeHtml(link.componentIds.slice(0, 5).join(', ') || '-')}</td><td>${escapeHtml(listHints)}</td></tr>`;
    })
    .join('\n');
  const sourceHealthRows = result.sourceHealth.findings
    .slice(0, 50)
    .map((finding) => `<tr><td>${escapeHtml(finding.id)}</td><td>${issueBadge(finding.severity)}</td><td>${escapeHtml(`${finding.file}:${finding.line ?? '-'}:${finding.column ?? '-'}`)}</td><td>${escapeHtml(finding.message)}</td></tr>`)
    .join('\n');
  const sourceHealthScriptRows = result.sourceHealth.packageScripts
    .slice(0, 50)
    .map((script) => `<tr><td>${escapeHtml(script.name)}</td><td>${escapeHtml(script.category)}</td><td><code>${escapeHtml(script.command)}</code></td></tr>`)
    .join('\n');
  const sourceHealthCheckRows = result.sourceHealth.scriptChecks
    .slice(0, 50)
    .map((check) => `<tr><td>${escapeHtml(check.id)}</td><td>${escapeHtml(check.scriptName)}</td><td>${escapeHtml(check.category)}</td><td>${escapeHtml(check.status)}</td><td>${check.durationMs}</td><td>${escapeHtml(String(check.exitCode ?? '-'))}</td><td>${escapeHtml((check.error ?? check.stderrPreview ?? check.stdoutPreview ?? '-').slice(0, 240))}</td></tr>`)
    .join('\n');
  const failedSourceScriptChecks = result.sourceHealth.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out').length;
  const phaseErrorRows = result.metadata.phaseErrors
    .map((item) => `<tr><td>${escapeHtml(item.phase)}</td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.timestamp)}</td></tr>`)
    .join('\n');
  const artifactRows = Object.entries(result.artifacts)
    .map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(Array.isArray(value) ? value.join(', ') : String(value ?? '-'))}</td></tr>`)
    .join('\n');
  const artifactIntegrityRows = result.artifactIntegrity.missing
    .slice(0, 50)
    .map((entry) => `<tr><td>${escapeHtml(entry.source)}</td><td>${escapeHtml(entry.kind)}</td><td>${escapeHtml(entry.path)}</td><td>${escapeHtml(entry.issueId ?? '-')}</td><td>${escapeHtml(entry.message ?? '-')}</td></tr>`)
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
          <div class="metric"><span>Root Causes</span><strong>${result.rootCauseGroups.filter((group) => group.status === 'actionable').length}/${result.rootCauseGroups.length}</strong></div>
          <div class="metric"><span>Disposition</span><strong>${result.issueDisposition.summary.actionableCount}/${result.issueDisposition.summary.conditionalCount}/${result.issueDisposition.summary.nonActionableCount}</strong></div>
          <div class="metric"><span>Fix Tasks</span><strong>${result.fixTasks.length}</strong></div>
          <div class="metric"><span>Professional</span><strong>${escapeHtml(result.professionalSummary.status)} / ${result.professionalSummary.mustFix.length}</strong></div>
          <div class="metric"><span>Regression</span><strong>${escapeHtml(result.regressionPlan.status)} / ${result.regressionPlan.summary.itemCount}</strong></div>
          <div class="metric"><span>QA Gate</span><strong>${escapeHtml(result.qualityGate.status)}</strong></div>
          <div class="metric"><span>QA Sign-off</span><strong>${escapeHtml(result.qaSignoff.status)}</strong></div>
          <div class="metric"><span>Environment</span><strong>${escapeHtml(result.environment.kind)}</strong></div>
          <div class="metric"><span>Page Profile</span><strong>${escapeHtml(result.pageProfile.pageType)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.qualityGate.confidence)}</strong></div>
          <div class="metric"><span>Artifacts</span><strong>${escapeHtml(result.artifactIntegrity.status)}</strong></div>
          <div class="metric"><span>Source</span><strong>${escapeHtml(result.sourceAnalysis.status)}</strong></div>
          <div class="metric"><span>Source × Runtime</span><strong>${escapeHtml(result.sourceRuntimeCorrelation.status)}</strong></div>
          <div class="metric"><span>Source Health</span><strong>${escapeHtml(result.sourceHealth.status)}</strong></div>
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
        <h2>QA Sign-off / 专业测试签核</h2>
        <p>${escapeHtml(result.qaSignoff.summary)}</p>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.qaSignoff.status)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.qaSignoff.confidence)}</strong></div>
          <div class="metric"><span>Business validation</span><strong>${escapeHtml(result.qaSignoff.businessValidationConfidence)}</strong></div>
          <div class="metric"><span>Provided reqs</span><strong>${result.qaSignoff.scope.providedRequirementCount}</strong></div>
          <div class="metric"><span>Journeys</span><strong>${result.qaSignoff.scope.passedJourneyCount}/${result.qaSignoff.scope.journeyCount}</strong></div>
          <div class="metric"><span>Interactions</span><strong>${result.qaSignoff.scope.passedInteractionCount}/${result.qaSignoff.scope.interactionCount}</strong></div>
          <div class="metric"><span>Auth</span><strong>${String(result.qaSignoff.scope.authStateProvided)}</strong></div>
          <div class="metric"><span>Environment</span><strong>${escapeHtml(result.qaSignoff.scope.environmentKind)}</strong></div>
          <div class="metric"><span>Page profile</span><strong>${escapeHtml(result.qaSignoff.scope.pageProfileStatus)} / ${escapeHtml(result.qaSignoff.scope.pageProfileType)}</strong></div>
          <div class="metric"><span>Source health</span><strong>${escapeHtml(result.qaSignoff.scope.sourceHealthStatus)}</strong></div>
        </div>
        <table>
          <thead><tr><th>Type</th><th>Note</th></tr></thead>
          <tbody>${qaSignoffRows || '<tr><td colspan="2">No QA sign-off notes</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Environment Assessment / 测试环境可信度</h2>
        <div class="grid">
          <div class="metric"><span>Kind</span><strong>${escapeHtml(result.environment.kind)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.environment.confidence)}</strong></div>
          <div class="metric"><span>Functional trust</span><strong>${escapeHtml(result.environment.trust.functional)}</strong></div>
          <div class="metric"><span>Performance trust</span><strong>${escapeHtml(result.environment.trust.performance)}</strong></div>
          <div class="metric"><span>Security trust</span><strong>${escapeHtml(result.environment.trust.security)}</strong></div>
          <div class="metric"><span>Vite dev</span><strong>${String(result.environment.isViteDevServer)}</strong></div>
          <div class="metric"><span>Dev modules</span><strong>${result.environment.devModuleRequestCount}</strong></div>
          <div class="metric"><span>Hashed assets</span><strong>${result.environment.hashedAssetCount}</strong></div>
        </div>
        <table>
          <thead><tr><th>Type</th><th>Note</th></tr></thead>
          <tbody>${environmentRows || '<tr><td colspan="2">No environment caveats</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Page Profile / 产品范围画像</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.pageProfile.status)}</strong></div>
          <div class="metric"><span>Source</span><strong>${escapeHtml(result.pageProfile.source)}</strong></div>
          <div class="metric"><span>Type</span><strong>${escapeHtml(result.pageProfile.pageType)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.pageProfile.confidence)}</strong></div>
          <div class="metric"><span>Device</span><strong>${escapeHtml(result.pageProfile.suggestedProductContext.deviceScope ?? '-')}</strong></div>
          <div class="metric"><span>A11y</span><strong>${escapeHtml(result.pageProfile.suggestedProductContext.accessibilityTarget ?? '-')}</strong></div>
          <div class="metric"><span>Required</span><strong>${result.pageProfile.suggestedProductContext.requiredFeatures.length}</strong></div>
          <div class="metric"><span>Optional</span><strong>${result.pageProfile.suggestedProductContext.optionalFeatures.length}</strong></div>
        </div>
        <table>
          <thead><tr><th>Type</th><th>Note</th></tr></thead>
          <tbody>${pageProfileRows || '<tr><td colspan="2">No page-profile prompts</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Root Cause Groups / 根因归并</h2>
        <p>Raw issue 数不等于修复工作量。本节按实现根因归并，优先看这里再看原始问题详情。</p>
        <div class="grid">
          <div class="metric"><span>Total</span><strong>${result.rootCauseGroups.length}</strong></div>
          <div class="metric"><span>Actionable</span><strong>${result.rootCauseGroups.filter((group) => group.status === 'actionable').length}</strong></div>
          <div class="metric"><span>Reference</span><strong>${result.rootCauseGroups.filter((group) => group.status === 'reference').length}</strong></div>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Severity</th><th>Status</th><th>Owner</th><th>Root cause</th><th>Raw issues</th><th>Evidence</th><th>Suggested fix</th></tr></thead>
          <tbody>${rootCauseRows || '<tr><td colspan="9">No root-cause groups</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Raw Finding Disposition / 原始问题处置</h2>
        <p>本节把 raw issue 分为可执行缺陷、需确认项和非缺陷，避免把扫描器噪音、产品取舍或部署项混入核心修复列表。</p>
        <div class="grid">
          <div class="metric"><span>Actionable</span><strong>${result.issueDisposition.summary.actionableCount}</strong></div>
          <div class="metric"><span>Conditional</span><strong>${result.issueDisposition.summary.conditionalCount}</strong></div>
          <div class="metric"><span>Non-actionable</span><strong>${result.issueDisposition.summary.nonActionableCount}</strong></div>
          <div class="metric"><span>Confirmed</span><strong>${result.issueDisposition.summary.confirmedCount}</strong></div>
          <div class="metric"><span>Product</span><strong>${result.issueDisposition.summary.productDecisionCount}</strong></div>
          <div class="metric"><span>Tool limitation</span><strong>${result.issueDisposition.summary.toolLimitationCount}</strong></div>
        </div>
        <table>
          <thead><tr><th>Issue</th><th>Actionability</th><th>Status</th><th>Bucket</th><th>Owner</th><th>Evidence</th><th>Reason</th><th>Next step</th></tr></thead>
          <tbody>${dispositionRows || '<tr><td colspan="8">No disposition items</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Requirement Coverage / 需求覆盖矩阵</h2>
        <div class="grid">
          <div class="metric"><span>Source</span><strong>${escapeHtml(result.requirementCoverage.source)}</strong></div>
          <div class="metric"><span>Passed / Total</span><strong>${result.requirementCoverage.summary.passedCount}/${result.requirementCoverage.summary.requirementCount}</strong></div>
          <div class="metric"><span>Failed</span><strong>${result.requirementCoverage.summary.failedCount}</strong></div>
          <div class="metric"><span>Partial</span><strong>${result.requirementCoverage.summary.partialCount}</strong></div>
          <div class="metric"><span>Not covered</span><strong>${result.requirementCoverage.summary.notCoveredCount}</strong></div>
          <div class="metric"><span>P0/P1 gaps</span><strong>${result.requirementCoverage.summary.highPriorityGapCount}</strong></div>
        </div>
        <p>${escapeHtml(result.requirementCoverage.gaps.join(' ') || 'No requirement coverage gaps')}</p>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Source</th><th>Status</th><th>Confidence</th><th>Requirement</th><th>Evidence</th><th>Gaps</th></tr></thead>
          <tbody>${requirementRows || '<tr><td colspan="8">No requirements collected</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Source Analysis / 源码索引</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.sourceAnalysis.status)}</strong></div>
          <div class="metric"><span>Files</span><strong>${result.sourceAnalysis.scannedFiles}</strong></div>
          <div class="metric"><span>Routes</span><strong>${result.sourceAnalysis.summary.routeCount}</strong></div>
          <div class="metric"><span>Eager routes</span><strong>${result.sourceAnalysis.summary.eagerRouteImportCount}</strong></div>
          <div class="metric"><span>Heavy imports</span><strong>${result.sourceAnalysis.summary.heavyImportCount}</strong></div>
          <div class="metric"><span>API calls</span><strong>${result.sourceAnalysis.summary.apiCallCount}</strong></div>
        </div>
        <p>${escapeHtml(result.sourceAnalysis.root ?? result.sourceAnalysis.error ?? 'No source root')}</p>
        <table>
          <thead><tr><th>ID</th><th>Kind</th><th>Severity</th><th>Title</th><th>Locations</th></tr></thead>
          <tbody>${sourceFindingRows || '<tr><td colspan="5">No source findings</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Source × Runtime Correlation / 源码×运行时绑定</h2>
        <p>用于过滤“全局 Network 有数据但页面为空”一类发散结论；未绑定到源码 API/UI/状态信号的响应不会直接作为可执行前端缺陷。</p>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.sourceRuntimeCorrelation.status)}</strong></div>
          <div class="metric"><span>Runtime API</span><strong>${result.sourceRuntimeCorrelation.summary.networkRequestCount}</strong></div>
          <div class="metric"><span>Linked</span><strong>${result.sourceRuntimeCorrelation.summary.linkedRequestCount}</strong></div>
          <div class="metric"><span>Strong</span><strong>${result.sourceRuntimeCorrelation.summary.strongLinkCount}</strong></div>
          <div class="metric"><span>Unlinked</span><strong>${result.sourceRuntimeCorrelation.summary.unlinkedRequestCount}</strong></div>
          <div class="metric"><span>List responses</span><strong>${result.sourceRuntimeCorrelation.summary.listResponseLinkCount}</strong></div>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Network</th><th>Status</th><th>Confidence</th><th>Source matches</th><th>Components</th><th>List hints</th></tr></thead>
          <tbody>${sourceRuntimeRows || '<tr><td colspan="7">No source/runtime links</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Source Health / 源码健康</h2>
        <p>源码静态健康检查会识别 package scripts，并对 TS/JS/Vue script 做语法解析；语法错误是构建/发布前置阻断，不代表业务功能已完成验收。</p>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.sourceHealth.status)}</strong></div>
          <div class="metric"><span>Package manager</span><strong>${escapeHtml(result.sourceHealth.packageManager ?? '-')}</strong></div>
          <div class="metric"><span>Scanned</span><strong>${result.sourceHealth.scannedFiles}</strong></div>
          <div class="metric"><span>Parsed</span><strong>${result.sourceHealth.parsedFiles}</strong></div>
          <div class="metric"><span>Skipped</span><strong>${result.sourceHealth.skippedFiles}</strong></div>
          <div class="metric"><span>Syntax errors</span><strong>${result.sourceHealth.syntaxErrorCount}</strong></div>
          <div class="metric"><span>Script checks</span><strong>${result.sourceHealth.scriptChecks.length} / ${failedSourceScriptChecks} failed</strong></div>
        </div>
        <h3>package.json scripts</h3>
        <table>
          <thead><tr><th>Script</th><th>Category</th><th>Command</th></tr></thead>
          <tbody>${sourceHealthScriptRows || '<tr><td colspan="3">No package scripts detected</td></tr>'}</tbody>
        </table>
        <h3>Script checks</h3>
        <table>
          <thead><tr><th>ID</th><th>Script</th><th>Category</th><th>Status</th><th>Duration ms</th><th>Exit</th><th>Output/Error preview</th></tr></thead>
          <tbody>${sourceHealthCheckRows || '<tr><td colspan="7">No source script checks executed</td></tr>'}</tbody>
        </table>
        <h3>Syntax findings</h3>
        <table>
          <thead><tr><th>ID</th><th>Severity</th><th>Location</th><th>Message</th></tr></thead>
          <tbody>${sourceHealthRows || '<tr><td colspan="4">No source syntax findings</td></tr>'}</tbody>
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
          <thead><tr><th>ID</th><th>Kind</th><th>Status</th><th>Target</th><th>Issue</th><th>Download</th></tr></thead>
          <tbody>${interactionRows || '<tr><td colspan="6">No interaction tests</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>用户旅程测试</h2>
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Source</th><th>Requirements</th><th>Steps</th><th>Final URL</th><th>Issue</th></tr></thead>
          <tbody>${journeyRows || '<tr><td colspan="8">No journey tests</td></tr>'}</tbody>
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
        <p>
          Current: ${result.p2.visual.currentScreenshot ? `<a href="${escapeHtml(path.relative(result.artifacts.outputDir, result.p2.visual.currentScreenshot))}">current</a>` : '-'}
          / Baseline: ${result.p2.visual.baselinePath ? `<a href="${escapeHtml(path.relative(result.artifacts.outputDir, result.p2.visual.baselinePath))}">baseline</a>` : '-'}
          / Diff: ${result.p2.visual.diffScreenshot ? `<a href="${escapeHtml(path.relative(result.artifacts.outputDir, result.p2.visual.diffScreenshot))}">diff</a>` : '-'}
        </p>
        <p>Method: ${escapeHtml(result.p2.visual.diffMethod ?? '-')} / Ratio: ${result.p2.visual.diffRatio ?? '-'} / Changed: ${result.p2.visual.changedPixelCount ?? '-'} / ${result.p2.visual.totalPixelCount ?? '-'} / Size mismatch: ${String(result.p2.visual.sizeMismatch ?? '-')}</p>
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
        <h2>Professional Summary / 专业测试摘要</h2>
        <p>${escapeHtml(result.professionalSummary.headline)}</p>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.professionalSummary.status)}</strong></div>
          <div class="metric"><span>Confidence</span><strong>${escapeHtml(result.professionalSummary.confidence)}</strong></div>
          <div class="metric"><span>Must-fix</span><strong>${result.professionalSummary.mustFix.length}</strong></div>
          <div class="metric"><span>Non-defect</span><strong>${result.professionalSummary.nonDefectObservations.length}</strong></div>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Kind</th><th>Owner</th><th>Title</th><th>Action</th></tr></thead>
          <tbody>${professionalSummaryRows || '<tr><td colspan="6">No professional summary items</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>机器可执行 Fix Tasks</h2>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Owner</th><th>Type</th><th>Title</th><th>Issues</th></tr></thead>
          <tbody>${fixTaskRows || '<tr><td colspan="6">No fix tasks</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Regression Plan / 回归复测计划</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.regressionPlan.status)}</strong></div>
          <div class="metric"><span>Items</span><strong>${result.regressionPlan.summary.itemCount}</strong></div>
          <div class="metric"><span>Blocked</span><strong>${result.regressionPlan.summary.blockedCount}</strong></div>
          <div class="metric"><span>Needs input</span><strong>${result.regressionPlan.summary.needsInputCount}</strong></div>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Priority</th><th>Type</th><th>Status</th><th>Owner</th><th>Title</th></tr></thead>
          <tbody>${regressionPlanRows || '<tr><td colspan="6">No regression plan items</td></tr>'}</tbody>
        </table>
      </section>

      <section>
        <h2>Artifact Integrity / 证据路径完整性</h2>
        <div class="grid">
          <div class="metric"><span>Status</span><strong>${escapeHtml(result.artifactIntegrity.status)}</strong></div>
          <div class="metric"><span>Present</span><strong>${result.artifactIntegrity.presentCount}</strong></div>
          <div class="metric"><span>Missing</span><strong>${result.artifactIntegrity.missingCount}</strong></div>
          <div class="metric"><span>Skipped</span><strong>${result.artifactIntegrity.skippedCount}</strong></div>
        </div>
        <p>${escapeHtml(result.artifactIntegrity.summary)}</p>
        <table>
          <thead><tr><th>Source</th><th>Kind</th><th>Path</th><th>Issue</th><th>Message</th></tr></thead>
          <tbody>${artifactIntegrityRows || '<tr><td colspan="5">No missing local artifact paths</td></tr>'}</tbody>
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
