import { existsSync } from 'node:fs';
import { stat as fsStat, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { buildLoaderAdapters } from '../loaders/index.ts';
import { log, startSpinner, stopSpinner, updateSpinner } from '../log.ts';
import { assembleJson } from '../pack/json.ts';
import { packZip } from '../pack/zip.ts';
import { resolveJars } from '../resolve/index.ts';
import { scanServerRoot } from '../scan/index.ts';
import { askPackOptions } from '../tui/prompts.ts';
import type { ServerCore } from '../types.ts';

export interface PackCommandOptions {
  root?: string;
  out?: string;
  loader?: string;
  mcVersion?: string;
  full?: boolean;
  noTui?: boolean;
}

export async function packCommand(opts: PackCommandOptions): Promise<void> {
  // 1. 收集选项（TUI 或 CLI flag）
  const answers = opts.noTui ? await fillFromFlags(opts) : await askPackOptions();

  // 2. 扫描
  startSpinner('扫描服务器目录……');
  const scan = await scanServerRoot(answers.root, answers.policy);
  stopSpinner(`扫描完毕：${scan.jars.length} 个 jar，${scan.regularFiles.length} 个常规文件`);

  // 3. 识别 loader 并取出 installer
  const adapters = buildLoaderAdapters();
  const adapter =
    answers.loaderType === 'manual-url' ? null : (adapters.byType.get(answers.loaderType) ?? null);

  if (!adapter && answers.loaderType !== 'manual-url') {
    throw new Error(`未找到 loader adapter: ${answers.loaderType}`);
  }

  let core: ServerCore;
  if (adapter) {
    startSpinner(`联网获取 ${adapter.type} installer 信息……`);
    const inst = await adapter.fetchInstaller(answers.mcVersion, answers.loaderVersion);
    stopSpinner(`installer: ${inst.fileName}`);
    core = {
      type: adapter.type,
      mcVersion: answers.mcVersion,
      loaderVersion: answers.loaderVersion,
      installerUrl: inst.url,
      installerSha512: inst.sha512,
      installerSize: inst.size,
      installerFileName: inst.fileName,
      launchMode: inst.launchMode,
    };
  } else {
    // manual-url：loaderVersion 即 URL
    core = {
      type: 'vanilla',
      mcVersion: answers.mcVersion,
      loaderVersion: 'manual',
      installerUrl: answers.loaderVersion,
      installerSha512: '',
      installerSize: 0,
      installerFileName: 'server.jar',
      launchMode: 'vanilla',
    };
  }

  // 4. resolve jars（并发联网查直链）
  startSpinner(`解析 0 / ${scan.jars.length} 个 jar 的下载链接……`);
  const outcomes = await resolveJars(scan.jars, {
    modrinthToken: answers.modrinthToken,
    curseforgeKey: answers.curseforgeKey,
    concurrency: 8,
    onProgress: (done, total, name) => {
      updateSpinner(`解析 ${done} / ${total} 个 jar 的下载链接……${name ?? ''}`);
    },
  });
  const resolved = outcomes.filter((o) => o.entry.source !== 'embedded').length;
  const embedded = outcomes.length - resolved;
  const warns = outcomes.filter((o) => o.warning);
  stopSpinner(
    `解析完毕：${resolved} 在线 / ${embedded} 内嵌${warns.length ? ` (${warns.length} 个警告)` : ''}`,
  );
  for (const w of warns) log(w.warning ?? '', 'warn');

  // 5. 组装 json
  const json = assembleJson({
    name: answers.name,
    versionId: answers.versionId,
    summary: answers.summary,
    mcVersion: answers.mcVersion,
    core,
    outcomes,
    regularFiles: scan.regularFiles,
    sourceRoot: answers.root,
    policy: answers.policy,
  });

  // 6. 写 zip
  let outZipAbs = isAbsolute(answers.outZip) ? answers.outZip : join(process.cwd(), answers.outZip);
  // 若 --out 指向已存在的目录，自动追加默认文件名
  try {
    const st = await fsStat(outZipAbs);
    if (st.isDirectory()) {
      outZipAbs = join(outZipAbs, `${answers.name}-${answers.versionId}.zip`);
    }
  } catch {
    // 路径不存在，按文件处理
  }
  await mkdir(dirname(outZipAbs), { recursive: true });
  startSpinner(`写入 ${outZipAbs}……`);
  await packZip({
    root: answers.root,
    outZip: outZipAbs,
    json,
    outcomes,
    regularFiles: scan.regularFiles,
  });
  stopSpinner(`完成：${outZipAbs}`, 'success');
  log(`共 ${outcomes.length} 个文件，内嵌 ${embedded}`, 'info');
}

async function fillFromFlags(
  opts: PackCommandOptions,
): Promise<Awaited<ReturnType<typeof askPackOptions>>> {
  const root = opts.root ?? process.cwd();
  if (!existsSync(root)) throw new Error(`服务器根目录不存在: ${root}`);
  let loaderVersion = '';
  if (opts.loader && opts.loader !== 'manual-url' && opts.mcVersion) {
    try {
      const adapters = buildLoaderAdapters();
      const cands = await adapters.byType.get(opts.loader)?.fetchCandidates(opts.mcVersion);
      const stable = cands?.find((c) => c.stable) ?? cands?.[0];
      loaderVersion = stable?.loaderVersion ?? '';
    } catch (e) {
      console.warn(`  (未取得 ${opts.loader} 候选版本: ${e instanceof Error ? e.message : e})`);
    }
  }
  return {
    root,
    policy: {
      mode: opts.full ? 'full' : 'whitelist',
      includeDirs: [],
      excludeDirs: [],
      includeFiles: [],
    },
    loaderType: opts.loader ?? 'neoforge',
    mcVersion: opts.mcVersion ?? '1.21.1',
    loaderVersion,
    modrinthToken: process.env.MODRINTH_TOKEN ?? undefined,
    curseforgeKey: process.env.CURSEFORGE_TOKEN ?? undefined,
    outZip: opts.out ?? 'TumbleweedOut/pack.zip',
    name: 'TumbleweedPack',
    versionId: '1.0.0',
    summary: '',
  };
}
