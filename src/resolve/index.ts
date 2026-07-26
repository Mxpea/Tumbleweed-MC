import { log } from '../log.ts';
import type { FileEntry, ResolveOutcome, ScannedJar } from '../types.ts';
import { resolveFromCurseForge } from './curseforge.ts';
import { type ModrinthResolveResult, batchResolveBySha1, resolveFromModrinth } from './modrinth.ts';

export interface ResolveConfig {
  modrinthToken?: string;
  curseforgeKey?: string;
  /** 并发上限（仅用于单 jar fallback 路径），默认 4 */
  concurrency?: number;
  onProgress?: (done: number, total: number, current?: string) => void;
}

/**
 * 解析流程：
 * 1) 一次性批量 POST /v2/version_files 按 sha1 查询 Modrinth（限 300/5min，每批 1000 hash）
 *    对 200 mod 来说只发 1 个 HTTP 请求
 * 2) 批量未命中的 jar 走单 jar Modrinth fallback（命中限流会被 try/catch 兜到 embedded）
 * 3) 仍未命中且有 CF key → CurseForge 兜底（CF 也支持批量 fingerprint, 暂不接）
 * 4) 仍未命中 → embedded fallback
 */
export async function resolveJars(
  jars: ScannedJar[],
  cfg: ResolveConfig,
): Promise<ResolveOutcome[]> {
  const total = jars.length;
  const results: Array<ResolveOutcome | null> = new Array(jars.length).fill(null);
  let done = 0;

  // ---- 1. 批量 Modrinth ----
  const sha1List = jars.map((j) => j.sha1.toLowerCase());
  const batch = await batchResolveBySha1(sha1List, cfg.modrinthToken);
  // 诊断：让用户看到 Modrinth 上有收录的占比
  log(
    `Modrinth 批量查询：${batch.size}/${jars.length} 个 jar 命中（未命中的可能为 CurseForge 独家 mod）`,
    'debug',
  );

  const missingIdx: number[] = [];
  for (let i = 0; i < jars.length; i++) {
    const jar = jars[i] ?? null;
    if (!jar) continue;
    const v = batch.get(jar.sha1.toLowerCase());
    if (v?.files[0]) {
      const file = v.files[0];
      const mr: ModrinthResolveResult = {
        projectId: v.project_id,
        versionId: v.id,
        downloads: [file.url],
        sha512: file.hashes.sha512 ?? '',
        sha1: file.hashes.sha1,
        size: file.size,
        fileName: file.filename,
        loaderType: v.loaders?.[0],
      };
      results[i] = makeFromModrinth(jar, mr);
      done++;
      cfg.onProgress?.(done, total, jar.fileName);
    } else {
      missingIdx.push(i);
    }
  }

  if (missingIdx.length === 0) return results.filter((r): r is ResolveOutcome => r !== null);

  // ---- 2. 单 jar Modrinth fallback（受限流影响）----
  const limit = Math.min(cfg.concurrency ?? 4, missingIdx.length);
  let cursor = 0;
  const singleWorker = async () => {
    while (true) {
      const my = cursor++;
      if (my >= missingIdx.length) return;
      const i = missingIdx[my] ?? -1;
      if (i < 0) return;
      const jar = jars[i] ?? null;
      if (!jar) continue;
      let picked: ResolveOutcome | null = null;
      try {
        const mr = await resolveFromModrinth({
          modId: jar.manifest?.modId,
          version: jar.manifest?.version,
          fileName: jar.fileName,
          sha512: jar.sha512,
          sha1: jar.sha1,
          token: cfg.modrinthToken,
        });
        if (mr) picked = makeFromModrinth(jar, mr);
      } catch {
        // ignore: 429/网络 → 走下一兜底
      }

      // ---- 3. CurseForge ----
      if (!picked && cfg.curseforgeKey) {
        try {
          const cf = await resolveFromCurseForge({
            modId: jar.manifest?.modId,
            version: jar.manifest?.version,
            fileName: jar.fileName,
            cf: { apiKey: cfg.curseforgeKey },
          });
          if (cf && cf.downloads.length > 0) {
            picked = {
              entry: {
                path: jar.relPath,
                hashes: { sha1: cf.sha1, sha512: cf.sha512 || jar.sha512 },
                downloads: cf.downloads,
                fileSize: cf.size || jar.size,
                source: 'curseforge',
                modId: jar.manifest?.modId,
                version: jar.manifest?.version,
                displayName: jar.manifest?.displayName,
                loaderSignature: jar.loaderSignature,
              },
            };
          }
        } catch {
          // ignore
        }
      }

      // ---- 4. embedded ----
      if (!picked) picked = makeEmbedded(jar);

      results[i] = picked;
      done++;
      cfg.onProgress?.(done, total, jar.fileName);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < limit; i++) workers.push(singleWorker());
  await Promise.all(workers);

  return results.filter((r): r is ResolveOutcome => r !== null);
}

function makeFromModrinth(jar: ScannedJar, mr: ModrinthResolveResult): ResolveOutcome {
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
      modId: jar.manifest?.modId,
      version: jar.manifest?.version,
      displayName: jar.manifest?.displayName,
      loaderSignature: jar.loaderSignature,
    },
  };
}

function makeEmbedded(jar: ScannedJar): ResolveOutcome {
  const m = jar.manifest;
  const modId = m?.modId ?? '(未知)';
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
    warning: `无法在线匹配 "${jar.fileName}" (modId=${modId}) — 该 mod 可能仅在 CurseForge 发布；设 \$CURSEFORGE_TOKEN 环境变量可尝试 CF 兜底，否则按源 jar 内嵌`,
  };
}
