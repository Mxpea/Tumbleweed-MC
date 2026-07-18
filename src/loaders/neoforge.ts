import { fetchWithMirrors, fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

/**
 * NeoForge 适配器。
 * metadata 主源 maven.neoforged.net 在 GFW 网络下经常被强关，
 * 使用多镜像 fallback：forgecdn > 主源 > 其它镜像。
 *
 * NeoForge maven 路径形如：
 *   <maven>/releases/net/neoforged/neoforge/<loaderVersion>/neoforge-<loaderVersion>-installer.jar
 * 其中 loaderVersion 自身已含 mc 前缀，例如 "21.1.240" 对应 MC 1.21.1。
 */
const MAVEN_MIRRORS = [
  'https://neoforged.forgecdn.net',
  'https://maven.neoforged.net',
  'https://maven.minecraftforge.net/net/neoforged', // 兼容别名
];

function metaUrl(mirror: string): string {
  // 第一个镜像路径是 /releases/net/...，第二个备用 forge maven 路径不同
  if (mirror.endsWith('/net/neoforged')) {
    return `${mirror}/neoforge/maven-metadata.xml`;
  }
  return `${mirror}/releases/net/neoforged/neoforge/maven-metadata.xml`;
}

function installerUrl(mirror: string, loaderVersion: string): string {
  if (mirror.endsWith('/net/neoforged')) {
    return `${mirror}/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }
  return `${mirror}/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
}

interface MavenVersion {
  version: string;
  updated?: string;
}

export const neoforgeAdapter: LoaderAdapter = {
  type: 'neoforge',

  detect(ctx: DetectContext): DetectResult | null {
    let hits = 0;
    const total = ctx.jars.length;
    for (const j of ctx.jars) {
      if (j.loaderSignature.includes('neoforge')) hits++;
    }
    if (hits === 0 && !ctx.installerHints.some((h) => /neoforge/i.test(h))) return null;
    return {
      type: 'neoforge',
      hits,
      total,
      installedVersion: installedVersion(ctx),
    };
  },

  async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
    const urls = MAVEN_MIRRORS.map((m) => metaUrl(m));
    const { response } = await fetchWithMirrors(urls, { timeoutMs: 20_000 });
    const text = await response.text();
    const versions = parseMavenVersions(text, mcVersion);
    if (versions.length === 0) throw new Error(`No NeoForge version for mc ${mcVersion}`);
    // 按 loader 版本号倒序（最新在前），过滤掉 beta/alpha 让用户在 TUI 中看到清晰推荐
    const sorted = versions.sort(cmpLoaderVersion).reverse();
    return sorted.slice(0, 15).map((v, i) => ({
      loaderVersion: v.version,
      releasedAt: v.updated ?? new Date().toISOString(),
      stable: !/beta|alpha/i.test(v.version) && i === 0,
    }));
  },

  async fetchInstaller(_mcVersion: string, loaderVersion: string): Promise<InstallerInfo> {
    const urls = MAVEN_MIRRORS.map((m) => installerUrl(m, loaderVersion));
    let info: { response: Response; url: string };
    try {
      info = await fetchWithMirrors(urls, { method: 'HEAD' });
    } catch {
      // HEAD 不支持则用 GET（HEAD 可能 405）
      info = await fetchWithMirrors(urls, {});
    }
    const size = Number(info.response.headers.get('content-length') ?? 0);
    // installer jar 的 sha512 sidecar 文件是 byte-decimal 格式而非 hex，我们不再远程取，
    // 直接让 deploy 阶段跳过 installer 哈希校验（installer 自身会校验 libraries）。
    return {
      url: info.url,
      sha512: '',
      size,
      fileName: `neoforge-${loaderVersion}-installer.jar`,
      launchMode: 'installer',
    };
  },
};

function parseMavenVersions(xml: string, mcVersion: string): MavenVersion[] {
  const vRe = /<version>([^<]+)<\/version>/g;
  const uRe = /<lastUpdated>([^<]+)<\/lastUpdated>/g;
  const vers = [...xml.matchAll(vRe)].map((m) => m[1] ?? '');
  const ups = [...xml.matchAll(uRe)].map((m) => m[1] ?? '');
  // NeoForge 版本号与 mc 一对一映射：
  //   1.21.1 -> 21.1.x
  //   1.20.4 -> 20.4.x（早期带 -beta 后缀）
  //   1.20.6 -> 20.6.x
  const mcPrefix = mcToLoaderPrefix(mcVersion);
  const versions: MavenVersion[] = [];
  for (let i = 0; i < vers.length; i++) {
    const v = vers[i] ?? '';
    if (v.startsWith(`${mcPrefix}.`) || v === mcPrefix) {
      // 排除纯 mc 版本号占位（如 "1.21.1"）
      if (v === mcVersion) continue;
      versions.push({ version: v, updated: formatLastUpdated(ups[i]) });
    }
  }
  return versions;
}

function mcToLoaderPrefix(mc: string): string {
  const m = mc.match(/^\d+\.(\d+)\.(\d+)/);
  if (!m) return mc;
  return `${m[1]}.${m[2]}`;
}

function formatLastUpdated(s?: string): string | undefined {
  if (!s) return undefined;
  // maven lastUpdated 是 yyyyMMddHHmmssSSS
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return s;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/** 把 "21.1.240" 拆成数字元组比较，smaller beta/i18n label 一律按 0 处理 */
function cmpLoaderVersion(a: MavenVersion, b: MavenVersion): number {
  const pa = a.version.split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.version.split(/[.-]/).map((x) => Number(x) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const v = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (v !== 0) return v;
  }
  return 0;
}

function installedVersion(ctx: DetectContext): string | undefined {
  for (const hint of ctx.installerHints) {
    const m = hint.match(/neoforge-?(?:[\d.]+-)?([\d.]+)/i);
    if (m) return m[1];
  }
  return undefined;
}

// 引用以保留 tree-shaking 友好
export const _neoforgeAdapterUses = fetchWithRetry;
