import { fetchWithRetry } from '../api/index.ts';
import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

type PaperFlavor = 'paper' | 'purpur' | 'leaf';

interface PaperBuildEntry {
  id: number;
  time?: string;
  channel?: 'STABLE' | 'EXPERIMENTAL';
  version?: string;
  downloads?: Record<
    string,
    { name?: string; url?: string; size?: number; checksums?: { sha256?: string } }
  >;
}

/**
 * Paper / Purpur / Leaf 共用适配器。
 * - 用 fill.papermc.io v3 REST API（旧 api.papermc.io/v2 已 sunset）
 * - Purpur 走官方 api.purpurmc.org
 * - Leaf 走官方 api.leafmc.dev
 */
function makeAdapter(flavor: PaperFlavor): LoaderAdapter {
  return {
    type: flavor,

    detect(ctx: DetectContext): DetectResult | null {
      let hits = 0;
      const total = ctx.jars.length;
      for (const j of ctx.jars) {
        if (j.loaderSignature.includes('paper') || j.loaderSignature.includes('spigot')) {
          hits++;
        }
      }
      const hintMatch = ctx.installerHints.some((h) => new RegExp(flavor, 'i').test(h));
      if (hits === 0 && !hintMatch) {
        const hasPluginsDir = [...ctx.dirs].some(
          (d) => d === 'plugins' || d.startsWith('plugins/'),
        );
        if (!hasPluginsDir) return null;
      }
      return { type: flavor, hits, total };
    },

    async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
      if (flavor === 'purpur') {
        const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}`;
        const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
        if (!r.ok) throw new Error(`Purpur meta fetch failed: ${r.status}`);
        const meta = (await r.json()) as {
          builds?: { latest?: string };
          version: string;
        };
        const latest = meta.builds?.latest ?? 'latest';
        return [
          {
            loaderVersion: latest,
            releasedAt: new Date().toISOString(),
            stable: true,
          },
        ];
      }

      if (flavor === 'leaf') {
        const url = `https://api.leafmc.dev/v2/projects/leaf/versions/${encodeURIComponent(mcVersion)}/builds`;
        const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
        if (!r.ok) throw new Error(`Leaf meta fetch failed: ${r.status}`);
        const meta = (await r.json()) as Array<{ build: number; time?: string }>;
        if (meta.length === 0) throw new Error(`No Leaf builds for ${mcVersion}`);
        const latest = meta[meta.length - 1];
        if (!latest) throw new Error(`No Leaf builds for ${mcVersion}`);
        return [
          {
            loaderVersion: String(latest.build),
            releasedAt: latest.time ?? new Date().toISOString(),
            stable: true,
          },
        ];
      }

      // paper v3
      const url = `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds`;
      const r = await fetchWithRetry(url, { timeoutMs: 20_000 });
      if (!r.ok) throw new Error(`Paper meta fetch failed: ${r.status}`);
      const list = (await r.json()) as PaperBuildEntry[];
      const stable = list.filter((b) => b.channel === 'STABLE');
      const arr = stable.length ? stable : list;
      return arr
        .slice(-10)
        .reverse()
        .map((b) => ({
          loaderVersion: String(b.id),
          releasedAt: b.time ?? new Date().toISOString(),
          stable: b.channel === 'STABLE',
        }));
    },

    async fetchInstaller(mcVersion: string, loaderVersion: string): Promise<InstallerInfo> {
      if (flavor === 'purpur') {
        const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/download`;
        const r = await fetchWithRetry(url, { method: 'HEAD', timeoutMs: 30_000 });
        if (!r.ok) throw new Error(`Purpur build not found: ${mcVersion}/${loaderVersion}`);
        return {
          url,
          sha512: '',
          size: Number(r.headers.get('content-length') ?? 0),
          fileName: `purpur-${mcVersion}-${loaderVersion}.jar`,
          launchMode: 'paperclip',
        };
      }

      if (flavor === 'leaf') {
        const url = `https://api.leafmc.dev/v2/projects/leaf/versions/${encodeURIComponent(mcVersion)}/builds/${encodeURIComponent(loaderVersion)}/download`;
        const r = await fetchWithRetry(url, { method: 'HEAD', timeoutMs: 30_000 });
        if (!r.ok) throw new Error(`Leaf build not found: ${mcVersion}/${loaderVersion}`);
        return {
          url,
          sha512: '',
          size: Number(r.headers.get('content-length') ?? 0),
          fileName: `leaf-${mcVersion}-${loaderVersion}.jar`,
          launchMode: 'paperclip',
        };
      }

      // paper v3：先 GET builds 列表找到指定 build id 的下载 URL
      const listUrl = `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(mcVersion)}/builds`;
      const r = await fetchWithRetry(listUrl, { timeoutMs: 30_000 });
      if (!r.ok) throw new Error(`Paper builds list fetch failed: ${r.status}`);
      const list = (await r.json()) as PaperBuildEntry[];
      const target = list.find((b) => String(b.id) === String(loaderVersion));
      if (!target) throw new Error(`Paper build ${loaderVersion} not found in ${mcVersion}`);
      const dl = target.downloads?.['server:default'] ?? target.downloads?.server ?? null;
      if (!dl?.url) throw new Error(`Paper build ${loaderVersion} has no server:default download`);
      return {
        url: dl.url,
        sha512: '',
        size: dl.size ?? 0,
        fileName: dl.name ?? `paper-${mcVersion}-${loaderVersion}.jar`,
        launchMode: 'paperclip',
      };
    },
  };
}

export const paperAdapter: LoaderAdapter = makeAdapter('paper');
export const purpurAdapter: LoaderAdapter = makeAdapter('purpur');
export const leafAdapter: LoaderAdapter = makeAdapter('leaf');
