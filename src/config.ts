import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml';
import type { JsonMap } from '@iarna/toml';
import type { FilterPolicy } from './scan/whitelist.ts';

interface TumbleweedConfigRaw {
  include?: string[];
  exclude?: string[];
  includeFiles?: string[];
  mode?: 'whitelist' | 'full';
  modrinthToken?: string;
  curseforgeKey?: string;
}

export interface TumbleweedConfig {
  policy: FilterPolicy;
  modrinthToken?: string;
  curseforgeKey?: string;
}

const FILENAME = '.tumbleweed.toml';

export async function loadConfig(root: string): Promise<TumbleweedConfig | null> {
  const path = join(root, FILENAME);
  try {
    await stat(path);
  } catch {
    return null;
  }
  const text = await readFile(path, 'utf8');
  try {
    const raw = parseToml(text) as unknown as TumbleweedConfigRaw;
    return {
      policy: {
        mode: raw.mode === 'full' ? 'full' : 'whitelist',
        includeDirs: raw.include ?? [],
        excludeDirs: raw.exclude ?? [],
        includeFiles: raw.includeFiles ?? [],
      },
      modrinthToken: raw.modrinthToken,
      curseforgeKey: raw.curseforgeKey,
    };
  } catch {
    return null;
  }
}

export async function saveConfig(root: string, cfg: TumbleweedConfig): Promise<void> {
  const path = join(root, FILENAME);
  const raw: TumbleweedConfigRaw = {
    include: cfg.policy.includeDirs,
    exclude: cfg.policy.excludeDirs,
    includeFiles: cfg.policy.includeFiles,
    mode: cfg.policy.mode,
    modrinthToken: cfg.modrinthToken,
    curseforgeKey: cfg.curseforgeKey,
  };
  await writeFile(path, stringifyToml(raw as unknown as JsonMap), 'utf8');
}
