import type { Page } from 'playwright';
import type { ArtifactIndex, ConsoleRecord, FrontLensConfig, Issue, NetworkRecord, PageErrorRecord, PageModel, ResourceRecord, SecurityCheckResult, SecurityScanResult, Severity } from '../types.js';
import { IssueFactory } from '../analyzers/issueFactory.js';
import { compactText, truncateMiddle } from '../utils/text.js';
import { redactText, redactUrl } from '../utils/redact.js';
import { isViteDevNetworkRecord, isViteDevServerRun } from '../utils/devServer.js';

interface SecurityScannerInput {
  page: Page;
  config: FrontLensConfig;
  artifacts: ArtifactIndex;
  pageModel: PageModel;
  networkRecords: NetworkRecord[];
  consoleRecords: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  resourceRecords: ResourceRecord[];
}

export interface SecurityScannerOutput {
  result: SecurityScanResult;
  issues: Issue[];
}

interface CookieFinding {
  name: string;
  missing: string[];
  requestId?: string;
}

interface DomSecuritySnapshot {
  inlineScriptCount: number;
  inlineEventHandlers: Array<{ selector: string; attribute: string }>;
  javascriptLinks: Array<{ selector: string; href: string }>;
  srcdocFrames: Array<{ selector: string }>;
  storageFindings: Array<{ storage: 'localStorage' | 'sessionStorage'; key: string; reason: string }>;
  thirdPartyWithoutSri: Array<{ selector: string; url: string; tag: string }>;
}

const SENSITIVE_KEY_EXACT_PATTERN = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|secret|client[_-]?secret|password|passwd|pwd|jwt|session[_-]?id|auth(?:orization)?|cookie)$/i;
const SENSITIVE_TEXT_PATTERN = /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|password|passwd|secret|jwt)\s*[:=]/i;
const API_LEAK_PATTERN = /(traceback|stack trace|sql syntax|SQLException|PostgreSQL|MySQL|MongoError|ORA-\d+|\/var\/www|\/usr\/src|\/Users\/|internal server error|at\s+\S+\s*\([^)]*:\d+:\d+\))/i;
const MUTATING_METHOD_PATTERN = /^(POST|PUT|PATCH|DELETE)$/i;

export function createEmptySecurityResult(config: FrontLensConfig, message = 'Security scan disabled.', status: SecurityScanResult['status'] = 'skipped'): SecurityScanResult {
  const enabled = config.security.enabled;
  const effectiveStatus = enabled ? status : 'skipped';
  const includePlaceholder = !enabled || effectiveStatus !== 'passed';
  return {
    enabled,
    mode: config.security.mode,
    score: 100,
    status: effectiveStatus,
    checkedAt: new Date().toISOString(),
    summary: {
      checkCount: includePlaceholder ? 1 : 0,
      failedCount: effectiveStatus === 'failed' ? 1 : 0,
      warningCount: 0,
      passedCount: effectiveStatus === 'passed' && includePlaceholder ? 1 : 0,
      skippedCount: effectiveStatus === 'skipped' && includePlaceholder ? 1 : 0,
      highCount: effectiveStatus === 'failed' ? 1 : 0,
      mediumCount: 0,
      lowCount: 0,
      infoCount: effectiveStatus === 'failed' ? 0 : includePlaceholder ? 1 : 0
    },
    checks: includePlaceholder
      ? [
          {
            id: 'SEC-001',
            category: 'active-probing',
            rule: enabled ? 'security-scan-not-collected' : 'security-disabled',
            status: effectiveStatus,
            severity: effectiveStatus === 'failed' ? 'high' : 'info',
            title: enabled ? 'Security scan not collected' : 'Security scan disabled',
            description: message,
            evidence: [],
            suggestion: { test: enabled ? '检查 security.scan phase error，并重新运行被动安全扫描。' : 'Set security.enabled=true to run passive security checks.', priority: 'P3' }
          }
        ]
      : []
  };
}

function lowerHeaders(headers?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function sameOrigin(a: string, b: string): boolean {
  const left = originOf(a);
  const right = originOf(b);
  return Boolean(left && right && left === right);
}

function isHttpUrl(value: string): boolean {
  return /^http:\/\//i.test(value);
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    a === 169 && b === 254 ||
    a === 192 && b === 168 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 100 && b >= 64 && b <= 127
  );
}

function ipv4FromMappedIpv6(host: string): string | undefined {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (!hex) return undefined;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return undefined;
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

export function isLocalOrPrivateTarget(value: string): boolean {
  if (/^file:/i.test(value)) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    const ipv4Mapped = ipv4FromMappedIpv6(host);
    return (
      host === 'localhost' ||
      host === 'host.docker.internal' ||
      host.endsWith('.docker.internal') ||
      host.endsWith('.testcontainers.internal') ||
      host.endsWith('.localhost') ||
      host === '::1' ||
      host === '0:0:0:0:0:0:0:1' ||
      host === '::' ||
      host.endsWith('.local') ||
      host.startsWith('fe80:') ||
      /^f[cd][0-9a-f]{2}:/i.test(host) ||
      isPrivateIpv4(host) ||
      Boolean(ipv4Mapped && isPrivateIpv4(ipv4Mapped))
    );
  } catch {
    return false;
  }
}

function isSafetyBlocked(record: NetworkRecord): boolean {
  return record.failed && /blockedbyclient|blocked|abort|aborted/i.test(record.failureText ?? '');
}

function splitSetCookie(value: string): string[] {
  return value
    .split(/,(?=\s*[^;,=]+=[^;,]+)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function severityPenalty(severity: Severity, status: SecurityCheckResult['status']): number {
  if (status === 'passed' || status === 'skipped') return 0;
  const base = severity === 'high' ? 12 : severity === 'medium' ? 6 : severity === 'low' ? 3 : 1;
  return status === 'failed' ? base : Math.max(1, Math.round(base / 2));
}

function summarize(checks: SecurityCheckResult[], enabled: boolean, mode: FrontLensConfig['security']['mode']): SecurityScanResult {
  const score = Math.max(0, Math.min(100, 100 - checks.reduce((sum, check) => sum + severityPenalty(check.severity, check.status), 0)));
  const failedCount = checks.filter((check) => check.status === 'failed').length;
  const warningCount = checks.filter((check) => check.status === 'warning').length;
  return {
    enabled,
    mode,
    score,
    status: !enabled ? 'skipped' : failedCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed',
    checkedAt: new Date().toISOString(),
    summary: {
      checkCount: checks.length,
      failedCount,
      warningCount,
      passedCount: checks.filter((check) => check.status === 'passed').length,
      skippedCount: checks.filter((check) => check.status === 'skipped').length,
      highCount: checks.filter((check) => check.severity === 'high' && check.status !== 'passed' && check.status !== 'skipped').length,
      mediumCount: checks.filter((check) => check.severity === 'medium' && check.status !== 'passed' && check.status !== 'skipped').length,
      lowCount: checks.filter((check) => check.severity === 'low' && check.status !== 'passed' && check.status !== 'skipped').length,
      infoCount: checks.filter((check) => check.severity === 'info' && check.status !== 'passed' && check.status !== 'skipped').length
    },
    checks
  };
}

function checkToIssue(factory: IssueFactory, check: SecurityCheckResult, artifacts: ArtifactIndex): Issue | undefined {
  if (check.status === 'passed' || check.status === 'skipped') {
    return undefined;
  }
  const issueSeverity: Severity = check.status === 'warning'
    ? check.severity === 'high'
      ? 'medium'
      : check.severity === 'medium'
        ? 'low'
        : check.severity
    : check.severity;
  return factory.create({
    title: `安全扫描：${check.title}`,
    category: 'security',
    severity: issueSeverity === 'info' ? 'low' : issueSeverity,
    confidence: check.status === 'warning' ? 0.72 : 0.86,
    description: check.description,
    evidence: {
      screenshot: artifacts.screenshot,
      networkRequestId: check.evidence.find((item) => item.networkRequestId)?.networkRequestId,
      selector: check.evidence.find((item) => item.selector)?.selector,
      details: {
        securityCheckId: check.id,
        category: check.category,
        rule: check.rule,
        evidence: check.evidence
      }
    },
    reproduceSteps: ['运行 FrontLens 安全扫描', `查看 security.checks 中的 ${check.id}`, '根据 evidence 中的 header、selector、URL 或 requestId 定位问题'],
    reason: check.description,
    suggestion: check.suggestion,
    source: 'rule'
  });
}

async function collectDomSecuritySnapshot(page: Page): Promise<DomSecuritySnapshot> {
  return page.evaluate<DomSecuritySnapshot>(() => {
    const cssEscape = (value: string): string => {
      const css = (window as unknown as { CSS?: { escape?: (input: string) => string } }).CSS;
      return css?.escape ? css.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    };
    const selectorFor = (element: Element): string => {
      if (element.id) return `#${cssEscape(element.id)}`;
      const testId = element.getAttribute('data-testid') ?? element.getAttribute('data-test') ?? element.getAttribute('data-cy');
      if (testId) return `[data-testid="${testId.replace(/"/g, '\\"')}"]`;
      const path: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && path.length < 5) {
        const parent: Element | null = current.parentElement;
        const tag = current.tagName.toLowerCase();
        if (!parent) {
          path.unshift(tag);
          break;
        }
        const currentTag = current.tagName;
        const siblings = Array.from(parent.children).filter((item): item is Element => item instanceof Element && item.tagName === currentTag);
        path.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''}`);
        current = parent;
      }
      return path.join(' > ') || element.tagName.toLowerCase();
    };
    const storageFindings: DomSecuritySnapshot['storageFindings'] = [];
    const scanStorage = (storage: Storage, name: 'localStorage' | 'sessionStorage') => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) ?? '';
        const value = storage.getItem(key) ?? '';
        const sensitiveKey = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|secret|client[_-]?secret|password|passwd|pwd|jwt|session[_-]?id|auth(?:orization)?|cookie)$/i.test(key);
        const sensitiveValue = /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|client[_-]?secret|password|passwd|secret|jwt)\s*[:=]/i.test(value);
        if (sensitiveKey || sensitiveValue) {
          storageFindings.push({ storage: name, key, reason: sensitiveKey ? 'sensitive key name' : 'sensitive-looking value' });
        }
      }
    };
    try {
      scanStorage(localStorage, 'localStorage');
    } catch {
      // Ignore inaccessible storage.
    }
    try {
      scanStorage(sessionStorage, 'sessionStorage');
    } catch {
      // Ignore inaccessible storage.
    }

    const inlineEventHandlers = Array.from(document.querySelectorAll('*'))
      .flatMap((element) => Array.from(element.attributes).filter((attribute) => /^on/i.test(attribute.name)).map((attribute) => ({ selector: selectorFor(element), attribute: attribute.name })))
      .slice(0, 40);
    const javascriptLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="javascript:"], area[href^="javascript:"]'))
      .map((element) => ({ selector: selectorFor(element), href: element.getAttribute('href') ?? '' }))
      .slice(0, 40);
    const srcdocFrames = Array.from(document.querySelectorAll('iframe[srcdoc]')).map((element) => ({ selector: selectorFor(element) })).slice(0, 20);
    const pageOrigin = location.origin;
    const thirdPartyWithoutSri = [
      ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]')).map((element) => ({ element, url: element.src, tag: 'script' })),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).map((element) => ({ element, url: element.href, tag: 'link' }))
    ]
      .filter((item) => {
        try {
          const url = new URL(item.url, location.href);
          return url.origin !== pageOrigin && !item.element.getAttribute('integrity');
        } catch {
          return false;
        }
      })
      .map((item) => ({ selector: selectorFor(item.element), url: item.url, tag: item.tag }))
      .slice(0, 40);

    return {
      inlineScriptCount: Array.from(document.querySelectorAll('script:not([src])')).filter((script) => (script.textContent ?? '').trim().length > 0).length,
      inlineEventHandlers,
      javascriptLinks,
      srcdocFrames,
      storageFindings,
      thirdPartyWithoutSri
    };
  });
}

async function runActiveReflectionProbe(page: Page, config: FrontLensConfig): Promise<SecurityCheckResult> {
  if (!config.security.activeProbing || config.security.mode !== 'active') {
    return {
      id: 'SEC-ACTIVE',
      category: 'active-probing',
      rule: 'active-probing-disabled',
      status: 'skipped',
      severity: 'info',
      title: '主动安全探测未启用',
      description: '默认仅执行被动安全扫描；设置 security.mode=active 且 activeProbing=true 后执行安全 canary 反射测试。',
      evidence: [],
      suggestion: { test: '仅在授权环境开启 active probing，并将结果与被动扫描一起审查。', priority: 'P3' }
    };
  }

  const canary = `frontlens_probe_${Date.now()}`;
  let probeUrl = config.target.url;
  try {
    const parsed = new URL(config.target.url);
    parsed.searchParams.set('frontlens_probe', canary);
    probeUrl = parsed.toString();
  } catch {
    return {
      id: 'SEC-ACTIVE',
      category: 'active-probing',
      rule: 'active-reflection-probe',
      status: 'skipped',
      severity: 'info',
      title: '主动反射测试跳过',
      description: '目标 URL 无法解析，未执行主动 canary 反射测试。',
      evidence: [],
      suggestion: { test: '提供可解析的 http/https URL 后再启用 active probing。', priority: 'P3' }
    };
  }

  const probePage = await page.context().newPage();
  try {
    await probePage.goto(probeUrl, { waitUntil: config.browser.waitUntil, timeout: config.browser.timeoutMs }).catch(() => undefined);
    await probePage.waitForTimeout(Math.min(config.browser.extraWaitMs, 1000)).catch(() => undefined);
    const bodyText = await probePage.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    const reflected = bodyText.includes(canary);
    return {
      id: 'SEC-ACTIVE',
      category: 'active-probing',
      rule: 'active-reflection-probe',
      status: reflected ? 'warning' : 'passed',
      severity: reflected ? 'medium' : 'info',
      title: reflected ? 'URL 参数 canary 被页面反射' : '主动反射 canary 未发现反射',
      description: reflected ? '启用 active probing 后，FrontLens 发现 harmless canary 查询参数出现在页面可见文本中。需要人工确认是否正确转义。' : '未在页面可见文本中发现 canary 参数反射。',
      evidence: reflected ? [{ url: redactUrl(probeUrl), details: { canary: '[REDACTED_CANARY]' } }] : [],
      suggestion: reflected
        ? { frontend: '确认 URL 参数渲染路径是否经过 HTML/属性/URL 上下文转义，避免 DOM XSS。', test: '补充参数反射转义测试。', priority: 'P2' }
        : { test: '保留 active probing 作为授权环境下的可选回归。', priority: 'P3' }
    };
  } finally {
    await probePage.close().catch(() => undefined);
  }
}

function findDocumentRequest(records: NetworkRecord[], targetUrl: string): NetworkRecord | undefined {
  return records.find((record) => record.resourceType === 'document') ?? records.find((record) => sameOrigin(record.url, targetUrl)) ?? records[0];
}

function addHeaderChecks(checks: SecurityCheckResult[], documentRequest: NetworkRecord | undefined, targetUrl: string): void {
  const headers = lowerHeaders(documentRequest?.responseHeaders);
  const csp = headers['content-security-policy'] ?? '';
  const isHttps = isHttpsUrl(targetUrl);
  const localOrPrivate = isLocalOrPrivateTarget(targetUrl);
  const definitions: Array<{ header: string; title: string; severity: Severity; requiredWhen?: boolean; weak?: (value: string) => boolean; fix: string }> = [
    { header: 'content-security-policy', title: '缺少 Content-Security-Policy', severity: 'high', weak: (value) => /unsafe-inline|unsafe-eval|\*/i.test(value), fix: '在网关或后端添加严格 CSP，至少限制 script-src/object-src/base-uri/frame-ancestors。' },
    { header: 'x-content-type-options', title: '缺少 X-Content-Type-Options', severity: 'medium', weak: (value) => !/nosniff/i.test(value), fix: '设置 X-Content-Type-Options: nosniff。' },
    { header: 'referrer-policy', title: '缺少 Referrer-Policy', severity: 'low', fix: '设置 Referrer-Policy: strict-origin-when-cross-origin 或更严格策略。' },
    { header: 'permissions-policy', title: '缺少 Permissions-Policy', severity: 'low', fix: '按业务需要限制 camera、microphone、geolocation 等浏览器能力。' },
    { header: 'strict-transport-security', title: 'HTTPS 页面缺少 HSTS', severity: 'medium', requiredWhen: isHttps, fix: 'HTTPS 站点设置 Strict-Transport-Security，并逐步评估 includeSubDomains/preload。' },
    { header: 'cross-origin-opener-policy', title: '缺少 Cross-Origin-Opener-Policy', severity: 'low', fix: '根据业务兼容性设置 COOP，降低跨窗口数据泄露风险。' },
    { header: 'cross-origin-resource-policy', title: '缺少 Cross-Origin-Resource-Policy', severity: 'low', fix: '为敏感资源设置 CORP，限制跨站读取。' }
  ];

  if (localOrPrivate) {
    for (const definition of definitions) {
      if (definition.requiredWhen === false) continue;
      checks.push({
        id: '',
        category: 'headers',
        rule: `security-header-${definition.header}`,
        status: 'skipped',
        severity: 'info',
        title: `本地/私网环境跳过安全响应头门禁：${definition.header}`,
        description: `目标是本地、文件或私网地址，${definition.header} 由生产网关/部署层负责配置，本次不计入页面缺陷或安全扣分。`,
        evidence: [{ networkRequestId: documentRequest?.id, header: definition.header, details: { target: redactUrl(targetUrl), deploymentOwned: true } }],
        suggestion: { backend: definition.fix, test: '生产或预发域名应在部署 checklist/CI 中校验该响应头。', priority: 'P3' }
      });
    }
    checks.push({
      id: '',
      category: 'headers',
      rule: 'clickjacking-protection',
      status: 'skipped',
      severity: 'info',
      title: '本地/私网环境跳过点击劫持响应头门禁',
      description: '目标是本地、文件或私网地址，CSP frame-ancestors / X-Frame-Options 由生产网关/部署层负责配置，本次不计入页面缺陷或安全扣分。',
      evidence: [{ networkRequestId: documentRequest?.id, header: 'content-security-policy', details: { target: redactUrl(targetUrl), deploymentOwned: true } }],
      suggestion: { backend: '生产环境配置 CSP frame-ancestors 或 X-Frame-Options。', test: '生产或预发域名应在部署 checklist/CI 中校验点击劫持防护。', priority: 'P3' }
    });
    return;
  }

  for (const definition of definitions) {
    if (definition.requiredWhen === false) continue;
    const value = headers[definition.header];
    const weak = value && definition.weak?.(value);
    if (!value || weak) {
      checks.push({
        id: '',
        category: 'headers',
        rule: `security-header-${definition.header}`,
        status: weak ? 'warning' : 'failed',
        severity: weak ? 'medium' : definition.severity,
        title: weak ? `安全响应头策略较弱：${definition.header}` : definition.title,
        description: weak ? `${definition.header} 当前值包含宽松配置：${compactText(value, 160)}。` : `主文档响应未发现 ${definition.header} 安全头。`,
        evidence: [{ networkRequestId: documentRequest?.id, header: definition.header, details: value ? { value } : undefined }],
        suggestion: { backend: definition.fix, priority: definition.severity === 'high' ? 'P1' : 'P2' }
      });
    } else {
      checks.push({
        id: '',
        category: 'headers',
        rule: `security-header-${definition.header}`,
        status: 'passed',
        severity: 'info',
        title: `已设置 ${definition.header}`,
        description: `${definition.header} 已存在。`,
        evidence: [{ networkRequestId: documentRequest?.id, header: definition.header }],
        suggestion: { test: '持续在 CI 中校验安全响应头。', priority: 'P3' }
      });
    }
  }

  const frameAncestors = /frame-ancestors/i.test(csp);
  const xfo = headers['x-frame-options'];
  checks.push({
    id: '',
    category: 'headers',
    rule: 'clickjacking-protection',
    status: frameAncestors || xfo ? 'passed' : 'failed',
    severity: frameAncestors || xfo ? 'info' : 'medium',
    title: frameAncestors || xfo ? '已配置点击劫持防护' : '缺少点击劫持防护',
    description: frameAncestors || xfo ? '检测到 CSP frame-ancestors 或 X-Frame-Options。' : '未检测到 CSP frame-ancestors 或 X-Frame-Options，页面可能被第三方 iframe 嵌入。',
    evidence: [{ networkRequestId: documentRequest?.id, header: xfo ? 'x-frame-options' : 'content-security-policy', details: { xFrameOptions: xfo, hasFrameAncestors: frameAncestors } }],
    suggestion: { backend: '优先使用 CSP frame-ancestors；兼容需要时补充 X-Frame-Options: DENY/SAMEORIGIN。', priority: 'P2' }
  });
}

function addCookieChecks(checks: SecurityCheckResult[], records: NetworkRecord[], targetUrl: string): void {
  const findings: CookieFinding[] = [];
  for (const record of records) {
    const headers = lowerHeaders(record.responseHeaders);
    const raw = headers['set-cookie'];
    if (!raw) continue;
    for (const cookie of splitSetCookie(raw)) {
      const [namePair, ...attrs] = cookie.split(';').map((item) => item.trim());
      const name = redactText(namePair.split('=')[0] ?? 'cookie');
      const attrText = attrs.join(';').toLowerCase();
      const missing = [];
      if (!/httponly/i.test(attrText)) missing.push('HttpOnly');
      if (isHttpsUrl(targetUrl) && !/secure/i.test(attrText)) missing.push('Secure');
      if (!/samesite=/i.test(attrText)) missing.push('SameSite');
      if (missing.length) findings.push({ name, missing, requestId: record.id });
    }
  }
  checks.push({
    id: '',
    category: 'cookies',
    rule: 'cookie-security-attributes',
    status: findings.length > 0 ? 'failed' : 'passed',
    severity: findings.some((item) => item.missing.includes('HttpOnly') || item.missing.includes('Secure')) ? 'high' : findings.length ? 'medium' : 'info',
    title: findings.length > 0 ? `Cookie 安全属性缺失：${findings.length} 个` : 'Cookie 安全属性未发现明显问题',
    description: findings.length > 0 ? '部分 Set-Cookie 缺少 HttpOnly、Secure 或 SameSite，可能增加 XSS 窃取、明文传输或 CSRF 风险。' : '未发现缺少关键安全属性的 Set-Cookie。',
    evidence: findings.slice(0, 30).map((item) => ({ networkRequestId: item.requestId, cookieName: item.name, details: { missing: item.missing } })),
    suggestion: { backend: '为会话 Cookie 设置 HttpOnly、Secure、SameSite=Lax/Strict；跨站场景明确使用 SameSite=None; Secure。', priority: findings.length ? 'P1' : 'P3' }
  });
}


export function hasSensitiveUrlSignal(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return true;
    for (const [key, value] of parsed.searchParams) {
      if (SENSITIVE_KEY_EXACT_PATTERN.test(key) && value.trim().length > 0) return true;
      if (SENSITIVE_TEXT_PATTERN.test(`${key}=${value}`)) return true;
    }
    return false;
  } catch {
    return SENSITIVE_TEXT_PATTERN.test(url);
  }
}

function walkSensitiveJson(value: unknown, depth = 0): boolean {
  if (depth > 5 || value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => walkSensitiveJson(item, depth + 1));
  if (typeof value !== 'object') return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_EXACT_PATTERN.test(key)) {
      if (typeof item === 'string' && item.trim().length > 0) return true;
      if (typeof item === 'number') return true;
    }
    if (walkSensitiveJson(item, depth + 1)) return true;
  }
  return false;
}

export function hasSensitivePayloadSignal(text: string | undefined | null, contentType = ''): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if ((/json/i.test(contentType) || /^[{[]/.test(trimmed)) && trimmed.length <= 200_000) {
    try {
      return walkSensitiveJson(JSON.parse(trimmed));
    } catch {
      // Fall through to form/text heuristics.
    }
  }
  if (/application\/x-www-form-urlencoded/i.test(contentType)) {
    try {
      const params = new URLSearchParams(trimmed);
      for (const [key, value] of params) {
        if (SENSITIVE_KEY_EXACT_PATTERN.test(key) && value.trim().length > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return SENSITIVE_TEXT_PATTERN.test(trimmed);
}

function addSensitiveDataChecks(checks: SecurityCheckResult[], input: SecurityScannerInput, dom: DomSecuritySnapshot, targetUrl: string): void {
  const evidence: SecurityCheckResult['evidence'] = [];
  const secureRequestTransport = isHttpsUrl(targetUrl) || isLocalOrPrivateTarget(targetUrl);
  const viteDevServerRun = isViteDevServerRun(input.networkRecords, targetUrl);
  for (const record of input.networkRecords) {
    const requestContentType = record.requestHeaders['content-type'] ?? record.requestHeaders['Content-Type'] ?? '';
    const responseContentType = record.contentType ?? record.responseHeaders?.['content-type'] ?? record.responseHeaders?.['Content-Type'] ?? '';
    const urlSignal = hasSensitiveUrlSignal(record.url);
    const rawRequestSignal = hasSensitivePayloadSignal(record.postData, requestContentType);
    const requestSignal = rawRequestSignal && (!secureRequestTransport || record.method.toUpperCase() === 'GET');
    const responseSignal = !(viteDevServerRun && isViteDevNetworkRecord(record, targetUrl)) && hasSensitivePayloadSignal(record.responseBodyPreview, responseContentType);
    if (urlSignal || requestSignal || responseSignal) {
      evidence.push({
        networkRequestId: record.id,
        url: truncateMiddle(redactUrl(record.url), 160),
        details: {
          method: record.method,
          resourceType: record.resourceType,
          sources: [urlSignal ? 'url-query' : undefined, requestSignal ? 'request-body' : undefined, responseSignal ? 'response-body' : undefined].filter(Boolean)
        }
      });
    }
  }
  for (const message of input.consoleRecords) {
    if (SENSITIVE_TEXT_PATTERN.test(message.text)) {
      evidence.push({ details: { consoleId: message.id, type: message.type, text: compactText(message.text, 160) } });
    }
  }
  if (SENSITIVE_TEXT_PATTERN.test(input.pageModel.stats.bodyTextSample)) {
    evidence.push({ details: { source: 'bodyTextSample' } });
  }
  for (const finding of dom.storageFindings) {
    evidence.push({ storage: finding.storage, key: redactText(finding.key), details: { reason: finding.reason } });
  }
  checks.push({
    id: '',
    category: 'sensitive-data',
    rule: 'sensitive-data-exposure',
    status: evidence.length > 0 ? 'warning' : 'passed',
    severity: evidence.some((item) => item.storage || item.networkRequestId) ? 'medium' : evidence.length ? 'low' : 'info',
    title: evidence.length > 0 ? `疑似敏感信息暴露信号：${evidence.length} 处` : '未发现明显敏感信息暴露信号',
    description: evidence.length > 0 ? '扫描发现 token/secret/password/session 等敏感字段和值出现在 URL query、请求/响应体、Console、DOM 或浏览器存储中。报告仅保留脱敏证据；普通业务路径名不计为泄露。' : '未发现 token/secret/password/session 等敏感信息暴露信号。',
    evidence: evidence.slice(0, 50),
    suggestion: { frontend: '避免把 token/secret 放入 URL query、DOM、Console 或可读存储；优先使用 HttpOnly Cookie 或短期内存态。', backend: '接口响应避免返回敏感字段；服务端日志和错误信息也应脱敏。', priority: evidence.length ? 'P2' : 'P3' }
  });
}

function addTransportAndMixedChecks(checks: SecurityCheckResult[], input: SecurityScannerInput, targetUrl: string): void {
  const secureTransport = isHttpsUrl(targetUrl);
  const localOrFileTransport = isLocalOrPrivateTarget(targetUrl);
  const tlsVerificationBypassed = secureTransport && input.config.browser.ignoreHTTPSErrors;
  const transportPassed = (secureTransport || localOrFileTransport) && !tlsVerificationBypassed;
  const mixed = isHttpsUrl(targetUrl)
    ? input.networkRecords.filter((record) => isHttpUrl(record.url)).map((record) => ({ networkRequestId: record.id, url: redactUrl(record.url) }))
    : [];
  checks.push({
    id: '',
    category: 'transport',
    rule: 'https-transport',
    status: transportPassed ? 'passed' : 'warning',
    severity: transportPassed ? 'info' : 'medium',
    title: tlsVerificationBypassed ? 'HTTPS 证书校验已绕过' : secureTransport ? '页面使用 HTTPS' : localOrFileTransport ? '本地/文件测试地址允许非 HTTPS' : '页面未使用 HTTPS',
    description: tlsVerificationBypassed
      ? '本轮为进入内网测试环境显式忽略了证书错误；只证明页面可通过加密连接访问，不证明证书链、有效期或主机名可信。'
      : secureTransport
      ? '目标页面通过 HTTPS 加载。'
      : localOrFileTransport
        ? '目标是 localhost/127.0.0.1/file 测试地址，非 HTTPS 不计为生产风险。'
        : '目标页面不是 HTTPS，生产环境下可能导致凭证或业务数据被窃听/篡改。',
    evidence: [{ url: redactUrl(targetUrl) }],
    suggestion: { backend: tlsVerificationBypassed ? '为测试入口部署受客户端信任的内部 CA 证书，并确保 SAN 匹配实际访问域名/IP；修复后关闭 ignoreHTTPSErrors 复测。' : '生产环境启用 HTTPS，并配合 HSTS。', priority: tlsVerificationBypassed ? 'P1' : transportPassed ? 'P3' : 'P2' }
  });
  checks.push({
    id: '',
    category: 'mixed-content',
    rule: 'mixed-content',
    status: mixed.length > 0 ? 'failed' : 'passed',
    severity: mixed.length > 0 ? 'high' : 'info',
    title: mixed.length > 0 ? `检测到 Mixed Content：${mixed.length} 个资源/请求` : '未发现 Mixed Content',
    description: mixed.length > 0 ? 'HTTPS 页面加载了 HTTP 资源或接口，可能被中间人篡改。' : '未发现 HTTPS 页面加载 HTTP 资源。',
    evidence: mixed.slice(0, 30),
    suggestion: { frontend: '所有脚本、样式、图片、API 改用 HTTPS 或相对协议安全路径。', backend: '为资源和 API 开启 HTTPS，并配置重定向。', priority: mixed.length ? 'P1' : 'P3' }
  });
}

function addThirdPartyChecks(checks: SecurityCheckResult[], input: SecurityScannerInput, dom: DomSecuritySnapshot, targetUrl: string): void {
  const thirdParty = input.networkRecords.filter((record) => ['script', 'stylesheet', 'font'].includes(record.resourceType) && originOf(record.url) && !sameOrigin(record.url, targetUrl));
  const sourceMaps = [...input.networkRecords.map((record) => record.url), ...input.resourceRecords.map((record) => record.name)].filter((url) => /\.map(?:\?|$)/i.test(url));
  checks.push({
    id: '',
    category: 'third-party',
    rule: 'third-party-resources',
    status: thirdParty.length > 0 ? 'warning' : 'passed',
    severity: thirdParty.length > 0 ? 'low' : 'info',
    title: thirdParty.length > 0 ? `加载第三方 JS/CSS/Font：${thirdParty.length} 个` : '未发现第三方关键资源',
    description: thirdParty.length > 0 ? '页面加载了非同源脚本/样式/字体，需要确认域名可信、稳定且受版本控制。' : '未发现非同源脚本/样式/字体。',
    evidence: thirdParty.slice(0, 30).map((record) => ({ networkRequestId: record.id, url: redactUrl(record.url) })),
    suggestion: { frontend: '减少不必要第三方关键资源，固定版本，必要时自托管并启用 SRI。', priority: 'P3' }
  });
  checks.push({
    id: '',
    category: 'third-party',
    rule: 'subresource-integrity',
    status: dom.thirdPartyWithoutSri.length > 0 ? 'warning' : 'passed',
    severity: dom.thirdPartyWithoutSri.length > 0 ? 'medium' : 'info',
    title: dom.thirdPartyWithoutSri.length > 0 ? `第三方脚本/样式缺少 SRI：${dom.thirdPartyWithoutSri.length} 个` : '第三方关键资源未发现 SRI 缺失',
    description: dom.thirdPartyWithoutSri.length > 0 ? '第三方 script/link 缺少 integrity，供应链被篡改时浏览器无法校验。' : '未发现缺少 SRI 的第三方脚本或样式。',
    evidence: dom.thirdPartyWithoutSri.map((item) => ({ selector: item.selector, url: redactUrl(item.url), details: { tag: item.tag } })),
    suggestion: { frontend: '为固定版本第三方 script/link 添加 integrity 和 crossorigin；或改为可信自托管资源。', priority: dom.thirdPartyWithoutSri.length ? 'P2' : 'P3' }
  });
  checks.push({
    id: '',
    category: 'third-party',
    rule: 'source-map-exposure',
    status: sourceMaps.length > 0 ? 'warning' : 'passed',
    severity: sourceMaps.length > 0 ? 'low' : 'info',
    title: sourceMaps.length > 0 ? `发现 Source Map 暴露：${sourceMaps.length} 个` : '未发现 Source Map 暴露',
    description: sourceMaps.length > 0 ? '生产环境暴露 source map 可能泄露源码结构、内部路径或注释。' : '未发现 .map 资源请求。',
    evidence: sourceMaps.slice(0, 20).map((url) => ({ url: redactUrl(url) })),
    suggestion: { frontend: '生产环境关闭公开 source map，或上传到受控错误平台并限制公网访问。', priority: sourceMaps.length ? 'P3' : 'P3' }
  });
}

function addXssPassiveChecks(checks: SecurityCheckResult[], dom: DomSecuritySnapshot): void {
  const inlineEvidence: SecurityCheckResult['evidence'] = [];
  if (dom.inlineScriptCount > 0) inlineEvidence.push({ details: { inlineScriptCount: dom.inlineScriptCount } });
  inlineEvidence.push(...dom.inlineEventHandlers.map((item) => ({ selector: item.selector, details: { attribute: item.attribute } })));
  inlineEvidence.push(...dom.javascriptLinks.map((item) => ({ selector: item.selector, url: redactUrl(item.href) })));
  inlineEvidence.push(...dom.srcdocFrames.map((item) => ({ selector: item.selector, details: { attribute: 'srcdoc' } })));
  checks.push({
    id: '',
    category: 'xss-passive',
    rule: 'passive-xss-sinks',
    status: inlineEvidence.length > 0 ? 'warning' : 'passed',
    severity: inlineEvidence.some((item) => item.url || item.selector) ? 'medium' : inlineEvidence.length ? 'low' : 'info',
    title: inlineEvidence.length > 0 ? `发现 XSS 被动风险特征：${inlineEvidence.length} 处` : '未发现明显 XSS 被动风险特征',
    description: inlineEvidence.length > 0 ? '页面存在 inline script、inline event handler、javascript: URL 或 iframe srcdoc 等需要人工复核的 XSS 风险特征。' : '未发现 inline event handler、javascript: URL 或 srcdoc 等明显风险特征。',
    evidence: inlineEvidence.slice(0, 60),
    suggestion: { frontend: '移除 inline handler/javascript: 链接，避免把不可信输入写入 innerHTML/srcdoc；配合 CSP 禁止 unsafe-inline。', test: '补充 DOM XSS 和参数转义回归测试。', priority: inlineEvidence.length ? 'P2' : 'P3' }
  });
}

function addCsrfChecks(checks: SecurityCheckResult[], input: SecurityScannerInput): void {
  const risky = input.networkRecords.filter((record) => {
    if (!MUTATING_METHOD_PATTERN.test(record.method) || isSafetyBlocked(record)) return false;
    const headers = lowerHeaders(record.requestHeaders);
    const usesCookie = Boolean(headers.cookie);
    const hasToken = Object.keys(headers).some((key) => /csrf|xsrf|token/i.test(key)) || /csrf|xsrf/i.test(record.postData ?? '');
    const hasAuthHeader = Boolean(headers.authorization || headers['x-api-key'] || headers['x-auth-token']);
    return usesCookie && !hasToken && !hasAuthHeader;
  });
  checks.push({
    id: '',
    category: 'csrf',
    rule: 'csrf-token-hints',
    status: risky.length > 0 ? 'warning' : 'passed',
    severity: risky.length > 0 ? 'medium' : 'info',
    title: risky.length > 0 ? `写接口缺少明显 CSRF 防护信号：${risky.length} 个` : '未发现明显 CSRF 风险信号',
    description: risky.length > 0 ? '检测到依赖 Cookie 的写请求，但未发现 CSRF/XSRF token 或显式 Authorization header。该结果为启发式提示，需要结合后端 SameSite/Origin 校验确认。' : '未发现依赖 Cookie 且缺少 CSRF 信号的写请求。',
    evidence: risky.slice(0, 30).map((record) => ({ networkRequestId: record.id, url: redactUrl(record.url), details: { method: record.method } })),
    suggestion: { frontend: '对写请求携带 CSRF/XSRF token 或使用明确 Authorization 机制。', backend: '校验 Origin/Referer、CSRF token 和 SameSite Cookie 策略；对写接口保持幂等与审计。', priority: risky.length ? 'P2' : 'P3' }
  });
}

function hasApiLeakSignal(record: NetworkRecord): boolean {
  const haystack = `${record.responseBodyPreview ?? ''} ${JSON.stringify(record.responseHeaders ?? {})}`;
  if (API_LEAK_PATTERN.test(haystack)) return true;
  const errorStatus = (record.status ?? 0) >= 400;
  return errorStatus && (/"debug"\s*:\s*true/i.test(haystack) || /\bdebug\s*=\s*true\b/i.test(haystack) || /\b[A-Z][A-Za-z0-9_]*Exception\b/.test(haystack));
}

function isFirstPartyServiceRecord(record: NetworkRecord, targetUrl: string): boolean {
  return record.resourceType === 'document' || sameOrigin(record.url, targetUrl) || ['xhr', 'fetch'].includes(record.resourceType) || record.protocol === 'rest' || record.protocol === 'graphql';
}

function addApiLeakChecks(checks: SecurityCheckResult[], input: SecurityScannerInput, targetUrl: string): void {
  const viteDevServerRun = isViteDevServerRun(input.networkRecords, targetUrl);
  const rawLeaks = input.networkRecords.filter(hasApiLeakSignal);
  const devServerLeaks = rawLeaks.filter((record) => viteDevServerRun && isViteDevNetworkRecord(record, targetUrl));
  const leaks = rawLeaks.filter((record) => !(viteDevServerRun && isViteDevNetworkRecord(record, targetUrl)));
  const fingerprintHeaders = input.networkRecords.filter((record) => isFirstPartyServiceRecord(record, targetUrl) && (lowerHeaders(record.responseHeaders).server || lowerHeaders(record.responseHeaders)['x-powered-by']));
  const localOrPrivate = isLocalOrPrivateTarget(targetUrl);
  checks.push({
    id: '',
    category: 'api-leak',
    rule: 'api-error-and-debug-leak',
    status: leaks.length > 0 ? 'failed' : devServerLeaks.length > 0 ? 'skipped' : 'passed',
    severity: leaks.length > 0 ? 'high' : 'info',
    title: leaks.length > 0 ? `接口响应疑似泄露调试/堆栈信息：${leaks.length} 个` : devServerLeaks.length > 0 ? `Vite dev server 源码模块调试信号已跳过：${devServerLeaks.length} 个` : '未发现接口调试/堆栈泄露',
    description: leaks.length > 0
      ? '接口响应或响应头中出现 stack trace、SQL 错误、内部路径或 debug 关键词。'
      : devServerLeaks.length > 0
        ? '本次目标运行在 Vite dev server，/@vite/client、/src/*.vue、/node_modules 等源码模块会自然包含源码路径、debug 字样或本机路径；这些不是业务接口泄露，不计入安全扣分。生产环境应改扫 build/preview/nginx 产物。'
        : '未发现明显接口调试、堆栈、SQL 错误或内部路径泄露。',
    evidence: (leaks.length > 0 ? leaks : devServerLeaks).slice(0, 20).map((record) => ({ networkRequestId: record.id, url: redactUrl(record.url), details: { status: record.status, contentType: record.contentType, viteDevServer: devServerLeaks.includes(record) || undefined } })),
    suggestion: { backend: '生产环境关闭 debug 输出，统一错误响应结构，只返回错误码、用户可理解信息和 requestId。', priority: leaks.length ? 'P1' : 'P3' }
  });
  checks.push({
    id: '',
    category: 'api-leak',
    rule: 'server-fingerprint-headers',
    status: localOrPrivate ? 'skipped' : fingerprintHeaders.length > 0 ? 'warning' : 'passed',
    severity: localOrPrivate || fingerprintHeaders.length === 0 ? 'info' : 'low',
    title: localOrPrivate ? '本地/私网环境跳过服务指纹响应头门禁' : fingerprintHeaders.length > 0 ? `响应头暴露服务指纹：${fingerprintHeaders.length} 个请求` : '未发现明显服务指纹响应头',
    description: localOrPrivate
      ? '目标是本地、文件或私网地址，Server / X-Powered-By 指纹隐藏由生产网关/部署层负责配置，本次不计入页面缺陷或安全扣分。'
      : fingerprintHeaders.length > 0
        ? '响应头包含 Server 或 X-Powered-By，可能泄露技术栈和版本信息。'
        : '未发现 Server/X-Powered-By 等明显服务指纹响应头。',
    evidence: fingerprintHeaders.slice(0, 20).map((record) => ({ networkRequestId: record.id, url: redactUrl(record.url), details: { server: lowerHeaders(record.responseHeaders).server, xPoweredBy: lowerHeaders(record.responseHeaders)['x-powered-by'] } })),
    suggestion: { backend: '在生产网关层隐藏或规范化 Server/X-Powered-By 等指纹头。', test: localOrPrivate ? '生产或预发域名应在部署 checklist/CI 中校验服务指纹响应头。' : undefined, priority: 'P3' }
  });
}

export async function runSecurityScanner(input: SecurityScannerInput): Promise<SecurityScannerOutput> {
  const { config } = input;
  if (!config.security.enabled) {
    return { result: createEmptySecurityResult(config), issues: [] };
  }

  const checks: SecurityCheckResult[] = [];
  const finalUrl = typeof input.page.url === 'function' ? input.page.url() : '';
  const targetUrl = finalUrl && finalUrl !== 'about:blank' ? finalUrl : config.target.url;
  const documentRequest = findDocumentRequest(input.networkRecords, targetUrl);
  const dom = await collectDomSecuritySnapshot(input.page).catch(() => ({
    inlineScriptCount: 0,
    inlineEventHandlers: [],
    javascriptLinks: [],
    srcdocFrames: [],
    storageFindings: [],
    thirdPartyWithoutSri: []
  }) satisfies DomSecuritySnapshot);

  if (config.security.checkHeaders) addHeaderChecks(checks, documentRequest, targetUrl);
  if (config.security.checkCookies) addCookieChecks(checks, input.networkRecords, targetUrl);
  if (config.security.checkSensitiveData) addSensitiveDataChecks(checks, input, dom, targetUrl);
  if (config.security.checkMixedContent) addTransportAndMixedChecks(checks, input, targetUrl);
  if (config.security.checkThirdPartyResources) addThirdPartyChecks(checks, input, dom, targetUrl);
  if (config.security.checkXssPassive) addXssPassiveChecks(checks, dom);
  if (config.security.checkCsrfHints) addCsrfChecks(checks, input);
  if (config.security.checkApiLeaks) addApiLeakChecks(checks, input, targetUrl);
  checks.push(await runActiveReflectionProbe(input.page, config).catch((error: unknown) => ({
    id: '',
    category: 'active-probing',
    rule: 'active-reflection-probe',
    status: 'skipped',
    severity: 'info',
    title: '主动安全探测执行失败',
    description: redactText(error instanceof Error ? error.message : String(error)),
    evidence: [],
    suggestion: { test: '检查 active probing 配置、目标 URL 和页面可达性。', priority: 'P3' }
  })));

  checks.forEach((check, index) => {
    check.id = `SEC-${String(index + 1).padStart(3, '0')}`;
  });

  const result = summarize(checks, config.security.enabled, config.security.mode);
  const factory = new IssueFactory();
  const issues = checks.map((check) => checkToIssue(factory, check, input.artifacts)).filter((issue): issue is Issue => Boolean(issue));
  return { result, issues };
}
