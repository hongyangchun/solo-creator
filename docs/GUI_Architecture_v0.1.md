# SoloCreator Content OS - Tauri 桌面端应用技术架构文档 (v0.1)

> 状态：草案（架构设计阶段，未进入实现）
> 作者：首席架构师 - 高见远
> 日期：2026-08-20
> 范围：仅出架构设计，不产出实现代码
> 关联文档：`docs/SPEC.md`、`docs/LLD_01~07_*`、`docs/SoloCreator_Modular_Architecture_PRD_and_Design.md`

---

## 0. 版本锚定与范围声明（防幻觉基线）

### 0.1 引擎已安装依赖（实测版本，来自 `node_modules`，非 package.json 声明范围）

| 包 | 声明范围 | 实测安装版本 | 备注 |
|----|----------|--------------|------|
| better-sqlite3 | ^9.6.0 | **9.6.0** | 原生模块，需按平台编译/预编译 |
| playwright | ^1.44.0 | **1.62.1** | 声明与实测不一致，打包须以 1.62.1 为准 |
| commander | ^12.1.0 | **12.1.0** | CLI 框架 |
| handlebars | ^4.7.8 | **4.7.9** | 模板（卡片 HTML 即用其渲染逻辑） |
| dotenv | ^16.4.5 | 16.4.x | 环境变量 |
| typescript | ^5.4.5 | **5.9.3** | 引擎编译 |
| tsx | ^4.15.0 | 4.x | dev 运行器 |
| vitest | ^1.6.0 | 1.6.x | 测试 |

> 注：用户需求中称 playwright 为 `^1.44.0`，但当前锁文件实际解析为 **1.62.1**。本架构所有涉及 Playwright 的打包、浏览器下载、版本锁定均以 **1.62.1** 为准，避免按 1.44 的 API 行为做假设。

### 0.2 引擎模块边界（不重写，仅承载）

| 模块 | 职责 | GUI 是否直接调用 |
|------|------|------------------|
| `SQLiteStorage` | 本地 SQLite 持久化（母稿/分发/分析） | 否（经引擎 HTTP） |
| `LocalKeyVault` | AES-256-GCM 密钥保险箱 | 否（仅引擎内访问，详见 §5） |
| `MasterContentService` | 母稿生成 + 去 AI 味质检 | 否（经引擎 HTTP） |
| `TranspilerMatrix` | 母稿 → 多端 Payload | 否（经引擎 HTTP） |
| `CardRenderer` | Playwright 渲染 3:4 视网膜卡片 PNG | 否（经引擎 HTTP） |
| `PublisherRegistry` + 驱动 | 多端草稿直塞 | 否（经引擎 HTTP） |
| `Notifier` | 飞书/控制台通知 | 否（引擎内部） |

### 0.3 本次范围（in-scope）

- Tauri(Rust 壳) 承载现有 TS 引擎的架构方案
- ① 密钥/配置中心 ② 母稿创作台 ③ 多端实时预览 ④ 发布状态看板 的页面/路由/数据流
- 锁定技术栈（含版本）、目录结构、关键风险与对策

### 0.4 明确不做（out-of-scope，杜绝镀金）

- 不重写引擎任何业务逻辑，不把引擎移植到 Rust/WASM
- 不做账号体系、云端同步、团队协作（本地优先）
- 不做 v2 复盘/分析页的数据回采（`post_analytics` 表已建但未写入，留待 v2）
- 不做 macOS/Windows/Linux 三端全量签名证书配置（仅在风险中给出路径）
- 不在此文档产出任何实现代码

---

## 1. 宿主承载方案

### 1.1 约束前提

Tauri 的 webview 是系统浏览器内核（WKWebView / WebView2 / WebKitGTK），**本质是浏览器环境，无法加载 Node 原生模块（`.node`）**，也不能直接 `require('playwright')`。而引擎强依赖 `better-sqlite3`（原生）与 `playwright`（需下载 Chromium）。因此「把引擎塞进 webview」在物理上不可行，必须把引擎留在 Node 运行时中。

### 1.2 候选方案对比

| 方案 | 描述 | 原生模块 | Playwright | 状态/重入 | 改写量 | 结论 |
|------|------|----------|------------|-----------|--------|------|
| **A. Node Sidecar + 本地 HTTP 服务** | 引擎打包为常驻 Node 进程，监听 `127.0.0.1`，Tauri 启动期拉起，前端经 IPC/HTTP 调用 | 原生，留在 Node | 原生，留在 Node | 常驻、有状态、快 | 引擎加一个 HTTP 传输层 | **推荐** |
| B. Rust command 每次 spawn Node 脚本 | 每个 GUI 操作 `Command::new("node").arg("engine.js").arg(...)` 短生命周期进程 | 原生，每次重新加载 | 每次重新启动浏览器 | 无状态、慢、进程抖动大 | 小 | 否决（见下） |
| C. 引擎编译进 webview 运行 | 把 TS 编译成浏览器 JS 在 webview 跑 | **不可行** | **不可行** | - | 重写 | 否决 |
| D. 引擎移植 Rust/WASM | 用 Rust 重写或 WASM 化 | 可，但代价极高 | WASM 无 Playwright | - | 重写 | 否决（违反不重写） |
| E. 引擎作为库被 Tauri Rust 直接 `napi` 调用 | 用 napi-rs 把引擎编译成 `.node` 供 Rust 调 | 需 napi 改造 | 需 napi 改造 | 中 | 大 | 暂缓（v2 优化项） |

**方案 B 否决理由**：母稿创作台是强状态、多步交互（写→预览→改→再预览），每次 spawn 进程要重新 `require` 原生模块 + 重连 SQLite + 重启 Playwright 浏览器，单次操作延迟高、进程抖动大，且无法在进程间保持内存态（如未保存的母稿草稿）。不适合 MVP。

### 1.3 推荐方案：A — Node Sidecar + 本地 HTTP 服务

```
┌──────────────────────────────────────────────────────────────┐
│  Tauri 应用 (单进程, Rust + WebView)                            │
│                                                                │
│  ┌──────────────┐   invoke() IPC    ┌───────────────────────┐ │
│  │ React 前端   │ ───────────────▶ │ Tauri Rust 主进程      │ │
│  │ (WebView)    │                   │ - 应用级命令           │ │
│  │              │                   │   (文件选择/打开URL/   │ │
│  │ Zustand +    │                   │    健康检查/更新)      │ │
│  │ TanStack Q.  │                   │ - Sidecar 生命周期管理 │ │
│  └──────────────┘                   │ - 引擎请求代理(可选)   │ │
│           │                        └──────────┬────────────┘ │
│           │ 直接 fetch 127.0.0.1 (推荐路径)    │ 启动/守护     │
│           ▼                                    ▼              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 引擎 Sidecar (Node 20 常驻进程)                         │  │
│  │  engine-server.js (新增, 薄传输层)                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐  │  │
│  │  │SQLiteStorage│ LocalKeyVault│Transpiler│CardRenderer │  │  │
│  │  │(better-   │ │AES-256-GCM│Matrix  │(Playwright) │  │  │
│  │  │ sqlite3)  │ │(仅引擎内) │        │             │  │  │
│  │  └──────────┘ └──────────┘ └────────┘ └─────┬───────┘  │  │
│  │  PublisherRegistry + 多驱动 + Notifier        │          │  │
│  └──────────────────────────────────────────────┼─────────┘  │
└──────────────────────────────────────────────────┼──────────┘
                                           Chromium (仅导出 PNG)
```

**拉起时序**：
1. 应用启动 → Rust `setup` 钩子通过 `tauri-plugin-shell` 的 `Command::new_sidecar("node")` 启动 `engine-server.js`，绑定 `127.0.0.1: <端口>`（端口从空闲端口获取或固定，写入应用状态）。
2. Rust 做健康检查（`GET /api/v1/health`），就绪前前端显示「引擎启动中」。
3. 前端（React）通过两种可选路径访问引擎（见 §5 决策点）：
   - **推荐主路径**：前端直接 `fetch('http://127.0.0.1:PORT/...')`，Tauri CSP 放行该 connect-src。
   - **加固路径**：前端 `invoke('engine_request', …)`，由 Rust 代理转发到 sidecar（前端不感知端口、免 CORS）。
4. 应用退出 → Rust 在 `on_exit` 向 sidecar 发 `SIGTERM` 并等待退出。

---

## 2. 前端 ↔ 引擎边界（调用契约）

### 2.1 边界原则

- **引擎是单一事实源（single source of truth）**：所有持久化状态在 SQLite，前端只持有镜像缓存。
- **密钥保险箱只能经引擎访问**：`LocalKeyVault` 永远只在 Node sidecar 内解密；前端**永远拿不到明文**。引擎 HTTP 只暴露「写密钥值」「列密钥名+掩码末4位」「删除密钥」三类操作，无任何返回明文的端点。
- **前端不直接碰明文、不直接碰 DB 文件、不直接碰 playwright**：一切经引擎 HTTP 服务收敛。

### 2.2 引擎需新增的薄传输层（唯一引擎侧改动）

仅新增 `src/server/engineServer.ts`：用轻量 HTTP 服务（推荐 `hono ^4` 或 Node 原生 `http`）暴露下列 REST，内部复用既有服务，不改动既有逻辑。绑定 `127.0.0.1` 仅，禁止 `0.0.0.0`。

### 2.3 端点清单（契约）

版本前缀统一 `/api/v1`。

**密钥 / 配置中心（①）**
- `POST   /api/v1/secrets`            body `{key, value}` → 写入保险箱（value 不回传）
- `GET    /api/v1/secrets`            → `[{key, masked, exists}]`（仅末4位掩码）
- `GET    /api/v1/secrets/:key/masked`→ `{key, masked}`（确认用）
- `DELETE /api/v1/secrets/:key`       → 删除
- *无* `GET /api/v1/secrets/:key`（明文）—— 故意缺失，架构硬约束

**母稿创作台（②）**
- `POST   /api/v1/master`             body `{idea, topic?}` → 调 `MasterContentService` + 质检 + Hook，返回 `MasterPost`
- `GET    /api/v1/master`             → 列表（分页）
- `GET    /api/v1/master/:id`         → 详情（含 markdown / hooks / takeaways）
- `PATCH  /api/v1/master/:id`         body `{title?, masterMarkdown?}` → 保存编辑
- `DELETE /api/v1/master/:id`

**多端实时预览（③）**
- `POST   /api/v1/master/:id/transpile` body `{channels:['wechat','xiaohongshu','x','weibo']}` → 返回各端 Payload（article HTML / thread 文本 / card HTML）
- `POST   /api/v1/master/:id/card-preview` body `{theme}` → 返回卡片 HTML 字符串（供 webview 实时渲染，**不经过 Playwright**）
- `POST   /api/v1/master/:id/render`  body `{theme}` → `CardRenderer` 走 Playwright 生成 PNG，返回图片文件路径列表（导出用）

**发布状态看板（④）**
- `POST   /api/v1/master/:id/publish` body `{channels, draftOnly:true}` → `PublisherRegistry.dispatch`，返回 `PublishResult[]`
- `GET    /api/v1/master/:id/dispatch`→ 该母稿各渠道分发记录
- `GET    /api/v1/dashboard`          → 聚合看板（母稿 × 渠道 × 状态）
- `POST   /api/v1/dispatch/:id/retry` → 失败重试

**长任务进度（render/publish）**
- `GET    /api/v1/jobs/:id/stream`    → SSE 进度流（渲染百分比、发布逐渠道结果），前端用 `EventSource` 订阅

**健康检查**
- `GET    /api/v1/health`             → `{status:'ok', version:'0.1.0'}`

### 2.4 统一响应形状

```jsonc
{ "code": 0, "data": {}, "message": "" }   // 0=成功, 非0=错误码
```
错误码：401=未配置密钥 / 409=幂等跳过 / 422=参数错误 / 500=引擎内部（含 Playwright 启动失败明细）。

---

## 3. 页面 / 路由清单

采用单窗口 + 左侧导航（或顶部 Tab）的多视图结构，路由为前端路由（React Router），不依赖多窗口。

| 路由 | 名称 | 对应 v1 范围 | 核心交互 |
|------|------|--------------|----------|
| `/settings/secrets` | 密钥 / 配置中心 | ① | 列出密钥（掩码）、新增/编辑/删除、按平台分组（微信/DeepSeek/X/小红书/飞书）展示「已配置/未配置」状态 |
| `/studio` | 母稿创作台 | ② | 灵感输入 → 生成母稿 → 编辑 markdown → 查看 Hook 候选与去 AI 味得分 |
| `/preview/:masterId` | 多端实时预览 | ③ | 选择渠道 + 主题（minimal_dark / notion_light）→ 文章 HTML / 连推文本 / 卡片 HTML 实时预览 → 一键导出 PNG |
| `/dashboard` | 发布状态看板 | ④ | 母稿 × 渠道矩阵，状态徽标（pending/success/failed/draft），预览链接、失败重试、一键发布草稿 |
| `/retro` | v2 复盘 / 分析 | v2（本期仅占位） | 读取 `post_analytics` 做表现复盘；v1 仅展示「规划中」空态，数据回采留 v2 |

导航图标（**SVG 图标库锁定 lucide-react 0.510.0，严禁 emoji 图标**，见 §7）。

---

## 4. 状态管理与数据流

### 4.1 分层

- **服务端状态（Server State）**：所有来自引擎的数据（母稿列表/详情、转译结果、分发状态、密钥掩码）。用 **TanStack Query** 管理：查询 = `useQuery` 调引擎端点；变更 = `useMutation` 调引擎端点并在成功后 `invalidateQueries` 重新同步。
- **客户端/UI 状态（Client State）**：当前选中的渠道、主题、编辑中的草稿文本、激活路由、侧栏折叠。用 **Zustand** 管理，保持原子化、不存业务数据。
- **事实源**：引擎 SQLite。`post_analytics` 等未写入字段本期不展示。

### 4.2 数据流（以「母稿 → 预览 → 发布」为例）

```
用户输入灵感
  │ (useMutation POST /master)
  ▼
引擎 MasterContentService 生成 + 质检
  │ 返回 MasterPost
  ▼
TanStack Query 缓存 master 详情 → 创作台渲染
  │ 用户点「预览多端」
  ▼
POST /master/:id/transpile {channels}
  │ 返回各端 Payload
  ▼
预览页按渠道渲染：
  - wechat  → 沙箱化 HTML 预览（用文章 HTML 字符串）
  - x       → 连推文本组件
  - xiaohongshu → card-preview 返回的卡片 HTML 在 webview 响应式渲染（实时）
  │ 用户点「导出卡片 PNG」
  ▼
POST /master/:id/render {theme}  → SSE 进度 → CardRenderer(Playwright) 写 PNG → 返回路径
  │ 用户点「发布草稿」
  ▼
POST /master/:id/publish {channels, draftOnly:true}
  │ SSE 逐渠道结果
  ▼
invalidateQueries(['dashboard']) → 看板刷新状态徽标
```

### 4.3 实时性

- 预览/转译为同步请求（毫秒~秒级），无需推送。
- 导出/发布为长任务，引擎通过 SSE（`/jobs/:id/stream`）推进度，前端 `EventSource` 订阅后更新 Zustand 进度态，完成后 `invalidateQueries` 同步看板。
- 看板不做全局轮询；仅在进入 `/dashboard` 时查询一次，操作后 invalidate。

---

## 5. 前端 ↔ 引擎通信路径（决策点 D1，需用户拍板）

- **推荐主路径：前端直连 `127.0.0.1` 引擎 HTTP**。理由：零 Rust 代理样板、标准 `fetch` + TanStack Query 即可、延迟最低。代价：Tauri CSP 需放行 `connect-src http://127.0.0.1:PORT`，引擎需返回 `Access-Control-Allow-Origin` 允许 Tauri 源（因绑定 127.0.0.1，CORS 用 `*` 可接受）。
- **加固路径：Rust `engine_request` 代理**。前端只 `invoke()`，Rust 持端口并转发。代价：多一跳 + 一个代理命令；收益：前端完全不感知网络、CSP 无需放行出站、密钥边界更硬。

> 两者引擎侧完全一致，仅前端调用方式不同，可后期无痛切换。本文档按「推荐主路径」设计，并在风险中给出加固路径的切换成本。

---

## 6. 锁定技术栈表（含实际版本号）

| 层 | 技术 | 锁定版本 | 说明 |
|----|------|----------|------|
| 前端框架 | React + React DOM | **18.3.1** | 与 Tauri v2 兼容稳定 |
| 前端路由 | react-router-dom | **6.30.x**（^6.28） | 单窗口多视图 |
| 构建/Dev | Vite | **6.3.5** | Tauri v2 用 `@tauri-apps/cli`，**不用** vite-plugin-tauri（那是 v1 方案，已废弃） |
| Vite React 插件 | @vitejs/plugin-react | **4.7.0** | |
| 类型系统 | TypeScript | **5.9.3**（与引擎一致） | |
| Tauri 核心 (Rust) | tauri | **2.11.1** | Cargo.toml，最新稳定（2026-05） |
| Tauri CLI (npm) | @tauri-apps/cli | **2.11.0** | 须与 core 同 2.11.x |
| Tauri JS API | @tauri-apps/api | **2.11.0**（^2.11，与 CLI lockstep） | IPC / dialog / fs / shell / process / updater |
| Tauri 插件 (Rust) | tauri-plugin-shell / -dialog / -fs / -opener / -process / -updater | **2.x**（与 core 锁步，Cargo `"2"`） | sidecar 拉起 / 文件选择 / 打开URL / 更新 |
| Tauri 插件 (JS) | @tauri-apps/plugin-shell | **^2.3.0** | |
| | @tauri-apps/plugin-dialog | **^2.3.3** | |
| | @tauri-apps/plugin-fs | **^2.4.2** | |
| | @tauri-apps/plugin-opener | **^2.5.0** | |
| | @tauri-apps/plugin-process | **^2.3.0** | 更新后重启 |
| | @tauri-apps/plugin-updater | **^2.9.0** | 自动更新 |
| UI 组件库 | Radix UI Primitives + shadcn/ui 模式 | Radix **^1.1.x** | 无样式原语 + Tailwind 主题化；视觉由设计师定 |
| 样式方案 | Tailwind CSS | **4.1.6** | v4 为 CSS-first 配置（`@import "tailwindcss"` + `@theme`），**无 tailwind.config.js** |
| 客户端状态 | Zustand | **5.0.4** | |
| 服务端状态 | @tanstack/react-query | **^5.62.0** | 引擎 HTTP 调用 |
| 图标库（P0 锁定） | lucide-react | **0.510.0** | **SVG 图标，严禁 emoji 图标方案** |
| 引擎 | @solo-creator/content-os | **0.1.0** | 既有 TS 引擎 |
| 引擎原生模块 | better-sqlite3 | **9.6.0** | 随 sidecar 打包，需匹配 Node ABI |
| 引擎浏览器 | playwright | **1.62.1** | 随 sidecar 打包，需下载 Chromium |
| 引擎其它 | commander 12.1.0 / handlebars 4.7.9 / dotenv 16.4.x | 实测版本 | |
| 随附 Node 运行时 | Node.js | **20 LTS (20.18.x)** | 锁定以匹配 better-sqlite3 预编译与 playwright |

---

## 7. 关键风险与对策

### R1. 原生模块 better-sqlite3 打包（高）
- **风险**：sidecar 必须自带 Node 运行时 + 原生 `.node`；若 Node 版本与 better-sqlite3 预编译 ABI 不匹配，启动即崩溃。
- **对策**：① 锁定 Node 20 LTS，CI 用同版本构建；② 构建期执行 `npm rebuild better-sqlite3 --build-from-source` 或在目标平台用预编译；③ 启动自检：sidecar 启动后 `GET /health` 失败则前端提示「引擎启动失败：原生模块」，并记录 `ldd`/缺失 lib 信息。

### R2. Playwright 在打包后渲染卡片（高）
- **风险**：Chromium 需预先下载（~150MB），且 Linux 依赖系统库（libnss3 等）；macOS 上 Playwright 拉起的 Chromium 可能触发 Gatekeeper 拦截。
- **对策**：① 构建期 `npx playwright install chromium --with-deps`（Linux 装系统依赖），并将浏览器置于可随包分发的路径，运行期设 `PLAYWRIGHT_BROWSERS_PATH`；② **架构降依赖**：实时预览走 webview 渲染卡片 HTML（§2.3 `card-preview`），Playwright 仅用于「导出 PNG」这一低频动作，缩小故障面；③ macOS 用 `uses思维导图` 不对——改为：对打包的 Chromium 做 ad-hoc 签名/`xattr -cr` 处理，或允许用户在「导出」失败时提示手动安装浏览器。

### R3. 密钥安全（高，决策点 D2）
- **现状隐患**：`LocalKeyVault` 用 `USER:arch:platform` 经 PBKDF2 派生主密钥，**未要求用户口令**，同机任何人可派生出同一密钥解密保险箱。
- **对策（本期最小改动）**：保持引擎内解密，前端永不拿明文（已锁死）。**是否升级保险箱强度为决策点 D2**：
  - 选项 a（维持）：沿用机器指纹派生，开箱即用、无解锁步骤，但同机不安全。
  - 选项 b（推荐 hardening）：应用启动增加「保险箱解锁」步骤，用户口令 + 机器指纹共同派生主密钥（或接入系统钥匙串 `@tauri-apps/plugin-...`/keyring）。GUI 在解锁前隐藏 ① 页明文编辑入口。
- 无论 a/b，明文绝不离开 sidecar。

### R4. 自动更新（中，决策点 D3）
- **风险**：应用内含 Node sidecar + Playwright 浏览器，体积大；Tauri `tauri-plugin-updater` 默认更新的是 Rust 二进制 + 前端资源，**不含 sidecar/node_modules/浏览器**。
- **对策**：① 本期将 sidecar + node + 浏览器作为 Tauri 资源（`src-tauri/resources/`）随主包分发，更新器整体替换；② 接受更新包较大（估算 macOS 包 80~150MB）；③ 备选：sidecar 首次启动按需下载（减小主包，但增加首启复杂度）。策略选型见 D3。

### R5. CSP / CORS（中，仅主路径）
- **风险**：若选 §5 主路径（前端直连 127.0.0.1），Tauri 默认 CSP 会拦截出站 fetch。
- **对策**：`tauri.conf.json` 的 `app.security.csp` 增加 `connect-src http://127.0.0.1:PORT`；引擎 HTTP 设 `Access-Control-Allow-Origin` 允许 Tauri 源。若选加固路径则无需此配置。

### R6. Tailwind v4 配置范式（低，已知坑）
- **风险**：v4 废弃 `tailwind.config.js` 与 `@tailwind` 指令，改用 `@import "tailwindcss"` + CSS `@theme`；按 v3 写法会静默无效。
- **对策**：以 v4 文档为准，设计令牌在 `@theme` 中声明；设计师与前端须同步此变更。

### R7. Tauri v2 插件体系（低，已知坑）
- **风险**：v2 用 `@tauri-apps/cli` + 独立 `tauri-plugin-*`（Rust crate + npm 包成对），`vite-plugin-tauri`（v1）已废弃；sidecar 需用 `tauri-plugin-shell` 的 `new_sidecar`。
- **对策**：脚手架以 `npm create tauri-app@latest` 的 `react-ts` 模板起步，手动加 shell/dialog/fs/opener/process/updater 插件，不使用任何 v1 插件写法。

---

## 8. 目录结构提案

采用 **pnpm workspace 单仓库**：引擎作为 `packages/engine`，GUI 作为 `packages/gui`（含 `src-tauri/` + `src/`）。引擎经 workspace 被 GUI 引用，sidecar 构建产物落地到 `packages/gui/src-tauri/binaries/`。

```
solo-creator/                         # 仓库根 (private, pnpm workspace)
├── package.json                      # workspace 根: { "private": true, "workspaces": ["packages/*"] }
├── pnpm-workspace.yaml
├── packages/
│   ├── engine/                       # 既有 @solo-creator/content-os (仅新增薄层)
│   │   ├── src/
│   │   │   ├── cli/index.ts          # 既有 CLI (不变)
│   │   │   ├── server/
│   │   │   │   └── engineServer.ts   # 【新增】HTTP 传输层, 复用既有服务
│   │   │   ├── storage/  critic/  transpiler/  renderer/  publisher/  llm/  notifier/  types/  exports/  index.ts
│   │   │   └── ...
│   │   ├── package.json              # 新增 "bin": { "solo-engine": "dist/server/engineServer.js" }
│   │   └── tsconfig.json
│   └── gui/                          # Tauri 桌面应用
│       ├── index.html
│       ├── vite.config.ts
│       ├── package.json              # 前端依赖见 §6
│       ├── src/                      # React 前端
│       │   ├── main.tsx
│       │   ├── App.tsx               # 路由 + 布局
│       │   ├── routes/
│       │   │   ├── SettingsSecrets.tsx     # ①
│       │   │   ├── Studio.tsx              # ②
│       │   │   ├── Preview.tsx             # ③
│       │   │   ├── Dashboard.tsx           # ④
│       │   │   └── Retro.tsx              # v2 占位
│       │   ├── lib/
│       │   │   ├── engineClient.ts        # fetch 封装 (base URL 来自 Rust/常量)
│       │   │   ├── queries.ts              # TanStack Query hooks
│       │   │   └── types.ts               # 与引擎契约对齐的类型
│       │   ├── store/                     # Zustand
│       │   │   └── uiStore.ts
│       │   └── components/                # Radix + Tailwind, lucide-react 图标
│       └── src-tauri/                     # Rust 壳
│           ├── Cargo.toml                 # tauri 2.11.1 + 插件
│           ├── tauri.conf.json            # 窗口/CSP/sidecar 声明/更新配置
│           ├── build.rs
│           ├── binaries/                  # 【构建产出】node 二进制 + engine-server.js + node_modules
│           │   ├── node-{target-triple}   # sidecar: 随附 Node 运行时
│           │   └── resources/             # better-sqlite3 预编译 + playwright 浏览器
│           └── src/
│               ├── main.rs
│               ├── setup.rs               # 拉起 sidecar + 健康检查
│               ├── commands.rs            # 应用级命令 + (可选) engine_request 代理
│               └── state.rs               # 持有引擎 base URL / 进程句柄
```

### 8.1 Sidecar 构建要点
- `packages/engine` 用 `esbuild` 打包 `engineServer.ts` → 单文件 `engine-server.js`（bundle 既有服务，external `better-sqlite3`/`playwright` 留在 node_modules）。
- CI 按目标平台拷贝：Node 20 二进制（命名 `node-<triple>` 供 `new_sidecar`）、`engine-server.js`、含原生模块的 `node_modules`、`playwright` 浏览器，落地到 `src-tauri/binaries/`。
- `tauri.conf.json` 的 `bundle.externalBin` 声明 sidecar；`tauri-plugin-shell` 在 `setup` 中以 `Command::new_sidecar("node").args(["<resources>/engine-server.js"])` 启动。

---

## 9. 端到端验证步骤（架构可验收性）

虽未实现，架构须能回答「怎么从头证明它可用」：

1. `pnpm install && pnpm -F engine build && pnpm -F gui tauri dev`
2. 应用启动 → 观察 Rust 日志 sidecar 拉起；前端「引擎启动中」在 `GET /health` 就绪后消失。
3. ① 配置中心：写入 `DEEPSEEK_API_KEY=test_value` → 列表出现该 key 且掩码为 `********st_value`；确认「无明文返回」（`GET /api/v1/secrets/DEEPSEEK_API_KEY` 返回 404/拒绝）。
4. ② 创作台：输入灵感 → 生成母稿（离线或 LLM）→ 编辑 markdown 保存 → `GET /api/v1/master` 可见。
5. ③ 预览：选 wechat + xiaohongshu → 文章 HTML 与卡片 HTML 实时渲染；点「导出 PNG」→ SSE 进度 → 产出 `*.png` 文件（验证 Playwright 在打包态可用）。
6. ④ 看板：对母稿执行 publish（draftOnly）→ 看板出现 success/draft 状态 + 预览链接；kill sidecar 模拟异常 → 看板显示 failed 且可 retry。
7. 退出应用 → sidecar 进程随之终止（无孤儿进程）。

---

## 10. 待用户拍板的架构决策点

**D1 — 前端 ↔ 引擎通信路径（§5）**
- 推荐：前端直连 `127.0.0.1` 引擎 HTTP（零 Rust 代理、低延迟）。
- 备选：Rust `engine_request` 代理（前端不感知端口、CSP 更严）。
- 影响：开发量、CSP 配置、密钥边界硬度。

**D2 — 密钥保险箱强度（§R3）**
- 选项 a：维持现状（机器指纹派生，无解锁步骤，同机不安全）。
- 选项 b（推荐 hardening）：增加「保险箱解锁」口令步骤，或接入系统钥匙串。
- 影响：是否需要在 GUI 增加解锁流程与 `① 页` 的可见性门控。

**D3 — 自动更新策略（§R4）**
- 选项 a：sidecar + Node + 浏览器整体随主包分发，更新器整体替换（包大但简单）。
- 选项 b：sidecar 首次启动按需下载（主包小但首启复杂）。
- 影响：包体积、首启体验、更新器实现复杂度。

> 以上三项确定后，本架构文档 v0.2 将固化为可执行 Spec（点名文件/接口/构建命令），进入实现阶段。

---

## 附录 A. 关键决策记录（ADR 摘要）

- **ADR-001 承载模型 = Node Sidecar + 本地 HTTP**：否决 webview 内运行与 Rust 重写；理由为原生模块与 Playwright 物理约束 + 不重写引擎原则。
- **ADR-002 密钥明文不离开 sidecar**：在所有引擎端点中故意缺失「返回明文密钥」接口，作为架构硬约束。
- **ADR-003 预览与导出分离**：实时预览用 webview 渲染卡片 HTML，Playwright 仅用于导出 PNG，压缩原生故障面。
- **ADR-004 技术栈版本锚定**：Tauri 2.11.x / React 18.3.1 / Tailwind 4.1.6 / lucide-react 0.510.0 / better-sqlite3 9.6.0 / playwright 1.62.1（实测版本），全部以锁文件为准。
