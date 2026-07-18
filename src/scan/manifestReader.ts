import { parse as parseToml } from '@iarna/toml';
import { open } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';
import type { JarManifest, LoaderType } from '../types.ts';

/** 候选 manifest 路径，按优先级排序。第一个命中即返回。 */
const MANIFEST_CANDIDATES = [
  'META-INF/neoforge.mods.toml',
  'META-INF/mods.toml',
  'fabric.mod.json',
  'quilt.mod.json',
  'plugin.yml',
] as const;

interface RawNeoForgeToml {
  mods?: Array<{ modId?: string; version?: string; displayName?: string; displayURL?: string }>;
  dependencies?: Record<string, Array<{ type?: string; version?: string; side?: string }>>;
}

interface RawFabricJson {
  schemaVersion?: number;
  id?: string;
  version?: string;
  name?: string;
  contact?: { homepage?: string; sources?: string[] };
  depends?: Record<string, string>;
}

interface RawQuiltJson {
  quilt_loader?: {
    id?: string;
    version?: string;
    intermediate?: { id?: string }[];
  };
  quilt?: { metadata?: { name?: string; contact?: { homepage?: string } } };
}

interface RawPluginYml {
  name?: string;
  version?: string;
  main?: string;
  apiVersion?: string;
  website?: string;
}

/** 通过 manifest 路径推断 loader signature */
export function signatureFromManifestPath(path: string): LoaderType[] | null {
  if (path === 'META-INF/neoforge.mods.toml') return ['neoforge'];
  if (path === 'META-INF/mods.toml') return ['forge', 'neoforge'];
  if (path === 'fabric.mod.json') return ['fabric'];
  if (path === 'quilt.mod.json') return ['quilt'];
  if (path === 'plugin.yml') return ['spigot', 'paper', 'purpur', 'leaf'];
  return null;
}

async function getEntryBuffer(absPath: string, name: string): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    open(absPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      let found: Entry | null = null;
      const readFound = () => {
        if (!found) return resolve(null);
        zip.openReadStream(found, (e2, stream) => {
          if (e2) return reject(e2);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      };
      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        if (entry.fileName === name) {
          found = entry;
          readFound();
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', readFound);
      zip.on('error', reject);
    });
  });
}

/** 从 jar 中读取第一个命中的 manifest，解析为 JarManifest */
export async function readJarManifest(absPath: string): Promise<JarManifest | null> {
  for (const candidate of MANIFEST_CANDIDATES) {
    const buf = await getEntryBuffer(absPath, candidate).catch(() => null);
    if (!buf) continue;
    const text = buf.toString('utf8');
    return parseManifestText(candidate, text);
  }
  return null;
}

function parseManifestText(path: string, text: string): JarManifest {
  if (path.endsWith('.toml')) {
    return parseTomlManifest(path, text);
  }
  if (path === 'fabric.mod.json') return parseFabricJson(text);
  if (path === 'quilt.mod.json') return parseQuiltJson(text);
  if (path === 'plugin.yml') return parsePluginYml(text);
  return { kind: 'unknown' };
}

function parseTomlManifest(path: string, text: string): JarManifest {
  try {
    const t = parseToml(text) as unknown as RawNeoForgeToml;
    const first = t.mods?.[0];
    const deps = t.dependencies ?? {};
    const mcRange = findDep(deps, 'minecraft');
    const loaderRange = findDep(deps, first?.modId) ?? findDepAny(deps, ['forge', 'neoforge']);

    const kind = path === 'META-INF/neoforge.mods.toml' ? 'neoforge' : 'forge';
    return {
      kind,
      manifestPath: path,
      modId: first?.modId,
      version: first?.version,
      displayName: first?.displayName,
      displayURL: first?.displayURL,
      mcVersionRange: mcRange,
      loaderVersionRange: loaderRange,
    };
  } catch {
    return { kind: 'unknown', manifestPath: path };
  }
}

function findDep(
  deps: Record<string, Array<{ type?: string; version?: string }>>,
  modId: string | undefined,
): string | undefined {
  if (!modId) return undefined;
  const arr = deps[modId];
  const m = arr?.find((d) => d.type === 'mc' || d.type === 'minecraft');
  return m?.version ?? arr?.find((d) => d.type === undefined)?.version;
}

function findDepAny(
  deps: Record<string, Array<{ type?: string; version?: string }>>,
  names: string[],
): string | undefined {
  for (const n of names) {
    const arr = deps[n];
    if (arr) return arr[0]?.version;
  }
  return undefined;
}

function parseFabricJson(text: string): JarManifest {
  try {
    const j = JSON.parse(text) as RawFabricJson;
    const mcRange = j.depends?.minecraft ?? j.depends?.['minecraft-version'];
    return {
      kind: 'fabric',
      manifestPath: 'fabric.mod.json',
      modId: j.id,
      version: j.version,
      displayName: j.name,
      displayURL: j.contact?.homepage ?? j.contact?.sources?.[0],
      mcVersionRange: mcRange,
    };
  } catch {
    return { kind: 'unknown', manifestPath: 'fabric.mod.json' };
  }
}

function parseQuiltJson(text: string): JarManifest {
  try {
    const j = JSON.parse(text) as RawQuiltJson;
    return {
      kind: 'quilt',
      manifestPath: 'quilt.mod.json',
      modId: j.quilt_loader?.id,
      version: j.quilt_loader?.version,
      displayName: j.quilt?.metadata?.name,
      displayURL: j.quilt?.metadata?.contact?.homepage,
    };
  } catch {
    return { kind: 'unknown', manifestPath: 'quilt.mod.json' };
  }
}

function parsePluginYml(text: string): JarManifest {
  try {
    // 简单 YAML 子集解析，plugin.yml 实际都是扁平 key: value
    const lines = text.split(/\r?\n/);
    const map: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (m) map[m[1] ?? ''] = (m[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
    }
    const raw = map as unknown as RawPluginYml;
    return {
      kind: 'bukkit',
      manifestPath: 'plugin.yml',
      modId: raw.name,
      version: raw.version,
      displayName: raw.name,
      displayURL: raw.website,
      mcVersionRange: raw.apiVersion ? `[${raw.apiVersion}]` : undefined,
    };
  } catch {
    return { kind: 'unknown', manifestPath: 'plugin.yml' };
  }
}
