export function analyze(context) {
  const hasTitle = Boolean(context.pageModel.title);
  if (hasTitle) return [];
  return [
    {
      id: 'CUSTOM-001',
      title: '自定义规则：页面标题为空',
      category: 'frontend-ui',
      severity: 'medium',
      confidence: 0.9,
      description: '示例 Analyzer Plugin 检测到页面标题为空。',
      evidence: {},
      reproduceSteps: ['打开目标页面', '读取 document.title'],
      reason: '标题为空会影响浏览器标签和用户识别。',
      suggestion: {
        frontend: '设置明确的页面 title。',
        priority: 'P2'
      },
      source: 'manual'
    }
  ];
}
