# DSH 0.2.x 迁移分支测试指南

分支：`feature/dsh-0.2-kernel-migration`

测试分四层，从「不需要任何依赖的纯逻辑」到「需要真实模型与知识库的完整功能」。建议按顺序做，前一层不过不要进下一层。

---

## 第 0 层：环境准备（需要网络）

当前分支把 Node 下限提高到 **24.22.3**（DSH 0.2.x 的要求），所以先用 Node 24 执行：

```bash
node -v                  # 必须 >= 24.22.3
npm install --legacy-peer-deps
```

`postinstall` 会自动跑三个修复脚本（`fix-langgraph-sdk` / `fix-dsh-directory-picker-electron` / `dedupe-nested-deps`），任何一个报错都不要跳过，先记下来。

> **实测（2026-11-27）**：官方 registry 不通，改用 `https://registry.npmmirror.com`。另外 `npm install --legacy-peer-deps` 不会装 DSH 内部 peer 包（`autoInstallPeers: false`），必须用一条命令把全部内部包一次性装上——注意 `--no-save` 的包会被下一次 install 清掉，不能分多次装。Windows 上跳过 `dsh-cua-macos`（仅 darwin）和 `libreoffice-kit-*` / `node-addon-system-*` 的跨平台二进制，其余缺失包实测清单见文末「本轮实测记录」。

## 第 1 层：纯逻辑单元测试（零依赖）

```bash
node --test scripts/tests/migrate-harness-config.test.mjs \
         scripts/tests/tool-bridge.test.mjs \
         scripts/tests/knowledge-bridge.test.mjs \
         scripts/tests/knowledge-plugin.test.mjs
```

**预期**：23 个用例全通过（实测 23/23，2026-11-27）。

这三个文件覆盖：旧配置清理规则（含 `name:` 写在第二行的条目）、工具清单与审批决策、知识注入正文构造、工具结果解析、`agent.inject()` 与主轮次合并的互斥逻辑、`HARNESS.md` 幂等投影。

> 如果跑 `node --test scripts/tests/*.test.mjs`，会额外跑 `obsidian-parser` 和 `obsidian-webdav` 两个既有测试；装完依赖后它们才可能通过。本分支新增的测试不依赖 `js-yaml`，可离线运行。

## 第 2 层：配置迁移实测（零依赖，动的是临时目录）

先用一个假的旧配置目录验证脚本行为，**不要直接对真实数据目录跑**：

```bash
# Windows（Git Bash）
TMP=./harness-migrate-demo
mkdir -p "$TMP/deepseek-harness/home/profiles/default"
cat > "$TMP/deepseek-harness/home/o-hino.patch.yml" <<'EOF'
- id: custom-invariant
  name: "@deepseek-ai/dsh-invariants"
- id: time-context
  options: {}
- id: mcp-o-hino
  insert: []
EOF
cat > "$TMP/deepseek-harness/home/profiles/default/package.json" <<'EOF'
{"dsh.profile":{"bundles":["@deepseek-ai/dsh-experimental-schedule-bundle","@deepseek-ai/dsh-web-app"]}}
EOF

npm run harness:migrate -- "$TMP"
npm run harness:migrate -- "$TMP"     # 第二次应为「没有需要清理的配置」
cat "$TMP/deepseek-harness/home/o-hino.patch.yml"
cat "$TMP/deepseek-harness/home/profiles/default/package.json"
```

**预期**：

- 第一次输出两条「已清理」，每条都带 `*.bak-0.1.5-<时间戳>` 备份路径；
- 第二次输出「没有需要清理的 0.1.x 配置」（幂等）；
- `o-hino.patch.yml` 只剩 `mcp-o-hino` 条目，两个旧条目被清掉；
- profile manifest 的 `bundles` 只剩 `@deepseek-ai/dsh-web-app`，其他字段保持原样。

确认无误后，再对真实数据目录执行（默认开发数据目录是项目下 `app-data`）：

```bash
npm run harness:migrate -- ./app-data
```

自定义数据目录时传实际路径，或设置 `O_HINO_DATA_DIR`。执行前先确认备份文件路径，**出问题直接把 `*.bak-*` 改回原名即可回滚**。

## 第 3 层：构建与启动冒烟

```bash
npm run build
npm run electron:dev
```

应用启动后，左侧进入「DeepSeek Harness」页，点启动。**重点观察状态区**：

| 观察项 | 通过标准 |
|---|---|
| 状态 | 从 `starting` 变为 `ready`，不是 `error` / `config-required` |
| 错误文案 | 没有 `patch: entry not found` / `cannot find package` / `loader entries failed to apply` |
| 工具数 | `toolCount` 大于 0，且等于注册表中 `exposedViaMcp: true` 的工具数 |
| iframe | 能打开 Web UI，登录后不再出现反复 401 |

如果报 `config-required`，是没在设置里配置模型（分支没改这块）；如果报插件加载失败，看终端里 `[Harness] Startup failed` 后面的多行诊断，里面会列出具体是哪个插件条目。

生成的 patch 在 `app-data/deepseek-harness/home/o-hino.patch.yml`，可以直接打开核对三个插入项：`mcp-o-hino`、`o-hino-tool-approval`、`o-hino-knowledge`。

## 第 4 层：P1 / P2 功能实测

### 4.1 审批插件（P1）

在 Harness 页面让模型调用一个标记为 `requireApproval` 的工具（例如写文件、日记写入类工具）。

- **预期**：执行前弹出审批确认；拒绝时工具不执行。
- 审批名单来源已统一到注册表，核对 `toolBridge.js` 输出的 `approvalTools` 与 UI 中触发审批的工具一致。

### 4.2 知识库注入（P2）

1. 在 Friday 主界面里收录一条容易识别的私有知识（例如「项目代号是 OBSIDIAN-7」）。
2. 在 Harness 页面**第一轮对话**就问：「项目代号是什么？」
3. **预期**：模型直接答出这条知识。这是关键——`agent.inject()` 只排队不唤醒 driver，所以插件还在 `agent/pre-step` 里做了同轮合并；如果首轮答不出、第二轮才答出，说明 pre-step 合并没生效。

终端里如果出现 `[HarnessKnowledge] 检索失败` 或 `pre-step 注入失败`，把完整日志记下来。常见原因：

- `ctx.tools.execute()` 的实际返回形状与 `extractToolResultText()` 预期不同 → 需要按真实返回调整解析；
- `ctx.agents.currentInitiator()` 在 `agent/pre-step` 阶段拿不到 agent → 需要换一种方式取 sessionId；
- 检索超时（默认 `preStepTimeoutMs: 1500`）→ 可在 `harness/index.js` 的插件 config 里调大。

### 4.3 会话记忆投影（P2）

在 Harness 里完成几轮对话后，打开 Friday 的「记忆文件」抽屉，确认出现第五份文件 **`HARNESS.md`**，并在 Agent 沙箱的 `/memories/HARNESS.md` 中看到类似：

```
- <!-- hf:session-id:12 --> 2026-11-27T... · <助手回复摘录>
```

**验证幂等**：重启 Harness、重复同一段对话，同一 `(session, seq)` 的条目不应重复出现；手动在两个 `<!-- o-hino-harness-memory:start/end -->` 标记之外写一行文字，重启后这行文字应保留。

默认 `captureUser: false`，用户原话不应落盘；如需验证用户消息投影，把 `harness/index.js` 中的 `captureUser` 临时改为 `true` 再跑一轮。

### 4.4 Windows / AppImage 专项

- **Windows**：确认目录选择器补丁生效（能弹出浏览对话框选目录），没有出现第二个 Electron 进程闪退。
- **Linux AppImage**：确认打包后 `node scripts/verify-packaged-native-modules.mjs x64` 通过；`profiles/node_modules` 下没有指向 `/tmp/.mount_*` 的失效符号链接。

## 已知未验证点（需要你这边实测确认）

1. DSH 0.2.x 的认证 / cookie 机制是否仍需要 `enableHarnessCookieForwarding()`——如果 iframe 不再 401，说明可以删掉这段兼容代码。
2. `ctx.tools.execute()` 调用 MCP 工具的实际返回形状。
3. `ctx.agents.currentInitiator()` 在 `agent/pre-step` 中的可用性。
4. `npm install` / `npm run build` / Electron 打包在 Node 24 + 新依赖下的完整兼容性。

把这几项的结果发回来，我按实测情况修正代码，再把 P1b（原生 `ctx.tools` 注册）或 P3（SDK 宿主化替换 iframe）接上。

---

## 本轮实测记录（2026-11-27）

模型已配置为 `deepseek-flash` / `https://api.deepseek.com`。按依赖顺序实测后，Harness 在本机**仍无法从 Electron 启动**，定位到两个独立阻塞，均与模型无关：

### 阻塞 1：Electron 运行时指纹不被 DSH 原生模块接受（主因）

- 现象：`[Harness] Startup failed`，host preparation 第一步就崩。
- 根因：Harness 用 `process.execPath`（Electron 二进制）+ `ELECTRON_RUN_AS_NODE=1` 启动 dsh CLI（`src-electron/harness/index.js:536`、`sdkRuntime.js:53`）。当前 Electron **42.11.18**（Node 24.19.0），V8 带 `-electron.0` 后缀；DSH 0.2.3 的原生模块只认 **Electron 43.0.0 / 44.x / 45.0.0-alpha.6**。指纹校验在原生层，没有 env 开关可跳过。
- 佐证：改用标准 Node 24.22.3 启动同一个 dsh CLI，原生模块 `requireBuiltin('fs')` 正常，dsh web 正常监听端口——证明代码路径没问题，纯粹是 Electron 版本指纹问题。
- 修复（**本轮已执行并验证**）：`package.json` 的 `electron` 从 `^42.2.0` 改为精确 `43.0.0`（必须精确——白名单是按 Electron 版本精确匹配，升到 43.8.x 反而过不了）。因为 `npm install` 会 prune 掉阻塞 2 补好的 peer 依赖，实际采用**手动替换**方式：从 npmmirror 下载 `electron-v43.0.0-win32-x64.zip`（SHA256 校验通过），解包覆盖 `node_modules/electron/dist`，更新 `electron/package.json` 的 version 与 `path.txt`。这是 P0 版本对齐当初漏改的一项。
- 验证：用 `electron.exe`（43.0.0）+ `ELECTRON_RUN_AS_NODE=1` 直接启动 dsh CLI，`dsh web` 正常监听端口（HTTP 401 = 需要 token，属正常），日志中无任何 `unsupported Electron runtime fingerprint` 错误。指纹问题确认解决。
- 注意：手动替换只改本机 `node_modules`，未改 lockfile。其他机器 / 打包环境需执行 `npm install` 让 electron@43.0.0 正式落库；届时仍需按阻塞 2 的方法补 DSH peer 依赖。

### 阻塞 2：DSH profile 的 peer 依赖从未安装（已修复）

- 现象：首次标准 Node 探测报 56 个插件加载失败，缺 `@deepseek-ai/dsh-scope` / `dsh-sandbox` / `dsh-error` 等内部包。
- 根因：profile 的 `pnpm-workspace.yaml` 设了 `autoInstallPeers: false`，且主项目安装时用了 `--legacy-peer-deps`，DSH 的 peer 包（均要求 `0.2.3-alpha.2`）从未进入 `profiles/node_modules`。
- 修复：用一条 `npm install --no-save --legacy-peer-deps` 命令装齐 23 个内部包 + `@modelcontextprotocol/client@2.2.0` / `core@2.2.0`。关键点：
  - `--no-save` 的包会被**下一次** `npm install` prune 掉，所以必须一次性列全，不能分多次补；
  - 中途被 SIGTERM 中断会留下残缺包（当时 `client/dist/index.mjs` 只有 `.map` 没有本体，导致 `ERR_MODULE_NOT_FOUND`），重装即可；
  - `dsh-cua-macos`（darwin）、`libreoffice-kit-*` / `node-addon-system-*` 的 darwin/linux/arm64 二进制在 Windows x64 上用不到，可跳过。
- 结果：内部包真实缺失数从 23 降到 **0**。

### 阻塞 3：多次中断的 npm install 导致依赖包残缺（已修复）

- 现象：换 Electron 43 后应用加载报 `Cannot find module 'langsmith/internal/utils/values.mjs'`，修好后又报 `Cannot find package 'langchain'`。
- 根因：前几轮 `npm install` 被 SIGTERM 中断，留下大量残缺包——`langsmith@0.14.0` 缺 605 个文件（含 26 个运行时 `.mjs`），`langchain` / `@langchain/anthropic` 整个未装（项目只声明了 `@langchain/*` 作用域包，没声明裸 `langchain`，但 `deepagents` 需要它）。
- 修复（同样避开 `npm install`）：从 npmmirror 下载官方 tarball，解包补齐。`langsmith` 按相对路径补 605 个缺失文件；`langchain@1.6.4` + `@langchain/anthropic@1.5.13` 整包解包安装。验证 `import('langchain')` 成功、应用加载零 `ERR_MODULE_NOT_FOUND`。
- 结果：应用干净启动，Vite 200、electron 进程正常、日志仅有无害的证书告警。

### 修复后的 dsh 独立探测结果

```
dsh: warning: 1 entry did not activate
mcp-o-hino (@deepseek-ai/dsh-mcp-client): ... ECONNREFUSED 127.0.0.1:17891
dsh web: http://127.0.0.1:15996/?token=...
```

只剩 `mcp-o-hino` 一个未激活，且是**预期内**的：它要连 o-hino 主进程开的 MCP 服务（17891），独立探测时没有 Electron 主进程，必然拒绝连接。其余插件全部激活，dsh web 正常监听——说明在 Electron 42 问题解决后，插件树本身是健康的。

### 本轮已确认通过

| 项 | 结果 |
|---|---|
| 第 1 层纯逻辑单测 | 23/23 通过 |
| 配置迁移实测 | 幂等通过（临时目录） |
| patch 三项 | `mcp-o-hino` / `o-hino-tool-approval` / `o-hino-knowledge` 均在 `o-hino.patch.yml` |
| `HARNESS.md` 投影 | 文件已生成，标记对齐全，内容为空（尚无成功会话） |
| bundle 注册表 | `bundles.json` 为空（默认），符合未添加第三方 bundle 状态 |
| 标准 Node 下 dsh 启动 | 成功监听端口，插件树仅 1 个预期内未激活 |
| Electron 43.0.0 下 dsh 启动 | 成功监听端口（401 需 token），**无指纹错误**，主因修复确认 |
| 应用加载 | Electron 43 下零 `ERR_MODULE_NOT_FOUND`，仅无害证书告警 |

### 仍待你在 UI 里实测（需真实会话/交互）

应用本身已能干净启动，但以下项需要点击 UI 和真实对话才能确认，我无法代劳：

- 第 3 层：左侧进入「DeepSeek Harness」页点启动，状态是否从 `starting` 变为 `ready`、`toolCount` 是否 > 0、iframe 是否不再反复 401。
- 第 4 层：P1 审批弹窗、P2 首轮知识注入、`HARNESS.md` 会话投影、bundle 启停。
- `ctx.tools.execute()` 返回形状、`ctx.agents.currentInitiator()` 在 pre-step 的可用性（需真实会话才能确认）。

> 补充：`mcp-o-hino` 在独立探测时未激活是因为没有主进程的 MCP 服务（17891）。在真实应用里，点启动 Harness 时主进程会先拉起 MCP 服务，这一项应能正常激活——这也可以在 UI 启动后一并确认。
