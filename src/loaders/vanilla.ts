import { fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

export const vanillaAdapter: LoaderAdapter = {
  type: 'vanilla',

  detect(ctx: DetectContext): DetectResult | null {
    // vanilla 仅在没有其他 loader 命中且 mods/plugins 目录基本为空时给出弱信号
    const total = ctx.jars.length;
    if (total > 0) return null;
    return { type: 'vanilla', hits: 0, total: 0 };
  },

  async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
    const url = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
    const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Mojang version manifest fetch failed: ${r.status}`);
    const manifest = (await r.json()) as {
      versions: Array<{ id: string; type: string; releaseTime: string; url: string }>;
    };
    const found = manifest.versions.find((v) => v.id === mcVersion);
    if (!found) throw new Error(`Vanilla server not found for mc ${mcVersion}`);
    return [
      {
        loaderVersion: mcVersion,
        releasedAt: found.releaseTime,
        stable: found.type === 'release',
      },
    ];
  },

  async fetchInstaller(mcVersion: string): Promise<InstallerInfo> {
    const url = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
    const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Mojang version manifest fetch failed: ${r.status}`);
    const manifest = (await r.json()) as {
      versions: Array<{ id: string; url: string }>;
    };
    const ver = manifest.versions.find((v) => v.id === mcVersion);
    if (!ver) throw new Error(`Vanilla ${mcVersion} not found`);
    const r2 = await fetchWithRetry(ver.url, { timeoutMs: 20_000 });
    if (!r2.ok) throw new Error(`Vanilla version meta fetch failed for ${mcVersion}`);
    const verMeta = (await r2.json()) as {
      downloads: { server: { url: string; sha1: string; size: number } };
    };
    const dl = verMeta.downloads.server;
    if (!dl) throw new Error(`No server jar for vanilla ${mcVersion}`);
    return {
      url: dl.url,
      sha512: '', // Mojang 只给 sha1
      size: dl.size,
      fileName: `server-${mcVersion}.jar`,
      launchMode: 'vanilla',
    };
  },
};
