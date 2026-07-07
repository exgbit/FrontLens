import path from 'node:path';
import type { Issue, QaResult, Severity } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';
import { writeText } from '../utils/fs.js';
import { isActionableIssue } from '../qualityGate.js';
import { proofReadyRootCauseGroups } from '../proof/proofReadiness.js';
import { formatProfessionalBrief } from './briefReporter.js';
import { formatProfessionalAudit, runProfessionalAudit } from '../audit/professionalAudit.js';
import { buildProductContextSuggestion, formatProductContextSuggestion } from '../product/productContextSuggestion.js';
import { buildQaExecutionPlan, formatQaExecutionPlan } from '../plan/qaExecutionPlan.js';

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
  const rendered = reportArtifactPath(result.artifacts.outputDir, filePath);
  if (!rendered || !filePath || !result.artifactIntegrity.entries.length) return rendered;
  const renderedCandidates = new Set(
    [filePath, portablePath(filePath)]
      .map((item) => reportArtifactPath(result.artifacts.outputDir, item) ?? portablePath(item))
  );
  const entry = result.artifactIntegrity.entries.find((item) => {
    const candidates = [item.path, item.absolutePath].filter((value): value is string => Boolean(value));
    return candidates.some((candidate) => {
      const candidateRendered = reportArtifactPath(result.artifacts.outputDir, candidate) ?? portablePath(candidate);
      return renderedCandidates.has(candidateRendered) || portablePath(candidate) === portablePath(filePath);
    });
  });
  if (!entry) return rendered;
  if (!entry.expected || !entry.absolutePath) return `${rendered} (unchecked artifact)`;
  return entry.exists ? rendered : `${rendered} (missing artifact)`;
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

function formatRequirementCoverage(result: QaResult): string {
  const coverage = result.requirementCoverage;
  const rows = coverage.items.map((item) => {
    const evidence = [
      item.evidence.journeyIds.length ? `journey:${item.evidence.journeyIds.join(',')}` : '',
      item.evidence.interactionTestIds.length ? `interaction:${item.evidence.interactionTestIds.join(',')}` : '',
      item.evidence.networkRequestIds.length ? `network:${item.evidence.networkRequestIds.slice(0, 5).join(',')}` : '',
      item.evidence.selectors.length ? `selector:${item.evidence.selectors.slice(0, 3).join(',')}` : ''
    ].filter(Boolean).join(' / ') || '-';
    const gaps = item.gaps.length ? item.gaps.join('；') : '-';
    return `| ${markdownEscape(item.id)} | ${markdownEscape(item.priority)} | ${markdownEscape(item.source)} | ${markdownEscape(item.status)} | ${markdownEscape(item.confidence)} | ${markdownEscape(item.title)} | ${markdownEscape(truncateMiddle(evidence, 140))} | ${markdownEscape(truncateMiddle(gaps, 160))} |`;
  });
  const gapRows = coverage.gaps.map((gap) => `- ${markdownEscape(gap)}`).join('\n');
  return `## Requirement Coverage / 需求覆盖矩阵

- Enabled：${coverage.enabled}
- Source：${coverage.source}
- Passed / Total：${coverage.summary.passedCount} / ${coverage.summary.requirementCount}
- Failed / Partial / Not covered：${coverage.summary.failedCount} / ${coverage.summary.partialCount} / ${coverage.summary.notCoveredCount}
- Provided / Inferred：${coverage.summary.providedCount} / ${coverage.summary.inferredCount}
- P0/P1 gaps：${coverage.summary.highPriorityGapCount}

${gapRows || '未发现额外需求覆盖缺口。'}

${rows.length ? ['| ID | 优先级 | 来源 | 状态 | 置信度 | 需求/能力 | 证据 | 缺口 |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '未配置或未推断出需求项。'}
`;
}

function formatQualityGate(result: QaResult): string {
  const gate = result.qualityGate;
  const gapRows = gate.coverageGaps.map((gap) => `| coverage-gap | ${markdownEscape(gap)} |`);
  const reasonRows = gate.reasons.map((reason) => `| reason | ${markdownEscape(reason)} |`);
  const rows = [...reasonRows, ...gapRows];
  return `## QA Gate / 专业验收结论

- Status：**${gate.status}**
- Confidence：**${gate.confidence}**
- Summary：${markdownEscape(gate.summary)}
- 可执行问题 / 参考观察：${gate.actionableIssueCount} / ${gate.referenceIssueCount}
- 阻断问题 / Medium 风险 / 覆盖缺口：${gate.blockingIssueCount} / ${gate.mediumRiskCount} / ${gate.coverageGapCount}

${rows.length ? ['| 类型 | 说明 |', '| --- | --- |', ...rows, ''].join('\n') : '未发现额外覆盖缺口。'}
`;
}

function formatQaSignoff(result: QaResult): string {
  const signoff = result.qaSignoff;
  const rows = [
    ...signoff.blockers.map((item) => `| blocker | ${markdownEscape(item)} |`),
    ...signoff.risks.map((item) => `| risk | ${markdownEscape(item)} |`),
    ...signoff.coverageGaps.map((item) => `| gap | ${markdownEscape(item)} |`),
    ...signoff.requiredFollowups.map((item) => `| follow-up | ${markdownEscape(item)} |`),
    ...signoff.evidence.map((item) => `| evidence | ${markdownEscape(item)} |`)
  ];
  return `## QA Sign-off / 专业测试签核

- Status：**${signoff.status}**
- Confidence：**${signoff.confidence}**
- Business validation confidence：**${signoff.businessValidationConfidence}**
- Summary：${markdownEscape(signoff.summary)}
- Requirements provided / inferred：${signoff.scope.providedRequirementCount} / ${signoff.scope.inferredRequirementCount}
- Journeys passed / total：${signoff.scope.passedJourneyCount} / ${signoff.scope.journeyCount}
- Journey assertions passed / total：${signoff.scope.passedAssertionStepCount} / ${signoff.scope.assertionStepCount}
- Passed journeys with / without assertions：${signoff.scope.passedJourneyWithAssertionCount} / ${signoff.scope.passedJourneyWithoutAssertionCount}
- Interactions passed / total：${signoff.scope.passedInteractionCount} / ${signoff.scope.interactionCount}
- Auth state provided：${signoff.scope.authStateProvided}
- Destructive actions allowed：${signoff.scope.destructiveActionsAllowed}
- Environment：${signoff.scope.environmentKind} / ${signoff.scope.environmentConfidence}
- Page profile：${signoff.scope.pageProfileStatus} / ${signoff.scope.pageProfileType}
- Source health / artifacts：${signoff.scope.sourceHealthStatus} / ${signoff.scope.artifactIntegrityStatus}

${rows.length ? ['| 类型 | 说明 |', '| --- | --- |', ...rows, ''].join('\n') : '未发现额外签核说明。'}
`;
}

function formatProfessionalSummary(result: QaResult): string {
  const summary = result.professionalSummary;
  const toRows = (items: typeof summary.mustFix) =>
    items.map((item) => `| ${markdownEscape(item.id)} | ${item.priority} | ${item.kind} | ${item.owner} | ${markdownEscape(truncateMiddle(item.title, 100))} | ${markdownEscape(truncateMiddle(item.action, 150))} | ${markdownEscape(truncateMiddle(item.evidenceRefs.slice(0, 8).join(', ') || '-', 120))} |`);
  const rows = [
    ...toRows(summary.mustFix),
    ...toRows(summary.shouldFix.slice(0, Math.max(0, 12 - summary.mustFix.length))),
    ...toRows(summary.coverageGaps.slice(0, 8)),
    ...toRows(summary.nonDefectObservations.slice(0, 8)),
    ...toRows(summary.nextActions.slice(0, 8))
  ].slice(0, 32);
  return `## Professional Summary / 专业测试摘要

- Status：**${summary.status}**
- Confidence：**${summary.confidence}**
- Business validation：**${summary.businessValidationConfidence}**
- Headline：${markdownEscape(summary.headline)}
- Must-fix / Should-fix：${summary.mustFix.length} / ${summary.shouldFix.length}（proof-ready root causes ${summary.counts.proofReadyRootCauseCount}/${summary.counts.actionableRootCauseCount}）
- Defect proof needs-evidence / P0-P1 blocked：${summary.counts.defectProofNeedsEvidenceCount} / ${summary.counts.defectProofBlockedCount}
- Non-defect observations / Coverage gaps / Release risks：${summary.nonDefectObservations.length} / ${summary.coverageGaps.length} / ${summary.releaseRisks.length}
- Regression blocked / needs-input：${summary.counts.regressionBlockedCount} / ${summary.counts.regressionNeedsInputCount}

${rows.length ? ['| ID | Priority | Kind | Owner | Title | Action | Evidence |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前没有需要展示的专业摘要项。'}
`;
}

function formatEnvironmentAssessment(result: QaResult): string {
  const env = result.environment;
  const warningRows = env.warnings.map((item) => `| warning | ${markdownEscape(item)} |`);
  const recommendationRows = env.recommendations.map((item) => `| recommendation | ${markdownEscape(item)} |`);
  return `## Environment Assessment / 测试环境可信度

- Kind：${env.kind}
- Confidence：${env.confidence}
- Target / Final：${markdownEscape(env.targetUrl)} / ${markdownEscape(env.finalUrl ?? '-')}
- HTTPS / Local-private / Vite-dev / HMR：${env.isHttps} / ${env.isLocalOrPrivate} / ${env.isViteDevServer} / ${env.hasHmr}
- Same-origin requests / Dev modules / Hashed assets：${env.sameOriginRequestCount} / ${env.devModuleRequestCount} / ${env.hashedAssetCount}
- Trust（functional / performance / security / business）：${env.trust.functional} / ${env.trust.performance} / ${env.trust.security} / ${env.trust.businessSignoff}
- Evidence：${env.evidence.length ? markdownEscape(env.evidence.join('；')) : '-'}

${warningRows.length || recommendationRows.length ? ['| Type | Note |', '| --- | --- |', ...warningRows, ...recommendationRows, ''].join('\n') : '环境未发现额外降置信提示。'}
`;
}

function formatPageProfileAssessment(result: QaResult): string {
  const profile = result.pageProfile;
  const suggestion = profile.suggestedProductContext;
  const rows = [
    ...profile.caveats.map((item) => `| caveat | ${markdownEscape(item)} |`),
    ...profile.questions.map((item) => `| question | ${markdownEscape(item)} |`),
    ...profile.signals.map((item) => `| signal | ${markdownEscape(item)} |`)
  ];
  return `## Page Profile / 产品范围画像

- Status / Source：${profile.status} / ${profile.source}
- Type / Confidence：${profile.pageType} / ${profile.confidence}
- Configured pageType：${markdownEscape(profile.configuredPageType ?? '-')}
- Suggested device / a11y：${markdownEscape(suggestion.deviceScope ?? '-')} / ${markdownEscape(suggestion.accessibilityTarget ?? '-')}
- Suggested required：${suggestion.requiredFeatures.length ? markdownEscape(suggestion.requiredFeatures.join(', ')) : '-'}
- Suggested optional：${suggestion.optionalFeatures.length ? markdownEscape(suggestion.optionalFeatures.join(', ')) : '-'}
- Suggested out-of-scope：${suggestion.outOfScopeFeatures.length ? markdownEscape(suggestion.outOfScopeFeatures.join(', ')) : '-'}
- Suggested decisions：${suggestion.decisions.length ? markdownEscape(suggestion.decisions.map((item) => item.title).join('；')) : '-'}

${rows.length ? ['| Type | Note |', '| --- | --- |', ...rows, ''].join('\n') : '暂无页面画像提示。'}
`;
}

function formatScopeReview(result: QaResult): string {
  const scope = result.scopeReview;
  const questionRows = scope.questions.slice(0, 30).map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.category)} | ${markdownEscape(item.question)} | ${markdownEscape(truncateMiddle(item.impact, 160))} | ${markdownEscape(truncateMiddle(item.defaultDisposition, 140))} |`);
  const configJson = JSON.stringify(scope.configSnippet, null, 2).replace(/```/g, '`​``');
  return `## Scope Review / 产品范围确认

- Status：**${scope.status}**
- Confidence：${scope.confidence}
- Page type：${scope.pageType}
- Summary：${markdownEscape(scope.summary)}
- Notes：${scope.notes.length ? markdownEscape(scope.notes.join('；')) : '-'}

${questionRows.length ? ['| ID | Category | Question | Impact | Default disposition |', '| --- | --- | --- | --- | --- |', ...questionRows, ''].join('\n') : '产品范围已配置，当前没有待确认问题。'}

### Suggested productContext

\`\`\`json
${configJson}
\`\`\`
`;
}

function formatClaimGuard(result: QaResult): string {
  const guard = result.claimGuard;
  const rows = guard.items.map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.claim)} | ${markdownEscape(item.status)} | ${markdownEscape(item.confidence)} | ${markdownEscape(truncateMiddle(item.allowedWording, 120))} | ${markdownEscape(truncateMiddle(item.forbiddenWording.join('；'), 140))} |`);
  return `## Claim Guard / 结论护栏

- Status：**${guard.status}**
- Summary：${markdownEscape(guard.summary)}
- Required inputs：${guard.requiredInputs.length ? markdownEscape(guard.requiredInputs.join('；')) : '-'}
- Notes：${guard.notes.length ? markdownEscape(guard.notes.join('；')) : '-'}

${rows.length ? ['| ID | Claim | Status | Confidence | Allowed wording | Forbidden wording |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前报告缺少 claim guard 明细。'}

### Forbidden claims

${guard.forbiddenClaims.length ? guard.forbiddenClaims.map((item) => `- ${markdownEscape(item)}`).join('\n') : '-'}
`;
}

function formatQaIntake(result: QaResult): string {
  const intake = result.qaIntake;
  const rows = intake.questions.slice(0, 40).map((item) => {
    const blocks = item.blocksClaims.length ? item.blocksClaims.join(', ') : '-';
    const refs = item.evidenceRefs.length ? item.evidenceRefs.slice(0, 6).join(', ') : '-';
    return `| ${markdownEscape(item.id)} | ${item.priority} | ${markdownEscape(item.category)} | ${markdownEscape(truncateMiddle(item.question, 120))} | ${markdownEscape(truncateMiddle(item.why, 150))} | ${markdownEscape(truncateMiddle(item.howToAnswer, 150))} | ${markdownEscape(blocks)} | ${markdownEscape(refs)} |`;
  });
  const topRows = intake.topQuestions.map((item) => `- **${item.priority} ${markdownEscape(item.category)}**：${markdownEscape(item.question)}`);
  return `## QA Intake / 专业测试待补输入

- Status：**${intake.status}**
- Summary：${markdownEscape(intake.summary)}
- Top questions：${intake.topQuestions.length}
- Total questions：${intake.questions.length}
- Config hints：${intake.configHints.length ? markdownEscape(intake.configHints.join('；')) : '-'}
- Ready to proceed：${intake.readyToProceed.length ? markdownEscape(intake.readyToProceed.join('；')) : '-'}

${topRows.length ? topRows.join('\n') : '当前没有必须追问的输入项。'}

${rows.length ? ['| ID | Priority | Category | Question | Why | How to answer | Blocks claims | Evidence refs |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前 QA intake 已就绪。'}
`;
}

function formatDefectProof(result: QaResult): string {
  const proof = result.defectProof;
  const rows = proof.items.slice(0, 40).map((item) => {
    const missing = item.missingEvidence.length ? item.missingEvidence.slice(0, 3).join('；') : '-';
    const next = item.nextSteps.length ? item.nextSteps.slice(0, 3).join('；') : '-';
    return `| ${markdownEscape(item.id)} | ${markdownEscape(item.rootCauseGroupId)} | ${item.priority} | ${markdownEscape(item.owner)} | ${markdownEscape(item.status)} | ${item.score} | ${markdownEscape(truncateMiddle(item.title, 90))} | ${markdownEscape(truncateMiddle(missing, 140))} | ${markdownEscape(truncateMiddle(next, 140))} |`;
  });
  return `## Defect Proof / 缺陷证明强度

- Status：**${proof.status}**
- Summary：${markdownEscape(proof.summary)}
- Counts：proven ${proof.counts.proven} / probable ${proof.counts.probable} / needs-evidence ${proof.counts.needsEvidence} / not-defect ${proof.counts.notDefect}
- Notes：${proof.notes.length ? markdownEscape(proof.notes.join('；')) : '-'}

${rows.length ? ['| ID | Root cause | Priority | Owner | Proof status | Score | Title | Missing / weak evidence | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前没有 rootCauseGroups 需要证明。'}
`;
}

function formatTestDataAssessment(result: QaResult): string {
  const testData = result.testData;
  const rows = testData.findings.slice(0, 30).map((finding) => `| ${markdownEscape(finding.id)} | ${finding.severity} | ${finding.category} | ${markdownEscape(finding.recordId ?? '-')} | ${markdownEscape(finding.operationId ?? '-')} | ${markdownEscape(finding.message)} |`);
  return `## Test Data Lifecycle / 测试数据生命周期

- Status：**${testData.status}**
- Environment：${testData.environment}
- Records / setup / cleanup：${testData.summary.recordCount} / ${testData.summary.setupStepCount} / ${testData.summary.cleanupStepCount}
- Destructive requirements / operations：${testData.summary.destructiveRequirementCount} / ${testData.summary.destructiveOperationCount}
- Generated records / missing cleanup / sensitive / production risk：${testData.summary.generatedRecordCount} / ${testData.summary.missingCleanupCount} / ${testData.summary.sensitiveRecordCount} / ${testData.summary.productionRiskCount}
- Recommendations：${testData.recommendations.length ? markdownEscape(testData.recommendations.join('；')) : '-'}

${rows.length ? ['| ID | Severity | Category | Record | Operation | Message |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '未发现测试数据生命周期问题。'}
`;
}

function formatRegressionPlan(result: QaResult): string {
  const plan = result.regressionPlan;
  const itemRows = plan.items.slice(0, 40).map((item) => {
    const refs = [...(item.issueIds ?? []), ...(item.requirementIds ?? []), ...(item.journeyIds ?? []), ...item.evidenceRefs].slice(0, 8).join(', ') || '-';
    return `| ${markdownEscape(item.id)} | ${item.priority} | ${item.type} | ${item.status} | ${item.owner} | ${markdownEscape(truncateMiddle(item.title, 90))} | ${markdownEscape(truncateMiddle(refs, 130))} |`;
  });
  const commandRows = plan.commands.slice(0, 12).map((command, index) => `${index + 1}. \`${markdownEscape(command)}\``);
  return `## Regression Plan / 回归复测计划

- Status：**${plan.status}**
- Items / Commands：${plan.summary.itemCount} / ${plan.summary.commandCount}
- Blocked / Needs input / P0-P1：${plan.summary.blockedCount} / ${plan.summary.needsInputCount} / ${plan.summary.highPriorityCount}
- Notes：${plan.notes.length ? markdownEscape(plan.notes.join('；')) : '-'}

${commandRows.length ? commandRows.join('\n') : '暂无复测命令。'}

${itemRows.length ? ['| ID | Priority | Type | Status | Owner | Title | Evidence refs |', '| --- | --- | --- | --- | --- | --- | --- |', ...itemRows, ''].join('\n') : '暂无回归复测项。'}
`;
}

function formatSourceAnalysis(result: QaResult): string {
  const source = result.sourceAnalysis;
  const findingRows = source.findings.slice(0, 20).map((finding) => {
    const locations = finding.locations.slice(0, 4).map((location) => `${location.file}:${location.line}`).join(', ');
    return `| ${markdownEscape(finding.id)} | ${markdownEscape(finding.kind)} | ${markdownEscape(finding.severity)} | ${markdownEscape(finding.title)} | ${markdownEscape(locations || '-')} |`;
  });
  const routeRows = source.routes.slice(0, 20).map((route) => `| ${markdownEscape(route.path ?? '-')} | ${markdownEscape(route.name ?? '-')} | ${route.lazy ? 'lazy' : 'eager/unknown'} | ${markdownEscape(route.file)}:${route.line} |`);
  const apiRows = source.apiCalls.slice(0, 20).map((api) => `| ${markdownEscape(api.method ?? '-')} | ${markdownEscape(api.path ?? '-')} | ${markdownEscape(api.client ?? '-')} | ${markdownEscape(api.file)}:${api.line} |`);
  return `## Source Analysis / 源码索引

- Enabled：${source.enabled}
- Status：${source.status}
- Root：${source.root ? `\`${markdownEscape(source.root)}\`` : '-'}
- Scanned files / bytes：${source.scannedFiles} / ${source.scannedBytes}
- Routes：${source.summary.routeCount}（route files ${source.summary.routeFileCount}，eager imports ${source.summary.eagerRouteImportCount}）
- Heavy imports：${source.summary.heavyImportCount}
- API calls：${source.summary.apiCallCount}
- Error / Empty signals：${source.summary.errorStateSignalCount} / ${source.summary.emptyStateSignalCount}
- Error：${markdownEscape(source.error ?? '-')}

### 源码发现

${findingRows.length ? ['| ID | Kind | Severity | Title | Locations |', '| --- | --- | --- | --- | --- |', ...findingRows, ''].join('\n') : '未发现源码级风险。'}

### 路由线索

${routeRows.length ? ['| Path | Name | Loading | Location |', '| --- | --- | --- | --- |', ...routeRows, ''].join('\n') : '未识别到路由定义。'}

### API 调用线索

${apiRows.length ? ['| Method | Path | Client | Location |', '| --- | --- | --- | --- |', ...apiRows, ''].join('\n') : '未识别到 API 调用。'}
`;
}

function formatSourceRuntimeCorrelation(result: QaResult): string {
  const correlation = result.sourceRuntimeCorrelation;
  const rows = correlation.links.slice(0, 25).map((link) => {
    const sourceMatches = link.sourceMatches.slice(0, 3).map((match) => `${match.file}:${match.line}${match.path ? ` ${match.path}` : ''}`).join('<br>');
    const listHints = link.responseListHints.slice(0, 3).map((hint) => `${hint.path}(${hint.length})`).join('<br>');
    return `| ${markdownEscape(link.id)} | ${markdownEscape(`${link.method} ${truncateMiddle(link.path, 70)}`)} | ${markdownEscape(String(link.status ?? '-'))} | ${markdownEscape(link.confidence)} | ${markdownEscape(sourceMatches || '-')} | ${markdownEscape(link.componentIds.slice(0, 5).join(', ') || '-')} | ${markdownEscape(listHints || '-')} |`;
  });
  return `## Source × Runtime Correlation / 源码×运行时绑定

- Enabled：${correlation.enabled}
- Status：${correlation.status}
- Runtime API requests：${correlation.summary.networkRequestCount}
- Linked / Strong / Unlinked：${correlation.summary.linkedRequestCount} / ${correlation.summary.strongLinkCount} / ${correlation.summary.unlinkedRequestCount}
- Linked list-like responses：${correlation.summary.listResponseLinkCount}
- Error：${markdownEscape(correlation.error ?? '-')}

该节用于过滤“全局 Network 里某接口有数据，但页面为空”这类发散结论。只有运行时接口能绑定到源码 API 调用，并能找到 UI/状态/列表响应线索时，相关数据不一致问题才进入可执行缺陷候选。

${rows.length ? ['| ID | Network | Status | Confidence | Source matches | Components | List hints |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '未建立运行时接口与源码/UI 的绑定。'}
`;
}

function formatSourceHealth(result: QaResult): string {
  const health = result.sourceHealth;
  const scriptRows = health.packageScripts.slice(0, 20).map((script) => `| ${markdownEscape(script.name)} | ${markdownEscape(script.category)} | \`${markdownEscape(script.command)}\` |`);
  const scriptCheckRows = health.scriptChecks.slice(0, 20).map((check) => `| ${markdownEscape(check.id)} | ${markdownEscape(check.scriptName)} | ${markdownEscape(check.category)} | ${markdownEscape(check.status)} | ${check.durationMs} | ${check.exitCode ?? '-'} | ${markdownEscape((check.error ?? check.stderrPreview ?? check.stdoutPreview ?? '-').slice(0, 180))} |`);
  const findingRows = health.findings.slice(0, 20).map((finding) => `| ${markdownEscape(finding.id)} | ${markdownEscape(finding.severity)} | ${markdownEscape(finding.file)}:${finding.line ?? '-'}:${finding.column ?? '-'} | ${markdownEscape(finding.message)} |`);
  const failedScriptChecks = health.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out').length;
  return `## Source Health / 源码健康

- Enabled：${health.enabled}
- Status：${health.status}
- Root：${health.root ? `\`${markdownEscape(health.root)}\`` : '-'}
- Package manager：${health.packageManager ?? '-'}
- Scanned / Parsed / Skipped：${health.scannedFiles} / ${health.parsedFiles} / ${health.skippedFiles}
- Syntax errors：${health.syntaxErrorCount}
- Script checks：${health.scriptChecks.length}（failed/timed-out ${failedScriptChecks}）
- Error：${markdownEscape(health.error ?? '-')}

### package.json scripts

${scriptRows.length ? ['| Script | Category | Command |', '| --- | --- | --- |', ...scriptRows, ''].join('\n') : '未识别到 package.json scripts。'}

### Script checks

${scriptCheckRows.length ? ['| ID | Script | Category | Status | Duration ms | Exit | Output/Error preview |', '| --- | --- | --- | --- | --- | --- | --- |', ...scriptCheckRows, ''].join('\n') : '未执行 source script checks。默认只识别脚本和解析语法；需要时使用 `--source-run-scripts`。'}

### Syntax findings

${findingRows.length ? ['| ID | Severity | Location | Message |', '| --- | --- | --- | --- |', ...findingRows, ''].join('\n') : '未发现源码语法解析错误。'}
`;
}

function formatRootCauseGroups(result: QaResult): string {
  const groups = result.rootCauseGroups ?? [];
  const rows = groups.slice(0, 50).map((group) => {
    const sourceLocations = group.sourceLocations?.map((location) => `${location.file}:${location.line}`).slice(0, 4) ?? [];
    const evidence = [
      group.issueIds.length ? `issues:${group.issueIds.join(',')}` : '',
      group.networkRequestIds.length ? `network:${group.networkRequestIds.slice(0, 5).join(',')}` : '',
      group.consoleIds.length ? `console:${group.consoleIds.slice(0, 5).join(',')}` : '',
      group.pageErrorIds.length ? `pageError:${group.pageErrorIds.slice(0, 5).join(',')}` : '',
      sourceLocations.length ? `source:${sourceLocations.join(', ')}` : '',
      group.selectors.length ? `selector:${truncateMiddle(group.selectors.slice(0, 3).join(' / '), 120)}` : ''
    ].filter(Boolean).join('；') || '-';
    return `| ${group.id} | ${group.priority} | ${severityLabel[group.severity]} | ${group.status} | ${group.owner} | ${markdownEscape(group.title)} | ${group.issueCount} | ${markdownEscape(truncateMiddle(evidence, 180))} | ${markdownEscape(truncateMiddle(group.suggestedFix, 180))} |`;
  });
  return `## Root Cause Groups / 根因归并

Raw issue 数不等于修复工作量。本节按实现根因归并，优先看这里再看后面的原始问题详情。

- Root Cause 总数：${groups.length}
- Actionable / Reference：${groups.filter((group) => group.status === 'actionable').length} / ${groups.filter((group) => group.status === 'reference').length}

${rows.length ? ['| ID | 优先级 | 等级 | 状态 | Owner | 根因 | Raw Issues | 证据 | 建议 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '未归并出根因问题。'}
`;
}

function formatIssueDisposition(result: QaResult): string {
  const disposition = result.issueDisposition;
  const rows = disposition.items.slice(0, 80).map((item) => `| ${item.issueId} | ${item.actionability} | ${item.status} | ${item.bucket} | ${item.owner} | ${item.evidenceStrength} | ${markdownEscape(truncateMiddle(item.reason, 180))} | ${markdownEscape(truncateMiddle(item.nextStep, 180))} |`);
  return `## Raw Finding Disposition / 原始问题处置

本节把 raw issue 分为可执行缺陷、需确认项和非缺陷，避免把扫描器噪音、产品取舍或部署项混入核心修复列表。

- Actionable / Conditional / Non-actionable：${disposition.summary.actionableCount} / ${disposition.summary.conditionalCount} / ${disposition.summary.nonActionableCount}
- Confirmed / Needs source / Deployment / Product / Tool / Insufficient / Reference：${disposition.summary.confirmedCount} / ${disposition.summary.needsSourceConfirmationCount} / ${disposition.summary.deploymentOnlyCount} / ${disposition.summary.productDecisionCount} / ${disposition.summary.toolLimitationCount} / ${disposition.summary.insufficientEvidenceCount} / ${disposition.summary.referenceCount}

${rows.length ? ['| Issue | Actionability | Status | Bucket | Owner | Evidence | Reason | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '未生成 raw finding 处置。'}
`;
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
    const content = test.observations.downloadContent;
    const contentSummary = content ? `, ${content.kind}/${content.parseStatus}${content.rowCount !== undefined ? `, rows ${content.rowCount}` : ''}${content.columnCount !== undefined ? `, cols ${content.columnCount}` : ''}` : '';
    const download = test.observations.downloadPath ? `\`${reportPath(result, test.observations.downloadPath)}\` (${test.observations.downloadSizeBytes ?? 0} bytes${contentSummary})` : '-';
    return `| ${test.id} | ${test.kind} | ${test.status} | ${markdownEscape(test.target)} | ${markdownEscape(test.issue ?? '-')} | ${markdownEscape(network)} | ${markdownEscape(consoleIds)} | ${markdownEscape(download)} |`;
  });

  return `## 三、安全交互测试

默认尽量只执行非破坏性交互：搜索、筛选重置、分页、查看/详情、刷新等。上传、下载/导出、创建、编辑、删除、真实提交需通过 safety 配置显式开启；本节按实际执行动作列出证据。

| ID | 类型 | 状态 | 目标 | 观察/问题 | 新请求 | 新 Console | 下载文件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
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
  const rows = result.journeyTests.map((journey) => `| ${journey.id} | ${markdownEscape(journey.name)} | ${journey.status} | ${markdownEscape(journey.source ?? 'configured')} | ${markdownEscape(journey.requirementIds?.join(',') || '-')} | ${journey.steps.length} | ${markdownEscape(journey.finalUrl ?? '-')} | ${markdownEscape(journey.issue ?? '-')} |`);
  return `## 八、用户旅程测试

| ID | 名称 | 状态 | 来源 | 需求 | 步骤数 | 最终 URL | 问题 |
| --- | --- | --- | --- | --- | --- | --- | --- |
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
- Visual baseline / diff：${result.p2.visual.baselinePath ? `\`${reportPath(result, result.p2.visual.baselinePath)}\`` : '-'} / ${result.p2.visual.diffScreenshot ? `\`${reportPath(result, result.p2.visual.diffScreenshot)}\`` : '-'}
- Visual metrics：method ${result.p2.visual.diffMethod ?? '-'}；ratio ${result.p2.visual.diffRatio ?? '-'}；changed ${result.p2.visual.changedPixelCount ?? '-'} / ${result.p2.visual.totalPixelCount ?? '-'}；size mismatch ${result.p2.visual.sizeMismatch ?? '-'}

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
  const dispositionByIssue = new Map(result.issueDisposition.items.map((item) => [item.issueId, item]));
  const actionableIssues = result.issues.filter((issue) => dispositionByIssue.get(issue.id)?.actionability === 'actionable' || (!dispositionByIssue.has(issue.id) && isActionableIssue(issue)));
  const frontend = actionableIssues.filter((issue) => issue.suggestion.frontend).slice(0, 12);
  const backend = actionableIssues.filter((issue) => issue.suggestion.backend).slice(0, 12);
  const test = actionableIssues.filter((issue) => issue.suggestion.test).slice(0, 12);

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

function formatArtifactIntegrity(result: QaResult): string {
  const integrity = result.artifactIntegrity;
  const missingRows = integrity.missing.slice(0, 50).map((entry) => `| ${markdownEscape(entry.source)} | ${markdownEscape(entry.kind)} | ${markdownEscape(reportPath(result, entry.path) ?? entry.path)} | ${markdownEscape(entry.issueId ?? '-')} | ${markdownEscape(entry.message ?? '-')} |`);
  return `## Artifact Integrity / 证据路径完整性

- Status：${integrity.status}
- Present / Missing / Skipped：${integrity.presentCount} / ${integrity.missingCount} / ${integrity.skippedCount}
- Summary：${markdownEscape(integrity.summary)}

${missingRows.length ? ['| Source | Kind | Path | Issue | Message |', '| --- | --- | --- | --- | --- |', ...missingRows, ''].join('\n') : '未发现缺失的本地证据路径。'}
`;
}

function formatArtifacts(result: QaResult): string {
  const entries = Object.entries(result.artifacts).filter(([, value]) => typeof value === 'string' && value);
  return `## 十九、证据索引

${entries.map(([key, value]) => `- ${key}: \`${reportPath(result, value as string)}\``).join('\n')}
`;
}

export function formatProfessionalReview(result: QaResult): string {
  const actionableGroups = proofReadyRootCauseGroups(result.rootCauseGroups, result.defectProof);
  const professionalAudit = runProfessionalAudit(result);
  const rawActionableGroupCount = result.rootCauseGroups.filter((group) => group.status === 'actionable').length;
  const blockerGroups = actionableGroups.filter((group) => group.priority === 'P0' || group.priority === 'P1');
  const sourceScriptPassed = result.sourceHealth.scriptChecks.filter((check) => check.status === 'passed').length;
  const sourceScriptFailed = result.sourceHealth.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out').length;
  const disposition = result.issueDisposition.summary;
  const artifactPath = (value: string | undefined): string => value ? `\`${markdownEscape(reportPath(result, value) ?? value)}\`` : '-';
  const rootRows = actionableGroups.slice(0, 12).map((group) => {
    const sourceLocations = group.sourceLocations?.map((location) => `${location.file}:${location.line}`).slice(0, 4) ?? [];
    const evidence = [
      group.issueIds.length ? `issues:${group.issueIds.join(',')}` : '',
      group.networkRequestIds.length ? `network:${group.networkRequestIds.slice(0, 5).join(',')}` : '',
      group.consoleIds.length ? `console:${group.consoleIds.slice(0, 5).join(',')}` : '',
      group.pageErrorIds.length ? `pageError:${group.pageErrorIds.slice(0, 5).join(',')}` : '',
      sourceLocations.length ? `source:${sourceLocations.join(', ')}` : '',
      group.selectors.length ? `selector:${group.selectors.slice(0, 2).join(' / ')}` : ''
    ].filter(Boolean).join('；') || '-';
    return `| ${group.priority} | ${severityLabel[group.severity]} | ${group.owner} | ${markdownEscape(truncateMiddle(group.title, 90))} | ${group.issueCount} | ${markdownEscape(truncateMiddle(evidence, 140))} | ${markdownEscape(truncateMiddle(group.suggestedFix, 180))} |`;
  });
  const nonDefectRows = [
    ['部署/安全配置', disposition.deploymentOnlyCount, '交给网关/CDN/nginx/后端部署；不要当作前端代码 bug。'],
    ['产品/ADR 决策', disposition.productDecisionCount, '只有违反明确需求或阻塞核心任务时才转为缺陷。'],
    ['工具/环境局限', disposition.toolLimitationCount, '记录测试方法限制，必要时换环境或补专项测试。'],
    ['证据不足', disposition.insufficientEvidenceCount + disposition.needsSourceConfirmationCount, '需要源码/运行时双证据后再转缺陷。'],
    ['参考观察', disposition.referenceCount, '不计入修复工作量。']
  ].map(([type, count, decision]) => `| ${type} | ${count} | ${markdownEscape(String(decision))} |`);
  const dispositionRank: Record<string, number> = {
    'product-decision': 0,
    'tool-limitation': 1,
    'deployment-only': 2,
    'needs-source-confirmation': 3,
    'insufficient-evidence': 4,
    reference: 5,
    confirmed: 6
  };
  const dispositionSampleRows = result.issueDisposition.items
    .filter((item) => item.actionability !== 'actionable' || item.status !== 'confirmed')
    .sort((a, b) => (dispositionRank[a.status] ?? 99) - (dispositionRank[b.status] ?? 99) || severityOrder[a.severity] - severityOrder[b.severity] || a.issueId.localeCompare(b.issueId))
    .slice(0, 12)
    .map((item) => `| ${markdownEscape(item.issueId)} | ${severityLabel[item.severity]} | ${markdownEscape(item.status)} | ${markdownEscape(item.actionability)} | ${markdownEscape(item.owner)} | ${markdownEscape(truncateMiddle(item.reason, 150))} | ${markdownEscape(truncateMiddle(item.nextStep, 140))} |`);
  const gapRows = [
    ...result.qaSignoff.blockers.map((item) => `| blocker | ${markdownEscape(item)} |`),
    ...result.qaSignoff.risks.map((item) => `| risk | ${markdownEscape(item)} |`),
    ...result.qaSignoff.coverageGaps.map((item) => `| gap | ${markdownEscape(item)} |`),
    ...result.qaSignoff.requiredFollowups.map((item) => `| follow-up | ${markdownEscape(item)} |`)
  ].slice(0, 16);
  const requirementRows = result.requirementCoverage.items.slice(0, 12).map((item) => {
    const evidence = [
      item.evidence.journeyIds.length ? `journey:${item.evidence.journeyIds.join(',')}` : '',
      item.evidence.selectors.length ? `selector:${item.evidence.selectors.slice(0, 2).join(',')}` : '',
      item.evidence.networkRequestIds.length ? `network:${item.evidence.networkRequestIds.slice(0, 3).join(',')}` : ''
    ].filter(Boolean).join(' / ') || '-';
    return `| ${markdownEscape(item.id)} | ${markdownEscape(item.priority)} | ${markdownEscape(item.source)} | ${markdownEscape(item.status)} | ${markdownEscape(item.confidence)} | ${markdownEscape(truncateMiddle(item.title, 90))} | ${markdownEscape(truncateMiddle(evidence, 120))} |`;
  });

  const evidenceReport = typeof result.artifacts.evidenceReport === 'string' ? result.artifacts.evidenceReport : result.artifacts.markdownReport;

  return `# FrontLens Professional QA Review

这是一份面向决策和修复排期的精简复盘；完整原始证据见 ${artifactPath(evidenceReport)}，机器可读数据见 ${artifactPath(result.artifacts.jsonReport)}。

## 结论

- Target：${markdownEscape(result.summary.url)}
- Professional summary：${markdownEscape(result.professionalSummary.headline)}
- QA sign-off：**${result.qaSignoff.status}** / confidence **${result.qaSignoff.confidence}** / business **${result.qaSignoff.businessValidationConfidence}**
- Adjusted score：**${result.summary.adjustedScore}/100**（专业排期口径，基于 ${result.summary.adjustedIssueCount} 个 ${result.summary.scoreBasis} finding）
- Fix queue：${actionableGroups.length} proof-ready root cause(s) / ${blockerGroups.length} P0-P1 blocker(s)
- Defect proof：**${result.defectProof.status}** / proven ${result.defectProof.counts.proven} / needs-evidence ${result.defectProof.counts.needsEvidence}
- Professional audit：**${professionalAudit.status}** / blockers ${professionalAudit.summary.blockerCount} / warnings ${professionalAudit.summary.warningCount} / artifact ${artifactPath(result.artifacts.professionalAudit)}
- Raw score：**${result.summary.score}/100**（原始扫描趋势分，不能直接等同页面质量或修复工作量）
- Raw issues：${result.summary.issueCount}；actionable / conditional / non-actionable：${disposition.actionableCount} / ${disposition.conditionalCount} / ${disposition.nonActionableCount}
- Proof-ready root causes：${actionableGroups.length} / actionable ${rawActionableGroupCount}（P0/P1 ${blockerGroups.length}）
- Quality gate：**${result.qualityGate.status}** / **${result.qualityGate.confidence}**
- Claim guard：**${result.claimGuard.status}** / forbidden claims ${result.claimGuard.forbiddenClaims.length}
- QA intake：**${result.qaIntake.status}** / questions ${result.qaIntake.questions.length}（top ${result.qaIntake.topQuestions.length}）
- Requirement coverage：${result.requirementCoverage.summary.passedCount}/${result.requirementCoverage.summary.requirementCount} passed；provided / inferred：${result.requirementCoverage.summary.providedCount}/${result.requirementCoverage.summary.inferredCount}
- Environment：${result.environment.kind} / trust performance ${result.environment.trust.performance} / security ${result.environment.trust.security}
- Page profile：${result.pageProfile.status} / ${result.pageProfile.pageType} / ${result.pageProfile.confidence}
- Scope review：${result.scopeReview.status} / ${result.scopeReview.questions.length} question(s)
- Test data：${result.testData.status} / records ${result.testData.summary.recordCount} / missing cleanup ${result.testData.summary.missingCleanupCount}
- Regression plan：${result.regressionPlan.status} / items ${result.regressionPlan.summary.itemCount} / blocked ${result.regressionPlan.summary.blockedCount}
- Source health：${result.sourceHealth.status}；syntax errors ${result.sourceHealth.syntaxErrorCount}；script checks ${result.sourceHealth.scriptChecks.length}（passed ${sourceScriptPassed} / failed-or-timeout ${sourceScriptFailed}）
- Artifact integrity：${result.artifactIntegrity.status}（missing ${result.artifactIntegrity.missingCount}）

## 核心缺陷 / 修复根因

${rootRows.length ? ['| Priority | Severity | Owner | Root cause | Raw issues | Evidence | Fix |', '| --- | --- | --- | --- | --- | --- | --- |', ...rootRows, ''].join('\n') : '当前证据未归并出可执行根因。'}

## 缺陷证明强度

- Defect proof：**${result.defectProof.status}**
- Artifact：${artifactPath(result.artifacts.defectProof)}
- Rule：must-fix 缺陷需要用户影响、运行时证据、源码/owner 修复面、复现步骤，以及必要的需求/产品范围上下文。

${result.defectProof.items.length ? ['| Root cause | Proof | Score | Missing / weak evidence | Next step |', '| --- | --- | --- | --- | --- |', ...result.defectProof.items.slice(0, 8).map((item) => `| ${markdownEscape(item.rootCauseGroupId)} | ${markdownEscape(item.status)} | ${item.score} | ${markdownEscape(truncateMiddle(item.missingEvidence.slice(0, 2).join('；') || '-', 140))} | ${markdownEscape(truncateMiddle(item.nextSteps.slice(0, 2).join('；') || '-', 140))} |`), ''].join('\n') : '当前没有 root cause 需要缺陷证明。'}

## 非缺陷与降噪

| Bucket | Count | Decision |
| --- | --- | --- |
${nonDefectRows.join('\n')}

### 降级 / 不修 / 待补证据样例

${dispositionSampleRows.length ? ['| Issue | Severity | Disposition | Actionability | Owner | Why not a direct fix | Next step |', '| --- | --- | --- | --- | --- | --- | --- |', ...dispositionSampleRows, ''].join('\n') : '当前没有被降级或需补证据的 raw findings。'}

## 签核阻断、风险与待补证据

${gapRows.length ? ['| Type | Item |', '| --- | --- |', ...gapRows, ''].join('\n') : '未发现额外阻断、风险或待补证据。'}

## 结论护栏 / 禁止过度承诺

- Claim guard：**${result.claimGuard.status}**
- Artifact：${artifactPath(result.artifacts.claimGuard)}
- Required inputs：${result.claimGuard.requiredInputs.length ? markdownEscape(result.claimGuard.requiredInputs.slice(0, 5).join('；')) : '-'}

${result.claimGuard.items.length ? ['| Claim | Status | Allowed wording | Forbidden wording |', '| --- | --- | --- | --- |', ...result.claimGuard.items.slice(0, 8).map((item) => `| ${markdownEscape(item.claim)} | ${markdownEscape(item.status)} | ${markdownEscape(item.allowedWording)} | ${markdownEscape(item.forbiddenWording.slice(0, 2).join('；'))} |`), ''].join('\n') : '暂无 claim guard 明细。'}

## 专业 QA 待补输入 / 避免猜测

- QA intake：**${result.qaIntake.status}**
- Artifact：${artifactPath(result.artifacts.qaIntake)}
- Top questions：${result.qaIntake.topQuestions.length ? markdownEscape(result.qaIntake.topQuestions.map((item) => `${item.priority} ${item.category}: ${item.question}`).join('；')) : '-'}

${result.qaIntake.topQuestions.length ? ['| Priority | Category | Question | Why | How to answer |', '| --- | --- | --- | --- | --- |', ...result.qaIntake.topQuestions.map((item) => `| ${item.priority} | ${markdownEscape(item.category)} | ${markdownEscape(item.question)} | ${markdownEscape(truncateMiddle(item.why, 140))} | ${markdownEscape(truncateMiddle(item.howToAnswer, 140))} |`), ''].join('\n') : '无必须追问项，可按当前证据范围签核。'}

## 产品范围 / PRD 待确认

- Scope review：**${result.scopeReview.status}** / confidence **${result.scopeReview.confidence}**
- Questions：${result.scopeReview.questions.length}
- Suggested config：${artifactPath(result.artifacts.scopeReview)}

${result.scopeReview.questions.length ? ['| ID | Category | Question | Default disposition |', '| --- | --- | --- | --- |', ...result.scopeReview.questions.slice(0, 8).map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.category)} | ${markdownEscape(item.question)} | ${markdownEscape(item.defaultDisposition)} |`), ''].join('\n') : '产品范围已配置；按 productContext 作为产品/设计 triage 的依据。'}

## 需求/能力覆盖

${requirementRows.length ? ['| ID | Priority | Source | Status | Confidence | Requirement / capability | Evidence |', '| --- | --- | --- | --- | --- | --- | --- |', ...requirementRows, ''].join('\n') : '未配置或未推断出需求项；不能给出完整业务验收结论。'}

## 复测命令

\`\`\`bash
node dist/cli.js qa --url ${JSON.stringify(result.summary.url)} --output "reports/frontlens/verify" --no-trace --json${result.sourceAnalysis.root ? ` --source-root ${JSON.stringify(result.sourceAnalysis.root)}` : ''}
\`\`\`

## 阅读顺序

1. 先处理上方“核心缺陷 / 修复根因”，不要按 raw issue 数量排期。
2. 对“证据不足/需源码确认”的项，补 source/runtime 绑定后再转 bug。
3. 对部署安全、产品取舍、dev server 伪影，按对应 owner 或 ADR 处理，不进入前端修复队列。
`;
}

export async function writeMarkdownReport(result: QaResult): Promise<void> {
  const outputPath = path.join(result.artifacts.outputDir, 'report.md');
  const evidencePath = path.join(result.artifacts.outputDir, 'evidence-report.md');
  const briefPath = path.join(result.artifacts.outputDir, 'brief.md');
  const auditPath = path.join(result.artifacts.outputDir, 'professional-audit.md');
  const productContextPath = path.join(result.artifacts.outputDir, 'product-context.md');
  const qaPlanPath = path.join(result.artifacts.outputDir, 'qa-plan.md');
  const reviewPath = path.join(result.artifacts.outputDir, 'qa-review.md');
  const scopeReviewPath = path.join(result.artifacts.outputDir, 'scope-review.md');
  const claimGuardPath = path.join(result.artifacts.outputDir, 'claim-guard.md');
  const qaIntakePath = path.join(result.artifacts.outputDir, 'qa-intake.md');
  const defectProofPath = path.join(result.artifacts.outputDir, 'defect-proof.md');
  result.artifacts.markdownReport = outputPath;
  result.artifacts.evidenceReport = evidencePath;
  result.artifacts.professionalBrief = briefPath;
  result.artifacts.professionalAudit = auditPath;
  result.artifacts.productContext = productContextPath;
  result.artifacts.qaPlan = qaPlanPath;
  result.artifacts.qaReview = reviewPath;
  result.artifacts.scopeReview = scopeReviewPath;
  result.artifacts.claimGuard = claimGuardPath;
  result.artifacts.qaIntake = qaIntakePath;
  result.artifacts.defectProof = defectProofPath;

  const dispositionByIssue = new Map(result.issueDisposition.items.map((item) => [item.issueId, item]));
  const isReportActionable = (issue: Issue): boolean => dispositionByIssue.get(issue.id)?.actionability === 'actionable' || (!dispositionByIssue.has(issue.id) && isActionableIssue(issue));
  const actionableIssues = result.issues.filter(isReportActionable);
  const referenceIssues = result.issues.filter((issue) => !isReportActionable(issue));
  const frontendIssues = actionableIssues.filter((issue) => issue.category.startsWith('frontend') || issue.category === 'resource-loading' || issue.category === 'resource-performance' || issue.category === 'console-error' || issue.category === 'seo');
  const backendIssues = actionableIssues.filter((issue) => issue.category.startsWith('backend'));
  const integrationIssues = actionableIssues.filter((issue) => issue.category.startsWith('integration'));
  const securityIssues = actionableIssues.filter((issue) => issue.category === 'security');

  const evidenceMarkdown = `# FrontLens QA Evidence Appendix

## 一、测试概览

- URL：${result.summary.url}
- 页面标题：${formatMaybe(result.summary.title)}
- 浏览器：${result.summary.browser}
- 视口：${result.summary.viewport.width}x${result.summary.viewport.height}
- 测试时间：${result.summary.testedAt}
- 总耗时：${result.metadata.durationMs}ms
- Result Schema：${result.metadata.schemaVersion}
- 采集阶段异常：${result.metadata.phaseErrors.length}
- Raw score：**${result.summary.score}/100**（全量 raw finding）
- Adjusted score：**${result.summary.adjustedScore}/100**（${result.summary.scoreBasis}，基于 ${result.summary.adjustedIssueCount} 个 proof-ready 可执行问题）
- 安全评分：**${result.security.score}/100**（${result.security.status}）
- API Contract：${result.apiContract.summary.endpointCount} endpoints / ${result.apiContract.summary.schemaMismatchCount + result.apiContract.summary.statusMismatchCount + result.apiContract.summary.undocumentedCount} findings
- Realtime：GraphQL ${result.realtime.summary.graphqlOperationCount} / WS ${result.realtime.summary.webSocketCount} / SSE ${result.realtime.summary.sseCount}
- Root Causes：${result.professionalSummary.counts.proofReadyRootCauseCount} proof-ready / ${result.rootCauseGroups.filter((group) => group.status === 'actionable').length} actionable / ${result.rootCauseGroups.length} total
- Raw Finding Disposition：${result.issueDisposition.summary.actionableCount} actionable / ${result.issueDisposition.summary.conditionalCount} conditional / ${result.issueDisposition.summary.nonActionableCount} non-actionable
- Fix Tasks：${result.fixTasks.length}
- Professional Summary：${result.professionalSummary.status} / must-fix ${result.professionalSummary.mustFix.length} / non-defect ${result.professionalSummary.nonDefectObservations.length}
- Claim Guard：${result.claimGuard.status} / forbidden ${result.claimGuard.forbiddenClaims.length}
- QA Intake：${result.qaIntake.status} / questions ${result.qaIntake.questions.length} / top ${result.qaIntake.topQuestions.length}
- Defect Proof：${result.defectProof.status} / proven ${result.defectProof.counts.proven} / needs-evidence ${result.defectProof.counts.needsEvidence}
- QA Sign-off：${result.qaSignoff.status} / ${result.qaSignoff.confidence} / ${result.qaSignoff.businessValidationConfidence}
- Page Profile：${result.pageProfile.status} / ${result.pageProfile.pageType} / ${result.pageProfile.confidence}
- Test Data：${result.testData.status} / records ${result.testData.summary.recordCount} / cleanup gaps ${result.testData.summary.missingCleanupCount}
- Regression Plan：${result.regressionPlan.status} / items ${result.regressionPlan.summary.itemCount} / blocked ${result.regressionPlan.summary.blockedCount}
- Artifact Integrity：${result.artifactIntegrity.status}（missing ${result.artifactIntegrity.missingCount}）
- 问题总数：${result.summary.issueCount}
- 可执行问题：${actionableIssues.length}（参考观察项：${referenceIssues.length}）
- 严重 / 高 / 中 / 低 / 信息：${result.summary.criticalCount} / ${result.summary.highCount} / ${result.summary.mediumCount} / ${result.summary.lowCount} / ${result.summary.infoCount}
- 评分说明：${result.summary.scoreNotes.map(markdownEscape).join('；')}

${formatPhaseErrors(result)}

${formatQualityGate(result)}

${formatQaSignoff(result)}

${formatProfessionalSummary(result)}

${formatEnvironmentAssessment(result)}

${formatPageProfileAssessment(result)}

${formatScopeReview(result)}

${formatClaimGuard(result)}

${formatQaIntake(result)}

${formatDefectProof(result)}

${formatTestDataAssessment(result)}

${formatRegressionPlan(result)}

${formatRootCauseGroups(result)}

${formatIssueDisposition(result)}

${formatRequirementCoverage(result)}

${formatSourceAnalysis(result)}

${formatSourceRuntimeCorrelation(result)}

${formatSourceHealth(result)}

## 核心可执行问题列表

${formatIssueTable(actionableIssues)}

${referenceIssues.length ? `### 参考观察项（不计分、不生成 Fix Task）\n\n${formatIssueTable(referenceIssues)}` : ''}

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

${formatArtifactIntegrity(result)}

${formatArtifacts(result)}
`;

  const reviewMarkdown = formatProfessionalReview(result);
  const reportMarkdown = reviewMarkdown.replace('# FrontLens Professional QA Review', '# FrontLens Professional QA Report');
  await writeText(briefPath, formatProfessionalBrief(result));
  await writeText(auditPath, formatProfessionalAudit(runProfessionalAudit(result)));
  await writeText(productContextPath, formatProductContextSuggestion(buildProductContextSuggestion(result)));
  result.qaPlan = buildQaExecutionPlan(result);
  await writeText(qaPlanPath, formatQaExecutionPlan(result.qaPlan));
  await writeText(outputPath, reportMarkdown);
  await writeText(reviewPath, reviewMarkdown);
  await writeText(evidencePath, evidenceMarkdown);
  await writeText(scopeReviewPath, formatScopeReview(result));
  await writeText(claimGuardPath, formatClaimGuard(result));
  await writeText(qaIntakePath, formatQaIntake(result));
  await writeText(defectProofPath, formatDefectProof(result));
}
