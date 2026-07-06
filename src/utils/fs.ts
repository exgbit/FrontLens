import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
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
