import type { NetworkRecord, ResourceRecord } from '../types.js';

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function sameOrigin(url: string, targetUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

export function isViteDevUrl(url: string, targetUrl?: string): boolean {
  if (targetUrl && !sameOrigin(url, targetUrl)) return false;
  const pathname = pathnameOf(url);
  return (
    pathname === '/@vite/client' ||
    pathname.startsWith('/@vite/') ||
    pathname.startsWith('/src/') ||
    pathname.includes('/node_modules/.vite/') ||
    pathname.includes('/node_modules/.pnpm/') ||
    pathname.includes('/node_modules/')
  );
}

export function isViteDevNetworkRecord(record: NetworkRecord, targetUrl?: string): boolean {
  return isViteDevUrl(record.url, targetUrl);
}

export function isViteDevResource(resource: ResourceRecord, targetUrl?: string): boolean {
  return isViteDevUrl(resource.name, targetUrl);
}

export function isViteDevServerRun(records: NetworkRecord[], targetUrl: string): boolean {
  const sameOriginRecords = records.filter((record) => sameOrigin(record.url, targetUrl));
  if (sameOriginRecords.some((record) => pathnameOf(record.url) === '/@vite/client')) return true;
  const sourceModuleCount = sameOriginRecords.filter((record) => pathnameOf(record.url).startsWith('/src/')).length;
  const viteOptimizedCount = sameOriginRecords.filter((record) => pathnameOf(record.url).includes('/node_modules/.vite/')).length;
  return sourceModuleCount >= 3 || viteOptimizedCount >= 1;
}

