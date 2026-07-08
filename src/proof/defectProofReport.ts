import type { DefectProofResult, QaResult } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

export function formatDefectProof(input: DefectProofResult | Pick<QaResult, 'defectProof'>, options: { headingLevel?: 1 | 2 } = {}): string {
  const proof = 'defectProof' in input ? input.defectProof : input;
  const heading = '#'.repeat(options.headingLevel ?? 1);
  const rows = proof.items.slice(0, 40).map((item) => {
    const missing = item.missingEvidence.length ? item.missingEvidence.slice(0, 3).join('；') : '-';
    const next = item.nextSteps.length ? item.nextSteps.slice(0, 3).join('；') : '-';
    return `| ${markdownEscape(item.id)} | ${markdownEscape(item.rootCauseGroupId)} | ${item.priority} | ${markdownEscape(item.owner)} | ${markdownEscape(item.status)} | ${item.score} | ${markdownEscape(truncateMiddle(item.title, 90))} | ${markdownEscape(truncateMiddle(missing, 140))} | ${markdownEscape(truncateMiddle(next, 140))} |`;
  });
  return `${heading} FrontLens Defect Proof / 缺陷证明强度

- Status：**${proof.status}**
- Summary：${markdownEscape(proof.summary)}
- Counts：proven ${proof.counts.proven} / probable ${proof.counts.probable} / needs-evidence ${proof.counts.needsEvidence} / not-defect ${proof.counts.notDefect}
- Notes：${proof.notes.length ? markdownEscape(proof.notes.join('；')) : '-'}

${rows.length ? ['| ID | Root cause | Priority | Owner | Proof status | Score | Title | Missing / weak evidence | Next step |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前没有 rootCauseGroups 需要证明。'}
`;
}
