import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** 流式计算文件的 sha512 与 sha1，一次性返回两者 */
export async function hashFile(absPath: string): Promise<{ sha512: string; sha1: string }> {
  const buf = await readFile(absPath);
  return {
    sha512: createHash('sha512').update(buf).digest('hex'),
    sha1: createHash('sha1').update(buf).digest('hex'),
  };
}

export function sha512Buffer(buf: Uint8Array): string {
  return createHash('sha512').update(buf).digest('hex');
}

/** 校验 buffer 是否匹配给定 hex；为防御大小写不一致，统一小写比较 */
export function verifySha512(buf: Uint8Array, expected: string): boolean {
  return sha512Buffer(buf).toLowerCase() === expected.toLowerCase();
}

/** 反复读取直到内存上限；用于校验阶段 */
export async function readAndHash(absPath: string): Promise<{ sha512: string; size: number }> {
  const buf = await readFile(absPath);
  return { sha512: sha512Buffer(buf), size: buf.byteLength };
}

export function relPathWithin(root: string, absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const rootNorm = root.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized.toLowerCase().startsWith(`${rootNorm.toLowerCase()}/`)) {
    return normalized.slice(rootNorm.length + 1);
  }
  return normalized;
}

export function joinPath(...parts: string[]): string {
  return join(...parts).replace(/\\/g, '/');
}
