import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { hashFile, relPathWithin } from '../hash/index.ts';
import type { LoaderType, ScannedJar } from '../types.ts';
import { readJarManifest, signatureFromManifestPath } from './manifestReader.ts';
import { type FilterPolicy, shouldPack } from './whitelist.ts';

export interface ScanResult {
  /** 所有应打包的常规文件（相对 server root），不含 jar */
  regularFiles: string[];
  /** 扫描出的 jar 列表（已读 manifest + hash） */
  jars: ScannedJar[];
  /** server root 下发现的全部目录（相对路径） */
  allDirs: Set<string>;
  /** 安装器提示：根目录或 libraries 下匹配 *.jar 中含 installer/installer 关键字者 */
  installerHints: string[];
}

const JAR_EXT = /\.(jar|disabled)$/i;

export async function scanServerRoot(root: string, policy: FilterPolicy): Promise<ScanResult> {
  const regularFiles: string[] = [];
  const jars: ScannedJar[] = [];
  const allDirs = new Set<string>();
  const installerHints: string[] = [];

  await walk(root, '', policy, { regularFiles, jars, allDirs, installerHints });

  return { regularFiles, jars, allDirs, installerHints };
}

interface WalkAcc {
  regularFiles: string[];
  jars: ScannedJar[];
  allDirs: Set<string>;
  installerHints: string[];
}

async function walk(
  root: string,
  relDir: string,
  policy: FilterPolicy,
  acc: WalkAcc,
): Promise<void> {
  const absDir = relDir ? join(root, relDir) : root;
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    const absEntry = join(absDir, name);
    let st: import('node:fs').Stats;
    try {
      st = await stat(absEntry);
    } catch {
      continue;
    }
    const relEntry = relDir ? `${relDir}/${name}` : name;
    if (st.isDirectory()) {
      acc.allDirs.add(relEntry);
      // 白名单与黑名单的判定走 shouldPack；目录即便被排除也记录到 allDirs 中供 TUI 显示
      if (shouldPack(`${relEntry}/`, policy) || policy.mode === 'full') {
        await walk(root, relEntry, policy, acc);
      }
      continue;
    }
    if (!st.isFile()) continue;
    if (!shouldPack(relEntry, policy)) continue;

    if (JAR_EXT.test(name)) {
      await pushJar(root, absEntry, relEntry, st.size, acc);
    } else {
      acc.regularFiles.push(relEntry);
      if (isInstallerHint(name)) acc.installerHints.push(relEntry);
    }
  }
}

async function pushJar(
  root: string,
  absPath: string,
  relPath: string,
  size: number,
  acc: WalkAcc,
): Promise<void> {
  const hashes = await hashFile(absPath);
  const manifest = await readJarManifest(absPath).catch(() => null);
  let loaderSignature: LoaderType[] = [];
  if (manifest?.manifestPath) {
    loaderSignature = signatureFromManifestPath(manifest.manifestPath) ?? [];
  }
  acc.jars.push({
    absPath,
    relPath,
    fileName: relPath.split('/').pop() ?? relPath,
    size,
    sha512: hashes.sha512,
    sha1: hashes.sha1,
    manifest,
    loaderSignature,
  });
  // 安装器 jar（neoforge-installer、forge-installer、fabric-server-launch）
  if (isInstallerHint(relPath.split('/').pop() ?? '')) {
    acc.installerHints.push(relPath);
  }
}

function isInstallerHint(name: string): boolean {
  const lc = name.toLowerCase();
  return (
    lc.includes('installer') ||
    lc.includes('forge') ||
    lc.includes('neoforge') ||
    lc.includes('fabric-server-launch') ||
    lc.includes('paperclip') ||
    lc.includes('purpur') ||
    lc.includes('leaf-server')
  );
}

/** 把绝对路径转相对路径（导出工具） */
export function toRel(root: string, abs: string): string {
  return relPathWithin(root, abs);
}
