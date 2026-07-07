import type { ProductContextSuggestionResult, QaResult, ScopeReviewQuestion } from '../types.js';

function escapeMarkdown(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

function truncate(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function featureList(items: string[]): string {
  return items.length ? items.map(escapeMarkdown).join(', ') : '-';
}

function questionRows(questions: ScopeReviewQuestion[]): string {
  if (questions.length === 0) return '产品范围已配置；当前没有待确认问题。';
  return [
    '| ID | Category | Question | Default disposition |',
    '| --- | --- | --- | --- |',
    ...questions.map((item) => `| ${escapeMarkdown(item.id)} | ${escapeMarkdown(item.category)} | ${escapeMarkdown(truncate(item.question, 160))} | ${escapeMarkdown(truncate(item.defaultDisposition, 160))} |`)
  ].join('\n');
}

export function buildProductContextSuggestion(result: QaResult): ProductContextSuggestionResult {
  const productContext = result.scopeReview.configSnippet.productContext;
  const configPath = typeof result.artifacts.productContextConfig === 'string' && result.artifacts.productContextConfig.length > 0
    ? result.artifacts.productContextConfig
    : undefined;
  const configArg = configPath ?? 'frontlens.config.json';
  return {
    generatedAt: new Date().toISOString(),
    status: result.scopeReview.status,
    confidence: result.scopeReview.confidence,
    pageType: result.scopeReview.pageType,
    summary: result.scopeReview.status === 'configured'
      ? 'productContext is already configured; keep it as the source of truth for product/design triage.'
      : 'Review this suggested productContext with Product/QA before using it to downgrade style, device, export, pagination, refresh, SEO, or accessibility observations.',
    productContext,
    questions: result.scopeReview.questions,
    notes: [
      'This artifact is a reviewable scope contract, not an automatic PRD decision.',
      'After Product/QA confirms it, copy usage.configSnippet into the FrontLens config and rerun QA.',
      'Until confirmed, scope-sensitive findings should stay conditional/non-actionable rather than must-fix implementation defects.'
    ],
    usage: {
      configKey: 'productContext',
      configPath,
      configSnippet: { productContext },
      rerunCommand: `node dist/cli.js qa --url ${JSON.stringify(result.summary.url)} --config ${JSON.stringify(configArg)} --output "reports/frontlens/with-product-context" --no-trace --json`
    }
  };
}

export function formatProductContextSuggestion(suggestion: ProductContextSuggestionResult): string {
  const json = JSON.stringify(suggestion.usage.configSnippet, null, 2).replace(/```/g, '`​``');
  const context = suggestion.productContext;
  const decisions = context.decisions.length
    ? context.decisions.map((item, index) => `- ${escapeMarkdown(item.id ?? `DECISION-${index + 1}`)}: ${escapeMarkdown(item.title)}${item.appliesTo?.length ? `（appliesTo: ${escapeMarkdown(item.appliesTo.join(', '))}）` : ''}${item.rationale ? ` — ${escapeMarkdown(item.rationale)}` : ''}`).join('\n')
    : '-';
  return `# FrontLens Product Context Suggestion

## Status

- Scope review: **${suggestion.status}** / confidence **${suggestion.confidence}**
- Page type: **${suggestion.pageType}**
- Summary: ${escapeMarkdown(suggestion.summary)}

## Suggested productContext

| Field | Value |
| --- | --- |
| productName | ${escapeMarkdown(context.productName ?? '-')} |
| pageName | ${escapeMarkdown(context.pageName ?? '-')} |
| pageType | ${escapeMarkdown(context.pageType ?? '-')} |
| deviceScope | ${escapeMarkdown(context.deviceScope)} |
| accessibilityTarget | ${escapeMarkdown(context.accessibilityTarget)} |
| requiredFeatures | ${featureList(context.requiredFeatures)} |
| optionalFeatures | ${featureList(context.optionalFeatures)} |
| outOfScopeFeatures | ${featureList(context.outOfScopeFeatures)} |
| adrRefs | ${featureList(context.adrRefs)} |

### Decisions

${decisions}

## Questions to confirm before applying

${questionRows(suggestion.questions)}

## Config snippet

\`\`\`json
${json}
\`\`\`

${suggestion.usage.configPath ? `Config artifact: \`${escapeMarkdown(suggestion.usage.configPath)}\`\n` : ''}

## How to use

1. Review the questions above with Product/QA/Design.
2. If a \`product-context.config.json\` artifact exists, edit/approve it directly; otherwise copy the confirmed \`productContext\` into your FrontLens config.
3. Rerun QA with the reviewed config:

\`\`\`bash
${suggestion.usage.rerunCommand}
\`\`\`

## Guardrail

Do not treat this suggestion as an automatic PRD decision. Until confirmed, style/product/device/a11y optional-feature findings remain conditional or non-actionable rather than implementation defects.
`;
}
