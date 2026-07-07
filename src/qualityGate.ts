import type { CoverageResult, ExceptionSimulationResult, InteractionTestResult, Issue, JourneyTestResult, PageModel, PhaseError, QaQualityGate, SecurityScanResult } from './types.js';

export function isActionableIssue(issue: Issue): boolean {
  return issue.severity !== 'info';
}

function allSkipped(items: Array<{ status: string }>): boolean {
  return items.length > 0 && items.every((item) => item.status === 'skipped');
}

function hasNavigationBlocker(issues: Issue[], pageModel: PageModel): boolean {
  return (
    issues.some((issue) => issue.severity === 'critical' && (issue.category === 'frontend-routing' || /页面打开失败|导航|白屏|首屏|page unavailable/i.test(issue.title))) ||
    /页面加载失败/i.test(pageModel.structureTree)
  );
}

function collectCoverageGaps(input: {
  phaseErrors: PhaseError[];
  interactionTests: InteractionTestResult[];
  journeyTests: JourneyTestResult[];
  exceptionSimulations: ExceptionSimulationResult[];
  coverage: CoverageResult;
  security: SecurityScanResult;
}): string[] {
  const gaps: string[] = [];
  if (input.phaseErrors.length > 0) gaps.push(`${input.phaseErrors.length} 个采集阶段异常，部分证据可能缺失。`);
  if (input.interactionTests.length === 0) gaps.push('未执行安全交互测试。');
  else if (allSkipped(input.interactionTests)) gaps.push('安全交互测试全部 skipped，搜索/表单/弹窗/表格交互未被有效覆盖。');
  if (input.journeyTests.length === 0) gaps.push('未配置或未执行业务用户旅程。');
  else if (allSkipped(input.journeyTests)) gaps.push('用户旅程全部 skipped，核心业务流未被有效覆盖。');
  if (input.exceptionSimulations.length === 0) gaps.push('未执行异常/错误态模拟。');
  else if (allSkipped(input.exceptionSimulations)) gaps.push('异常/错误态模拟全部 skipped。');
  if (input.coverage.enabled && input.coverage.status !== 'passed') gaps.push(`Coverage 状态为 ${input.coverage.status}，未使用资源结论置信度降低。`);
  if (input.security.enabled && input.security.status === 'skipped') gaps.push('安全扫描已启用但未采集完成。');
  return gaps;
}

export function buildQualityGate(input: {
  issues: Issue[];
  pageModel: PageModel;
  phaseErrors: PhaseError[];
  interactionTests: InteractionTestResult[];
  journeyTests: JourneyTestResult[];
  exceptionSimulations: ExceptionSimulationResult[];
  coverage: CoverageResult;
  security: SecurityScanResult;
}): QaQualityGate {
  const actionableIssues = input.issues.filter(isActionableIssue);
  const referenceIssues = input.issues.filter((issue) => !isActionableIssue(issue));
  const blockers = actionableIssues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
  const mediumRisks = actionableIssues.filter((issue) => issue.severity === 'medium');
  const failedJourneys = input.journeyTests.filter((journey) => journey.status === 'failed');
  const failedExceptions = input.exceptionSimulations.filter((item) => item.status === 'failed');
  const coverageGaps = collectCoverageGaps(input);
  const navigationBlocked = hasNavigationBlocker(actionableIssues, input.pageModel);

  const reasons: string[] = [];
  let status: QaQualityGate['status'];
  if (navigationBlocked) {
    status = 'blocked';
    reasons.push('目标页面未可靠进入或首屏/路由被阻断，无法完成有效 QA 验收。');
  } else if (blockers.length > 0 || failedJourneys.length > 0) {
    status = 'fail';
    if (blockers.length > 0) reasons.push(`${blockers.length} 个 Critical/High 可执行问题未解决。`);
    if (failedJourneys.length > 0) reasons.push(`${failedJourneys.length} 条用户旅程失败。`);
  } else if (mediumRisks.length > 0 || failedExceptions.length > 0 || coverageGaps.length > 0) {
    status = 'pass-with-risks';
    if (mediumRisks.length > 0) reasons.push(`${mediumRisks.length} 个 Medium 可执行风险。`);
    if (failedExceptions.length > 0) reasons.push(`${failedExceptions.length} 个异常场景失败。`);
    if (coverageGaps.length > 0) reasons.push(`${coverageGaps.length} 个覆盖缺口。`);
  } else {
    status = 'pass';
    reasons.push('未发现阻断级或中高风险可执行问题，已执行模块无明显失败。');
  }

  const confidence: QaQualityGate['confidence'] = (() => {
    if (status === 'blocked' || input.phaseErrors.length > 0 || input.pageModel.stats.domNodes === 0) return 'low';
    if (coverageGaps.length > 0 || allSkipped(input.interactionTests) || allSkipped(input.journeyTests)) return 'medium';
    return 'high';
  })();

  return {
    status,
    confidence,
    checkedAt: new Date().toISOString(),
    actionableIssueCount: actionableIssues.length,
    referenceIssueCount: referenceIssues.length,
    blockingIssueCount: blockers.length,
    mediumRiskCount: mediumRisks.length,
    coverageGapCount: coverageGaps.length,
    coverageGaps,
    reasons,
    summary: `${status} / ${confidence}: ${reasons.join(' ')}`
  };
}
