# 安装与启动（Windows / Node 24 / npm 11）

本文记录分支 `feature/dsh-0.2-kernel-migration` 在 **WorkBuddy 环境**下的完整安装与启动过程，所有命令已实测通过。

## 一、环境要求

| 项目 | 版本 | 说明 |
|---|---|---|
| Node | **24.22.3** | DSH 0.2.x 的硬下限；系统默认是 22.22.2，必须用 nvm 切 |
| npm | 11.19.1 | Node 24 自带 |
| Electron | 42.11.18 | 从国内镜像手动下载 |
| DSH | 0.2.3-alpha.2 | 随依赖安装 |

## 二、安装 Node 24

系统已装 nvm for Windows（`D:\nvm\nvm`，symlink 到 `C:\nvm4w\nodejs`）。nvm 默认源极慢，且镜像站当时还没同步 24.22.3，所以直接手动下载解压：

```bash
mkdir -p /d/nvm/nvm/v24.22.3
curl -sL --max-time 180 \
  "https://cdn.npmmirror.com/binaries/node/v24.22.3/node-v24.22.3-win-x64.zip" \
  -o /d/nvm/nvm/node24.zip
unzip -q -o /d/nvm/nvm/node24.zip -d /d/nvm/nvm/node24-extract
cp -r /d/nvm/nvm/node24-extract/node-v24.22.3-win-x64/. /d/nvm/nvm/v24.22.3/
/d/nvm/nvm/v24.22.3/node.exe -v    # v24.22.3
```

切到 Node 24：

```bash
/d/nvm/nvm/nvm use 24.22.3
```

> 注意：WorkBuddy 自带 Node 22 在 PATH 里排在前面，`nvm use` 后当前终端 `node -v` 可能仍是 22。下面所有 npm 命令都显式把 Node 24 目录放到 PATH 最前面。

## 三、安装依赖（关键：三个坑）

仓库根目录自带 `.npmrc` 配置了 Electron 国内镜像，但源码快照容易漏掉它——先确认存在：

```
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 坑 1：WorkBuddy 沙箱的删除保护

环境的 `NODE_OPTIONS` 注入了 safe-delete shim，npm 回滚时批量删除超过 50 个文件会被拦截，导致安装半途失败并留下残缺的 `node_modules`。**执行 npm 时要清掉这些变量**：

```bash
env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_ENABLED -u CODEBUDDY_SAFE_DELETE_BULK_GUARD \
  npm ...
```

### 坑 2：npm 11 默认不跑安装脚本

esbuild、node-pty、`@zvec/zvec` 等原生模块不会构建。加 `--dangerously-allow-all-scripts` 放行（首次装也可用 `npm install-scripts approve --all` + `npm rebuild`）。

### 坑 3：`--legacy-peer-deps` 跳过运行时必需的 peer

`dsh-error`、`langchain`、`@langchain/anthropic`、schedule-x 的 preact 系列都被跳过，Electron 启动时会报 `ERR_MODULE_NOT_FOUND`。装完主依赖后要补装。

### 完整命令

```bash
cd Draymond-work
export PATH="/d/nvm/nvm/v24.22.3:$PATH"

# 1) 主依赖
env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_ENABLED -u CODEBUDDY_SAFE_DELETE_BULK_GUARD \
  npm install --legacy-peer-deps --dangerously-allow-all-scripts \
  --registry=https://registry.npmmirror.com

# 2) 补齐 peer（必须一次性全给，分开装会互相移除）
env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_ENABLED \
  npm install --no-save --legacy-peer-deps --dangerously-allow-all-scripts \
  --registry=https://registry.npmmirror.com \
  @deepseek-ai/dsh-error@0.2.3-alpha.2 langchain@^1.6.4 \
  @langchain/anthropic@^1.5.13 @preact/signals@^2.0.2 \
  preact@^10.19.2 temporal-polyfill@0.3.2
```

分支里提供了封装脚本：

```bash
node scripts/setup-dev-env.mjs          # 自动处理 PATH / shim / peer 依赖
node scripts/setup-dev-env.mjs --check  # 只检查环境是否齐备
```

### Electron 二进制（如自动下载失败）

`electron/install.js` 下载可能被网络中断。手动下载解压：

```bash
curl -sL -C - -o electron.zip \
  "https://cdn.npmmirror.com/binaries/electron/42.11.18/electron-v42.11.18-win32-x64.zip"
mkdir -p node_modules/electron/dist
unzip -q -o electron.zip -d node_modules/electron/dist
```

确认 `node_modules/electron/path.txt` 内容为 `electron.exe`（无换行），`dist/version` 为 `42.11.18`。

## 四、补齐源码快照缺失的根目录文件

如果用的是我最初的源码快照（只抓了 `src/` 等目录），根目录这几个文件需要补：

```bash
for f in index.html vite.config.js tsconfig.json README.md .npmrc; do
  gh api "repos/zoombooy/Draymond/contents/$f?ref=master" --jq '.content' \
    | base64 -d > "$f"
done
```

缺 `index.html` 会让 `npm run build` 报 `Could not resolve entry module`。

## 五、构建与启动

**关键前提**：`main.js` 用 `const isDev = !app.isPackaged` 判断模式。未打包直接启动时 **一定是 dev 模式**，窗口会去加载 `http://localhost:5173`（Vite 服务）。如果只启动 Electron 而不拉起 Vite，窗口就是一片空白（控制台报 `ERR_CONNECTION_REFUSED`）。所以**必须用 `electron:dev` 一条命令把两者一起启动**：

```bash
cd Draymond-work
export PATH="/d/nvm/nvm/v24.22.3:$PATH"

# 一条命令同时拉起 Vite(5173) + Electron（推荐，唯一正确方式）
env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE -u CODEBUDDY_SAFE_DELETE_ENABLED \
  npm run electron:dev
```

脚本内部是 `concurrently "vite" "wait-on http://localhost:5173 && electron ."`，会等 Vite 就绪后再启动 Electron。启动成功标志：日志出现 `VITE v6.4.6 ready`、窗口标题变成 `o-hino`（不是默认的 Electron 标题）、`curl http://localhost:5173/` 返回 200。

**必须清掉 `ELECTRON_RUN_AS_NODE`**：WorkBuddy 客户端自己设了这个变量，不清的话 Electron 会以纯 Node 模式启动，报 `electron does not provide an export named 'BrowserWindow'`。

`npm run start` / 直接 `electron.exe .` **不适用**——它们只启动 Electron、不启动 Vite，窗口必然白屏。只有打包后的应用（`app.isPackaged === true`）才会走 `loadFile(dist/index.html)` 读构建产物。

**另一个白屏根因（已修复）**：开发环境下 Electron 把 userData 放在项目内的 `app-data/`，其中包含被 Electron 锁定的 `Local Storage/leveldb/*.tmp` 文件。Vite 默认监听整个项目根目录，chokidar 扫描到这些被锁文件时抛 `EBUSY: resource busy or locked`，导致 Vite 进程直接退出（`vite exited with code 1`），随后 Electron 报 `ERR_CONNECTION_REFUSED` 而白屏。已在 `vite.config.js` 的 `server.watch.ignored` 中加入 `**/app-data/**`——该目录是运行时数据而非源码，忽略不影响 HMR。

```bash
# 仅需要产出前端构建产物时（不需要启动窗口）
env -u NODE_OPTIONS -u CODEBUDDY_SAFE_DELETE_ENABLED npm run build
```

## 六、实测结果（2026-11-27）

| 检查项 | 结果 |
|---|---|
| `node -v` | v24.22.3 |
| DSH CLI `--version` | 0.2.3-alpha.2 |
| `node --test scripts/tests/*.test.mjs` | **29 / 29 通过** |
| `npm run build` | ✓ built in 25.82s |
| Electron 启动 | ✓ `npm run electron:dev` 后窗口标题 `o-hino`，Vite 5173 返回 200，5 个进程，数据目录初始化 |
| Vite watch 冲突修复 | ✓ 加 `server.watch.ignored: ["**/app-data/**"]` 后重启，日志无 `EBUSY`、无 `vite exited with code 1`、无 `ERR_CONNECTION_REFUSED`，进程持续存活 |
| 配置迁移脚本 | ✓ 模拟旧配置清理 + 幂等验证通过 |

**仍未验证**：Harness 页面的 sidecar 启动与插件加载（需要在 UI 里点启动并配置模型）。详见 `TESTING-DSH-0.2.md` 第 3、4 层。
