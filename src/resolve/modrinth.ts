const MODRINTH_API = 'https://api.modrinth.com/v2';

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

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
}

export interface ModrinthResolveResult {
  projectId: string;
  versionId: string;
  downloads: string[];
  sha512: string;
  sha1?: string;
  size: number;
  fileName: string;
  loaderType?: string;
}

function modrinthHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'tumbleweed-mc/0.1 (https://github.com/Tumbleweed-MC)',
  };
  if (token) h.Authorization = token;
  return h;
}

/**
 * 批量按 sha1 hash 查询 Modrinth 返回 version 信息。
 * Modrinth 一次最多 1000 个 hash。
 * 返回的 Map<sha1, ModrinthVersion>。
 */
export async function batchResolveBySha1(
  sha1List: string[],
  token?: string,
): Promise<Map<string, ModrinthVersion>> {
  const out = new Map<string, ModrinthVersion>();
  if (sha1List.length === 0) return out;

  // 切分 1000 一批
  const BATCH = 1000;
  for (let i = 0; i < sha1List.length; i += BATCH) {
    const slice = sha1List.slice(i, i + BATCH);
    const body = JSON.stringify({ hashes: slice, algorithm: 'sha1' });
    const r = await fetch(`${MODRINTH_API}/version_files`, {
      method: 'POST',
      headers: { ...modrinthHeaders(token), 'Content-Type': 'application/json' },
      body,
    });
    if (!r.ok) {
      // 失败时容错：返回空 map，调用方走单 jar fallback
      continue;
    }
    const obj = (await r.json()) as Record<string, ModrinthVersion | null>;
    for (const [h, v] of Object.entries(obj)) {
      if (v) out.set(h.toLowerCase(), v);
    }
  }
  return out;
}

/**
 * 单 jar 兜底：按 modId/version/fileName 直查。
 * 用于批量查询丢失的 hash（mod 不在 Modrinth / hash 异常 / 修改过）。
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
  if (params.modId) {
    const candidates = [params.modId.toLowerCase(), params.modId];
    for (const q of candidates) {
      const url = `${MODRINTH_API}/project/${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: modrinthHeaders() });
      if (r.ok) {
        const j = (await r.json()) as { id: string; slug: string; title: string };
        hit = { project_id: j.id, slug: j.slug, title: j.title };
        break;
      }
    }
  }
  if (!hit && params.fileName) {
    const base = params.fileName.replace(/\.(jar|disabled)$/i, '').replace(/[-_+]/g, ' ');
    const r = await fetch(`${MODRINTH_API}/search?limit=5&query=${encodeURIComponent(base)}`, {
      headers: modrinthHeaders(),
    });
    if (r.ok) hit = (((await r.json()) as { hits: ModrinthSearchHit[] }).hits || [])[0] ?? null;
  }
  if (!hit) return null;

  const url = `${MODRINTH_API}/project/${hit.project_id}/version`;
  const r = await fetch(url, { headers: modrinthHeaders() });
  if (!r.ok) return null;
  const versions = (await r.json()) as ModrinthVersion[];
  if (versions.length === 0) return null;

  const matchEntry = matchVersion(versions, params);
  if (!matchEntry) return null;

  return {
    projectId: hit.project_id,
    versionId: matchEntry.version.id,
    downloads: [matchEntry.file.url],
    sha512: matchEntry.file.hashes.sha512 ?? '',
    sha1: matchEntry.file.hashes.sha1,
    size: matchEntry.file.size,
    fileName: matchEntry.file.filename,
    loaderType: matchEntry.version.loaders?.[0],
  };
}

interface MatchedEntry {
  version: ModrinthVersion;
  file: ModrinthVersionFile;
}

function matchVersion(
  versions: ModrinthVersion[],
  p: { sha512?: string; sha1?: string; version?: string; fileName?: string },
): MatchedEntry | null {
  if (p.sha512) {
    for (const v of versions) {
      const f = v.files.find((ff) => ff.hashes.sha512?.toLowerCase() === p.sha512?.toLowerCase());
      if (f) return { version: v, file: f };
    }
  }
  if (p.sha1) {
    for (const v of versions) {
      const f = v.files.find((ff) => ff.hashes.sha1?.toLowerCase() === p.sha1?.toLowerCase());
      if (f) return { version: v, file: f };
    }
  }
  if (p.version) {
    const v = versions.find((vv) => vv.version_number === p.version);
    if (v) {
      const f = v.files[0];
      if (f) return { version: v, file: f };
    }
  }
  if (p.fileName) {
    for (const v of versions) {
      const f = v.files.find((ff) => ff.filename === p.fileName);
      if (f) return { version: v, file: f };
    }
  }
  return null;
}

/** 从 ModrinthVersion 直接转 ResolveResult，作为批量接口返回后的 helper */
export function versionToResult(
  version: ModrinthVersion,
  file: ModrinthVersionFile,
): ModrinthResolveResult {
  return {
    projectId: version.project_id,
    versionId: version.id,
    downloads: [file.url],
    sha512: file.hashes.sha512 ?? '',
    sha1: file.hashes.sha1,
    size: file.size,
    fileName: file.filename,
    loaderType: version.loaders?.[0],
  };
}
