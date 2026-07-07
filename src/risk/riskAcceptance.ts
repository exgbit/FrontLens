import type { QaResult, RiskAcceptanceApprover, RiskAcceptanceItem, RiskAcceptanceResult, RiskRegisterItem } from '../types.js';
import { markdownEscape } from '../utils/text.js';

export type RiskAcceptanceInput = Pick<QaResult, 'riskRegister'>;

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function approversFor(risk: RiskRegisterItem, mitigationRequired: boolean): RiskAcceptanceApprover[] {
  const approvers: RiskAcceptanceApprover[] = ['qa'];
  if (mitigationRequired || risk.owner === 'frontend' || risk.owner === 'backend') approvers.push('engineering');
  if (risk.owner === 'product' || risk.category === 'product-scope' || risk.category === 'coverage') approvers.push('product');
  if (risk.owner === 'security' || risk.category === 'environment' && /security|https|tls|csp|header/i.test(`${risk.title} ${risk.trigger}`)) approvers.push('security');
  if (risk.blocksRelease || risk.level === 'critical' || risk.level === 'high') approvers.push('release-manager');
  return unique(approvers);
}

function requiresMitigation(risk: RiskRegisterItem): boolean {
  if (risk.status === 'blocked') return true;
  if (!risk.blocksRelease) return false;
  return risk.category === 'defect'
    || risk.category === 'source-health'
    || risk.category === 'artifact'
    || risk.category === 'test-data'
    || risk.category === 'release'
    || risk.level === 'critical';
}

function acceptanceCriteriaFor(risk: RiskRegisterItem, mitigationRequired: boolean): string[] {
  if (mitigationRequired) {
    return [
      '风险不能仅靠接受关闭；必须先执行 mitigation。',
      risk.mitigation,
      risk.verification
    ].filter(Boolean);
  }
  return [
    'Product/QA/Release 明确确认该风险在本次范围内可接受。',
    '记录接受原因、影响范围、到期条件和后续补测/修复计划。',
    risk.verification || '后续版本或发布前复测该风险。'
  ];
}

function minimumEvidenceFor(risk: RiskRegisterItem, mitigationRequired: boolean): string[] {
  const evidence = [
    ...risk.evidenceRefs.slice(0, 5),
    mitigationRequired ? '修复/补证后的 FrontLens rerun 或 CI 证据。' : '风险接受人、日期、范围、过期条件和回滚/监控计划。'
  ].filter(Boolean);
  return unique(evidence);
}

function shouldTrack(risk: RiskRegisterItem): boolean {
  if (risk.status === 'accepted' || risk.status === 'mitigated') return false;
  return risk.blocksRelease || risk.level === 'critical' || risk.level === 'high';
}

export function buildRiskAcceptance(result: RiskAcceptanceInput): RiskAcceptanceResult {
  const items: RiskAcceptanceItem[] = result.riskRegister.items
    .filter(shouldTrack)
    .slice(0, 30)
    .map((risk, index) => {
      const mitigationRequired = requiresMitigation(risk);
      return {
        id: `RISK-ACCEPT-${String(index + 1).padStart(3, '0')}`,
        riskId: risk.id,
        title: risk.title,
        category: risk.category,
        level: risk.level,
        blocksRelease: risk.blocksRelease,
        owner: risk.owner,
        decision: mitigationRequired ? 'must-mitigate' : 'needs-acceptance',
        requiredApprovers: approversFor(risk, mitigationRequired),
        acceptanceCriteria: acceptanceCriteriaFor(risk, mitigationRequired),
        minimumEvidence: minimumEvidenceFor(risk, mitigationRequired),
        mitigationRequired,
        expiry: risk.blocksRelease ? 'Before release / 发布前' : 'Before next release or risk-review checkpoint / 下个发布或风险复盘点前',
        notes: [
          `Trigger: ${risk.trigger}`,
          `Impact/Likelihood: ${risk.impact}/${risk.likelihood}; exposure ${risk.exposure}`
        ]
      };
    });

  const mustMitigateCount = items.filter((item) => item.decision === 'must-mitigate').length;
  const acceptanceRequiredCount = items.filter((item) => item.decision === 'needs-acceptance').length;
  const releaseBlockingCount = items.filter((item) => item.blocksRelease).length;
  const status: RiskAcceptanceResult['status'] = mustMitigateCount > 0
    ? 'blocked'
    : acceptanceRequiredCount > 0
      ? 'needs-acceptance'
      : 'not-needed';

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      itemCount: items.length,
      mustMitigateCount,
      acceptanceRequiredCount,
      acceptedCount: items.filter((item) => item.decision === 'accepted').length,
      rejectedCount: items.filter((item) => item.decision === 'rejected').length,
      deferredCount: items.filter((item) => item.decision === 'deferred').length,
      releaseBlockingCount
    },
    items,
    notes: [
      'Risk acceptance is a decision checklist generated from riskRegister; it does not auto-accept any risk.',
      'must-mitigate items require mitigation/verification before release. needs-acceptance items require explicit Product/QA/Release acceptance if not mitigated.'
    ]
  };
}

export function formatRiskAcceptance(result: RiskAcceptanceResult): string {
  const rows = result.items.slice(0, 30).map((item) => `| ${item.id} | ${item.riskId} | ${item.decision} | ${item.level} | ${item.blocksRelease ? 'yes' : 'no'} | ${item.owner} | ${item.requiredApprovers.join(', ')} | ${markdownEscape(item.title)} | ${markdownEscape(item.acceptanceCriteria.slice(0, 2).join('；'))} |`);
  return `# FrontLens Risk Acceptance

- Status: **${result.status}**
- Items: ${result.summary.itemCount}
- Must mitigate / Needs acceptance: ${result.summary.mustMitigateCount} / ${result.summary.acceptanceRequiredCount}
- Accepted / Rejected / Deferred: ${result.summary.acceptedCount} / ${result.summary.rejectedCount} / ${result.summary.deferredCount}
- Release-blocking: ${result.summary.releaseBlockingCount}

## Decision Checklist

${rows.length ? ['| ID | Risk | Decision | Level | Blocks release | Owner | Required approvers | Title | Criteria / Evidence |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No high/critical or release-blocking risks need explicit acceptance.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
