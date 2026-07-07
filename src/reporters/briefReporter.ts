import type { ProfessionalSummaryItem, QaResult, RootCauseGroup } from '../types.js';
import { proofReadyRootCauseGroups } from '../proof/proofReadiness.js';
import { runProfessionalAudit } from '../audit/professionalAudit.js';

function markdownEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

function truncate(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function issueIdsOf(item: Pick<ProfessionalSummaryItem, 'issueIds'>): string {
  return item.issueIds?.length ? item.issueIds.join(',') : '-';
}

function evidenceFor(group: RootCauseGroup): string {
  const sourceLocations = group.sourceLocations.map((location) => `${location.file}:${location.line}`).slice(0, 3);
  const evidence = [
    group.networkRequestIds.length ? `network:${group.networkRequestIds.slice(0, 3).join(',')}` : '',
    group.consoleIds.length ? `console:${group.consoleIds.slice(0, 3).join(',')}` : '',
    group.pageErrorIds.length ? `pageError:${group.pageErrorIds.slice(0, 3).join(',')}` : '',
    group.selectors.length ? `selector:${group.selectors.slice(0, 2).join(' / ')}` : '',
    sourceLocations.length ? `source:${sourceLocations.join(', ')}` : ''
  ].filter(Boolean);
  return evidence.length ? evidence.join('；') : '-';
}

function artifactPath(result: QaResult, key: keyof QaResult['artifacts']): string {
  const value = result.artifacts[key];
  return typeof value === 'string' && value ? value : '-';
}

export function formatProfessionalBrief(result: QaResult): string {
  const proofReadyGroups = proofReadyRootCauseGroups(result.rootCauseGroups, result.defectProof);
  const professionalAudit = runProfessionalAudit(result);
  const mustFix = result.professionalSummary.mustFix.slice(0, 5);
  const shouldFix = result.professionalSummary.shouldFix.slice(0, Math.max(0, 5 - mustFix.length));
  const fixItems = [...mustFix, ...shouldFix];
  const rootRows = proofReadyGroups.slice(0, 5).map((group) =>
    `| ${group.priority} | ${group.owner} | ${markdownEscape(truncate(group.title, 90))} | ${group.issueIds.length} | ${markdownEscape(truncate(evidenceFor(group), 120))} | ${markdownEscape(truncate(group.suggestedFix, 120))} |`
  );
  const summaryFixRows = fixItems.map((item) =>
    `| ${item.priority} | ${item.owner} | ${markdownEscape(truncate(item.title, 90))} | ${markdownEscape(issueIdsOf(item))} | ${markdownEscape(truncate(item.action, 120))} |`
  );
  const nonDefectRows = [
    ['部署/安全配置', result.issueDisposition.summary.deploymentOnlyCount, '部署 owner 处理；不计前端代码缺陷。'],
    ['产品/设计/ADR', result.issueDisposition.summary.productDecisionCount, '等产品范围或 ADR 明确后再转需求。'],
    ['工具/环境局限', result.issueDisposition.summary.toolLimitationCount, '换环境或补专项测试，不进修复队列。'],
    ['证据不足/需源码确认', result.issueDisposition.summary.insufficientEvidenceCount + result.issueDisposition.summary.needsSourceConfirmationCount, '补 runtime/source/PRD 绑定后再定责。'],
    ['参考观察', result.issueDisposition.summary.referenceCount, '仅作背景。']
  ].filter(([, count]) => Number(count) > 0);
  const nonDefectTable = nonDefectRows.map(([bucket, count, note]) => `| ${bucket} | ${count} | ${markdownEscape(String(note))} |`);
  const topQuestions = result.qaIntake.topQuestions.slice(0, 5).map((item) => `- ${item.priority} / ${item.category}: ${markdownEscape(truncate(item.question, 150))}`);
  const proofGaps = result.defectProof.items
    .filter((item) => item.status === 'needs-evidence')
    .slice(0, 5)
    .map((item) => `- ${item.rootCauseGroupId}: ${markdownEscape(truncate(item.missingEvidence.slice(0, 2).join('；') || item.title, 160))}`);
  const auditGaps = professionalAudit.findings
    .filter((item) => item.severity === 'blocker' || item.severity === 'warning')
    .slice(0, 5)
    .map((item) => `- audit/${item.severity}/${item.category}: ${markdownEscape(truncate(item.title, 150))}`);
  const forbidden = result.claimGuard.forbiddenClaims.slice(0, 5).map((item) => `- ${markdownEscape(item)}`);

  const suggestedFixQueue = summaryFixRows.length && rootRows.length === 0
    ? `\n## Suggested fix queue\n\n${['| Priority | Owner | Item | Issues | Action |', '| --- | --- | --- | --- | --- |', ...summaryFixRows].join('\n')}\n`
    : '';

  return `# FrontLens QA Brief

## Sign-off

- QA sign-off: **${result.qaSignoff.status}** / confidence **${result.qaSignoff.confidence}** / business **${result.qaSignoff.businessValidationConfidence}**
- Adjusted score: **${result.summary.adjustedScore}/100**（${result.summary.scoreBasis}, ${result.summary.adjustedIssueCount} actionable/proof finding）
- Raw score: **${result.summary.score}/100**（scanner trend only; raw issues ${result.summary.issueCount}）
- Proof-ready root causes: **${result.professionalSummary.counts.proofReadyRootCauseCount}** / actionable ${result.professionalSummary.counts.actionableRootCauseCount}
- Must-fix / should-fix: **${result.professionalSummary.mustFix.length} / ${result.professionalSummary.shouldFix.length}**
- Professional audit: **${professionalAudit.status}**（blockers ${professionalAudit.summary.blockerCount}, warnings ${professionalAudit.summary.warningCount}）
- Report content audit: **${result.reportContentAudit.status}**（blockers ${result.reportContentAudit.summary.blockerCount}, warnings ${result.reportContentAudit.summary.warningCount}）
- Journey assertion audit: **${result.journeyAssertionAudit.status}**（runtime-verified ${result.journeyAssertionAudit.summary.runtimeVerifiedJourneyCount}, path-only ${result.journeyAssertionAudit.summary.pathOnlyJourneyCount}, weak ${result.journeyAssertionAudit.summary.weaklyAssertedJourneyCount}）
- Claim guard: **${result.claimGuard.status}**；QA intake: **${result.qaIntake.status}**；Defect proof: **${result.defectProof.status}**
- QA execution plan: **${result.qaPlan.status}** / confidence **${result.qaPlan.confidence}**
- QA coverage matrix: **${result.qaCoverage.status}** / confidence **${result.qaCoverage.confidence}**（covered ${result.qaCoverage.summary.coveredCount}, gaps ${result.qaCoverage.summary.partialCount + result.qaCoverage.summary.skippedCount + result.qaCoverage.summary.needsInputCount + result.qaCoverage.summary.failedCount}）
- Test case matrix: **${result.testCases.status}** / confidence **${result.testCases.confidence}**（total ${result.testCases.summary.totalCount}, failed+blocked ${result.testCases.summary.failedCount + result.testCases.summary.blockedCount}, needs-input ${result.testCases.summary.needsInputCount}）
- Risk register: **${result.riskRegister.status}**（total ${result.riskRegister.summary.totalCount}, release-blocking ${result.riskRegister.summary.releaseBlockingCount}）
- Risk acceptance: **${result.riskAcceptance.status}**（must-mitigate ${result.riskAcceptance.summary.mustMitigateCount}, needs-acceptance ${result.riskAcceptance.summary.acceptanceRequiredCount}）

## Core fixes

${rootRows.length ? ['| Priority | Owner | Root cause | Raw issues | Evidence | Fix |', '| --- | --- | --- | --- | --- | --- |', ...rootRows].join('\n') : '当前没有 proof-ready 实现缺陷。'}
${suggestedFixQueue}

## Non-defect / conditional buckets

${nonDefectTable.length ? ['| Bucket | Count | Decision |', '| --- | --- | --- |', ...nonDefectTable].join('\n') : '当前没有需要特别降级的 raw findings。'}

## Evidence gaps / questions

${topQuestions.length || proofGaps.length || auditGaps.length ? [...auditGaps, ...topQuestions, ...proofGaps].join('\n') : '当前没有必须追问的专业 QA 输入；仍需按报告范围解读。'}

## Claim guard

${forbidden.length ? ['以下结论当前不能正向使用：', ...forbidden].join('\n') : '当前没有额外禁止措辞；仍需限定环境和范围。'}

## Artifacts

- result.json: \`${markdownEscape(artifactPath(result, 'jsonReport'))}\`
- report.md: \`${markdownEscape(artifactPath(result, 'markdownReport'))}\`
- professional-audit.md: \`${markdownEscape(artifactPath(result, 'professionalAudit'))}\`
- report-content-audit.md: \`${markdownEscape(artifactPath(result, 'reportContentAudit'))}\`
- journey-assertion-audit.md: \`${markdownEscape(artifactPath(result, 'journeyAssertionAudit'))}\`
- product-context.md: \`${markdownEscape(artifactPath(result, 'productContext'))}\`
- product-context.config.json: \`${markdownEscape(artifactPath(result, 'productContextConfig'))}\`
- qa-plan.md: \`${markdownEscape(artifactPath(result, 'qaPlan'))}\`
- qa-coverage.md: \`${markdownEscape(artifactPath(result, 'qaCoverage'))}\`
- test-cases.md: \`${markdownEscape(artifactPath(result, 'testCases'))}\`
- risk-register.md: \`${markdownEscape(artifactPath(result, 'riskRegister'))}\`
- risk-acceptance.md: \`${markdownEscape(artifactPath(result, 'riskAcceptance'))}\`
- qa-review.md: \`${markdownEscape(artifactPath(result, 'qaReview'))}\`
- evidence-report.md: \`${markdownEscape(artifactPath(result, 'evidenceReport'))}\`
- artifact integrity: **${result.artifactIntegrity.status}**（missing ${result.artifactIntegrity.missingCount}）
`;
}
