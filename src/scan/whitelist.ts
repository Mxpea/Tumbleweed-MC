/**
 * 默认目录白名单（递归全收）。相对 server root。
 * 在这些目录下，所有非"黑名单 explicit 排除项"的文件都会被打包。
 */
export const DEFAULT_DIR_WHITELIST: readonly string[] = [
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

/** KubeJS 子目录黑名单：这些子目录默认排除（如 build/probe/cache 是临时/缓存）
 * 其余 kubejs 下所有文件与子目录默认纳入打包
 */
export const KUBEJS_SUBDIR_BLACKLIST: readonly string[] = [
  'build',
  'probe',
  'cache',
  '.cache',
  'generated',
];

/**
 * 根级文件白名单（精确文件名）。仅这些根目录下的文件会被打包。
 */
export const DEFAULT_FILE_WHITELIST: readonly string[] = [
  'server.properties',
  'eula.txt',
  'ops.json',
  'whitelist.json',
  'banned-players.json',
  'banned-ips.json',
  'commands.yml',
  'permissions.yml',
  'help.yml',
  'paper.yml',
  'paper-graphics.yml',
  'paper-global.yml',
  'pufferfish.yml',
  'purpur.yml',
  'liberty.yml',
  'crafty.yml',
  'spigot.yml',
  'bukkit.yml',
  'config.yml',
];

/**
 * 默认黑名单——无论出现在哪里都排除（包括白名单目录内部）。
 * 全量模式下黑名单依然生效，除非用户在 TUI/CLI 中显式 override。
 */
export const DEFAULT_BLACKLIST: readonly string[] = [
  'world',
  'world_nether',
  'world_the_end',
  'dims',
  'region',
  'logs',
  'crash-reports',
  'cache',
  '.fabric',
  '.quilt',
  '.mixin.out',
  'backups',
  'session.lock',
  'usercache.json',
  'essentials',
  'ess_npcs',
  'npcs',
  'deathcount',
  'playerdata',
  'stats',
  'advancements',
];

/** 文件名黑名单（glob 风格）：所有目录下都不打包 */
export const DEFAULT_FILE_BLACKLIST_GLOBS: readonly ((name: string) => boolean)[] = [
  (n) => n.endsWith('.bak'),
  (n) => n.endsWith('.lock'),
  (n) => n.endsWith('.prof'),
  (n) => n.endsWith('.dump'),
  (n) => n.endsWith('.log'),
  (n) => n.endsWith('.log.gz'),
  (n) => n.endsWith('_console.txt'),
  (n) => n === 'session.lock',
  (n) => n === 'usercache.json',
];

/**
 * libraries/ 永远默认不打包（即使全量模式也排除），由 installer 在 deploy 阶段重生成。
 * 这是体积与价值权衡后的硬策略。
 */
export const HARDCODED_DONT_PACK = new Set(['libraries']);

export interface FilterPolicy {
  mode: 'whitelist' | 'full';
  /** 用户在 TUI 中附加包含的目录 */
  includeDirs: string[];
  /** 用户在 TUI 中显式排除的目录 */
  excludeDirs: string[];
  /** 用户额外指定的文件（精确路径） */
  includeFiles: string[];
}

/**
 * 判断某个相对路径（已归一化为 forward slash）是否应当被打包。
 */
export function shouldPack(relPath: string, policy: FilterPolicy): boolean {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return false;

  const top = parts[0] ?? '';
  if (HARDCODED_DONT_PACK.has(top)) return false;

  // 黑名单目录命中即排除
  for (const b of DEFAULT_BLACKLIST) {
    if (parts[0] === b || parts.includes(b as string)) return false;
  }

  // 用户显式排除
  for (const ex of policy.excludeDirs) {
    if (relPath === ex || relPath.startsWith(`${ex.replace(/\/$/, '')}/`)) return false;
  }

  // 文件名 glob 黑名单
  const fileName = parts[parts.length - 1] ?? '';
  for (const g of DEFAULT_FILE_BLACKLIST_GLOBS) {
    if (g(fileName)) return false;
  }

  // 全量模式：以上不命中即收
  if (policy.mode === 'full') return true;

  // 白名单模式
  // 1. 命中用户 include
  for (const inc of policy.includeDirs) {
    if (relPath === inc || relPath.startsWith(`${inc.replace(/\/$/, '')}/`)) return true;
  }
  if (policy.includeFiles.includes(relPath)) return true;

  // 2. KubeJS 子目录：黑名单排除，其余（含顶层文件、client_scripts/、assets/ 等）全部纳入
  if (top === 'kubejs') {
    if (parts.length === 1) return true; // kubejs 目录本身
    const sub = parts[1] ?? '';
    if (KUBEJS_SUBDIR_BLACKLIST.includes(sub)) return false;
    return true;
  }

  // 3. 命中默认目录白名单
  if (DEFAULT_DIR_WHITELIST.includes(top)) return true;

  // 4. 根级文件白名单
  if (parts.length === 1 && DEFAULT_FILE_WHITELIST.includes(top)) return true;

  return false;
}
