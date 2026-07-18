import type { FilterPolicy } from '../scan/whitelist.ts';
import type { FileEntry, ResolveOutcome, ServerCore, TumbleweedJson } from '../types.ts';

export interface AssembleJsonParams {
  name: string;
  versionId: string;
  summary: string;
  mcVersion: string;
  core: ServerCore;
  outcomes: ResolveOutcome[];
  regularFiles: string[];
  sourceRoot: string;
  policy: FilterPolicy;
}

/** 把 resolve 的产出与 core/regularFiles 组装成最终 Tumbleweed.json */
export function assembleJson(p: AssembleJsonParams): TumbleweedJson {
  const files: FileEntry[] = p.outcomes.map((o) => o.entry);
  const sortedRegular = [...p.regularFiles].sort();
  return {
    formatVersion: 1,
    game: 'minecraft',
    versionId: p.versionId,
    name: p.name,
    summary: p.summary,
    files,
    dependencies: {
      minecraft: p.mcVersion,
      [p.core.type]: p.core.loaderVersion,
    },
    server: {
      core: p.core,
      eulaAccepted: true,
      extraFiles: sortedRegular.map((path) => ({ path, packed: true })),
    },
    tumbleweed: {
      packerVersion: '0.1.0',
      packedAt: new Date().toISOString(),
      sourceRoot: p.sourceRoot,
      includedDirs: p.policy.includeDirs.slice().sort(),
      mode: p.policy.mode,
    },
  };
}
