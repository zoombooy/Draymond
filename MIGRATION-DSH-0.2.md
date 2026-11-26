# DSH 0.1.x → 0.2.x 迁移说明（分支 feature/dsh-0.2-kernel-migration）

本分支执行分析报告中 P0 + P1 的第一步，目标是把项目从「外挂旧版 DSH Web UI」推进到「DSH 0.2.x 运行时 + 一等插件」。

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

- 新增 `src-electron/harness/toolBridge.js`：把注册表中 `exposedViaMcp: true` 的工具统一生成为 `mcp__happy-friday__*` 清单及审批工具列表，消除两处重复拼接。
- 新增一等插件 `plugins/happy-friday-tools/`：在 `tools/pre-execute` 上执行审批，替代原先复制到 DSH home 的 `toolApprovalPolicy.mjs`（已删除）。
- `src-electron/harness/index.js`：改用桥接层生成配置，patch 直接引用仓库内插件的绝对路径。
- `scripts/tests/tool-bridge.test.mjs`：6 个用例覆盖清单过滤、审批决策与插件行为。
- `AGENTS.md`：补充 Harness 约定与 0.2.x 红线。

## 本地验证结果

```
node --test scripts/tests/migrate-harness-config.test.mjs scripts/tests/tool-bridge.test.mjs
# tests 13 / pass 13 / fail 0
```

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
   自定义数据目录时传入实际目录，或设置 `HAPPY_FRIDAY_DATA_DIR`。

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
- P2/P3/P4：知识库 `agent.inject()`、`SessionEvent` 记忆投影、headless 自动化并轨、SDK 宿主化替换 iframe。
