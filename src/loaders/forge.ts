import type {
  DetectContext,
  DetectResult,
  InstallerInfo,
  LoaderAdapter,
  LoaderCandidate,
} from '../types.ts';

export const forgeAdapter: LoaderAdapter = {
  type: 'forge',

  detect(ctx: DetectContext): DetectResult | null {
    let hits = 0;
    const total = ctx.jars.length;
    for (const j of ctx.jars) {
      if (j.loaderSignature.includes('forge') && !j.loaderSignature.includes('neoforge')) hits++;
    }
    if (hits === 0 && !ctx.installerHints.some((h) => /forge/i.test(h) && !/neoforge/i.test(h))) {
      return null;
    }
    return { type: 'forge', hits, total };
  },

  async fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]> {
    // Forge 主 maven 与 fallback
    const urls = [
      'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
      'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
    ];
    let text = '';
    let lastErr: unknown;
    for (const u of urls) {
      try {
        const r = await fetch(u, { headers: { Accept: 'application/xml' } });
        if (r.ok) {
          text = await r.text();
          break;
        }
        lastErr = new Error(`${u} -> ${r.status}`);
      } catch (e) {
        lastErr = e;
      }
    }
    if (!text)
      throw new Error(`Forge metadata fetch failed: ${(lastErr as Error)?.message ?? lastErr}`);
    const versions = parseForgeVersions(text, mcVersion);
    if (versions.length === 0) throw new Error(`No Forge version for mc ${mcVersion}`);
    return versions.slice(0, 10).map((v, i) => ({
      loaderVersion: v.version,
      releasedAt: new Date().toISOString(),
      stable: !/(beta|alpha)/i.test(v.version) && i === 0,
    }));
  },

  async fetchInstaller(mcVersion: string, loaderVersion: string): Promise<InstallerInfo> {
    // Forge 直链格式：minecraftforge/maven/forge/<mc>-<loader>/forge-<mc>-<loader>-installer.jar
    const base = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`;
    const r = await fetch(base, { method: 'HEAD' });
    if (r.ok) {
      return {
        url: base,
        sha512: '',
        size: Number(r.headers.get('content-length') ?? 0),
        fileName: `forge-${mcVersion}-${loaderVersion}-installer.jar`,
        launchMode: 'installer',
      };
    }
    // fallback: files.minecraftforge.net 直链
    const fb = `https://files.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/forge-${mcVersion}-${loaderVersion}-installer.jar`;
    const r2 = await fetch(fb, { method: 'HEAD' });
    if (!r2.ok) throw new Error(`Forge installer not found for ${mcVersion}-${loaderVersion}`);
    return {
      url: fb,
      sha512: '',
      size: Number(r2.headers.get('content-length') ?? 0),
      fileName: `forge-${mcVersion}-${loaderVersion}-installer.jar`,
      launchMode: 'installer',
    };
  },
};

interface ForgeVer {
  version: string;
}

function parseForgeVersions(xml: string, mcVersion: string): ForgeVer[] {
  const vRe = /<version>([^<]+)<\/version>/g;
  const vers = [...xml.matchAll(vRe)].map((m) => m[1] ?? '');
  return vers
    .filter((v) => v.startsWith(`${mcVersion}-`))
    .map((v) => ({ version: v.slice(mcVersion.length + 1) }));
}
