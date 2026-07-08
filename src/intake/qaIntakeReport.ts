import type { QaResult } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';
import path from 'node:path';

function reportPath(result: QaResult, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const outputDir = result.artifacts.outputDir;
  if (outputDir && path.isAbsolute(value)) {
    const relative = path.relative(outputDir, value);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.replace(/\\/g, '/');
    }
  }
  return value.replace(/\\/g, '/');
}

export function formatQaIntake(result: QaResult, options: { headingLevel?: 1 | 2 } = {}): string {
  const intake = result.qaIntake;
  const heading = '#'.repeat(options.headingLevel ?? 1);
  const rows = intake.questions.slice(0, 40).map((item) => {
    const blocks = item.blocksClaims.length ? item.blocksClaims.join(', ') : '-';
    const refs = item.evidenceRefs.length ? item.evidenceRefs.slice(0, 6).join(', ') : '-';
    return `| ${markdownEscape(item.id)} | ${item.priority} | ${markdownEscape(item.category)} | ${markdownEscape(truncateMiddle(item.question, 120))} | ${markdownEscape(truncateMiddle(item.why, 150))} | ${markdownEscape(truncateMiddle(item.howToAnswer, 150))} | ${markdownEscape(blocks)} | ${markdownEscape(refs)} |`;
  });
  const topRows = intake.topQuestions.map((item) => `- **${item.priority} ${markdownEscape(item.category)}**：${markdownEscape(item.question)}`);
  return `${heading} FrontLens QA Intake / 专业测试待补输入

- Status：**${intake.status}**
- Summary：${markdownEscape(intake.summary)}
- Top questions：${intake.topQuestions.length}
- Total questions：${intake.questions.length}
- Config hints：${intake.configHints.length ? markdownEscape(intake.configHints.join('；')) : '-'}
- Intake config：${result.artifacts.qaIntakeConfig ? `\`${reportPath(result, result.artifacts.qaIntakeConfig)}\`` : '-'}
- Ready to proceed：${intake.readyToProceed.length ? markdownEscape(intake.readyToProceed.join('；')) : '-'}

${heading}# Top questions

${topRows.length ? topRows.join('\n') : '当前没有必须追问的输入项。'}

${heading}# Question matrix

${rows.length ? ['| ID | Priority | Category | Question | Why | How to answer | Blocks claims | Evidence refs |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : '当前 QA intake 已就绪。'}

${heading}# How to use

1. 先回答 P0/P1 问题；不要把未回答的问题对应的产品/设计/API/UI 猜测转成缺陷。
2. 编辑 \`qa-intake.config.json\` 中的 \`requirements\`、\`productContext\`、\`journeys\`、\`testData\`、\`source\` 后用 \`--config\` 重跑。
3. 若没有 PRD/验收标准，保持 \`requirements.inferFromPage=false\`，避免把页面能力推断写成业务通过。
`;
}
