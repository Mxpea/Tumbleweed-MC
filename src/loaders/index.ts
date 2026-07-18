import type { LoaderAdapter } from '../types.ts';
import { fabricAdapter } from './fabric.ts';
import { forgeAdapter } from './forge.ts';
import { neoforgeAdapter } from './neoforge.ts';
import { paperAdapter } from './paper.ts';
import { quiltAdapter } from './quilt.ts';
import { vanillaAdapter } from './vanilla.ts';

export interface LoaderAdapters {
  list: LoaderAdapter[];
  byType: Map<string, LoaderAdapter>;
}

export function buildLoaderAdapters(): LoaderAdapters {
  const list: LoaderAdapter[] = [
    neoforgeAdapter,
    forgeAdapter,
    fabricAdapter,
    quiltAdapter,
    paperAdapter,
    vanillaAdapter,
  ];
  const byType = new Map(list.map((a) => [a.type, a]));
  return { list, byType };
}

/** 兼容别名：paper 分支可能被识别为 pl/purpur/leaf */
export function typeAliases(t: string): string[] {
  switch (t) {
    case 'paper':
      return ['paper', 'purpur', 'leaf'];
    default:
      return [t];
  }
}
