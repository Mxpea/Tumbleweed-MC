// Tumbleweed 共享类型定义

export type LoaderType =
  | 'neoforge'
  | 'forge'
  | 'fabric'
  | 'quilt'
  | 'paper'
  | 'purpur'
  | 'leaf'
  | 'spigot'
  | 'vanilla';

export type ModSource = 'modrinth' | 'curseforge' | 'manual' | 'embedded';

/**
 * 一个需要部署的文件条目。继承 Modrinth index.json 的 files 数组元素结构，
 * 扩展 source / embedPath 等字段以支持 Tumbleweed 的 fallback 机制。
 */
export interface FileEntry {
  /** 相对根目录的路径，例如 "mods/ae2.jar" 或 "plugins/EssentialsX.jar" */
  path: string;
  /** 哈希校验集合，至少含 sha512，可能含 sha1 */
  hashes: { sha1?: string; sha512: string };
  /** 远端直链列表，按优先级排序。manual/embedded 时为空数组 */
  downloads: string[];
  /** 文件字节数 */
  fileSize: number;
  /** 来源标签，决定 deploy 脚本如何获取文件 */
  source: ModSource;
  /** 仅 source=embedded 时有效，指向 zip 内 overrides 下的相对路径 */
  embedPath?: string;
  /** 解析自 jar manifest 的元数据，便于人工排查 */
  modId?: string;
  version?: string;
  displayName?: string;
  /** 该 jar 的载入器签名，用于 majority vote 识别 loader */
  loaderSignature?: LoaderType[];
}

export interface ServerCore {
  type: LoaderType;
  /** MC 版本，如 "1.21.1" */
  mcVersion: string;
  /** loader 自身版本，如 neoforge "21.1.233"、fabric "0.16.0" */
  loaderVersion: string;
  /** installer / server-launch / paperclip 的直链 */
  installerUrl: string;
  installerSha512: string;
  installerSize: number;
  /** installer 文件名，便于 deploy 脚本命名 */
  installerFileName: string;
  /** 该 loader 启动方式，决定 deploy 脚本分支 */
  launchMode: 'installer' | 'launch-jar' | 'paperclip' | 'vanilla';
}

export interface TumbleweedMeta {
  packerVersion: string;
  packedAt: string;
  sourceRoot: string;
  /** 用户在 TUI 中勾选纳入打包的目录（相对 server root），按字母序 */
  includedDirs: string[];
  /** 打包模式 */
  mode: 'whitelist' | 'full';
}

export interface TumbleweedJson {
  formatVersion: 1;
  game: 'minecraft';
  versionId: string;
  name: string;
  summary: string;
  files: FileEntry[];
  dependencies: {
    minecraft: string;
    [loader: string]: string;
  };
  server: {
    core: ServerCore;
    eulaAccepted: boolean;
    /** 不在 files[] 内、但随 overrides 一同打包的根级文件，deploy 脚本需原样还原 */
    extraFiles: { path: string; packed: boolean }[];
  };
  tumbleweed: TumbleweedMeta;
}

/**
 * 扫描阶段对单个 jar 的中间表示，未做远端 resolve。
 */
export interface ScannedJar {
  absPath: string;
  relPath: string;
  fileName: string;
  size: number;
  sha512: string;
  sha1: string;
  manifest: JarManifest | null;
  loaderSignature: LoaderType[];
}

export interface JarManifest {
  kind: 'forge' | 'neoforge' | 'fabric' | 'quilt' | 'bukkit' | 'unknown';
  modId?: string;
  version?: string;
  displayName?: string;
  displayURL?: string;
  mcVersionRange?: string;
  loaderVersionRange?: string;
  /** 原始 manifest 路径，例如 "META-INF/mods.toml" */
  manifestPath?: string;
}

/**
 * Loader 适配器统一接口。每个 loader 一个实现。
 */
export interface LoaderAdapter {
  type: LoaderType;
  /** 从扫描出的 jar 签名投票判断本 loader 适用度；返回命中数 */
  detect(ctx: DetectContext): DetectResult | null;
  /** 给定 mc 版本，联网查询推荐 loader 版本列表（按推荐度排序） */
  fetchCandidates(mcVersion: string): Promise<LoaderCandidate[]>;
  /** 给定具体版本，返回 installer/server-launch 的下载信息 */
  fetchInstaller(mcVersion: string, loaderVersion: string): Promise<InstallerInfo>;
}

export interface DetectContext {
  /** 所有扫描到的 jar，含 loaderSignature */
  jars: ScannedJar[];
  /** server root 下存在的目录相对路径集合 */
  dirs: Set<string>;
  /** 根目录或 libraries 下识别到的 installer jar 文件名 */
  installerHints: string[];
}

export interface DetectResult {
  type: LoaderType;
  hits: number;
  total: number;
  /** 已安装的 loader 版本（若能从 installer / libraries 推断） */
  installedVersion?: string;
}

export interface LoaderCandidate {
  loaderVersion: string;
  releasedAt: string;
  /** 是否为推荐稳定版（LoaderAdapter 判定） */
  stable: boolean;
  notes?: string;
}

export interface InstallerInfo {
  url: string;
  sha512: string;
  size: number;
  fileName: string;
  launchMode: ServerCore['launchMode'];
}

export interface ResolveOutcome {
  entry: FileEntry;
  /** 警告信息，例如 "Modrinth 未找到匹配版本，已 fallback 到源 jar 内嵌" */
  warning?: string;
}

export interface PackResult {
  zipPath: string;
  jsonPath: string;
  totalFiles: number;
  resolvedCount: number;
  embeddedCount: number;
  warnings: string[];
  durationMs: number;
}
