import type { LoaderType } from '../types.ts';

const MODRINTH_API = 'https://api.modrinth.com/v2';

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
}

interface ModrinthVersionFile {
  url: string;
  filename: string;
  hashes: { sha1?: string; sha512?: string };
  primary: boolean;
  size: number;
}

interface ModrinthVersion {
  id: string;
  project_id: string;
  name?: string;
  version_number?: string;
  game_versions?: string[];
  loaders?: string[];
  files: ModrinthVersionFile[];
}

export interface ModrinthResolveResult {
  projectId: string;
  versionId: string;
  downloads: string[];
  sha512: string;
  sha1?: string;
  size: number;
  fileName: string;
  loaderType?: LoaderType;
}

function modrinthHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'tumbleweed-mc/0.1',
  };
  if (token) h.Authorization = token;
  return h;
}

async function searchByModId(modId: string): Promise<ModrinthSearchHit | null> {
  // Modrinth search 接受 query，没有 modId 直查；尝试 slug 直查
  const candidates = [modId.toLowerCase(), modId];
  for (const q of candidates) {
    const url = `${MODRINTH_API}/project/${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: modrinthHeaders() });
    if (r.ok) {
      const j = (await r.json()) as { id: string; slug: string; title: string };
      return { project_id: j.id, slug: j.slug, title: j.title };
    }
  }
  const sUrl = `${MODRINTH_API}/search?limit=5&query=${encodeURIComponent(modId)}`;
  const r = await fetch(sUrl, { headers: modrinthHeaders() });
  if (!r.ok) return null;
  const hits = ((await r.json()) as { hits: ModrinthSearchHit[] }).hits || [];
  return hits.find((h) => h.slug === modId.toLowerCase()) ?? hits[0] ?? null;
}

async function listVersions(projectId: string): Promise<ModrinthVersion[]> {
  const url = `${MODRINTH_API}/project/${projectId}/version`;
  const r = await fetch(url, { headers: modrinthHeaders() });
  if (!r.ok) return [];
  return (await r.json()) as ModrinthVersion[];
}

/**
 * 在 Modrinth 上尝试匹配给定 modId + version (+ fileName 兜底)。
 * 返回最先命中版本的下载信息，或 null 表示未找到。
 */
export async function resolveFromModrinth(params: {
  modId?: string;
  version?: string;
  fileName?: string;
  sha512?: string;
  sha1?: string;
  token?: string;
}): Promise<ModrinthResolveResult | null> {
  if (!params.modId && !params.fileName) return null;
  let hit: ModrinthSearchHit | null = null;
  if (params.modId) hit = await searchByModId(params.modId);
  if (!hit && params.fileName) {
    // 文件名作为查询兜底
    const base = params.fileName.replace(/\.(jar|disabled)$/i, '').replace(/[-_+]/g, ' ');
    const r = await fetch(`${MODRINTH_API}/search?limit=5&query=${encodeURIComponent(base)}`, {
      headers: modrinthHeaders(),
    });
    if (r.ok) hit = (((await r.json()) as { hits: ModrinthSearchHit[] }).hits || [])[0] ?? null;
  }
  if (!hit) return null;

  const versions = await listVersions(hit.project_id);
  if (versions.length === 0) return null;

  // 优先按本地 sha512 命中
  let best: ModrinthVersion | undefined;
  let bestFile: ModrinthVersionFile | undefined;
  if (params.sha512) {
    for (const v of versions) {
      const f = v.files.find(
        (ff) => ff.hashes.sha512?.toLowerCase() === params.sha512?.toLowerCase(),
      );
      if (f) {
        best = v;
        bestFile = f;
        break;
      }
    }
  }
  // 退一步按 version_number 匹配
  if (!bestFile && params.version) {
    const v = versions.find((vv) => vv.version_number === params.version);
    if (v) {
      best = v;
      bestFile = v.files[0];
    }
  }
  // 再退一步按 file 名匹配
  if (!bestFile && params.fileName) {
    for (const v of versions) {
      const f = v.files.find((ff) => ff.filename === params.fileName);
      if (f) {
        best = v;
        bestFile = f;
        break;
      }
    }
  }
  if (!best || !bestFile) return null;

  return {
    projectId: hit.project_id,
    versionId: best.id,
    downloads: [bestFile.url],
    sha512: bestFile.hashes.sha512 ?? '',
    sha1: bestFile.hashes.sha1,
    size: bestFile.size,
    fileName: bestFile.filename,
    loaderType: (best.loaders?.[0] as LoaderType) ?? undefined,
  };
}
