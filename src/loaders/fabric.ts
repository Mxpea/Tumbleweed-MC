import { fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

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
    // Fabric 服务端启动需 fabric-server-launch.jar + 一个 game jar (下载者)
    const installerUrl = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/server/json`;
    const r = await fetchWithRetry(installerUrl, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Fabric installer meta not found for ${mcVersion}/${loaderVersion}`);
    const meta = (await r.json()) as {
      launcher: { path: string; sha1?: string; size?: number; url: string };
      mainClass: { url: string; size?: number };
      libraries: Array<{ url: string; size?: number; sha1?: string }>;
    };
    const launcherUrl = meta.launcher.url;
    const size = meta.launcher.size ?? 0;
    // fabric-server-launch.jar 本身的 sha512 metadata 不提供，留空校验跳过
    return {
      url: launcherUrl,
      sha512: '',
      size,
      fileName: 'fabric-server-launch.jar',
      launchMode: 'launch-jar',
    };
  },
};
