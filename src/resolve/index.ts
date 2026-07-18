import type { FileEntry, ResolveOutcome, ScannedJar } from '../types.ts';
import { resolveFromCurseForge } from './curseforge.ts';
import { resolveFromModrinth } from './modrinth.ts';

export interface ResolveConfig {
  modrinthToken?: string;
  curseforgeKey?: string;
  /** 并发上限，默认 8 */
  concurrency?: number;
  /** 进度回调，参数为 (已完成, 总数, 最后一个文件名) */
  onProgress?: (done: number, total: number, current?: string) => void;
}

const DEFAULT_CONCURRENCY = 8;

/**
 * 对扫描出的 jar 列表并发解析，返回 FileEntry[] + 警告。
 * 优先级：Modrinth → CurseForge → embedded fallback。
 */
export async function resolveJars(
  jars: ScannedJar[],
  cfg: ResolveConfig,
): Promise<ResolveOutcome[]> {
  const limit = cfg.concurrency ?? DEFAULT_CONCURRENCY;
  const total = jars.length;
  const results: Array<ResolveOutcome | null> = new Array(jars.length).fill(null);
  let done = 0;

  // 一个简单的并发池
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= jars.length) return;
      const jar = jars[i] ?? null;
      if (!jar) return;
      const m = jar.manifest;
      const fileName = jar.fileName;
      cfg.onProgress?.(done, total, fileName);
      try {
        results[i] = await resolveOne(jar, cfg);
      } catch {
        // 失败也兜底到 embedded
        results[i] = makeEmbedded(jar, m);
      }
      done++;
      cfg.onProgress?.(done, total, fileName);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, jars.length || 1); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results.filter((r): r is ResolveOutcome => r !== null);
}

async function resolveOne(jar: ScannedJar, cfg: ResolveConfig): Promise<ResolveOutcome> {
  const m = jar.manifest;
  const fileName = jar.fileName;

  // 1. Modrinth（最常用，先）
  let mr: Awaited<ReturnType<typeof resolveFromModrinth>> = null;
  try {
    mr = await resolveFromModrinth({
      modId: m?.modId,
      version: m?.version,
      fileName,
      sha512: jar.sha512,
      sha1: jar.sha1,
      token: cfg.modrinthToken,
    });
  } catch {
    // network / parse error → fallback to next
  }
  if (mr) {
    return {
      entry: {
        path: jar.relPath,
        hashes: {
          sha1: mr.sha1 ?? jar.sha1,
          sha512: mr.sha512 || jar.sha512,
        },
        downloads: mr.downloads,
        fileSize: mr.size || jar.size,
        source: 'modrinth',
        modId: m?.modId,
        version: m?.version,
        displayName: m?.displayName,
        loaderSignature: jar.loaderSignature,
      },
    };
  }

  // 2. CurseForge（需 API key）
  if (cfg.curseforgeKey) {
    try {
      const cf = await resolveFromCurseForge({
        modId: m?.modId,
        version: m?.version,
        fileName,
        cf: { apiKey: cfg.curseforgeKey },
      });
      if (cf && cf.downloads.length > 0) {
        return {
          entry: {
            path: jar.relPath,
            hashes: { sha1: cf.sha1, sha512: cf.sha512 || jar.sha512 },
            downloads: cf.downloads,
            fileSize: cf.size || jar.size,
            source: 'curseforge',
            modId: m?.modId,
            version: m?.version,
            displayName: m?.displayName,
            loaderSignature: jar.loaderSignature,
          },
        };
      }
    } catch {
      // ignore
    }
  }

  // 3. embedded fallback
  return makeEmbedded(jar, m);
}

function makeEmbedded(jar: ScannedJar, m: ScannedJar['manifest']): ResolveOutcome {
  return {
    entry: {
      path: jar.relPath,
      hashes: { sha1: jar.sha1, sha512: jar.sha512 },
      downloads: [],
      fileSize: jar.size,
      source: 'embedded',
      embedPath: `overrides/${jar.relPath}`,
      modId: m?.modId,
      version: m?.version,
      displayName: m?.displayName,
      loaderSignature: jar.loaderSignature,
    },
    warning: `无法在 Modrinth/CurseForge 找到 "${jar.fileName}"，已 fallback 为源 jar 内嵌`,
  };
}
