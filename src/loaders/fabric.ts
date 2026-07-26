import { fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

interface FabricInstallerMeta {
  version?: string;
  libraries?: Array<{ name: string; url: string; size?: number; sha1?: string; sha512?: string }>;
}

export const fabricAdapter: LoaderAdapter = {
  type: 'fabric',

  detect(ctx: DetectContext): DetectResult | null {
    let hits = 0;
    const total = ctx.jars.length;
    for (const j of ctx.jars) {
      if (j.loaderSignature.includes('fabric')) hits++;
    }
    if (hits === 0 && !ctx.installerHints.some((h) => /fabric-server/i.test(h))) return null;
    return { type: 'fabric', hits, total };
  },

  async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}`;
    const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Fabric meta fetch failed: ${r.status}`);
    const list = (await r.json()) as Array<{
      loader: { version: string; stable: boolean };
      interceptor?: { version: string };
    }>;
    return list.slice(0, 10).map((e) => ({
      loaderVersion: e.loader.version,
      releasedAt: new Date().toISOString(),
      stable: e.loader.stable,
    }));
  },

  async fetchInstaller(mcVersion: string, loaderVersion: string): Promise<InstallerInfo> {
    // 优先：通用 fabric-installer.jar 自我安装版（最稳，由 fabric 团队维护）
    // 它会自行拉取对应 mcVersion / loaderVersion 的 server 与 libraries。
    const installerMetaUrl =
      'https://maven.fabricmc.net/net/fabricmc/fabric-installer/maven-metadata.xml';
    let installerVer = '';
    try {
      const r = await fetchWithRetry(installerMetaUrl, { timeoutMs: 15_000 });
      if (r.ok) {
        const text = await r.text();
        // 末尾的 <version>0.x.x</version> 取 release/latest
        const m = text.match(/<release>([^<]+)<\/release>/);
        installerVer = m?.[1] ?? '';
      }
    } catch {
      // ignore
    }
    if (installerVer) {
      const url = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${installerVer}/fabric-installer-${installerVer}.jar`;
      let r = await fetchWithRetry(url, { method: 'HEAD' });
      if (r.ok) {
        const size = Number(r.headers.get('content-length') ?? 0);
        return {
          url,
          sha512: '',
          size,
          fileName: `fabric-installer-${installerVer}.jar`,
          launchMode: 'installer',
        };
      }
      r = await fetchWithRetry(url);
      if (r.ok) {
        return {
          url,
          sha512: '',
          size: Number(r.headers.get('content-length') ?? 0),
          fileName: `fabric-installer-${installerVer}.jar`,
          launchMode: 'installer',
        };
      }
    }
    // 兜底：手拼 server-launch.json
    const serverJsonUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/server/json`;
    const r = await fetchWithRetry(serverJsonUrl, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Fabric installer meta not found for ${mcVersion}/${loaderVersion}`);
    const meta = (await r.json()) as FabricInstallerMeta;
    // 把 server.json 写入 deploy 目录，由 deploy 脚本读出后用 java 启动
    // 这里返回一个虚拟 installer：url 指向 server-json 自身，deploy 走 launch-jar 分支
    return {
      url: serverJsonUrl,
      sha512: '',
      size: 0,
      fileName: 'fabric-server-launch.json',
      launchMode: 'launch-jar',
    };
  },
};
