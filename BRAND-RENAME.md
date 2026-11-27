# 品牌重命名：Happy Friday Lite → o-hino

本分支将平台名称从 **Happy Friday Lite** 改为 **o-hino**，助手人格名（Friday / 周五）同步改为 o-hino。

## 一、改名范围

### 用户可见
- 窗口标题、启动页：`index.html` 的 `<title>` 与 splash
- 安装包信息：`package.json` 的 `name` / `description` / `productName` / `appId`（`com.happyfriday.lite` → `com.ohino.lite`）
- Windows 通知标识：`main.js` 的 `setAppUserModelId`
- 全部 i18n 文案（zh-CN / en-US）：首页、助手、笔记、日程、设置、MCP、Harness、历史
- 系统提示词：`src/config/prompts.js`、笔记 AI 提示词
- 会话导出、消息默认显示名：`AIMessage.vue` / `StreamingAssistantMessage.vue` / `ChatHistoryDrawer.vue` / `HistoryList.vue`
- Logo：`src/assets/images/HPTEXT-b.png` / `HPTEXT-w.png` 重制为 "o-hino" 像素字（1221×333，与原版一致）

### 内部标识符
- MCP server 名 `happy-friday` → `o-hino`，工具前缀 `mcp__happy-friday__*` → `mcp__o-hino__*`
- DSH 插件目录：`plugins/happy-friday-tools` → `plugins/o-hino-tools`，`plugins/happy-friday-knowledge` → `plugins/o-hino-knowledge`
- 插件 name / 包名：`@happy-friday/dsh-*` → `@o-hino/dsh-*`
- patch 文件名：`happy-friday.patch.yml` → `o-hino.patch.yml`，patch id 同步
- Headless CLI：`happyfriday-office` → `ohino-office`
- 凭证 key：`HAPPY_FRIDAY_HARNESS_API_KEY` → `O_HINO_HARNESS_API_KEY`
- 数据目录环境变量：`HAPPY_FRIDAY_DATA_DIR` → `O_HINO_DATA_DIR`

### localStorage 数据键（含迁移）
全部 `happy-friday-*` → `o-hino-*`。`src/main.js` 加入一次性迁移层 `migrateLegacyStorageKeys()`：仅在目标键不存在时把旧键的值搬到新键，**旧键保留不删除**，因此：
- 升级后用户已有的模型配置、主题、聊天模式、会话历史、知识库视图偏好等**不会丢失**
- 回退到旧版本时仍能读取（旧键还在）

## 二、刻意保留的旧名（兼容用途）

以下 3 处保留旧品牌名是**升级兼容逻辑**，不是遗漏：

| 位置 | 用途 |
|---|---|
| `scripts/migrate-harness-config.mjs` 读 `happy-friday.patch.yml` | 清理旧版本升级上来的 patch 文件 |
| `scripts/migrate-harness-config.mjs` 读 `HAPPY_FRIDAY_DATA_DIR` | 旧环境变量名回退 |
| `src-electron/harness/index.js` `delete refs.HAPPY_FRIDAY_HARNESS_API_KEY` | 清理旧凭证 key，避免残留 |

组件文件名（`FridayHome.vue` / `FridayConversation.vue` / `FridayLayout.vue` 等）、路由名 `friday`、store 模块 `friday.js`、i18n 键名（`friday.*`）等**代码标识符未改**——它们不影响 UI，改名只会破坏 import 路径和路由引用，收益为零。

## 三、验证

- 全量测试：`node --test scripts/tests/*.test.mjs` → **29/29 通过**
- 语法校验：改动的核心 JS 全部 `node --check` 通过
- JSON 校验：28 个 JSON 全部可解析
- 构建：`npm run build` 通过
- 启动：`npm run electron:dev`，窗口标题显示 `o-hino`

## 四、启动方式（提醒）

未打包时 `main.js` 走 dev 模式，窗口加载 Vite 的 `http://localhost:5173`。**必须用 `npm run electron:dev` 一条命令同时拉起 Vite 和 Electron**，单独起 Electron 会白屏。详见 `INSTALL-AND-RUN.md`。
