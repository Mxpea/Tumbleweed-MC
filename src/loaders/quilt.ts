import { fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

export const quiltAdapter: LoaderAdapter = {
  type: 'quilt',

  detect(ctx: DetectContext): DetectResult | null {
    let hits = 0;
    const total = ctx.jars.length;
    for (const j of ctx.jars) {
      if (j.loaderSignature.includes('quilt')) hits++;
    }
    if (hits === 0) return null;
    return { type: 'quilt', hits, total };
  },

  async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
    const url = `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}`;
    const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Quilt meta fetch failed: ${r.status}`);
    const list = (await r.json()) as Array<{
      loader: { version: string };
      intermediary: { version: string };
    }>;
    return list.slice(0, 10).map((e) => ({
      loaderVersion: e.loader.version,
      releasedAt: new Date().toISOString(),
      stable: true,
    }));
  },

  async fetchInstaller(mcVersion: string, loaderVersion: string): Promise<InstallerInfo> {
    const url = `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/server/json`;
    const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
    if (!r.ok) throw new Error(`Quilt installer meta not found for ${mcVersion}/${loaderVersion}`);
    const meta = (await r.json()) as {
      launcher: { url: string; size?: number };
    };
    return {
      url: meta.launcher.url,
      sha512: '',
      size: meta.launcher.size ?? 0,
      fileName: 'quilt-server-launch.jar',
      launchMode: 'launch-jar',
    };
  },
};
