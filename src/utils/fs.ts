import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ensuredWindowsDirectories = new Set<string>();

export interface OutputPermissionHandoffResult {
  directory: string;
  platform: NodeJS.Platform;
  status: 'repaired' | 'skipped' | 'failed';
  recursive: boolean;
  message: string;
}

export function windowsAclInheritanceArgs(directory: string, recursive: boolean): string[] {
  return [directory, '/inheritance:e', ...(recursive ? ['/T'] : []), '/C', '/Q'];
}

export function windowsAclResetArgs(directory: string, recursive: boolean): string[] {
  return [directory, '/reset', ...(recursive ? ['/T'] : []), '/C', '/Q'];
}

function isSameOrParent(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Reject targets whose recursive ACL change would have an unbounded blast radius. */
export function unsafePermissionHandoffReason(directory: string, cwd = process.cwd(), home = homedir()): string | undefined {
  const resolved = path.resolve(directory);
  const root = path.parse(resolved).root;
  if (resolved === root) return 'Refusing to change ACL inheritance on a filesystem root.';
  if (resolved === path.resolve(home)) return 'Refusing to change ACL inheritance on the user home directory.';
  if (isSameOrParent(resolved, path.resolve(cwd))) return 'Refusing to change ACL inheritance on the source workspace or one of its ancestors.';
  const relativeFromRoot = path.relative(root, resolved).split(path.sep).filter(Boolean);
  if (relativeFromRoot.length < 2) return 'Refusing a broad top-level directory; select the specific generated output directory.';
  return undefined;
}

export async function handoffOutputPermissions(directory: string, recursive = true): Promise<OutputPermissionHandoffResult> {
  let resolved = path.resolve(directory);
  if (process.platform !== 'win32') {
    return {
      directory: resolved,
      platform: process.platform,
      status: 'skipped',
      recursive,
      message: 'Windows ACL handoff is not required on this platform.'
    };
  }

  const unsafeReason = unsafePermissionHandoffReason(resolved);
  if (unsafeReason) {
    return { directory: resolved, platform: process.platform, status: 'failed', recursive, message: unsafeReason };
  }

  try {
    const metadata = await lstat(resolved);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      return { directory: resolved, platform: process.platform, status: 'failed', recursive, message: 'Permission handoff target must be a real generated directory, not a file or symbolic link.' };
    }
    resolved = await realpath(resolved);
    const realUnsafeReason = unsafePermissionHandoffReason(resolved);
    if (realUnsafeReason) return { directory: resolved, platform: process.platform, status: 'failed', recursive, message: realUnsafeReason };
  } catch (error) {
    return { directory: resolved, platform: process.platform, status: 'failed', recursive, message: `Cannot inspect generated output directory: ${error instanceof Error ? error.message : String(error)}` };
  }

  try {
    await execFileAsync('icacls.exe', windowsAclInheritanceArgs(resolved, recursive), { windowsHide: true });
    // Enabling inheritance alone can leave an explicit sandbox-only DACL in place.
    // Reset the generated tree to its inherited parent ACL so the desktop user can remove it.
    await execFileAsync('icacls.exe', windowsAclResetArgs(resolved, recursive), { windowsHide: true });
    return {
      directory: resolved,
      platform: process.platform,
      status: 'repaired',
      recursive,
      message: 'ACL inheritance enabled and the generated output DACL reset to its parent workspace permissions.'
    };
  } catch (error) {
    return {
      directory: resolved,
      platform: process.platform,
      status: 'failed',
      recursive,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function handoffEnsuredDirectoryPermissions(): Promise<OutputPermissionHandoffResult[]> {
  if (process.platform !== 'win32' || ensuredWindowsDirectories.size === 0) return [];
  const directories = [...ensuredWindowsDirectories]
    .sort((left, right) => left.length - right.length)
    .filter((directory, index, all) => !all.slice(0, index).some((parent) => directory === parent || directory.startsWith(`${parent}${path.sep}`)));
  return Promise.all(directories.map((directory) => handoffOutputPermissions(directory, true)));
}

export async function ensureDir(dir: string): Promise<void> {
  const created = await mkdir(dir, { recursive: true });
  if (process.platform === 'win32' && created !== undefined) {
    const resolved = path.resolve(dir);
    ensuredWindowsDirectories.add(resolved);
    await handoffOutputPermissions(resolved, false);
  }
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const stack: object[] = [];
  const json = JSON.stringify(
    data,
    function (this: unknown, _key, value: unknown) {
      if (typeof value === 'bigint') return value.toString();
      if (value && typeof value === 'object') {
        while (stack.length > 0 && stack[stack.length - 1] !== this) {
          stack.pop();
        }
        if (stack.includes(value)) return '[Circular]';
        stack.push(value);
      }
      return value;
    },
    2
  );
  await writeFile(filePath, `${json}\n`, 'utf8');
}

export async function writeText(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

export function resolveOutputDir(outputDir: string): string {
  if (path.isAbsolute(outputDir)) {
    return outputDir;
  }
  return path.resolve(process.cwd(), outputDir);
}
