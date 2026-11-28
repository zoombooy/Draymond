# DSH 0.1.x → 0.2.x 迁移说明（分支 feature/dsh-0.2-kernel-migration）

本分支执行分析报告中 P0 + P1 + P2，目标是把项目从「外挂旧版 DSH Web UI」推进到「DSH 0.2.x 运行时 + 一等插件」，并让知识库与会话记忆进入 Harness 上下文。

## 架构收敛：只借鉴能力，不加载 DSH 运行时（最新）

早期实现走的是「iframe 加载完整 DSH + 网络层胶水」的验证路径，能跑通但耦合过重：cookie 捕获/转发、`sec-fetch-site` / `origin` / `referer` 改写、401 probe、Electron 43 精确版本、23 个 peer 包与原生二进制修复，都会把 o-hino 的启动稳定性绑在 DSH 上，`forbidden` 也来自这套来源校验。

现已收敛为：

- 默认宿主：`src-electron/harness/pluginHost.js`，在 o-hino 主进程内实现 DSH 插件契约的最小子集（`apply(ctx, config)`、`ctx.on`、`ctx.effect`、`tools/pre-execute`、`agent/pre-step`、`ctx.tools.execute`、`agent.inject`），并兼容官方 bundle 的 `ctx.tools.register(defineTool(...))` 与 `@deepseek-ai/dsh-tools` 解析方式。
- 默认 UI：`src/views/harness/DeepSeekHarness.vue` 改为本地插件管理页，不再加载 iframe；内置插件、第三方 bundle、审批队列、工具测试都在本地页完成。第三方插件支持本地目录、npm 包名和 `npm pack` 产出的 `.tgz` / `.tar.gz`：解包到 `deepseek-harness/plugin-cache`，按 `package.json` 的 `exports` / `module` / `main` 入口加载；摘要栏模型直接读取 o-hino 当前选择的模型，未配置时提供跳转入口。
- 知识检索：本地宿主直接调用 `src-electron/rag/index.js` 的 `searchKnowledgeBase`，不再经过 DSH 的 MCP 桥接。
- Electron：包约束回到 `^42.2.0`（与 `package-lock.json` 一致），默认宿主不依赖 DSH 0.2 的原生模块白名单。
- 完整 DSH web 通道：保留代码但默认关闭。只有显式设置 `O_HINO_LEGACY_DSH_WEB=1` 才走旧路径；SDK JSON-RPC 通道仍作为手动开启的兼容性实验入口。
- 插件桥接日常对话：新增 `src-electron/agent/pluginBridge.js`，把 PluginHost 的工具镜像注册进日常对话 Agent 的工具表（前缀 `plugin__`），并在每轮 `agent-invoke` 中触发 `session/event` 与 `agent/pre-step`。因此插件工具能被 LLM 在对话中选择调用，知识注入插件与审批策略也在对话链路生效；内置知识检索工具不重复桥接。桥接失败一律降级为无插件，不阻断对话。

因此本文下面 P0/P1/P2 中「patch 注入到 DSH 运行时」的描述属于历史验证路径。当前默认运行路径是本地 `PluginHost`，插件文件本身无需改动即可复用。

## 已完成的改动

### P0 依赖与配置对齐

- `package.json`：
  - `@deepseek-ai/dsh` → `0.2.3-alpha.2`
  - Cordis 生态同步到 4.2/1.2/1.3/3.20 alpha 系列
  - 新增 `engines.node >= 24.22.3`
  - 新增脚本 `npm run harness:migrate`
  - 打包白名单加入 `plugins/**/*`
- `scripts/migrate-harness-config.mjs`：按官方两条破坏性变更清理已有用户配置
  - 移除引用 `@deepseek-ai/dsh-invariants`、`/invariant`、`invariants|session-invariant|agent-invariant|scope-invariant|agent-loop-invariant` 的 patch 条目（递归处理嵌套 insert）
  - 从 profile manifest 的 `dsh.profile.bundles` 中移除退役的 `@deepseek-ai/dsh-experimental-schedule-bundle`
  - 移除顶层 `time-context` 覆盖
  - 修改前自动备份为 `*.bak-0.1.5-<timestamp>`
- `scripts/tests/migrate-harness-config.test.mjs`：7 个用例覆盖上述规则。

### P1 工具清单与审批插件化

- 新增 `src-electron/harness/toolBridge.js`：把注册表中 `exposedViaMcp: true` 的工具统一生成为 `mcp__o-hino__*` 清单及审批工具列表，消除两处重复拼接。
- 新增一等插件 `plugins/o-hino-tools/`：在 `tools/pre-execute` 上执行审批，替代原先复制到 DSH home 的 `toolApprovalPolicy.mjs`（已删除）。
- `src-electron/harness/index.js`：改用桥接层生成配置，patch 直接引用仓库内插件的绝对路径。
- `scripts/tests/tool-bridge.test.mjs`：6 个用例覆盖清单过滤、审批决策与插件行为。
- `AGENTS.md`：补充 Harness 约定与 0.2.x 红线。

### P2 知识库注入与会话记忆投影

- 新增一等插件 `plugins/o-hino-knowledge/`：
  - `session/event` 收到用户输入（`agent/inbox/spliced` / `user/message`）后，通过 `ctx.tools.execute()` 调用 `mcp__o-hino__retrieve_knowledge`，把结果包装成 `agent.inject()` 消息。
  - `agent/pre-step` waterfall 中同步占位并等待检索结果，把注入消息并入当前批次，避免首轮对话晚一拍；已完成合并的结果不会再走 `agent.inject()`，防止重复注入。
  - `assistant/message` 事件幂等投影到 `/memories/HARNESS.md`，标记外的手动编辑保留，默认不写入用户原话（`captureUser: false`）。
- 新增 `src-electron/harness/knowledgeBridge.js`：用户输入识别、query 提取、注入正文限长、工具结果解析、记忆段落幂等合并，全部为纯函数。
- `src-electron/agent/memoryFiles.js`：新增第五份记忆文件 `HARNESS.md`；zh-CN / en-US 抽屉文案同步新增 `HARNESS` / `HARNESS_desc`。
- `src-electron/harness/index.js`：patch 注入知识插件，并把 `/memories/HARNESS.md` 绝对路径作为配置传入；启动前调用 `ensureMemoryFiles()` 确保文件存在。

> 设计约束：DSH 的 `agent.inject()` 只排队、不唤醒 driver。因此 P2 同时实现了 `agent/pre-step` 合并（同轮生效）与 `agent.inject()` 兜底（晚到结果落到下一次被接纳的请求），两者互斥。

## 本地验证结果

```
node --test scripts/tests/*.test.mjs
# tests 25 / pass 23 / fail 2
# 2 个失败为既有的 obsidian-parser / obsidian-webdav 测试：
# 当前快照缺少 node_modules（js-yaml 等），与本次改动无关
```

新增用例集中在 `scripts/tests/knowledge-bridge.test.mjs`（6 例）与 `scripts/tests/knowledge-plugin.test.mjs`（3 例）。

由于当前环境无法访问 npm registry，`npm install` / `npm run build` / Electron 冒烟测试尚未执行。

## 升级操作步骤（在有网络的环境执行）

1. 切换到本分支并拉取依赖：
   ```bash
   git checkout feature/dsh-0.2-kernel-migration
   npm install --legacy-peer-deps
   ```
   `package-lock.json` 会随安装更新；提交更新后的 lockfile。

2. 确认 Node >= 24.22.3（DSH 0.2.x 下限）：
   ```bash
   node -v && npm -v
   ```

3. 迁移已有用户配置（开发版默认数据目录为项目下 `app-data`）：
   ```bash
   npm run harness:migrate -- ./app-data
   ```
   自定义数据目录时传入实际目录，或设置 `O_HINO_DATA_DIR`。

4. 用 `dsh --dump-config` 检查组合后的插件树，确认没有 `patch: entry not found` 或模块缺失告警。

5. 启动验证：
   ```bash
   npm run build
   npm run electron:dev
   ```
   打开「DeepSeek Harness」页确认 sidecar 启动、iframe 加载、MCP 工具列表与审批弹窗正常。

6. 打包后验证原生模块：
   ```bash
   node scripts/verify-packaged-native-modules.mjs x64
   ```

## 仍需关注的兼容点（下一阶段处理）

- 0.2.x 的认证 / cookie 机制可能已变化，`enableHarnessCookieForwarding()` 与 `--token` URL 解析需要实测确认是否仍需保留。
- Windows 目录选择器 patch 与 AppImage 符号链接清理逻辑需在新版实机验证。
- P1b：确认 `ctx.tools` 的注册 API 后，将工具执行层从 MCP 桥接迁为原生插件工具。
- P2 实测：`ctx.tools.execute()` 调用 MCP 工具的实际返回形状、`agent/pre-step` 中 `currentInitiator()` 的可用性，需在 Electron 冒烟测试中确认。
- P3/P4：headless 自动化并轨、SDK 宿主化替换 iframe。

## 插件机制与 DSH 0.2.3 原生契约核对（2026-11-27）

结论：**P1/P2 采用的就是 DSH 0.2.3 的原生 Cordis 插件机制**，不是自己另起的 IPC/回调旁路。逐项对照已安装的 `@deepseek-ai/*` 源码：

| 机制 | 项目实现 | 官方契约（0.2.3-alpha.2） | 结论 |
|---|---|---|---|
| 插件导出 | `export const name` / `export const inject` / `export function apply(ctx, config)` | Cordis `isApplicable()` 检查 `typeof plugin.apply === 'function'` 并调用 `plugin.apply`；`inject` 为依赖声明（cordis/lib/index.js:1669,1758） | ✅ 一致 |
| 挂载方式 | profile patch 的 `insert` 条目，`name` 指向仓库内插件的 `file://` 绝对路径 | loader 的 patch `insert` / `disabled` / `config` 字段（dsh-app-boot/lib/index.js:7223 等） | ✅ 一致 |
| P1 hook | `ctx.on('tools/pre-execute', async (execution, next) => ...)` | events.d.ts:17 `'tools/pre-execute'(exec, next: () => Promise<PreToolDecision>)` | ✅ 一致 |
| P1 决策 | `{ kind: 'ask', reason }` | contracts.d.ts:334-344 `PreToolDecision` 含 `allow/deny/cancel/ask`，`ask` 带可选 `reason` | ✅ 一致 |
| P2 hook | `ctx.on('session/event', ...)` | dsh-session/lib/index.js（事件名真实存在） | ✅ 一致 |
| P2 检索 | `ctx.tools.execute({ calls: [{ id, name, arguments: JSON.stringify(...) }], signal, agent })` | tools/lib/index.js:642 `execute(input)` → pipeline.js:29 解构 `{ calls, signal, agent, toolSet }`；pipeline.js:33-42 逐字段读 `block.id/name/arguments` 并 `parseArguments` | ✅ 一致 |
| P2 注入 | `agent.inject(message)` | runtime-types.d.ts:237 `inject(message: UserMessage): void` | ✅ 一致 |
| P2 同轮合并 | `ctx.on('agent/pre-step', async (payload, next) => { const d = await next(); if (d.kind !== 'enter') ...; return { ...d, messages: [...d.messages, msg] } })` | runtime-types.d.ts:117-124 `PreStepDecision = {kind:'reject'} \| {kind:'enter', messages: UserMessage[]}`；events 契约 `next: () => Promise<PreStepDecision>`；官方 installModelSelection（dsh-agent/lib/index.js:231）同样 `await next()` 后展开 `messages` | ✅ 一致 |
| 第三方 bundle | `bundleRegistry.js` 生成 patch `insert` 条目，`disabled` 控制启停 | 复用同一 patch 机制；不接 DSH 的 pnpm workspace / PluginManager | ⚠️ 见下 |

### 与"完整插件机制"的两点距离

1. **工具执行仍走 MCP 桥接，不是原生 `ctx.tools` 注册**（即文档里的 P1b）。当前 `mcp__o-hino__*` 是本机 MCP server 暴露给 dsh 的，插件只做审批与知识注入；DSH 原生做法是插件内 `ctx.tools.register()` 注册工具。这是**刻意的渐进迁移**，见 `plugins/o-hino-tools/index.js` 头部注释。
2. **第三方 bundle 用自建注册表 + patch 投影，没接 DSH 官方的 pnpm workspace / PluginManager**（当时判断完整接入成本过高，见第 2 层设计）。用户添加的包名/路径最终仍以官方 loader 的 `insert` 条目加载，运行时机制是原生的，只是"安装/依赖解析"这层没用官方的。

### 一处已修正的实现细节（2026-11-27）

`plugins/o-hino-knowledge/index.js` 原先在 `agent/pre-step` 里用 `ctx.agents.currentInitiator()` 取 agent，而官方 payload **直接带 `agent`**（dsh-agent/lib/index.js:231 解构 `{ agent, messages, ... }`）。若 `currentInitiator()` 在该阶段返回空，同轮合并会静默跳过、退化成 `agent.inject()` 兜底（首轮知识晚一拍）。现已改为 `payload?.agent || ctx.agents?.currentInitiator?.()`：优先用官方传入的 agent，保留旧路径兜底以兼容现有测试 mock；`scripts/tests/knowledge-plugin.test.mjs` 新增用例覆盖 payload 带 agent 的官方契约路径。全套纯逻辑单测 **32/32 通过**。
