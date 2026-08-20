# SoloCreator Content OS — 桌面 GUI 实现规格 v0.2（规格即契约）

> 状态：**可执行规格（待用户确认后进入 Phase 3 实现）**
> 作者：项目总监「大湾区靓仔」（韦优）综合架构师高见远、设计师颜好看产出
> 日期：2026-08-20
> 源文档：
> - `docs/GUI_Architecture_v0.1.md`（架构，408 行）
> - `docs/GUI_Design_v0.1.md`（设计，626 行）
> 关联：`docs/SPEC.md` v1.0.0、`docs/SoloCreator_Modular_Architecture_PRD_and_Design.md` (PRD v3.0)、`docs/LLD_01~07_*`、`src/server/engineServer.ts`(待建)
>
> **本文件即契约。** 实现者只按本文档 + 验收标准施工；任何冲突先改本 Spec 再改代码（活规格原则）。

---

## 0. 目标与背景（为什么做、做成什么样）

### 0.1 问题
PRD v3.0 把「桌面 Tauri 壳」列为四平等宿主适配器之一，但从未产品化：当前用户只能通过 CLI 配置密钥、触发转译/渲染/发布。用户明确决策——**原产品定位是一个带完整 GUI 的桌面产品**，而非仅 CLI。GUI 缺失导致：密钥只能命令行配置、无实时多端预览、发布状态无看板、创作者无法"工作台式"工作。

### 0.2 目标
把既有 TS 引擎（100% 复用，**不重写任何业务逻辑**）承载进一个 Tauri 2 桌面应用，提供四个工作台模块：
- ① 密钥/配置中心（GUI 配置全部密钥，明文永不离开引擎 sidecar）
- ② 母稿创作台（灵感→母稿→质检/Hook→保存）
- ③ 多端实时预览（微信/X/小红书/微博，实时 HTML + Playwright 导出 PNG）
- ④ 发布状态看板（母稿×渠道矩阵，草稿态分发，人工终审）

### 0.3 成功定义（EARS）
- **WHEN** 用户安装并启动应用，**THEN** 引擎 sidecar 在 5s 内就绪，前端 `GET /api/v1/health` 返回 `{status:'ok'}`，「引擎启动中」提示消失。
- **WHEN** 用户在 ① 写入任意密钥值，**THEN** 该值经 AES-256-GCM 落盘到 `~/.solo-creator/vault.enc`，列表仅显示掩码末 4 位，**AND** 引擎**无任何端点**返回明文。
- **WHEN** 用户在 ② 输入灵感并点「展开母稿」，**THEN** 母稿在 ≤3s 内生成并展示质检报告与 ≥5 个 Hook 候选（无 Key 时降级离线模板展开并标注）。
- **WHEN** 用户在 ③ 勾选渠道并生成预览，**THEN** 各端交付物在 ≤3s 内真实渲染（微信 iframe / 卡片 HTML / 连推文本）。
- **WHEN** 用户在 ④ 点「存入草稿箱」，**THEN** 各渠道 `draftOnly` 草稿就绪（不自动发布），看板刷新状态，失败渠道可重试。

### 0.4 已锁定的 6 项决策（本 Spec 的硬约束，不可在实现中推翻）

| ID | 决策点 | 锁定值 | 影响 |
|----|--------|--------|------|
| **D1** | 前端↔引擎通信路径 | **前端直连 `127.0.0.1` 引擎 HTTP**（无 Rust 代理） | 零代理样板；Tauri CSP 放行 `connect-src http://127.0.0.1:PORT`；引擎返回 `Access-Control-Allow-Origin: *` |
| **D2** | 密钥保险箱强度 | **维持机器指纹派生**（无解锁步骤） | 同机不安全，但开箱即用；明文绝不离开 sidecar（ADR-002） |
| **D3** | 自动更新/打包策略 | **sidecar + Node + Chromium 随主包整体分发** | 包 80~150MB，更新器整体替换；简单优先 |
| **S1** | 默认主题 | **浅色纸感优先 + 完整深色模式**（可切换） | `data-theme="light"` 默认 |
| **S2** | 品牌主色 | **墨青 Teal `#0D9488`**（深色 `#2DD4BF`） | 避开 AI 蓝/紫粉（P0 红线） |
| **S3** | 创作台布局 & 落地页 | **三栏工作台，应用启动默认进母稿**；导航保留「数据复盘」占位入口（v2 实装） | v1 仅骨架占位 |

---

## 1. 宿主承载模型（ADR-001）

**方案 A — Node Sidecar + 本地 HTTP 服务（锁定）。**

Tauri webview 是系统浏览器内核，**物理上无法加载 Node 原生模块（`.node`）或 `playwright`**。引擎强依赖 `better-sqlite3`（原生）+ `playwright`（Chromium）。因此引擎必须留在 Node 运行时，由 Tauri Rust 在 `setup` 钩子经 `tauri-plugin-shell` 的 `Command::new_sidecar("node").args(["<resources>/engine-server.js"])` 拉起为常驻进程，绑定 `127.0.0.1:<PORT>`。

否决项（已评估）：B 每次 spawn Node 脚本（进程抖动大、无法保持内存态）、C webview 内运行（不可行）、D Rust/WASM 重写（违反不重写）、E napi 桥接（v2 优化项）。

**拉起时序**
1. 应用启动 → Rust `setup` 经 `tauri-plugin-shell` 启动 `engine-server.js`，绑定 `127.0.0.1`，端口写入应用状态。
2. Rust 健康检查 `GET /api/v1/health`；就绪前前端显示「引擎启动中」。
3. 前端直接 `fetch('http://127.0.0.1:PORT/...')`（D1 主路径）。
4. 应用退出 → Rust `on_exit` 向 sidecar 发 `SIGTERM` 并等待退出，**无孤儿进程**。

---

## 2. 引擎↔GUI 边界与端点契约（ADR-002 / ADR-003）

### 2.1 边界原则
- **引擎是单一事实源**：所有持久化在 SQLite，前端只持镜像缓存（TanStack Query）。
- **密钥明文永不离开 sidecar**：`LocalKeyVault` 只在 Node 内解密；HTTP 仅暴露「写值 / 列掩码 / 删」三类操作，**故意缺失**任何返回明文的端点。
- **预览与导出分离（ADR-003）**：实时预览用 webview 渲染卡片 HTML（不经 Playwright）；Playwright 仅用于「导出 PNG」低频动作。

### 2.2 唯一引擎侧改动：新增薄 HTTP 传输层
- 新增 `packages/engine/src/server/engineServer.ts`：用 `hono ^4`（或 Node 原生 `http`）暴露下列 REST，内部复用既有服务，**不改动既有逻辑**。绑定 `127.0.0.1` 仅，禁止 `0.0.0.0`。
- `packages/engine/package.json` 新增 `"bin": { "solo-engine": "dist/server/engineServer.js" }`。

### 2.3 端点清单（版本前缀 `/api/v1`）

**① 密钥 / 配置中心**
- `POST   /api/v1/secrets`             body `{key, value}` → 写入保险箱（**value 不回传**）
- `GET    /api/v1/secrets`             → `[{key, masked, exists}]`（掩码末 4 位）
- `GET    /api/v1/secrets/:key/masked` → `{key, masked}`
- `DELETE /api/v1/secrets/:key`        → 删除
- *无* `GET /api/v1/secrets/:key`（明文）—— 架构硬约束，缺失即验收失败

**② 母稿创作台**
- `POST   /api/v1/master`      body `{idea, topic?}` → `MasterContentService` + 质检 + Hook，返回 `MasterPost`
- `GET    /api/v1/master`      → 列表（分页）
- `GET    /api/v1/master/:id`  → 详情（markdown / hooks / takeaways）
- `PATCH  /api/v1/master/:id`  body `{title?, masterMarkdown?}` → 保存编辑
- `DELETE /api/v1/master/:id`

**③ 多端实时预览**
- `POST   /api/v1/master/:id/transpile`    body `{channels:['wechat','xiaohongshu','x','weibo']}` → 各端 Payload（article HTML / thread 文本 / card HTML）
- `POST   /api/v1/master/:id/card-preview` body `{theme}` → 卡片 HTML 字符串（webview 实时渲染，**不经 Playwright**）
- `POST   /api/v1/master/:id/render`       body `{theme}` → `CardRenderer` 走 Playwright 生成 PNG，返回图片文件路径列表（导出用）

**④ 发布状态看板**
- `POST   /api/v1/master/:id/publish`   body `{channels, draftOnly:true}` → `PublisherRegistry.dispatch`，返回 `PublishResult[]`
- `GET    /api/v1/master/:id/dispatch`  → 该母稿各渠道分发记录
- `GET    /api/v1/dashboard`            → 聚合看板（母稿 × 渠道 × 状态）
- `POST   /api/v1/dispatch/:id/retry`   → 失败重试

**长任务进度**
- `GET    /api/v1/jobs/:id/stream`      → SSE 进度流（渲染百分比、发布逐渠道结果），前端 `EventSource` 订阅

**健康检查**
- `GET    /api/v1/health`               → `{status:'ok', version:'0.1.0'}`

### 2.4 统一响应形状
```jsonc
{ "code": 0, "data": {}, "message": "" }   // 0=成功, 非0=错误码
```
错误码：401=未配置密钥 / 409=幂等跳过 / 422=参数错误 / 500=引擎内部（含 Playwright 启动失败明细）。

---

## 3. 密钥统一化改动（本次必须修复的不一致）

**现状缺陷**：微信密钥经 `LocalKeyVault`（`src/publisher/WeChatApiDriver.ts:21-22` 读 `WECHAT_APP_ID/WECHAT_APP_SECRET`）；但 DeepSeek Key 经 `process.env.DEEPSEEK_API_KEY`（`src/llm/DeepSeekAdapter.ts:14` 兜底）。两路不统一，GUI 无法接管 DeepSeek 配置。

**改动契约（点名文件）**
- `src/llm/DeepSeekAdapter.ts:14`：移除 `process.env.DEEPSEEK_API_KEY` 兜底；构造参数 `apiKey` 改由调用方注入 `vault.getSecret('DEEPSEEK_API_KEY')`。
- 调用链 `MasterContentService` / `CriticPipeline` / `HookGeneratorService` 实例化 `DeepSeekAdapter` 时，统一从 `LocalKeyVault.getSecret('DEEPSEEK_API_KEY')` 取 Key 注入（CLI 已支持 `config set-secret DEEPSEEK_API_KEY`，无需新增写入路径）。
- 验收：删除 `DEEPSEEK_API_KEY` 环境变量后，经 `POST /api/v1/secrets {key:'DEEPSEEK_API_KEY',value:'sk-test'}` 写入，再走母稿展开，**应能成功调用 LLM**；未写入时正确降级离线模板。

---

## 4. GUI 设计系统（S1 / S2 / P0 合规）

### 4.1 信息架构（左侧常驻导航 + 主区 + 右栏上下文）
```
① 密钥/配置中心  [key-round]   ── 凭据保险箱 / 模型与质检 / 渠道与驱动 / 偏好
② 母稿创作台      [pen-line]    ── 灵感收件箱 / 母稿编辑器(默认启动页) / 母稿库
③ 多端实时预览    [monitor]     ── 转译 / 预览台
④ 发布状态看板    [layout-dashboard] ── 分发状态 / 一键发布 / 通知中心 / 数据复盘(v2 占位)
+ 顶部全局 ⌘K 命令面板 + 右侧上下文面板（仅 ②③ 展开）
```
导航项右上角 status pill：密钥缺失(琥珀) / 发布失败(红) / 飞书未连(灰)。

### 4.2 视觉令牌（全部经 Token，实现层零硬编码；仅 `#fff`/`#000` 字面允许）
- 浅色（默认）：`--bg:#FAFAF7` 暖纸白 / `--accent:#0D9488` 墨青 / `--fg:#1A1D1A` 墨色 / `--border:#E7E5E1` 暖灰
- 深色：`--bg:#0E1110` 近黑 / `--accent:#2DD4BF` / `--fg:#E8EAE6` / `--border:#262B28`
- 语义色：`--success:#16A34A` / `--warn:#D97706` / `--danger:#DC2626` / `--info:#0E7490`（深色对应提亮）
- 字号阶梯 12→44px、间距 4px 网格、圆角上限 16px、阴影克制（边框优先）、动效 `cubic-bezier(0.2,0,0,1)` 无回弹、`prefers-reduced-motion` 全量降级。
- 完整 Token 源见 `GUI_Design_v0.1.md` §3 / §7，实现阶段拆为 `design-tokens.css` + `design-tokens.json`。

### 4.3 图标（P0 红线：禁 emoji）
- 锁定 **lucide-react 0.510.0**（SVG 描边，`stroke-width:1.75`，`currentColor`），尺寸 16/20/24px。
- 功能→图标映射见 `GUI_Design_v0.1.md` §3.10；emoji 正则 `[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]` 在产物中必须为零。
- 渠道 glyph：16px 单色品牌 SVG（微信/小红书/X/微博），取自官方简化路径，颜色取自 `--ch-*` Token。

### 4.4 组件 5 态矩阵（Loading/Empty/Error/Populated/Edge）
覆盖：灵感收件箱、母稿编辑器、预览台、分发看板、密钥保险箱（详见 `GUI_Design_v0.1.md` §8）。按钮另覆盖 Disabled/Active/Focus(可见环)。

### 4.6 交互细节与体验加固（用户已确认闭环）
1. **首次打开引导（Onboarding）**：默认进入 ② 创作台，若未配置 DeepSeek Key，除顶部提示条外，增加「立即前往配置中心 →」直达链接；若 SQLite 无母稿，中栏展示极简引导卡片（「从一条灵感开始」/「使用示例」），避免空白。
2. **文件导出唤起 Finder**：③ 导出卡片 PNG / Markdown 后，Toast 与面板提供「在访达中显示」按钮，调用 `@tauri-apps/plugin-opener` 打开并定位文件。
3. **桌面高频快捷键**：
   - `⌘K` / `Ctrl+K`：打开全局命令面板
   - `⌘S` / `Ctrl+S`：保存当前母稿
   - `⌘Enter` / `Ctrl+Enter`：触发母稿展开 / 生成
   - `Esc`：关闭抽屉 / 模态 / 命令面板
4. **macOS 标题栏安全区**：自定义标题栏最左侧预留 80px 避让系统红绿灯按钮，拖拽区与搜索框从 80px 之后开始。

---

## 5. 实现范围：点名文件与模块（Phase 3 待执行，本文档不产出代码）

### 5.1 仓库布局（pnpm workspace 单仓库）
```
solo-creator/
├── package.json                      # workspace 根
├── pnpm-workspace.yaml
├── packages/
│   ├── engine/                       # 既有 @solo-creator/content-os（仅新增薄层 + 密钥统一化）
│   │   ├── src/
│   │   │   ├── cli/index.ts          # 不变
│   │   │   ├── server/
│   │   │   │   └── engineServer.ts   # 【新增】HTTP 传输层，复用既有服务
│   │   │   ├── llm/DeepSeekAdapter.ts# 【改】移除 process.env 兜底，改由 vault 注入
│   │   │   ├── storage/LocalKeyVault.ts  # 不变（已 AES-256-GCM）
│   │   │   └── ... (其余模块不变)
│   │   ├── package.json              # 新增 "bin": {"solo-engine": "dist/server/engineServer.js"}
│   │   └── tsconfig.json
│   └── gui/                          # Tauri 桌面应用（本次主体）
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx               # 路由 + 外壳布局
│       │   ├── routes/
│       │   │   ├── SettingsSecrets.tsx     # ①
│       │   │   ├── Studio.tsx              # ② (默认路由)
│       │   │   ├── Preview.tsx             # ③
│       │   │   ├── Dashboard.tsx           # ④
│       │   │   └── Retro.tsx              # v2 占位
│       │   ├── lib/
│       │   │   ├── engineClient.ts        # fetch 封装，base URL = 127.0.0.1:PORT
│       │   │   ├── queries.ts             # TanStack Query hooks
│       │   │   └── types.ts               # 与引擎契约对齐的类型
│       │   ├── store/uiStore.ts           # Zustand（渠道/主题/草稿/路由/侧栏）
│       │   └── components/                # Radix + Tailwind，lucide-react 图标
│       └── src-tauri/                     # Rust 壳
│           ├── Cargo.toml                 # tauri 2.11.1 + 插件
│           ├── tauri.conf.json            # 窗口/CSP/sidecar/更新配置
│           ├── build.rs
│           ├── binaries/                  # 构建产出
│           │   ├── node-<triple>          # 随附 Node 运行时
│           │   └── resources/             # better-sqlite3 预编译 + playwright 浏览器
│           └── src/
│               ├── main.rs
│               ├── setup.rs               # 拉起 sidecar + 健康检查
│               ├── commands.rs            # 应用级命令（文件选择/打开URL/更新）
│               └── state.rs               # 持有引擎 base URL / 进程句柄
```

### 5.2 前端↔引擎调用（D1 主路径）
- `lib/engineClient.ts`：封装 `fetch('http://127.0.0.1:PORT/api/v1/...')`，注入 CORS 友好；base URL 由 Rust `state.rs` 注入或常量。
- 服务端状态：`TanStack Query`（`useQuery` 查 / `useMutation` 改 + `invalidateQueries`）。
- 客户端状态：`Zustand`（`uiStore.ts`），不存业务数据。
- 长任务：`EventSource` 订阅 `/api/v1/jobs/:id/stream`，写 Zustand 进度，完成后 invalidate 看板。

### 5.3 状态管理与数据流（以「母稿→预览→发布」为例）
```
灵感输入 → useMutation POST /master → MasterContentService 生成+质检
  → TanStack 缓存详情 → 创作台渲染
  → POST /master/:id/transpile {channels} → 预览台按端渲染(iframe/卡片HTML/连推)
  → POST /master/:id/render {theme} → SSE → CardRenderer 写 PNG → 返回路径
  → POST /master/:id/publish {channels, draftOnly:true} → SSE 逐渠道
  → invalidateQueries(['dashboard']) → 看板刷新状态徽标
```

---

## 6. 验收标准（EARS，按模块）

**① 密钥中心**
- WHEN 用户提交 `POST /api/v1/secrets` 写入，`THEN` 值经 AES-256-GCM 落盘，列表掩码末 4 位显示。
- WHEN 用户请求 `GET /api/v1/secrets/:key`（明文），`THEN` 引擎返回 404/拒绝，**绝不返回明文**（硬约束）。
- WHEN DeepSeek Key 经 ① 写入后走母稿展开，`THEN` 能成功调 LLM（见 §3 统一化）。
- IF 微信 AppID/Secret 缺失，`THEN` ① 页该渠道显示「未配置(琥珀)」状态 pill。

**② 创作台**
- WHEN 用户输入灵感点「展开母稿」，`THEN` ≤3s 返回 `MasterPost`+`CriticReport`+≥5 Hook 候选。
- IF `DEEPSEEK_API_KEY` 未配置，`THEN` 降级离线模板展开并顶部非阻塞提示条 + 质检分标注「离线」。
- WHEN `overallScore < 75` 或命中违禁词，`THEN` 母稿状态置 `need_manual_review` 并阻断自动转译。
- WHEN 用户编辑并保存，`THEN` `PATCH /api/v1/master/:id` 持久化，刷新后 `GET /api/v1/master/:id` 可见。

**③ 预览**
- WHEN 用户勾选渠道+主题点「生成预览」，`THEN` ≤3s 真实渲染四端交付物（微信 iframe / 卡片 HTML / 连推文本 / 微博短文）。
- WHEN 用户点「导出 PNG」，`THEN` `POST /master/:id/render` 经 Playwright 产出 `*.png`，SSE 报告进度。
- IF 转译触发 429，`THEN` 指数退避≤3 次重试，预览台骨架屏 + 「限流重试中」。

**④ 看板**
- WHEN 用户点「存入草稿箱」，`THEN` `draftOnly` 草稿就绪，看板刷新，UI 文案明确「仅存草稿，绝不自动发布」。
- WHEN 某渠道分发失败，`THEN` 该行红色 + 「重试」按钮 + 日志折叠；重试时 `DispatchLock` 跳过已成功渠道。
- WHEN 微信 CDP 登录失效，`THEN` 弹二维码模态 + 倒计时≤120s + 超时优雅报错。

**跨模块**
- WHEN 应用退出，`THEN` sidecar 进程随之终止，无孤儿进程。
- WHEN `GET /api/v1/health` 失败，`THEN` 前端显示「引擎启动失败」并附原生模块/缺失 lib 诊断。

---

## 7. 明确不做（out-of-scope，杜绝镀金）

- 不重写引擎任何业务逻辑；不把引擎移植到 Rust/WASM。
- 不做账号体系、云端同步、团队协作（本地优先）。
- 不做 v2 复盘/分析页数据回采（`post_analytics` 表已建未写，v1 仅占位入口）。
- 不做 macOS/Windows/Linux 三端全量签名证书配置（仅在风险给路径）。
- 不实现 D2 选项 b（保险箱解锁口令/系统钥匙串）—— 维持 D2 机器指纹派生。
- 不实现 D3 选项 b（首次启动按需下载 sidecar）—— 维持随主包整体分发。
- 不实现 R5 加固路径（Rust `engine_request` 代理）—— 维持 D1 直连。
- 本 Spec 不产出任何实现代码；Phase 3 才动工。

---

## 8. 版本锚定（按锁文件实测，非 PRD 声明）

| 层 | 技术 | 锁定版本 |
|----|------|----------|
| 前端框架 | React + React DOM | **18.3.1** |
| 路由 | react-router-dom | **6.30.x**（^6.28） |
| 构建 | Vite | **6.3.5**（**不用** vite-plugin-tauri，已废弃） |
| React 插件 | @vitejs/plugin-react | **4.7.0** |
| 类型 | TypeScript | **5.9.3** |
| Tauri 核心 | tauri (Rust) | **2.11.1** |
| Tauri CLI | @tauri-apps/cli | **2.11.0** |
| Tauri JS API | @tauri-apps/api | **2.11.0** |
| 插件(Rust) | shell/dialog/fs/opener/process/updater | **2.x**（Cargo `"2"`） |
| 插件(JS) | plugin-shell/dialog/fs/opener/process/updater | ^2.3.0 / ^2.3.3 / ^2.4.2 / ^2.5.0 / ^2.3.0 / ^2.9.0 |
| 组件 | Radix UI Primitives + shadcn 模式 | Radix ^1.1.x |
| 样式 | Tailwind CSS | **4.1.6**（v4 CSS-first，`@theme`，**无 tailwind.config.js**） |
| 客户端状态 | Zustand | **5.0.4** |
| 服务端状态 | @tanstack/react-query | **^5.62.0** |
| 图标 | lucide-react | **0.510.0**（**禁 emoji**） |
| 引擎 | @solo-creator/content-os | **0.1.0** |
| 引擎原生 | better-sqlite3 | **9.6.0** |
| 引擎浏览器 | playwright | **1.62.1**（**非 PRD 声明的 1.44**） |
| 引擎 HTTP | hono | **^4**（新增传输层） |
| 随附 Node | Node.js | **20 LTS (20.18.x)** |

---

## 9. 内嵌已知坑（硬约束，实现前必读）

- **R1 原生模块打包（高）**：sidecar 自带 Node + 原生 `.node`；Node 与 better-sqlite3 预编译 ABI 必须匹配，否则启动崩溃。对策：锁 Node 20 LTS，CI 同版本构建，`npm rebuild better-sqlite3 --build-from-source` 或目标平台预编译；`/health` 失败提示「引擎启动失败：原生模块」+ `ldd` 信息。
- **R2 Playwright 渲染（高）**：Chromium ~150MB，Linux 依赖 libnss3 等，macOS 触发 Gatekeeper。对策：构建期 `npx playwright install chromium --with-deps`，运行期设 `PLAYWRIGHT_BROWSERS_PATH`；实时预览走 webview（不经 Playwright，ADR-003）；导出失败时提示手动装浏览器。
- **R3 密钥安全（高，D2）**：`LocalKeyVault` 用 `USER:arch:platform` PBKDF2 派生主密钥，无口令，同机可解密。对策：明文绝不离开 sidecar（已锁死）；维持 D2 不升级。
- **R4 自动更新（中，D3）**：Tauri updater 默认不含 sidecar/node/浏览器。对策：随主包整体分发，更新器整体替换，接受 80~150MB；维持 D3。
- **R5 CSP/CORS（中，仅 D1）**：直连 127.0.0.1 需 `tauri.conf.json` 的 `app.security.csp` 加 `connect-src http://127.0.0.1:PORT`；引擎 HTTP 设 `Access-Control-Allow-Origin: *`（绑定 127.0.0.1 可接受）。
- **R6 Tailwind v4（低）**：废弃 `tailwind.config.js` 与 `@tailwind` 指令，改用 `@import "tailwindcss"` + CSS `@theme`；按 v3 写法静默无效。
- **R7 Tauri v2（低）**：用 `@tauri-apps/cli` + 独立 `tauri-plugin-*`（Rust crate + npm 成对）；`vite-plugin-tauri`（v1）已废弃；sidecar 用 `tauri-plugin-shell` 的 `new_sidecar`。脚手架以 `npm create tauri-app@latest react-ts` 起步。
- **密钥统一化坑（来自 §3）**：`DeepSeekAdapter.ts:14` 的 `process.env` 兜底是历史残留，必须删；否则 GUI 写入的 Key 不生效，仍读环境变量。修改后需同步验证「删环境变量→GUI 写入→仍可用」。

---

## 10. 端到端验证步骤（收尾即验收）

> 目标：从头证明可用。覆盖核心成功流（①→②→③→④）+ 关键错误流（明文不可得 / 渠道失败重试 / sidecar 退出）。

1. `pnpm install && pnpm -F engine build && pnpm -F gui tauri dev`
2. 应用启动 → 观察 Rust 日志 sidecar 拉起；前端「引擎启动中」在 `GET /health` 就绪后消失。
3. **① 密钥**：`POST /api/v1/secrets {key:'DEEPSEEK_API_KEY', value:'sk-test'}` → 列表出现该 key 且掩码 `********st_value`；再请求 `GET /api/v1/secrets/DEEPSEEK_API_KEY`（明文）→ **返回 404/拒绝**（验证 ADR-002）。
4. **①→② 统一化**：删除 `DEEPSEEK_API_KEY` 环境变量，仅经 ① 写入；输入灵感点展开 → 母稿成功生成（验证 §3）。
5. **② 创作台**：输入灵感 → 生成母稿（离线或 LLM）→ 编辑 markdown 保存 → `GET /api/v1/master` 可见。
6. **③ 预览**：选 wechat + xiaohongshu → 文章 HTML 与卡片 HTML 实时渲染；点「导出 PNG」→ SSE 进度 → 产出 `*.png`（验证 Playwright 在打包态可用）。
7. **④ 看板**：对母稿执行 publish（draftOnly）→ 看板出现 success/draft 状态 + 预览链接；**kill sidecar 模拟异常** → 看板显示 failed 且可 retry。
8. **退出**：退出应用 → sidecar 进程随之终止（无孤儿进程，`pgrep -f engine-server` 为空）。

**完成定义**：以上 8 步全过 + 验收标准（§6）满足 + 回归率为零，本 Spec 交付完成。

---

## 11. 决策留痕与活规格维护

- **ADR-001** 承载模型 = Node Sidecar + 本地 HTTP（否决 webview/Rust 重写）。
- **ADR-002** 密钥明文不离开 sidecar（故意缺失明文端点）。
- **ADR-003** 预览与导出分离（Playwright 仅导出 PNG）。
- **ADR-004** 技术栈版本锚定（见 §8，全部以锁文件为准）。
- **D1/D2/D3/S1/S2/S3** 见 §0.4 锁定表，实现中不可推翻。
- 实现若与本文冲突，**先改本 Spec 再改代码**；被证伪约束显式修正，不作废不隐瞒。

---

*本文件取代 `GUI_Architecture_v0.1.md` 与 `GUI_Design_v0.1.md` 作为 Phase 3 实现的唯一契约来源；两份 v0.1 保留为设计依据。*
