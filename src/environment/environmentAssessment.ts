import type { EnvironmentAssessment, FrontLensConfig, NetworkRecord, PageModel } from '../types.js';
import { isViteDevServerRun, isViteDevUrl } from '../utils/devServer.js';
import { redactUrl } from '../utils/redact.js';

function hostOf(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function sameOrigin(url: string, targetUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31 || a === 100 && b >= 64 && b <= 127;
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

function isLocalOrPrivateTarget(value: string): boolean {
  if (/^file:/i.test(value)) return true;
  const host = hostOf(value);
  if (!host) return false;
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
}

function isLoopbackOrLocalhost(value: string): boolean {
  const host = hostOf(value);
  if (!host) return false;
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1' || host === '0:0:0:0:0:0:0:1';
}

function isHashedBuildAsset(url: string, targetUrl: string): boolean {
  if (!sameOrigin(url, targetUrl)) return false;
  try {
    const pathname = new URL(url).pathname;
    return /\/(assets|static)\/[^/]+[-.][a-f0-9]{6,}\.(?:js|css|mjs)$/i.test(pathname) || /\.(?:js|css)\?v=[a-f0-9]{6,}/i.test(url);
  } catch {
    return false;
  }
}

function confidenceFor(kind: EnvironmentAssessment['kind'], finalUrl: string): EnvironmentAssessment['confidence'] {
  if (kind === 'production-like' && /^https:/i.test(finalUrl)) return 'high';
  if (kind === 'local-dev' || kind === 'file') return 'high';
  if (kind === 'local-preview' || kind === 'staging-or-private') return 'medium';
  return 'low';
}

export function createEmptyEnvironmentAssessment(targetUrl = ''): EnvironmentAssessment {
  return {
    checkedAt: new Date().toISOString(),
    targetUrl,
    kind: 'unknown',
    confidence: 'low',
    isLocalOrPrivate: false,
    isHttps: false,
    isViteDevServer: false,
    hasHmr: false,
    sameOriginRequestCount: 0,
    devModuleRequestCount: 0,
    hashedAssetCount: 0,
    trust: {
      functional: 'low',
      performance: 'low',
      security: 'low',
      businessSignoff: 'low'
    },
    evidence: [],
    warnings: ['Environment assessment missing from report.'],
    recommendations: ['Rerun FrontLens with a reachable target URL to classify the test environment.']
  };
}

export function buildEnvironmentAssessment(input: {
  config: FrontLensConfig;
  pageModel: PageModel;
  networkRecords: NetworkRecord[];
}): EnvironmentAssessment {
  const finalUrl = input.pageModel.url || input.config.target.url;
  const targetUrl = input.config.target.url;
  const origin = originOf(finalUrl) ?? originOf(targetUrl);
  const sameOriginRecords = input.networkRecords.filter((record) => sameOrigin(record.url, finalUrl));
  const devModuleRequests = sameOriginRecords.filter((record) => isViteDevUrl(record.url, finalUrl));
  const isViteDevServer = isViteDevServerRun(input.networkRecords, finalUrl) || isViteDevServerRun(input.networkRecords, targetUrl);
  const hasHmr = sameOriginRecords.some((record) => /@vite\/client|\bwebpack-hmr\b|sockjs-node|__vite_ping|hmr/i.test(record.url));
  const hashedAssetCount = sameOriginRecords.filter((record) => isHashedBuildAsset(record.url, finalUrl)).length;
  const isLocalOrPrivate = isLocalOrPrivateTarget(finalUrl) || isLocalOrPrivateTarget(targetUrl);
  const isHttps = /^https:/i.test(finalUrl);
  const isFile = /^file:/i.test(finalUrl) || /^file:/i.test(targetUrl);
  const evidence: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  let kind: EnvironmentAssessment['kind'] = 'unknown';
  if (isFile) {
    kind = 'file';
    warnings.push('Target uses file://; network/security/performance conclusions are not production-representative.');
    recommendations.push('Serve the app through a production-like HTTP preview before security/performance sign-off.');
  } else if (isViteDevServer) {
    kind = 'local-dev';
    warnings.push('Vite/dev-source mode detected; request count, transfer size, source-path leak, and HMR WebSocket are dev artifacts.');
    recommendations.push('Run a build + preview pass for production bundle, security header, and performance conclusions.');
  } else if (isLocalOrPrivate && isLoopbackOrLocalhost(finalUrl)) {
    kind = 'local-preview';
    warnings.push('Local/private preview detected; functional checks are useful, but deployment headers/TLS may differ from production.');
    recommendations.push('Use production/staging domain for final security headers, TLS, CDN, and cookie checks.');
  } else if (isLocalOrPrivate) {
    kind = 'staging-or-private';
    warnings.push('Private/VPN/staging target detected; treat deployment security and external performance as pre-production evidence.');
    recommendations.push('Repeat production-readiness checks against the intended production-like domain before release.');
  } else if (isHttps) {
    kind = 'production-like';
  } else {
    kind = 'unknown';
    warnings.push('Public non-HTTPS or unrecognized environment; security and production-readiness confidence is limited.');
    recommendations.push('Use HTTPS production/staging preview for release sign-off.');
  }

  if (!isHttps && !isFile) {
    warnings.push('Target is not HTTPS; transport-security conclusions are deployment/environment dependent.');
  }
  if (devModuleRequests.length > 0) evidence.push(`devModules:${devModuleRequests.slice(0, 5).map((record) => redactUrl(record.url)).join(',')}`);
  if (hashedAssetCount > 0) evidence.push(`hashedAssets:${hashedAssetCount}`);
  if (hasHmr) evidence.push('hmr:true');
  if (origin) evidence.push(`origin:${redactUrl(origin)}`);

  const performanceTrust: EnvironmentAssessment['trust']['performance'] = kind === 'production-like' ? 'high' : kind === 'local-preview' || kind === 'staging-or-private' ? 'medium' : 'low';
  const securityTrust: EnvironmentAssessment['trust']['security'] = kind === 'production-like' ? 'high' : kind === 'local-dev' || kind === 'file' ? 'low' : 'medium';
  return {
    checkedAt: new Date().toISOString(),
    targetUrl: redactUrl(targetUrl),
    finalUrl: redactUrl(finalUrl),
    origin: origin ? redactUrl(origin) : undefined,
    kind,
    confidence: confidenceFor(kind, finalUrl),
    isLocalOrPrivate,
    isHttps,
    isViteDevServer,
    hasHmr,
    sameOriginRequestCount: sameOriginRecords.length,
    devModuleRequestCount: devModuleRequests.length,
    hashedAssetCount,
    trust: {
      functional: input.pageModel.stats.domNodes > 0 ? 'high' : 'low',
      performance: performanceTrust,
      security: securityTrust,
      businessSignoff: kind === 'production-like' ? 'high' : kind === 'local-dev' || kind === 'file' ? 'medium' : 'medium'
    },
    evidence,
    warnings,
    recommendations
  };
}
