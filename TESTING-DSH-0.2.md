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

**预期**：全通过（历史实测 32/32，2026-11-27；含 `bundle-registry.test.mjs` 与 `payload.agent` 契约用例）。新增 `plugin-host.test.mjs` 6 例后，全量单测实测 **50/50**（2026-11-28）。

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

## 本轮实测记录（2026-11-28）：iframe `forbidden` 修复

### 现象
点击左侧拼图图标进入 Harness 页，提示"正在启动 DeepSeek Harness"，加载约 25 秒后显示纯文本 **`forbidden`**（DevTools 里 `<body>` 只有这个词，没有 dsh 的 HTML 界面）。

### 根因（三层，逐层实测确认）

1. **DSH 0.2 新增来源校验（真正主因）**：`dsh-client-connection/lib/index.js` 的 `isTrustedApiRequest()` 在 `sec-fetch-site === 'cross-site'` 或 `Origin` 不等于监听器自身 authority 时拒绝请求；`dsh-host-webserver/lib/index.js:505` 对拒绝的请求直接返回**纯文本** `forbidden`（403）。iframe 从 `http://localhost:5173` 访问 `http://127.0.0.1:<port>`，两条都命中，必然 403。这一步与 cookie 无关，是 0.1.5 → 0.2 新增的防线。
2. **cookie 注入大小写错误**：`onBeforeSendHeaders` 用大写 `details.requestHeaders.Cookie = cookie`。Chromium 请求头 key 是小写，大写写法产生重复头，dsh 收不到凭证。
3. **探针访问 token URL**：`probe()` 用 Node `http.get(tokenUrl)`，其 303 走不到 Electron 的 `onHeadersReceived`；改为只探活 origin。

### 修复（`src-electron/harness/index.js`）
- `onBeforeSendHeaders`：删除所有大小写变体的 cookie 头，只写小写 `cookie`；**把 `sec-fetch-site` 改写为 `same-origin`、`origin`/`referer` 改写为 dsh 自身 authority**，让 iframe 请求通过 `isTrustedApiRequest()`；`onHeadersReceived` 大小写不敏感地找 `set-cookie`；加一次性诊断日志。
- `probe()`：只探测 token URL 的 origin（401 即判定在线），完整 token URL 留给 iframe 消费。
- `updateState()`：状态变 `error` 时把 `recentOutput` 打到主进程日志（此前 UI 只显示 `forbidden` 一行，无法定位）。

### 实测验证（curl 精确模拟 DSH 0.2 的校验）
| 步骤 | 结果 |
|---|---|
| token URL + 303 不带 cookie | 401 / "Connect to this Host" |
| **cross-site + 外部 Origin（旧逻辑）** | 触发来源防线，返回纯文本 `forbidden` |
| **改写 same-origin + 自身 Origin + token（新逻辑）** | **HTTP 200**，页面 title `DeepSeek Harness` ✅ |
| 带捕获 cookie + 改写头访问 | 鉴权通过 |

注：沙箱内无法起 Electron GUI 网络栈做端到端（窗口被拦，node 模式下 `session/net` 不可用），用 curl 精确复现 303 / Set-Cookie / 来源头 / cookie 的完整链路。最终以 UI 实测为准。

### 仍需你在 UI 里确认
服务已在 09:43 重启加载全部修复。请再次进入 Harness 页（必要时点"重试"），确认 iframe 显示 dsh 主界面而非 `forbidden`。加载约 25 秒属正常。若仍失败，看 `o-hino-startup.log` 里三行新诊断日志：`Captured dsh auth cookie` / `Forwarding dsh auth cookie` / `Rewriting iframe origin headers`，以及新增的 `status=error` + `recentOutput`（会给出 dsh 的真实报错）。

## 架构收敛验证（2026-11-28）：本地 PluginHost 替代 iframe 主链路

上面关于 iframe / `forbidden` 的记录保留为历史排查依据。**当前默认路径已经不再加载 DSH iframe**，因此来源头改写、cookie 转发、401 probe 默认都不启用，不会再出现 `forbidden`。

### 新增实现

- `src-electron/harness/pluginHost.js`：本地插件宿主，实现 DSH 契约最小子集（`apply(ctx, config)`、事件总线、`tools/pre-execute` waterfall、`agent/pre-step`、`ctx.tools.execute`、`agent.inject`、审批挂起/放行）。支持本地目录、`npm` 包名，以及 `npm pack` 产出的 `.tgz` / `.tar.gz` 包（解压到 `deepseek-harness/plugin-cache`，按 `package.json` 的 `exports` / `module` / `main` 入口加载；文件变化时按大小 + mtime 自动重新解包）。兼容官方 bundle 常用的 `ctx.effect()` 与 `ctx.tools.register(defineTool(...))`，并在 `apply` 期间把 `@deepseek-ai/dsh-tools` 的 require 兜底解析到 o-hino 自身依赖。
- `src/views/harness/DeepSeekHarness.vue`：本地插件管理页；内置插件与第三方 bundle 列表、启停、添加/移除、审批队列、工具调用测试。SDK 通道降级为手动开启的兼容性实验页。
- `src-electron/harness/index.js`：默认启动本地宿主；完整 DSH web 通道仅在 `O_HINO_LEGACY_DSH_WEB=1` 时启用。`harness-plugins-*` IPC 用于本地插件管理。
- `src-electron/harness/index.js`：本地知识工具直接调用 RAG `searchKnowledgeBase`，不再依赖 DSH 内的 MCP 工具。

### 单测

新增 `scripts/tests/plugin-host.test.mjs`（6 例）：

| 用例 | 结果 |
|---|---|
| waterfall 审批钩子阻塞工具直到确认 | 通过 |
| 拒绝审批时工具不执行 | 通过 |
| 知识插件在本地宿主内走 `agent.inject()` | 通过 |
| 第三方 `.tgz` 包解压后按 `package.json` 入口加载 | 通过 |
| 本地插件目录按约定入口加载 | 通过 |
| 用户 bundle 增删改与启停立即生效 | 通过 |

复跑相关测试：

```bash
node --test scripts/tests/plugin-host.test.mjs \
  scripts/tests/bundle-registry.test.mjs \
  scripts/tests/knowledge-plugin.test.mjs \
  scripts/tests/tool-bridge.test.mjs \
  scripts/tests/sdk-bridge.test.mjs
# tests 30 / pass 30 / fail 0
# 全量：node --test scripts/tests/*.test.mjs → tests 50 / pass 50 / fail 0
```

### UI 验证要点（默认路径）

1. 进入左侧拼图「插件」页：宿主状态直接显示「本地宿主已就绪」，不再出现 `starting` 等待约 25 秒或 `forbidden`。
2. 摘要栏「模型」应显示当前设置里已选择的模型（如 `deepseek / deepseek-flash`）；只有确实没配置时才显示「未配置」并给出「去配置」入口。
3. 插件列表应显示 2 个内置插件：`o-hino 工具审批`、`o-hino 知识注入`，均已加载且列出钩子。
4. 添加第三方插件（本地绝对路径、`.tgz` 包或 npm 包名）后，列表中立即出现并可启停；若加载失败，提示明确写「插件已登记但加载失败」，而不是误报「插件已添加」。停用后 `loaded` 变为未加载。本机实测 `dsh-office-0.3.1.tgz` 已加载成功并注册 9 个 office 工具，主进程日志为 `local host ready: 3 plugins, 10 tools`。
5. 工具测试区选择 `mcp__o-hino__retrieve_knowledge`，传入 `{"query":"...","topK":3}`，应返回知识片段或“未在知识库中检索到相关内容”。
6. 需要 DSH ids 兼容验证时，手动切到「DSH 可选通道」页启动 SDK；默认不要依赖该通道。

### 插件接入日常对话（桥接层）

插件页里的第三方工具已桥接进日常对话 Agent，不再只能手动点调用：

- 新增 `src-electron/agent/pluginBridge.js`：
  - `syncPluginTools()` 在每次 `createAgent()` 前把 PluginHost 工具镜像注册进 registry，复用日志/审计/`agent-tool-*`/审批包装；跳过宿主内置的 `mcp__o-hino__*`（对话已有内置 `retrieve_knowledge`）。工具名**优先用原名**（如 `office_docs_read`，LLM 易识别），仅与内置工具重名时才回退为 `plugin__<原名>`。
  - `runPluginPreStep()` 在每轮 `agent-invoke` 中触发 `session/event` 和 `agent/pre-step`，并消费上一轮 `agent.inject()` 排队的知识消息。
  - 桥接失败一律 try/catch 降级为无插件，不阻断对话。
- `src-electron/agent/tools/registry.js` 新增 `unregisterTool()`；`src-electron/harness/index.js` 新增 `getSharedPluginHost()`；`src-electron/agent/index.js` 与 `ipc.js` 埋入同步与事件触发点。
- **审批策略（2026-11-28 调整）**：按工具名判定只读（read/check/get/list/selection/inspect/view/query/search/status/dump/describe），只读工具**免审批**、无需填 `riskAssessment`，避免 LLM 为省事绕开插件改走 `python_repl`；写/外部副作用工具仍要求审批，走 Friday 现有的 `ToolApprovalDialog`。
- **工具选用规则**：工具描述与系统提示词明确「涉及读取/查看/检查 Office 文档（.docx/.xlsx）必须只用名单内插件工具，禁止用 `python_repl` 解压 XML/zip；不要调用名单外的 `office_*` 工具（如内置 `office_inspect`，当前环境未安装 Office CLI，必然失败）」。系统提示词会列出当前已桥接的工具全名。

新增 `scripts/tests/plugin-bridge.test.mjs`（6 例）：

| 用例 | 结果 |
|---|---|
| 插件工具以原名镜像注册且跳过宿主内置工具 | 通过 |
| 只读工具免审批、写工具仍要求审批 | 通过 |
| 桥接工具的 handler 能真正调用到插件工具 | 通过 |
| 再次同步会注销上一轮工具，插件停用后不再出现 | 通过 |
| `runPluginPreStep` 触发 `session/event` 并合并 pre-step 消息 | 通过 |
| 上一轮 `agent.inject()` 排队的知识插入用户输入之前 | 通过 |

**端到端验证方式（已实测通过，2026-11-28）**：插件页添加并启用 `dsh-office-0.3.1.tgz` 后，直接在 Friday 对话里说「帮我读取 D:\office-work 下 业务数据标准编码方案.docx 的内容」。实测日志（03:05）：`office_docs_read` 调用成功（19.8s，返回 6756 字符，107 个块 / 4 张表格），**未再使用 `python_repl`**。期间模型先误调内置 `office_inspect`（未装 CLI，2ms 失败），随后按提示词规则回退到插件工具；已补强提示词，明确禁止调用名单外的 `office_*` 工具。写类工具（如 `office_docs_write`）应弹出 Friday 审批框。全量单测：`node --test scripts/tests/*.test.mjs` → 实测 **56/56**（含桥接 6 例）。

**知识注入实测**：同轮日志出现 `插件 pre-step 合并消息: 1 条`，证明事件桥已触发。但 RAG 检索本身失败——日志 `RAG: 当前首选模型未配置 Embedding 模型名称`，这是模型配置问题（需在模型设置里配 Embedding 模型），不是桥接代码问题。

### 依赖说明

`package.json` 的 `electron` 已回到 `^42.2.0`，与 `package-lock.json` 一致；默认本地宿主不依赖 DSH 0.2 的 Electron 43 原生模块白名单。第三方 `.tgz` 插件解压显式依赖 `tar@^7.5.2`（已写入 `package.json` 与 `package-lock.json`）。若后续启用完整 DSH 通道，再按历史记录单独升级 Electron 与 peer 依赖。

完整生产构建已通过（2026-11-28）：此前 `node_modules/pdfjs-dist/wasm/` 下只剩 fallback JS、`openjpeg.wasm` 与 `jbig2.wasm` 二进制缺失（npm 中断残留），已从官方 `pdfjs-dist@6.5.438` tarball 补齐这两个文件。`vite build` 实测 14.77s 构建成功，仅有 chunk >500kB 的无害警告。该补齐只改 `node_modules`，不涉及版本变更或源码改动。

## 对话输入框改造（2026-11-28）：对齐 Yuxi 交互

参考 `xerrors/Yuxi` 的对话输入体验，对首页与对话页共用的 `FridayComposer` 做了增强，覆盖工作区、加号菜单、模型选择、工作模式四块。

### 新增实现

- `src/views/friday/composables/useWorkspaces.js`：本地工作区实体（默认工作区 + 用户新建/重命名/删除，localStorage 持久化），`friday store` 新增 `workspaceId`。
- `src/views/friday/constants.js`：模型能力关键词推断 `inferCapabilities()`、上下文长度推断 `inferContextLabel()`、`CHAT_MODES`（含新增 create/arena）。
- `src/views/friday/composables/useModelCatalog.js`：`modelList` 增加 `capabilities`/`contextLabel`/`provider` 字段。
- `FridayComposer.vue`：输入区上方新增「工作区 / 工作模式」选择条；加号菜单含添加附件、上传图片、知识库、工具、技能、MCP（后三类数据源走 `agent-list-tools` / `agent-list-skills` / `mcp-list-servers`）；模型下拉改为可搜索、按平台分组、带能力角标与上下文长度。
- `useChatStream.js`：新增 `folderPath` 透传（后端三条 IPC 均已支持），`create`/`arena` 模式复用 Agent 运行时（arena 多模型并跑留作后续扩展）。
- i18n：zh-CN / en-US 补齐新文案。

### 验证记录

- 语法与 SFC 编译：`node --check` + `@vue/compiler-sfc` 解析 3 个相关 Vue 文件全部通过。
- 全量单测：`node --test scripts/tests/*.test.mjs` → **56/56** 通过。
- 生产构建：`vite build` 25.47s 成功，仅 chunk >500kB 无害警告。
- 浏览器实测（Edge headless + CDP）：注入 3 个模型后，模型面板显示搜索框、思考模式切换、按平台分组（DashScope/DeepSeek/豆包）、能力角标（多模态）、上下文角标（128K）；加号菜单六项齐全；工作区/模式按钮正常显示。首页截图布局无重叠或错乱。

### 仍需你在 UI 里实测（需 Electron 环境）

- 加号菜单的「工具/技能/MCP」子菜单数据依赖 `window.electronAPI`（headless 环境为空），需在真实 Electron 窗口确认列表能加载、点击能插入 `@名称` 提及。
- 新建工作区时「浏览目录」走原生对话框 + 选中路径作为 `folderPath` 注入，需在真实窗口确认 Agent 的文件读写落在该目录。
- `create`（创造）/`arena`（竞技）模式的实际行为：当前均走 Agent 通道，arena 的多模型并跑尚未实现，仅保留模式入口。
