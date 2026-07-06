const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|proxy-authorization|x-api-key|x-auth-token|x-csrf-token)$/i;
const SET_COOKIE_HEADER_PATTERN = /^set-cookie$/i;
const SENSITIVE_PARAM_PATTERN = /^(access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|password|passwd|pwd|auth|authorization|session|session[_-]?id|credential|credentials|api[_-]?key|private[_-]?key|jwt|signature|code)$/i;
const SENSITIVE_FIELD_PATTERN = /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|private[_-]?key|token|secret|password|passwd|pwd|auth(?:orization)?|session(?:[_-]?id)?|credential|credentials|jwt|cookie|set-cookie)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g;
export const REDACTED = '[REDACTED]';

function splitSetCookie(value: string): string[] {
  return value
    .split(/,(?=\s*[^;,=]+=[^;,]+)/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function redactCookieName(name: string): string {
  return SENSITIVE_PARAM_PATTERN.test(name) ? REDACTED : name;
}

function redactSetCookie(value: string): string {
  return splitSetCookie(value)
    .map((cookie) => {
      const [namePair = '', ...attrs] = cookie.split(';').map((item) => item.trim());
      const name = redactCookieName(namePair.split('=')[0] || 'cookie');
      return `${name}=${REDACTED}${attrs.length ? `; ${attrs.join('; ')}` : ''}`;
    })
    .join(', ');
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (SENSITIVE_HEADER_PATTERN.test(key)) {
        return [key, REDACTED];
      }
      if (SET_COOKIE_HEADER_PATTERN.test(key)) {
        return [key, redactSetCookie(value)];
      }
      return [key, redactText(value)];
    })
  );
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_PARAM_PATTERN.test(key)) {
        parsed.searchParams.set(key, REDACTED);
      }
    }
    parsed.hash = parsed.hash ? '#[REDACTED]' : '';
    const rawPathParts = parsed.pathname.split('/');
    const pathSensitiveKey = /^(token|secret|password|passwd|pwd|auth|session|jwt|access[_-]?token|refresh[_-]?token|api[_-]?key|private[_-]?key)$/i;
    const pathParts = rawPathParts.map((part, index) => (/^[A-Za-z0-9_-]{24,}$/.test(part) || (index > 0 && pathSensitiveKey.test(rawPathParts[index - 1] ?? '')) ? REDACTED : part));
    parsed.pathname = pathParts.join('/');
    return parsed.toString();
  } catch {
    return redactText(url);
  }
}

export function redactText(value: string): string {
  return value
    .replace(JWT_PATTERN, REDACTED)
    .replace(/("([^"]+)"\s*:\s*)"[^"]*"/g, (match, prefix: string, key: string) => (SENSITIVE_FIELD_PATTERN.test(key) ? `${prefix}"${REDACTED}"` : match))
    .replace(/((?:localStorage|sessionStorage)\.setItem\(\s*['"]([^'"]+)['"]\s*,\s*['"])[^'"]+(['"]\s*\))/gi, (match, prefix: string, key: string, suffix: string) => (SENSITIVE_FIELD_PATTERN.test(key) ? `${prefix}${REDACTED}${suffix}` : match))
    .replace(/((?:^|[?&\s,;])([^=\s'"]+)=)[^&\s]+/g, (match, prefix: string, key: string) => (SENSITIVE_FIELD_PATTERN.test(key) ? `${prefix}${REDACTED}` : match))
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${REDACTED}`);
}
