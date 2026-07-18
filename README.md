# Tumbleweed

Minecraft 服务端打包工具。把服务器目录里"重要文件"打包成可重分发的轻量 zip，附带 `deploy.sh/.bat/.ps1`，运行即可联网还原所有 mod / 加载器 / server core，且不违反 mod 再分发条例——zip 本身不含任何第三方 jar（除少数扫不到直链的 mod 会以 source 副本形式内嵌并附警告）。

---

## 快速开始

### 1. 环境准备

- Node.js ≥ 20（用 [nvs](https://github.com/jasonk/nvs) 管理：`nvs use latest`）
- Windows / Linux / macOS 均可

```powershell
# 在项目根目录
nvs use latest         # 或自行激活 node 20+
npm install
```

### 2. 运行打包

#### TUI 交互模式（推荐首次使用）

```powershell
npx tsx ./src/cli.ts pack
```

会依次问你：服务器路径 → 打包模式（白名单/全量） → 勾选要打包的目录 → loader 候选 → MC 版本 → loader 版本 → API token（可选） → 输出名/版本/简介/zip 路径。

#### CLI 一行模式（脚本/CI）

```powershell
# 跳过 TUI，使用 flag 与环境变量
npx tsx ./src/cli.ts pack "G:\.server\QUST" `
  --out "TumbleweedOut/QUST-1.0.0.zip" `
  --loader neoforge `
  --mc-version 1.21.1 `
  --skip-tui
```

完整 flag：

| flag | 说明 |
| --- | --- |
| `[root]` | 服务器根目录位置参数 |
| `-o, --out <path>` | 输出 zip 路径（相对路径从当前工作目录算） |
| `-l, --loader <type>` | 强制 loader：`neoforge` / `forge` / `fabric` / `quilt` / `paper` / `purpur` / `leaf` / `vanilla` |
| `--mc-version <ver>` | 强制 MC 版本，例如 `1.21.1` |
| `--full` | 全量打包模式（包含 `world/`、`logs/` 等） |
| `--skip-tui` | 跳过交互，所有信息走 flag / 环境变量 |

环境变量：

| 变量 | 用途 |
| --- | --- |
| `MODRINTH_TOKEN` | Modrinth API token，提升匹配率（可选） |
| `CURSEFORGE_TOKEN` | CurseForge API key，开启 CF 兜底匹配（可选） |

### 3. 单文件可执行（可选）

打包成单文件 exe 给未装 Node 的用户：

```powershell
# 装 bun（更长超时，可能要 1-2 分钟）
powershell -NoProfile -Command "irm bun.sh/install.ps1 | iex"

# 编译产出 dist/tumbleweed.exe
npx tsx ./node_modules/.bin/bun-build './src/cli.ts' --compile --target=bun-windows-x64 --outfile=dist/tumbleweed.exe

# 运行
.\dist\tumbleweed.exe pack "G:\.server\QUST"
```

（Linux/mac 同理，把 `--target` 换成 `bun-linux-x64` / `bun-darwin-arm64`）

---

## 输出产物

zip 内结构：

```
TumbleweedPack-1.0.0.zip
├─ Tumbleweed.json        # 所有 mod 的直链、sha512、loader 信息
├─ overrides/             # 白名单内的非 jar 文件 + 内嵌 fallback jar
│  ├─ config/
│  ├─ defaultconfigs/
│  ├─ kubejs/server_scripts/
│  ├─ mods/<扫不到直链的 jar>
│  └─ server.properties
├─ deploy.sh              # Linux/macOS 部署脚本（内嵌 JSON）
├─ deploy.ps1             # Windows PowerShell 脚本（内嵌 JSON）
└─ deploy.bat             # Windows thin launcher（调 deploy.ps1）
```

### 部署流程

把 zip 解压到一个空目录，然后任选一个脚本运行：

**Windows：** 双击 `deploy.bat`，或在 PowerShell：
```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

**Linux/macOS：**
```bash
bash deploy.sh
```

脚本会自动：
1. 还原 `overrides/` 内容到当前目录
2. 逐个下载 `Tumbleweed.json.files[]` 的 mod / plugin，校验 sha512
3. 扫不到直链的 mod 从 `overrides/` 复制（与官方版本完全一致）
4. 下载 loader / server core：
   - NeoForge / Forge：跑 `java -jar *installer.jar --installServer` 生成 `libraries/`
   - Fabric / Quilt：`fabric-server-launch.jar` 直接重命名为 `server.jar`
   - Paper / Purpur / Leaf：Paperclip jar 重命名为 `server.jar` 首启自解压
   - Vanilla：直接下载 Mojang server.jar
5. 写入 `eula.txt`（`eula=true`）
6. 全量 sha512 校验 + 缺失检查，校验通过才输出 `✓ 完成`

启动服务端：
```bash
java -jar server.jar nogui
```

---

## 默认白名单 / 黑名单

### 默认打包（白名单模式）

**目录：** `mods` `config` `defaultconfigs` `kubejs`（仅 `client_scripts/server_scripts/startup_scripts/assets/data` 子目录）`plugins` `scripts` `resourcepacks` `shaderpacks` `structures` `data` `patchouli_data` `jei` `needs_packages` `custommobspawners` `defaultworldgenerator` `pufferfish` `liberty`

**根级文件：** `server.properties` `eula.txt` `ops.json` `whitelist.json` `banned-players.json` `banned-ips.json` `commands.yml` `permissions.yml` `help.yml` `paper.yml` `paper-graphics.yml` `paper-global.yml` `pufferfish.yml` `purpur.yml` `liberty.yml` `crafty.yml` `spigot.yml` `bukkit.yml` `config.yml`

### 默认排除（黑名单）

`world/` `world_nether/` `world_the_end/` `dims/` `region/` `logs/` `crash-reports/` `cache/` `.fabric/` `.quilt/` `backups/` `session.lock` `usercache.json` `playerdata/` `stats/` `advancements/` 以及所有 `*.bak *.lock *.prof *.dump *.log *_console.txt`

`libraries/` **永远不打包**（全量模式也不收），由 deploy 阶段重新走 installer 生成。

### 全量模式

`--full` 或 TUI 选"全量"即收 `world/` 等默认黑名单目录。**警告：可能数十 GB**。

---

## 配置：`.tumbleweed.toml`

在服务器根目录放置 `.tumbleweed.toml` 可永久覆盖默认（每次跑不必反复 TUI）：

```toml
mode = "whitelist"              # 或 "full"
include = ["saves/mystructures"]  # 额外纳入的目录
exclude = ["mods/old"]            # 额外排除的目录
includeFiles = ["my-config.yml"]  # 额外纳入的根级文件

# 可选：固化 API token，避免每次 env
modrinthToken = "mrp_xxx"
curseforgeKey = "$2a$xx..."
```

读优先级：**CLI flag > TUI 选择 > .tumbleweed.toml > 默认**

---

## 加载器自动识别

Tumbleweed 扫描每个 jar 的 manifest：

| 文件 | loader signature |
| --- | --- |
| `META-INF/neoforge.mods.toml` | neoforge |
| `META-INF/mods.toml` | forge（兼容 neoforge） |
| `fabric.mod.json` | fabric |
| `quilt.mod.json` | quilt |
| `plugin.yml` | spigot/paper/purpur/leaf |

按命中数多→少排序候选，TUI 让你选；同时扫根目录和 installer jar 文件名推断已安装版本。

联网查询最新 loader 版本来源：
- NeoForge `https://maven.neoforged.net`
- Forge `https://maven.minecraftforge.net`
- Fabric `https://meta.fabricmc.net`
- Quilt `https://meta.quiltmc.org`
- Paper `https://api.papermc.io`
- Purpur `https://api.purpurmc.org`
- Leaf `https://api.leafmc.dev`
- Vanilla `https://piston-meta.mojang.com`

也支持"完全自定义 URL"绕过自动识别（TUI 最后一项）。

---

## mod 下载链接解析

对每个 jar 按优先级查直链：

1. **Modrinth**：用 `modId` 直查项目→版本→sha512 精确匹配，找不到再按 version_number / fileName 兜底。无需 token 也能用，有 token 速率更高。
2. **CurseForge**：Modrinth 没找到时回退，**必须** `CURSEFORGE_TOKEN`。
3. **embedded fallback**：都查不到时把原始 jar 压入 `overrides/<path>`，deploy 时复制还原，并打 `!` 警告。**保证打包前 == 部署后**。

---

## 故障排查

| 现象 | 处置 |
| --- | --- |
| `ENOENT: mkdir 'D:\..\.WORKSPACE\...\C:\Users\...'` | 输出路径用绝对路径，或在 `--out` 给相对路径 |
| `EISDIR: illegal operation on a directory` | 已修复——`--out` 指向已存在目录时自动追加默认文件名（`<name>-<version>.zip`） |
| `远端 Modrinth 未找到匹配` | jar 被改动过或来自非 CF/Modrinth 站点 → 自动内嵌并警告，不影响打包结果 |
| `tumbleweed: command not found` | 单文件 exe 未编译时直接用 `npx tsx ./src/cli.ts` 即可 |
| Loader 识别错 | 跑 `--skip-tui` 时用 `--loader` 强制；TUI 模式选手动选 |

---

## 项目结构（开发者）

```
src/
├─ cli.ts                  # commander 入口
├─ commands/pack.ts        # 编排：扫描→识别→resolve→打包
├─ tui/prompts.ts          # @inquirer/prompts 向导
├─ scan/                   # 目录行走 + 白黑名单 + jar manifest 读取
├─ loaders/                # 各 loader adapter (neoforge/forge/fabric/quilt/paper/vanilla)
├─ resolve/                # Modrinth + CurseForge 客户端 + 编排
├─ pack/                   # Tumbleweed.json 组装 + yazl 流式写 zip
├─ deploy/                 # bash/ps1/bat 模板渲染
├─ config.ts               # .tumbleweed.toml 读写
├─ log.ts                  # 控制台日志 + spinner
├─ hash/                   # sha1/sha512 工具
└─ types.ts                # 共享类型
```

开发命令：
```powershell
npm run typecheck   # tsc --noEmit
npm run lint        # biome check src
npm run format      # biome format --write src
```

---

## License

MIT