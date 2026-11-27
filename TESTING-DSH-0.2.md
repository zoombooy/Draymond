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

> 当前开发机访问不了 npm registry，所以这一层还没做过实测。如果你那边也装不上，可以先把第 1、2 层做掉，它们不需要 `node_modules`。

## 第 1 层：纯逻辑单元测试（零依赖）

```bash
node --test scripts/tests/migrate-harness-config.test.mjs \
         scripts/tests/tool-bridge.test.mjs \
         scripts/tests/knowledge-bridge.test.mjs \
         scripts/tests/knowledge-plugin.test.mjs
```

**预期**：24 个用例全通过。

这三个文件覆盖：旧配置清理规则（含 `name:` 写在第二行的条目）、工具清单与审批决策、知识注入正文构造、工具结果解析、`agent.inject()` 与主轮次合并的互斥逻辑、`HARNESS.md` 幂等投影。

> 如果跑 `node --test scripts/tests/*.test.mjs`，会额外跑 `obsidian-parser` 和 `obsidian-webdav` 两个既有测试；装完依赖后它们才可能通过。本分支新增的测试不依赖 `js-yaml`，可离线运行。

## 第 2 层：配置迁移实测（零依赖，动的是临时目录）

先用一个假的旧配置目录验证脚本行为，**不要直接对真实数据目录跑**：

```bash
# Windows（Git Bash）
TMP=./harness-migrate-demo
mkdir -p "$TMP/deepseek-harness/home/profiles/default"
cat > "$TMP/deepseek-harness/home/happy-friday.patch.yml" <<'EOF'
- id: custom-invariant
  name: "@deepseek-ai/dsh-invariants"
- id: time-context
  options: {}
- id: mcp-happy-friday
  insert: []
EOF
cat > "$TMP/deepseek-harness/home/profiles/default/package.json" <<'EOF'
{"dsh.profile":{"bundles":["@deepseek-ai/dsh-experimental-schedule-bundle","@deepseek-ai/dsh-web-app"]}}
EOF

npm run harness:migrate -- "$TMP"
npm run harness:migrate -- "$TMP"     # 第二次应为「没有需要清理的配置」
cat "$TMP/deepseek-harness/home/happy-friday.patch.yml"
cat "$TMP/deepseek-harness/home/profiles/default/package.json"
```

**预期**：

- 第一次输出两条「已清理」，每条都带 `*.bak-0.1.5-<时间戳>` 备份路径；
- 第二次输出「没有需要清理的 0.1.x 配置」（幂等）；
- `happy-friday.patch.yml` 只剩 `mcp-happy-friday` 条目，两个旧条目被清掉；
- profile manifest 的 `bundles` 只剩 `@deepseek-ai/dsh-web-app`，其他字段保持原样。

确认无误后，再对真实数据目录执行（默认开发数据目录是项目下 `app-data`）：

```bash
npm run harness:migrate -- ./app-data
```

自定义数据目录时传实际路径，或设置 `HAPPY_FRIDAY_DATA_DIR`。执行前先确认备份文件路径，**出问题直接把 `*.bak-*` 改回原名即可回滚**。

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

生成的 patch 在 `app-data/deepseek-harness/home/happy-friday.patch.yml`，可以直接打开核对三个插入项：`mcp-happy-friday`、`happy-friday-tool-approval`、`happy-friday-knowledge`。

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

**验证幂等**：重启 Harness、重复同一段对话，同一 `(session, seq)` 的条目不应重复出现；手动在两个 `<!-- happy-friday-harness-memory:start/end -->` 标记之外写一行文字，重启后这行文字应保留。

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
