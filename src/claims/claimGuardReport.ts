import type { ClaimGuardResult, QaResult } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

export function formatClaimGuard(input: ClaimGuardResult | Pick<QaResult, 'claimGuard'>, options: { headingLevel?: 1 | 2 } = {}): string {
  const guard = 'claimGuard' in input ? input.claimGuard : input;
  const heading = '#'.repeat(options.headingLevel ?? 1);
  const rows = guard.items.map((item) => `| ${markdownEscape(item.id)} | ${markdownEscape(item.claim)} | ${markdownEscape(item.status)} | ${markdownEscape(item.confidence)} | ${markdownEscape(truncateMiddle(item.allowedWording, 120))} | ${markdownEscape(truncateMiddle(item.forbiddenWording.join('；'), 140))} |`);
  return `${heading} FrontLens Claim Guard / 结论护栏

- Status：**${guard.status}**
- Summary：${markdownEscape(guard.summary)}
- Required inputs：${guard.requiredInputs.length ? markdownEscape(guard.requiredInputs.join('；')) : '-'}
- Notes：${guard.notes.length ? markdownEscape(guard.notes.join('；')) : '-'}

${rows.length ? ['| ID | Claim | Status | Confidence | Allowed wording | Forbidden wording |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前报告缺少 claim guard 明细。'}

${heading}# Forbidden claims

${guard.forbiddenClaims.length ? guard.forbiddenClaims.map((item) => `- ${markdownEscape(item)}`).join('\n') : '-'}
`;
}
