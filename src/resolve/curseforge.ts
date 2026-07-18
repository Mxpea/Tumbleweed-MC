const CF_API = 'https://api.curseforge.com/v1';

/** CurseForge 必须的 X-API-Key 头 */
interface CFConfig {
  apiKey: string;
}

interface CFFile {
  id: number;
  fileName: string;
  downloadUrl?: string;
  fileDate?: string;
  hashes?: Array<{ algo: number; value: string }>; // algo: 1=sha1, 2=sha256, 3=md5
  fileLength?: number;
  gameVersions?: string[];
}

interface CFProjectFile {
  files?: CFFile[];
}

interface CFMod {
  id: string;
  slug: string;
}

interface CFProject {
  data: { id: number; slug: string; name: string };
}

interface CFSearchResult {
  data: Array<{ id: number; slug: string; name: string }>;
}

/** 实现 CurseForge 简单查询：modId(version)匹配返回下载信息 */
export async function resolveFromCurseForge(params: {
  modId?: string;
  version?: string;
  fileName?: string;
  sha512?: string;
  cf: CFConfig;
  cfProjectId?: string;
}): Promise<{
  downloads: string[];
  sha512?: string;
  sha1?: string;
  size: number;
  fileName: string;
} | null> {
  if (!params.cf.apiKey) return null;
  const headers: Record<string, string> = {
    'X-API-Key': params.cf.apiKey,
    Accept: 'application/json',
    'User-Agent': 'tumbleweed-mc/0.1',
  };

  let projectId = params.cfProjectId;
  if (!projectId) {
    // 搜索 game=minecraft class=mc-mods
    const slug = params.modId ?? '';
    if (!slug) return null;
    const r = await fetch(
      `${CF_API}/mods/search?gameId=432&classId=6&searchFilter=${encodeURIComponent(slug)}&pageSize=5`,
      { headers },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as CFSearchResult;
    const hit = j.data.find((d) => d.slug.toLowerCase() === slug.toLowerCase()) ?? j.data[0];
    if (!hit) return null;
    projectId = String(hit.id);
  }

  const url = `${CF_API}/mods/${projectId}/files?pageSize=200`;
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  const j = (await r.json()) as CFProjectFile;
  const files = j.files ?? [];

  // 优先 sha512（CF 不一定提供 sha512；会提供 sha1）
  let f: CFFile | undefined;
  if (params.fileName) f = files.find((ff) => ff.fileName === params.fileName);
  if (!f && params.version) {
    const ver = params.version;
    f = files.find(
      (ff) => /\b(?:v|version)?[\s_-]*/.test(ff.fileName) && ff.fileName.includes(ver),
    );
  }
  if (!f) return null;

  const hashSha1 = f.hashes?.find((h) => h.algo === 1)?.value;
  return {
    downloads: f.downloadUrl ? [f.downloadUrl] : [],
    sha1: hashSha1,
    sha512: '', // CF 不提供 sha512，留空
    size: f.fileLength ?? 0,
    fileName: f.fileName,
  };
}
