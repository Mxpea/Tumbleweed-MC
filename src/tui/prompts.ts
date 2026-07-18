import * as p from '@inquirer/prompts';
import { buildLoaderAdapters } from '../loaders/index.ts';
import { scanServerRoot } from '../scan/index.ts';
import type { FilterPolicy } from '../scan/whitelist.ts';
import type { DetectContext, DetectResult, LoaderAdapter, LoaderCandidate } from '../types.ts';

export interface AskPackOptionsResult {
  root: string;
  policy: FilterPolicy;
  loaderType: string;
  mcVersion: string;
  loaderVersion: string;
  modrinthToken?: string;
  curseforgeKey?: string;
  outZip: string;
  name: string;
  versionId: string;
  summary: string;
}

export async function askPackOptions(): Promise<AskPackOptionsResult> {
  const root = await p.input({
    message: '服务器根路径',
    validate: (s) => (s && s.trim().length > 0 ? true : '请输入路径'),
  });

  const mode = (await p.select({
    message: '打包模式',
    choices: [
      { value: 'whitelist', name: '白名单（推荐，排除 world/logs 等）' },
      { value: 'full', name: '全量（包含 world/logs）' },
    ],
  })) as 'whitelist' | 'full';

  // 先扫描以便勾选目录
  const policy0: FilterPolicy = {
    mode,
    includeDirs: [],
    excludeDirs: [],
    includeFiles: [],
  };
  const scan = await scanServerRoot(root, policy0);

  // 让用户勾选目录（仅顶层，全部 walk 太慢且无意义）
  const topDirs = [...scan.allDirs].filter((d) => !d.includes('/')).sort();
  const selected = (await p.checkbox({
    message: '勾选要打包的顶层目录（白名单默认已勾选；用户可加选 world 等被自动排除的项）',
    pageSize: 20,
    choices: topDirs.map((d) => ({
      name: d,
      value: d,
      checked: isDefaultChecked(d, mode),
    })),
  })) as string[];

  const policy: FilterPolicy = {
    mode,
    includeDirs: selected.filter((d) => !isDefaultWhitelisted(d)),
    excludeDirs: topDirs.filter((d) => !selected.includes(d) && isDefaultWhitelisted(d)),
    includeFiles: [],
  };

  // loader 识别
  const adapters = buildLoaderAdapters();
  const detectCtx: DetectContext = {
    jars: scan.jars,
    dirs: scan.allDirs,
    installerHints: scan.installerHints,
  };
  const detected = adapters.list
    .map((a) => a.detect(detectCtx))
    .filter((r): r is DetectResult => r !== null)
    .sort((a, b) => b.hits - a.hits);

  const loaderType = (await p.select({
    message: '选择加载器 / 服务器核心',
    choices: [
      ...detected.map((r) => ({
        value: r.type,
        name: `${r.type}  (${r.hits}/${r.total} 命中${r.installedVersion ? `，已安装 ${r.installedVersion}` : ''})`,
      })),
      { value: 'manual-url', name: '完全自定义 URL' },
    ],
  })) as string;

  // mc 版本候选（来自 manifest 投票）
  const mcVotes = new Map<string, number>();
  for (const j of scan.jars) {
    const range = j.manifest?.mcVersionRange;
    if (!range) continue;
    const m = range.match(/\[(\d+\.\d+(?:\.\d+)?)/);
    if (m?.[1]) mcVotes.set(m[1], (mcVotes.get(m[1]) ?? 0) + 1);
  }
  const mcCandidates = [...mcVotes.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const mcVersion = (await p.select({
    message: 'Minecraft 版本',
    choices: [
      ...mcCandidates.map((v) => ({ value: v, name: v })),
      { value: '__manual__', name: '手动输入' },
    ],
  })) as string;
  const finalMc = mcVersion === '__manual__' ? await p.input({ message: 'MC 版本：' }) : mcVersion;

  // loader 候选版本
  let loaderVersion = '';
  if (loaderType !== 'manual-url') {
    const adapter = adapters.byType.get(loaderType) as LoaderAdapter;
    let candidates: LoaderCandidate[] = [];
    try {
      candidates = await adapter.fetchCandidates(finalMc);
    } catch (e) {
      console.warn(`  (联网查询 ${loaderType} 失败：${e instanceof Error ? e.message : e})`);
    }
    loaderVersion = (await p.select({
      message: '选择 loader 版本',
      choices: [
        ...candidates.map((c) => ({
          value: c.loaderVersion,
          name: `${c.loaderVersion}${c.stable ? ' (stable)' : ''}${c.releasedAt ? `  ${c.releasedAt.slice(0, 10)}` : ''}`,
        })),
        { value: '__installed__', name: '使用已安装版本（不重新下载 installer）' },
        { value: '__manual__', name: '手动输入版本号' },
      ],
    })) as string;
    if (loaderVersion === '__manual__') {
      loaderVersion = await p.input({ message: 'loader 版本：' });
    } else if (loaderVersion === '__installed__') {
      const installed = detected.find((r) => r.type === loaderType)?.installedVersion;
      loaderVersion = installed ?? (await p.input({ message: '请输入已安装 loader 版本号' }));
    }
  } else {
    loaderVersion = await p.input({ message: '自定义 installer URL' });
  }

  const modrinthToken = await p
    .password({
      message: 'Modrinth token (可选，回车跳过)',
      mask: '*',
    })
    .then((v) => v || undefined)
    .catch(() => undefined);

  const curseforgeKey = await p
    .password({
      message: 'CurseForge API key (可选，回车跳过)',
      mask: '*',
    })
    .then((v) => v || undefined)
    .catch(() => undefined);

  const name = await p.input({ message: '整合包名称', default: 'TumbleweedPack' });
  const versionId = await p.input({ message: '版本号', default: '1.0.0' });
  const summary = await p.input({ message: '一句话简介', default: '' });
  const outZip = await p.input({
    message: '输出 zip 路径',
    default: `TumbleweedOut/${name}-${versionId}.zip`,
  });

  return {
    root: root.trim(),
    policy,
    loaderType,
    mcVersion: finalMc,
    loaderVersion,
    modrinthToken,
    curseforgeKey,
    outZip,
    name,
    versionId,
    summary,
  };
}

function isDefaultWhitelisted(dir: string): boolean {
  const tops = [
    'mods',
    'config',
    'defaultconfigs',
    'kubejs',
    'plugins',
    'scripts',
    'resourcepacks',
    'shaderpacks',
    'structures',
    'data',
    'patchouli_data',
    'jei',
    'needs_packages',
    'custommobspawners',
    'defaultworldgenerator',
    'pufferfish',
    'liberty',
  ];
  const top = dir.split('/')[0] ?? '';
  return tops.includes(top);
}

function isDefaultChecked(dir: string, mode: FilterPolicy['mode']): boolean {
  if (mode === 'full') return true;
  return isDefaultWhitelisted(dir);
}
