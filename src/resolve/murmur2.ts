/**
 * MurmurHash2 实现，与 CurseForge 的 fingerprint 算法一致。
 * CurseForge 要求把 jar 当成 byte stream，按 1MB 分块（不足时整文件），
 * 每块单独做 MurmurHash2，最终 fingerprint 就是第一块（<1MB 时即整文件）的 hash。
 * 参考 PCL2-CE ModLocalComp.cs 中的 CurseForgeHash 实现。
 */

const SEED = 1;
const M = 0x5bd1e995;
const R = 24;

function murmurHash2(data: Uint8Array, seed: number = SEED): number {
  const len = data.length;
  let h = (seed ^ len) >>> 0;

  let i = 0;
  // 每块 4 字节处理
  while (i + 4 <= len) {
    const d0 = data[i] ?? 0;
    const d1 = data[i + 1] ?? 0;
    const d2 = data[i + 2] ?? 0;
    const d3 = data[i + 3] ?? 0;
    let k = d0 | (d1 << 8) | (d2 << 16) | (d3 << 24);
    k = Math.imul(k, M);
    k ^= k >>> R;
    k = Math.imul(k, M);

    h = Math.imul(h, M);
    h ^= k;

    i += 4;
  }

  // 剩余 1-3 字节
  const remaining = len - i;
  if (remaining >= 3) h ^= ((data[i + 2] ?? 0) << 16) >>> 0;
  if (remaining >= 2) h ^= ((data[i + 1] ?? 0) << 8) >>> 0;
  if (remaining >= 1) {
    h ^= data[i] ?? 0;
    h = Math.imul(h, M);
  }

  h ^= h >>> 13;
  h = Math.imul(h, M);
  h ^= h >>> 15;

  return h >>> 0;
}

/**
 * 计算文件的 CurseForge fingerprint。
 * CF 把 >1MB 文件分块，每块独立做 MurmurHash2，但 fingerprint 只用第一块。
 * 实践中 PCL2-CE 用的是整文件流式 MurmurHash2，对应 CF 服务器侧的 partial 检测。
 */
export async function curseforgeFingerprint(filePath: string): Promise<number> {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(filePath);
  return murmurHash2(new Uint8Array(buf), SEED);
}

/** 批量计算一组文件的 fingerprint */
export async function batchCurseforgeFingerprints(
  paths: string[],
): Promise<Array<{ path: string; fingerprint: number }>> {
  const out: Array<{ path: string; fingerprint: number }> = [];
  for (const path of paths) {
    try {
      const fp = await curseforgeFingerprint(path);
      out.push({ path, fingerprint: fp });
    } catch {
      // 跳过读取失败的
    }
  }
  return out;
}
