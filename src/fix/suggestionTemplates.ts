import type { Issue, IssueSuggestion } from '../types.js';

const priorityRank: Record<NonNullable<IssueSuggestion['priority']>, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

function stricterPriority(base?: IssueSuggestion['priority'], extra?: IssueSuggestion['priority']): IssueSuggestion['priority'] {
  if (!base) return extra;
  if (!extra) return base;
  return priorityRank[base] <= priorityRank[extra] ? base : extra;
}

function merge(base: IssueSuggestion, extra: IssueSuggestion): IssueSuggestion {
  return {
    frontend: base.frontend ?? extra.frontend,
    backend: base.backend ?? extra.backend,
    product: base.product ?? extra.product,
    test: base.test ?? extra.test,
    priority: stricterPriority(base.priority, extra.priority)
  };
}

const apiTableTemplateNoise = /records|total|page\s*size|pagesize|page\/pagesize|分页|排序|筛选|分页参数|分页结构|列表接口|接口契约|openapi|rowselection|表格分页|表格排序|表格筛选|排序字段/i;
const accessibilityFixSignal = /aria|label|alt|焦点|键盘|语义|按钮|链接|表单|对比|颜色|触控|点击区|tabindex|dialog|弹窗|无障碍|axe|wcag/i;
const visualFixSignal = /视觉|截图|diff|基线|布局|遮挡|样式|断点|颜色|token|回归/i;
const seoFixSignal = /seo|title|description|meta|open\s*graph|og:|分享|社交|搜索引擎/i;

function stripNoisyField(value: string | undefined, signal: RegExp): string | undefined {
  if (!value) return value;
  if (apiTableTemplateNoise.test(value) && !signal.test(value)) return undefined;
  return value;
}

function sanitizeSuggestion(issue: Issue, suggestion: IssueSuggestion): IssueSuggestion {
  const clean: IssueSuggestion = { ...suggestion };
  if (issue.category === 'frontend-accessibility') {
    clean.backend = stripNoisyField(clean.backend, accessibilityFixSignal);
    clean.frontend = stripNoisyField(clean.frontend, accessibilityFixSignal) ?? '按具体 a11y 规则修复语义、可访问名称、键盘焦点、触控尺寸或颜色对比。';
    clean.test = stripNoisyField(clean.test, accessibilityFixSignal) ?? '增加 axe/键盘导航/目标断点的可访问性回归。';
    clean.priority = clean.priority ?? 'P3';
  }
  if (issue.category === 'frontend-visual') {
    clean.backend = stripNoisyField(clean.backend, visualFixSignal);
    clean.frontend = stripNoisyField(clean.frontend, visualFixSignal) ?? '确认视觉差异是否符合预期；非预期时修复布局、遮挡、断点样式或设计 token。';
    clean.test = stripNoisyField(clean.test, visualFixSignal) ?? '更新或补充视觉回归基线，并保留 diff 证据。';
  }
  if (issue.category === 'seo') {
    clean.backend = stripNoisyField(clean.backend, seoFixSignal);
    clean.frontend = stripNoisyField(clean.frontend, seoFixSignal) ?? '仅在公开内容/SEO 范围内补充 title、meta description、Open Graph 等元信息。';
    clean.test = stripNoisyField(clean.test, seoFixSignal) ?? '补充 SEO/meta 标签断言；后台页面无 SEO 需求时标记不适用。';
  }
  return clean;
}

export function templateSuggestion(issue: Issue): IssueSuggestion {
  const title = issue.title.toLowerCase();
  const finish = (extra: IssueSuggestion): IssueSuggestion => sanitizeSuggestion(issue, merge(issue.suggestion, extra));
  if (issue.category === 'security') {
    if (/content-security-policy|csp/i.test(issue.title)) return finish({ backend: '在 CDN/网关/后端统一添加 CSP；先 report-only 验证，再逐步收紧 script-src、object-src、base-uri、frame-ancestors。', test: '增加安全响应头回归断言。', priority: 'P1' });
    if (/cookie/i.test(issue.title)) return finish({ backend: '为认证 Cookie 设置 HttpOnly、Secure、SameSite，并避免在 JS 可读存储保存长期令牌。', test: '增加 Set-Cookie 属性契约测试。', priority: 'P1' });
    return finish({ backend: '按 security.checks 中的 rule 和 evidence 修复安全配置。', test: '修复后重新运行 frontlens security。', priority: 'P2' });
  }
  if (issue.category.startsWith('backend-api') || issue.category === 'backend-api-contract') {
    return finish({ backend: '统一接口状态码、错误响应结构、分页/筛选参数和 OpenAPI 文档。', frontend: '按接口契约处理空态、错误态和字段缺失兜底。', test: '补充接口契约测试和前端请求参数断言。', priority: issue.severity === 'high' ? 'P1' : 'P2' });
  }
  if (issue.category === 'backend-realtime') {
    return finish({ frontend: '为实时数据增加错误态、断线重连、订阅恢复和用户可见状态提示。', backend: '检查 GraphQL resolver、WebSocket/SSE 网关、鉴权、心跳和错误码契约。', test: '补充 GraphQL/WebSocket/SSE 连接、错误和重连回归。', priority: issue.severity === 'high' ? 'P1' : 'P2' });
  }
  if (issue.category.startsWith('integration')) {
    return finish({ frontend: '校准前端状态、URL query、请求参数、loading/empty/error 反馈和数据刷新时机。', backend: '统一列表/详情接口字段、分页结构、筛选语义和错误响应。', test: '补充前后端联动 E2E：参数断言、响应字段、空态和错误态。', priority: issue.severity === 'high' ? 'P1' : 'P2' });
  }
  if (issue.category.startsWith('frontend-form')) {
    return finish({ frontend: '为表单字段补充必填、长度、格式、禁用重复提交和保存 loading 状态。', test: '补充表单校验和重复点击回归。', priority: 'P2' });
  }
  if (issue.category.startsWith('frontend-table') || /\btable\b|表格|分页|排序|筛选/.test(title)) {
    if (/分页|排序|筛选|参数|page|sort|filter/.test(issue.title)) {
      return finish({ frontend: '核对表格分页、排序、筛选参数与 UI 状态同步；仅在页面需求包含这些能力时修复。', backend: '列表接口按页面需求提供稳定分页/排序/筛选参数和 total。', test: '补充具体分页、排序、筛选回归；无该产品需求时标记为不适用。', priority: issue.severity === 'low' ? 'P3' : 'P2' });
    }
    return finish({ frontend: '仅修复有明确用户影响的表格状态问题，例如 loading/empty/error 无法区分；产品设计项先确认需求。', test: '补充与当前页面真实需求绑定的表格状态回归。', priority: issue.severity === 'low' ? 'P3' : 'P2' });
  }
  if (issue.category === 'frontend-performance' || issue.category === 'resource-performance') {
    return finish({ frontend: '拆分首屏包、压缩图片、延迟非关键资源、减少长任务和重复渲染。', test: '设置性能预算并在 CI 中门禁。', priority: 'P2' });
  }
  if (issue.category === 'resource-loading') {
    return finish({ frontend: '修正资源路径、构建 publicPath/base、懒加载错误兜底和关键资源预加载。', backend: '检查 CDN/静态资源服务、MIME、缓存、鉴权和回源配置。', test: '补充关键 JS/CSS/图片加载 smoke test。', priority: issue.severity === 'high' ? 'P1' : 'P2' });
  }
  if (issue.category === 'console-error') {
    return finish({ frontend: '定位运行时异常来源，增加空值保护、错误边界和 Promise rejection 处理。', test: '补充首屏渲染、核心交互和错误日志断言。', priority: issue.severity === 'critical' ? 'P0' : 'P1' });
  }
  if (issue.category === 'frontend-visual') {
    return finish({ frontend: '确认视觉差异是否符合预期；非预期时修复布局、遮挡、断点样式或组件状态。', product: '若视觉变更是预期调整，确认验收标准并更新基线。', test: '更新或补充视觉回归基线，并在 CI 中保留 diff 证据。', priority: 'P2' });
  }
  if (issue.category === 'frontend-permission' || issue.category === 'backend-api-auth') {
    return finish({ frontend: '统一无权限、登录过期、危险操作禁用和权限提示组件。', backend: '校准鉴权/授权返回码、权限点和审计日志。', test: '补充不同角色的权限矩阵和 401/403 回归。', priority: issue.severity === 'high' ? 'P1' : 'P2' });
  }
  if (issue.category === 'frontend-accessibility') {
    return finish({ frontend: '补充语义化标签、可访问名称、键盘焦点和颜色对比。', test: '增加 axe/键盘导航回归。', priority: 'P3' });
  }
  return finish({ test: '修复后重新运行 FrontLens，并使用 fingerprint 对比问题是否消失。', priority: issue.severity === 'critical' ? 'P0' : issue.severity === 'high' ? 'P1' : 'P2' });
}

export function applySuggestionTemplates(issues: Issue[]): Issue[] {
  return issues.map((issue) => ({ ...issue, suggestion: templateSuggestion(issue) }));
}
