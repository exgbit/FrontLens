import type { ClaimGuardItem, ClaimGuardResult, QaResult } from '../types.js';
import { proofNeedsEvidenceItems, proofReadyRootCauseGroups } from '../proof/proofReadiness.js';

type ClaimGuardInput = Pick<QaResult, 'qaSignoff' | 'qualityGate' | 'requirementCoverage' | 'environment' | 'scopeReview' | 'sourceRuntimeCorrelation' | 'artifactIntegrity' | 'sourceHealth' | 'rootCauseGroups' | 'issueDisposition' | 'defectProof' | 'p2' | 'security' | 'artifacts' | 'journeyTests'>;

function uniq(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function item(input: Omit<ClaimGuardItem, 'id'>, index: number): ClaimGuardItem {
  return {
    id: `CLAIM-${String(index + 1).padStart(3, '0')}`,
    ...input
  };
}

function statusPriority(status: ClaimGuardItem['status']): number {
  if (status === 'blocked') return 2;
  if (status === 'limited') return 1;
  return 0;
}

function confidenceFromStatus(status: ClaimGuardItem['status']): ClaimGuardItem['confidence'] {
  if (status === 'allowed') return 'high';
  if (status === 'limited') return 'medium';
  return 'low';
}

function buildBusinessValidation(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const hasProvidedRequirements = result.requirementCoverage.summary.providedCount > 0;
  const scopeConfigured = result.scopeReview.status === 'configured';
  const runtimeVerified = result.qaSignoff.businessValidationConfidence === 'runtime-verified';
  const blocked = result.qaSignoff.status === 'blocked' || result.qaSignoff.status === 'fail';
  const status: ClaimGuardItem['status'] = blocked ? 'blocked' : runtimeVerified && hasProvidedRequirements && scopeConfigured ? 'allowed' : 'limited';
  const requiredInputs: string[] = [];
  if (!hasProvidedRequirements) requiredInputs.push('补充 PRD/验收标准，并用 selectors/expectedTexts/apiPatterns/journeySteps 编码核心断言。');
  if (!scopeConfigured) requiredInputs.push('回答 scope-review.md 的产品范围问题，并把确认结果写入 productContext。');
  if (!runtimeVerified) requiredInputs.push('补充至少一个带成功断言的 runtime journey 或 requirement-generated journey。');
  if (blocked) requiredInputs.push('先解决 qaSignoff blocker/fail 项。');
  return {
    claim: 'business-validation',
    status,
    confidence: confidenceFromStatus(status),
    summary: status === 'allowed'
      ? '可以描述为：已运行验证本次提供且可执行的验收标准；仍不应泛化为全业务 100%。'
      : status === 'blocked'
        ? '不能声明业务功能通过；当前 QA 签核失败或阻断。'
        : '只能声明有限运行证据；缺少 PRD、产品范围或带断言的业务 journey 时不能说业务功能已完整通过。',
    allowedWording: status === 'allowed'
      ? '本次提供的验收标准在当前环境下已 runtime-verified。'
      : '当前仅完成有限的页面/源码/运行时证据采集，业务验收仍需补充输入。',
    forbiddenWording: [
      '业务功能验证通过可信度 100%',
      '全量业务流程已通过',
      '没有 PRD/角色/测试数据仍可发布业务结论'
    ],
    evidenceRefs: ['qaSignoff', 'requirementCoverage', 'scopeReview', 'journeyTests'],
    requiredInputs
  };
}

function buildReleaseSignoff(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const hardBlocked = result.qaSignoff.status === 'blocked' || result.qualityGate.status === 'blocked' || result.qaSignoff.status === 'fail' || result.qualityGate.status === 'fail';
  const cleanPass = result.qaSignoff.status === 'pass' && result.qualityGate.status === 'pass' && result.scopeReview.status === 'configured';
  const status: ClaimGuardItem['status'] = hardBlocked ? 'blocked' : cleanPass ? 'allowed' : 'limited';
  const requiredInputs: string[] = [];
  if (result.scopeReview.status !== 'configured') requiredInputs.push('确认产品范围/PRD 后复测。');
  if (result.qaSignoff.status !== 'pass') requiredInputs.push(`处理 qaSignoff=${result.qaSignoff.status} 的 blocker/risk/gap。`);
  if (result.qualityGate.status !== 'pass') requiredInputs.push(`处理 qualityGate=${result.qualityGate.status} 的 gate 项。`);
  return {
    claim: 'release-signoff',
    status,
    confidence: confidenceFromStatus(status),
    summary: cleanPass ? '可以给出当前范围内的 QA pass；仍需限定环境、角色和需求范围。' : hardBlocked ? '不能签核发布；当前存在失败或阻断项。' : '只能给出 pass-with-risks/有限签核。',
    allowedWording: cleanPass ? '当前已配置范围内 QA pass。' : '当前结论为 pass-with-risks / blocked / fail，不能作为无条件发布批准。',
    forbiddenWording: ['无条件发布批准', '所有风险均已消除', 'raw score 等同发布签核'],
    evidenceRefs: ['qaSignoff', 'qualityGate', 'scopeReview', 'professionalSummary'],
    requiredInputs
  };
}

function buildPerformanceClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const failedBudget = result.p2.budgets.some((budget) => budget.status === 'failed');
  const productionTrust = result.environment.trust.performance === 'high';
  const status: ClaimGuardItem['status'] = failedBudget ? 'blocked' : productionTrust ? 'allowed' : 'limited';
  return {
    claim: 'production-performance',
    status,
    confidence: confidenceFromStatus(status),
    summary: failedBudget
      ? '不能声明性能达标；P2 性能预算存在失败项。'
      : productionTrust
        ? '可以在当前环境证据范围内讨论生产性能/预算。'
        : '只能把性能结果作为 dev/staging/pre-production 参考，不能当生产性能结论。',
    allowedWording: productionTrust ? '当前生产等价环境下的性能预算结果为准。' : '当前性能数据仅供环境内参考。',
    forbiddenWording: ['Vite dev server 结果代表生产性能', '本地/内网环境请求数或传输体积等同线上 bundle 表现'],
    evidenceRefs: ['environment', 'p2', 'coverage', 'performance'],
    requiredInputs: productionTrust ? [] : ['使用 build+preview 或生产等价 HTTPS 环境复测性能。']
  };
}

function buildSecurityClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const failedSecurity = result.security.status === 'failed';
  const productionTrust = result.environment.trust.security === 'high';
  const status: ClaimGuardItem['status'] = failedSecurity ? 'blocked' : productionTrust ? 'allowed' : 'limited';
  return {
    claim: 'production-security',
    status,
    confidence: confidenceFromStatus(status),
    summary: failedSecurity
      ? '不能声明安全通过；被动安全扫描存在失败项。'
      : productionTrust
        ? '可以把被动安全检查作为生产等价证据的一部分。'
        : '只能作为部署 checklist 或非生产环境安全参考。',
    allowedWording: productionTrust ? '当前生产等价环境下的被动安全检查结果可用于上线评审。' : '当前安全发现需按环境归因，部署头/TLS 等不归为前端代码缺陷。',
    forbiddenWording: ['localhost/dev server 安全头结果等同生产安全结论', '部署层响应头缺失就是前端代码 bug'],
    evidenceRefs: ['environment', 'security', 'issueDisposition'],
    requiredInputs: productionTrust ? [] : ['在生产等价 HTTPS/nginx/CDN/网关环境复测被动安全项。']
  };
}

function buildFrontendDefectClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const actionable = proofReadyRootCauseGroups(result.rootCauseGroups, result.defectProof);
  const proofGaps = proofNeedsEvidenceItems(result.defectProof);
  const conditional = result.issueDisposition.summary.conditionalCount;
  const status: ClaimGuardItem['status'] = actionable.length > 0 ? 'allowed' : conditional > 0 || proofGaps.length > 0 || result.qaSignoff.confidence !== 'high' ? 'limited' : 'allowed';
  return {
    claim: 'frontend-defect',
    status,
    confidence: status === 'allowed' && actionable.length > 0 ? 'high' : status === 'allowed' ? 'medium' : 'low',
    summary: actionable.length > 0
      ? `可以讨论 ${actionable.length} 个 proof-ready actionable root cause；不要按 raw issue 数量计算工作量。`
      : status === 'limited'
        ? '当前没有 proof-ready 前端根因，但仍有条件项/证据缺口，不能说“无缺陷”。'
        : '当前证据未发现可执行前端根因。',
    allowedWording: actionable.length > 0 ? '按 defectProof=proven/probable 的 rootCauseGroups 列出可执行前端缺陷。' : '当前证据未发现 proof-ready actionable 前端根因。',
    forbiddenWording: ['raw issue 数量等同修复工作量', 'conditional/insufficient-evidence/needs-evidence 直接变成必须修的前端 bug', '覆盖不足时宣称完全无缺陷'],
    evidenceRefs: ['rootCauseGroups', 'issueDisposition', 'defectProof', 'sourceAnalysis', 'sourceRuntimeCorrelation'],
    requiredInputs: status === 'limited' ? ['为 conditional 或 defectProof.needs-evidence findings 补充源码、PRD、角色或运行时复验证据。'] : []
  };
}

function buildApiUiBindingClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const strongLinks = result.sourceRuntimeCorrelation.links.filter((link) => link.confidence === 'high' || link.confidence === 'medium');
  const status: ClaimGuardItem['status'] = result.sourceRuntimeCorrelation.status === 'passed' && strongLinks.length > 0 ? 'allowed' : 'limited';
  return {
    claim: 'api-ui-data-binding',
    status,
    confidence: status === 'allowed' ? 'high' : 'low',
    summary: status === 'allowed'
      ? `可以仅对 ${strongLinks.length} 个 medium/high source-runtime link 范围内的 API/UI 绑定下结论。`
      : '不能提出强 API/UI 数据错配结论；缺少 medium/high 源码×运行时绑定。',
    allowedWording: status === 'allowed' ? '对已绑定 link 的具体 API/UI 区域做限定结论。' : 'API/UI 数据关系未充分绑定，只能列为待源码/旅程复核。',
    forbiddenWording: ['接口有数据但页面空', '后端数据一定没渲染', '全局 network 响应可直接证明某 UI 缺陷'],
    evidenceRefs: ['sourceRuntimeCorrelation', 'network.requests', 'pageModel', 'requirementCoverage'],
    requiredInputs: status === 'allowed' ? [] : ['提供 sourceRoot 并复测，或补充精确 journey/selector/API pattern 绑定。']
  };
}

function buildDownloadClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const downloadedCount = result.artifacts.downloadedFiles?.length ?? 0;
  const integrityOk = result.artifactIntegrity.status === 'passed' || result.artifactIntegrity.status === 'warning';
  const status: ClaimGuardItem['status'] = downloadedCount > 0 && integrityOk ? 'allowed' : 'limited';
  return {
    claim: 'download-export',
    status,
    confidence: status === 'allowed' ? 'high' : 'medium',
    summary: status === 'allowed'
      ? `可以对 ${downloadedCount} 个保存下来的下载/导出文件作产物级结论。`
      : '不能声明导出/下载通过；没有完整的本地文件产物、哈希、内容摘要或证据完整性。',
    allowedWording: status === 'allowed' ? '保存的下载/导出文件产物已进入证据链。' : '下载/导出未做产物级验证。',
    forbiddenWording: ['仅有网络请求就算导出成功', '未保存文件也算下载内容验证通过'],
    evidenceRefs: ['artifacts.downloadedFiles', 'artifactIntegrity', 'downloadContent', 'interactionTests', 'journeyTests'],
    requiredInputs: status === 'allowed' ? [] : ['启用 safety.allowDownload，并验证文件存在、非空、哈希和内容摘要。']
  };
}

function buildSourceHealthClaim(result: ClaimGuardInput): Omit<ClaimGuardItem, 'id'> {
  const failed = result.sourceHealth.status === 'failed';
  const passed = result.sourceHealth.status === 'passed';
  const status: ClaimGuardItem['status'] = failed ? 'blocked' : passed ? 'allowed' : 'limited';
  return {
    claim: 'source-health',
    status,
    confidence: passed || failed ? 'high' : 'low',
    summary: failed
      ? '源码健康检查失败；语法或受控脚本失败是源码确认阻断。'
      : passed
        ? '可以声明已完成源码语法/受控脚本健康检查；这不等同业务通过。'
        : '不能声明源码健康通过；sourceHealth 未运行或被跳过。',
    allowedWording: passed ? 'sourceHealth 已通过已启用的解析/脚本检查。' : failed ? 'sourceHealth 发现源码阻断。' : 'sourceHealth 未提供充分证据。',
    forbiddenWording: ['sourceHealth 通过等同业务功能通过', '未运行 typecheck/lint 也说源码健康无问题'],
    evidenceRefs: ['sourceHealth'],
    requiredInputs: passed || failed ? [] : ['提供 sourceRoot，并在安全时启用 --source-run-scripts --source-scripts "typecheck,lint"。']
  };
}

export function buildClaimGuard(result: ClaimGuardInput): ClaimGuardResult {
  const items = [
    buildBusinessValidation(result),
    buildReleaseSignoff(result),
    buildPerformanceClaim(result),
    buildSecurityClaim(result),
    buildFrontendDefectClaim(result),
    buildApiUiBindingClaim(result),
    buildDownloadClaim(result),
    buildSourceHealthClaim(result)
  ].map(item);
  const worst = items.reduce<ClaimGuardItem['status']>((acc, current) => (statusPriority(current.status) > statusPriority(acc) ? current.status : acc), 'allowed');
  const forbiddenClaims = uniq(items.flatMap((entry) => entry.status === 'allowed' ? [] : entry.forbiddenWording));
  const requiredInputs = uniq(items.flatMap((entry) => entry.requiredInputs));
  const status: ClaimGuardResult['status'] = worst === 'blocked' ? 'blocked' : worst === 'limited' ? 'limited' : 'clear';
  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: status === 'clear'
      ? 'Claim guard clear: current evidence supports the main professional QA claims within the configured scope.'
      : status === 'blocked'
        ? 'Claim guard blocked: at least one common QA claim is contradicted by blockers/failures and must not be used.'
        : 'Claim guard limited: some common QA claims require narrower wording or additional input.',
    items,
    forbiddenClaims,
    requiredInputs,
    notes: [
      'Use claimGuard before writing user-facing conclusions; it defines what the evidence allows the agent to say.',
      'Prefer allowedWording over raw scanner phrasing. Never use forbiddenWording unless explicitly explaining why it is not supported.'
    ]
  };
}

export function createEmptyClaimGuard(): ClaimGuardResult {
  const requiredInputs = ['Rerun FrontLens 1.29+ to generate claimGuard.'];
  return {
    generatedAt: new Date().toISOString(),
    status: 'limited',
    summary: 'Claim guard missing from report; avoid broad QA conclusions until normalized or rerun.',
    items: [],
    forbiddenClaims: ['业务功能验证通过可信度 100%', '无条件发布批准', '完全无缺陷'],
    requiredInputs,
    notes: ['Older reports may not contain claimGuard. Use qaSignoff/professionalSummary conservatively.']
  };
}
