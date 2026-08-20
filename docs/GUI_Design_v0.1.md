# SoloCreator Content OS — 桌面 GUI 设计文档 v0.1

> 文档类型：GUI 设计契约（设计阶段，无实现代码）
> 生成日期：2026-08-20 ｜ 设计师：颜好看 ｜ 依据：`SPEC.md` v1.0.0 + `SoloCreator_Modular_Architecture_PRD_and_Design.md` (PRD v3.0) + 7 篇 LLD
> 寄存器判定：**Product Register（设计服务产品）**——母稿/预览/看板是工具界面，标杆是「专业可信、赢得熟悉感」（Linear / Raycast / Notion / Arc 用户觉得"这是我的工作台"），而非营销惊艳。
> 三轴刻度：`DESIGN_VARIANCE=5`（偏移但克制）｜`MOTION_INTENSITY=4`（功能性微交互为主）｜`VISUAL_DENSITY=5`（日常应用密度）

---

## 0. 设计取舍预告（请用户拍板，详见文末 §10）

本设计已锁定一组自洽的默认决策。以下 3 点是最值得你亲自拍板的取舍：

1. **默认主题方向**：建议「浅色纸感优先 + 完整深色模式」。备选「纯深色工作台优先」。内容创作工具长时间写作，纸感浅色更护眼；但"创作 OS / 监控看板"又有深色气质。两者都做了完整 Token，只是默认显示谁。
2. **品牌主色**：建议「墨青 Teal `#0D9488`」——冷静、专注、区别于默认的 AI 蓝/靛紫/紫粉，且不踩 P0 红线。备选「墨黑 + 暖琥珀」或「墨青 + 珊瑚红 CTA」。
3. **母稿创作台布局 & 落地页**：建议「三栏工作台（灵感/输入 · 编辑器 · 质检+Hook）」作为应用启动默认页；v1 是否在导航保留「数据复盘」占位入口（v2 才实装）也请确认。

---

## 1. 产品信息架构（窗口 / 页面树）

> 桌面窗口（Tauri）采用 **左侧常驻导航 + 主内容区 + 可选右栏上下文面板** 的"工作台"范式。导航四级模块对应需求 ①②③④。

```
SoloCreator Content OS  (窗口标题栏：拖拽区 + 最小化/全屏/关闭 + 全局 ⌘K 命令面板入口)
│
├── ① 密钥 / 配置中心  (Key & Config Center)            [图标: key-round]
│   ├── 凭据保险箱 (Key Vault)          — LocalKeyVault (vault.enc, AES-256-GCM)
│   │   ├── 微信公众平台 (AppID / AppSecret)
│   │   ├── DeepSeek API Key            — 当前走环境变量，本页统一接管
│   │   ├── X (Twitter) API             — key/secret/token/secret
│   │   ├── 小红书 / 微博               — CDP/CLI 运行状态（无密钥，仅连通性）
│   │   └── 飞书通知 Webhook
│   ├── 模型与质检 (LLM & Critics)
│   │   ├── 默认 LLM 提供方 (DeepSeek / Ollama 离线降级)
│   │   └── 质检规则链 (humanizer-zh / ad-compliance / hook-strength) + 质量门禁阈值
│   ├── 渠道与驱动 (Channels & Drivers)
│   │   └── 每渠道 driver 策略 (auto / api / cdp / cli) + 自动降级优先级
│   └── 全局偏好 (Preferences)
│       ├── 主题 (Light / Dark)  ·  雷达调度 (cron, minLikes)  ·  通知免打扰时段
│
├── ② 母稿创作台  (Master Draft Studio)   [默认启动页]      [图标: pen-line]
│   ├── 灵感收件箱 (Inspiration Inbox)    — radar_items (X 高赞雷达 / 手动输入 / Obsidian 导入)
│   ├── 母稿编辑器 (Master Editor)        — 核心三栏：输入 · 编辑器 · 质检+Hook
│   └── 母稿库 (Master Library)          — master_posts (draft / transpiled / archived)
│
├── ③ 多端实时预览  (Multi-channel Live Preview)            [图标: monitor]
│   ├── 转译 (Transpile)                 — 选定母稿 + Hook + 主题 → 4 类交付物
│   │   ├── 微信公众号 (Article HTML)      [theme: notion_light]
│   │   ├── 小红书 (3:4 Card Flow PNG)     [theme: minimal_dark / notion_light]
│   │   ├── X / Twitter (Thread ≤280 字/条)
│   │   └── 微博 (Short Text)
│   └── 预览台 (Preview Studio)          — 并排/分页真实渲染，逐项核对
│
└── ④ 发布状态看板  (Publish Status Board)                 [图标: layout-dashboard]
    ├── 草稿箱分发状态 (Dispatch Board)   — channel_dispatches (pending/in_progress/drafted/failed)
    ├── 一键发布 (One-click Publish)      — draftOnly 安全界 + 人工终审确认
    ├── 通知中心 (Notifications)          — 飞书卡片 / 桌面原生通知历史
    └── 数据复盘 (Analytics)             — v2 占位骨架（post_analytics 表已存在，v1 仅入口）
```

**导航规则**
- 一级导航固定 4 项（①②③④）+ 顶部全局命令面板（⌘K）+ 右侧"当前母稿上下文"面板（在 ②③ 自动展开）。
- 每个模块内的子页用「面包屑 + 子标签（Tab）」切换，不新增侧栏层级（避免 >5 项认知过载）。
- 状态可见性：导航项右上角用小圆点（status pill）显示全局健康度——如密钥未配置(琥珀)、发布中有失败(红)、飞书未连(灰)。

---

## 2. 核心用户流（基于真实引擎能力，无虚构功能）

### 2.1 主流程：配置密钥 → 创作母稿 → 多端预览 → 一键发布

```
[① 配置密钥] ──► [② 创作母稿] ──► [③ 多端预览] ──► [④ 一键发布] ──► [人工终审]
     │                │                  │                  │
     │                │                  │                  └─ PublisherRegistry 探测驱动
     │                │                  │                     (api→cdp→cli 自动降级)
     │                │                  │                  └─ LoginStateGuard 扫码接管(≤120s)
     │                │                  │                  └─ DispatchLockService 幂等防重复草稿
     │                │                  │
     │                │                  └─ TranspilerTaskQueue 并发限流(≤2)
     │                │                     AC-01: 有效母稿 ≤3s 出 4 交付物
     │                │                     WeChatImageUploaderMiddleware 图片转存 CDN(防裂图)
     │                │
     │                └─ MasterContentService.expandMaster (LLM 展开)
     │                   CriticPipeline: humanizer-zh → ad-compliance → fact-checker
     │                   HookGeneratorService: 5 黄金 Hook (counter_intuitive/curiosity/
     │                                          pain_direct/story_intro/contrarian)
     │                   离线降级: 无 DEEPSEEK_API_KEY → 本地模板展开(能力降级提示)
     │
     └─ LocalKeyVault.setSecret (AES-256-GCM → vault.enc)
        状态: 已连接 / 未配置 / 离线降级
```

### 2.2 步骤级描述（创作者视角）

**步骤 1 · 配置密钥**
打开「① 密钥/配置中心 → 凭据保险箱」，逐行填入 DeepSeek / 微信 / X 等密钥 → 点击"测试连接" → `LocalKeyVault` 以 AES-256-GCM 加密落盘至 `~/.solo-creator/vault.enc`。每行右侧实时显示状态：已连接(绿) / 未配置(琥珀) / 离线降级(蓝)。未配置 DeepSeek 时，母稿编辑器顶部出现非阻塞提示条："未检测到 DeepSeek Key，将启用离线模板展开（质量降级）"。

**步骤 2 · 创作母稿**
进入「② 母稿创作台 → 灵感收件箱」，选中一条灵感（或点"新建闪念"手动输入）→ 在母稿编辑器左栏粘贴/输入原始闪念 → 点"展开母稿" → `MasterContentService` 调用 LLM 展开长文 → `CriticPipeline` 自动跑（去 AI 腔 18 组八股词 + 广告法合规 + 事实核验）→ 右栏展示 `CriticReport`（综合分 / 问题列表 / 修复建议）+ `HookGeneratorService` 产出的 5 个黄金 Hook 候选卡 → 选定 1 个主 Hook → "保存母稿"（写入 `master_posts`，状态 `draft`）。若 `overallScore < 75` 或命中违禁词，状态置 `need_manual_review` 并阻断自动转译。

**步骤 3 · 多端预览**
在母稿库选中母稿 → 进入「③ 多端实时预览 → 转译」→ 勾选渠道 + 选主题（`minimal_dark` / `notion_light`）+ 选 Hook → "生成预览" → `TranspilerTaskQueue`（并发≤2，指数退避防 429）生成 4 类交付物（AC-01 约束 ≤3s）→ 预览台真实渲染：微信长图文(HTML iframe) / 小红书 3:4 卡片流(1080×1440@2x PNG) / X 连推(逐条 ≤280 字) / 微博短动态。微信长图文经 `WeChatImageUploaderMiddleware` 转存 CDN，预览中标注"图片已换链 · 无裂图风险"。

**步骤 4 · 一键发布**
预览确认无误 → 点"一键存入草稿箱"（`draftOnly` 安全界，UI 明确文案："仅存草稿，绝不自动发布"）→ `PublisherRegistry` 按优先级探测驱动（api→cdp→cli）自动降级 → 若微信 CDP 登录态失效，`LoginStateGuard` 截取二维码弹窗 + 系统通知，轮询等待扫码(≤120s) → 各渠道分发状态经 `DispatchLockService`（幂等）实时回流「④ 发布状态看板」→ 全部草稿就绪 → 飞书卡片 / 桌面通知（含各端预览链接）→ 创作者在平台侧人工终审发布（人类保留最后 5% 扳机）。

### 2.3 异常 / 降级流（必须覆盖的状态）

| 触发 | 系统行为 | UI 表达 |
|---|---|---|
| 无 DEEPSEEK_API_KEY | 离线模板展开，质量降级 | 非阻塞提示条 + 质检分标注"离线" |
| 微信 CDP 登录失效 | 截二维码 + 轮询 120s | 模态二维码弹窗 + 倒计时 + 超时优雅报错 |
| 某渠道网络抖动失败 | DispatchLock 跳过已成功渠道，失败项可重试 | 看板该行(红) + "重试"按钮 + 错误日志折叠 |
| 转译触发 429 限流 | 指数退避重试(≤3) | 预览台骨架屏 + "限流重试中…"状态 |
| 飞书 Webhook 失效 | 降级桌面原生通知 | 通知中心标记"已降级为系统通知" |

---

## 3. 视觉设计系统（Design Token 完整定义）

> 全部颜色经 Design Token 引用，实现层零硬编码（仅 `#fff`/`#000` 字面值允许）。Token 分四层：A1-identity（品牌核心）/ A2-structure（间距圆角阴影）/ B-slot（组件别名）/ C-extension（渠道/状态扩展色）。

### 3.1 品牌定位与配色策略（Product Register）

- **风格主线**：Swiss Minimalism（瑞士极简）为底座 + Bento 信息块点缀 + Micro-interactions 微交互叠加层（约 12% 工时）。
- **色彩配比**：中性色 80–88%（纸感背景/墨色文字/暖灰边框）｜强调色（墨青）6–10%，每屏 ≤2 处可见使用｜语义色（绿/琥珀/红/蓝）2–4%｜效果色（聚焦环/光晕）<1%。
- **为什么是墨青而非 AI 蓝/紫**：避开 Tailwind 默认 `#6366F1` 与紫粉渐变（P0 红线），墨青传递"冷静专注的创作者工作台"气质，且在浅/深两套都保持高可读性与品牌辨识。

### 3.2 Token — 浅色主题（默认：warm paper）

```css
:root,
[data-theme="light"] {
  /* A1-identity */
  --bg:            #FAFAF7;   /* 暖纸白，非冷白，规避 AI 模板感 */
  --surface:       #FFFFFF;
  --surface-warm:  #F4F3EF;   /* 暖色三级面板 */
  --fg:            #1A1D1A;   /* 墨色，带极轻绿相，非纯黑 */
  --fg-2:          #3F463F;   /* 次级文字 */
  --muted:         #6B726B;   /* 三级/元数据 (对比 ≈4.6:1 达标) */
  --border:        #E7E5E1;   /* 暖灰边框，非蓝灰 */
  --border-soft:   #F0EFEB;
  --accent:        #0D9488;   /* 墨青 teal-600 */
  --accent-hover:  #0F766E;
  --accent-active: #115E59;
  --accent-on:     #FFFFFF;
  --accent-soft:   #CCFBF1;   /* teal-50 选中底 */

  /* A2-semantic */
  --success:       #16A34A;
  --warn:          #D97706;
  --danger:        #DC2626;
  --info:          #0E7490;
  --success-soft:  #DCFCE7;
  --warn-soft:     #FEF3C7;
  --danger-soft:   #FEE2E2;
  --info-soft:     #CFFAFE;

  /* C-extension: 渠道品牌色（仅用于小尺寸 glyph / 状态点，绝不做大色块） */
  --ch-wechat:     #07C160;
  --ch-xiaohongshu:#FF2442;
  --ch-x:          #1A1A1A;
  --ch-weibo:      #E6162D;
}
```

### 3.3 Token — 深色主题（warm near-black）

```css
[data-theme="dark"] {
  /* A1-identity */
  --bg:            #0E1110;
  --surface:       #161A18;
  --surface-warm:  #1C211E;
  --fg:            #E8EAE6;
  --fg-2:          #B9BEB8;
  --muted:         #808880;
  --border:        #262B28;
  --border-soft:   #1F2421;
  --accent:        #2DD4BF;   /* 深色下提亮，保持可辨 */
  --accent-hover:  #14B8A6;
  --accent-active: #0D9488;
  --accent-on:     #052E2B;   /* 亮青底上的深字 */
  --accent-soft:   #134E4A;

  --success:       #22C55E;
  --warn:          #F59E0B;
  --danger:        #F87171;
  --info:          #22D3EE;
  --success-soft:  #14331F;
  --warn-soft:     #3A2C0A;
  --danger-soft:   #3A1414;
  --info-soft:     #0A2E33;

  --ch-wechat:     #2BD47E;
  --ch-xiaohongshu:#FF5A72;
  --ch-x:          #E8EAE6;
  --ch-weibo:      #FF5A68;
}
```

### 3.4 字体（中文优先 + 等宽用于 payload/ID）

```css
--font-display: "Inter", "Noto Sans SC", -apple-system, "PingFang SC", sans-serif;
--font-body:    "Inter", "Noto Sans SC", -apple-system, "PingFang SC", sans-serif;
--font-mono:    "JetBrains Mono", "Fira Code", ui-monospace, monospace;
```
- 标题与正文同族（瑞士极简用字重建立层级，不混排衬线——Product Register 禁用衬线）。
- 等宽字体仅用于：渠道代码(`wechat`/`x`/`xiaohongshu`)、dispatch ID、字数统计(`280/280`)、JSON 配置预览。
- 字重三级：**400**（正文/说明）｜**500**（按钮/表头/小标题）｜**600**（大标题/CTA）。
- 字距：ALL CAPS 标签 `0.06em`｜标题 `-0.01em`｜正文 `0`。

### 3.5 字号阶梯（px / rem）

| Token | px | 用途 |
|---|---|---|
| `--text-xs` | 12 | 标签/徽章/元数据 |
| `--text-sm` | 13 | 辅助文字 |
| `--text-base` | 14 | 正文基准 |
| `--text-md` | 15 | 编辑器正文 |
| `--text-lg` | 18 | 三级标题 |
| `--text-xl` | 22 | 二级标题 |
| `--text-2xl` | 28 | 一级标题 |
| `--text-3xl` | 34 | 区块标题 |
| `--text-4xl` | 44 | 应用级标题（极少用） |

### 3.6 间距（4px 网格，禁止非标值）

`--space-1:4` `--space-2:8` `--space-3:12` `--space-4:16` `--space-5:20` `--space-6:24` `--space-8:32` `--space-10:40` `--space-12:48` `--space-16:64`

### 3.7 圆角（卡片上限 12–16px，禁 ≥24px 过度圆滑）

`--radius-xs:4` `--radius-sm:8` `--radius-md:12`(卡片) `--radius-lg:16`(弹窗) `--radius-xl:20`(特殊) `--radius-pill:9999`(徽章/开关)

### 3.8 阴影 / 层级（Swiss 极简：边框优先，阴影克制）

```css
--shadow-sm:   0 1px 2px  rgba(16,24,20,0.04);
--shadow-md:   0 4px 12px rgba(16,24,20,0.08);
--shadow-lg:   0 12px 32px rgba(16,24,20,0.12);
--elev-flat:   none;
--elev-ring:   0 0 0 1px var(--border);          /* 卡片默认用 ring 而非投影 */
--elev-raised: var(--shadow-md);
--focus-ring:  0 0 0 3px var(--accent-soft);     /* 键盘焦点可见环 */
```
- z-index：`base:0` `dropdown:1000` `sticky:1100` `modal:1200` `toast:1300`。
- 毛玻璃/blur 仅用于"命令面板"半透明遮罩等有功能目的的场合，不作装饰。

### 3.9 动效（禁止弹跳缓动；收敛值 180ms）

```css
--motion-fast: 120ms;   /* hover 变色 / 选中 */
--motion-base: 180ms;   /* 进入 / 抽屉 / Toast */
--motion-slow: 260ms;   /* 模态 / 跨面板 */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* 标准，无回弹 */
```
- 全量支持 `prefers-reduced-motion: reduce` → 仅保留 opacity 切换，移除位移/缩放。
- 生成流式输出（母稿展开/Hook 生成）用打字机/逐行揭示，时长跟随真实流式，不做假动画。

### 3.10 图标库锁定说明（P0：禁 emoji 图标）

- **锁定库**：Lucide Icons（`lucide-react`，SVG 描边，统一 `stroke-width:1.75`，`currentColor`）。SPEC 已锁定 `^0.380.0`。
- **尺寸**：行内 16px ｜ 按钮内 20px ｜ 独立图标 24px。全项目不混用其他图标库。
- **emoji 正则自检**：`[\x{1F300}-\x{1F9FF}\x{2600}-\x{26FF}\x{2700}-\x{27BF}]` 在产出物中必须为零（注：引擎 LLD-06 飞书卡片文本里出现的图形符号属于外部系统通知文案，非 GUI 图标；GUI 内部一律用 Lucide + 文字状态）。
- **渠道 glyph**：微信/小红书/X/微博使用 16px 单色品牌 SVG 标记（取自各品牌官方简化路径，非 emoji），颜色取自 `--ch-*` Token。

**功能 → Lucide 图标映射表**

| 功能 | 图标 | 功能 | 图标 |
|---|---|---|---|
| 密钥/保险箱 | `key-round` | 灵感收件箱 | `inbox` |
| 模型/LLM | `cpu` | 母稿编辑器 | `pen-line` |
| 质检规则 | `shield-check` | 黄金 Hook | `anchor` |
| 渠道/驱动 | `share-2` | 转译 | `shuffle` |
| 爆款雷达 | `radar` | 多端预览 | `monitor` |
| 发布/分发 | `send` | 发布看板 | `layout-dashboard` |
| 设置/偏好 | `sliders-horizontal` | 通知 | `bell` |
| 风格记忆 | `brain` | 主题切换 | `sun`/`moon` |
| 命令面板 | `command` | 新增 | `plus` |
| 搜索 | `search` | 重试 | `rotate-cw` |
| 离线降级 | `wifi-off` | 更多 | `more-horizontal` |
| 成功 | `circle-check` | 待处理 | `clock` |
| 进行中 | `loader` | 失败 | `circle-x` |

---

## 4. 组件模式（基础组件规范，禁 emoji）

> 每个交互组件覆盖 5 态：Loading / Empty / Error / Populated / Edge。按钮等另覆盖 Disabled/Active。

### 4.1 按钮 Button
| 变体 | 背景 | 文字 | 用途 |
|---|---|---|---|
| Primary | `--accent` | `--accent-on` | 主行动（保存母稿/一键发布） |
| Secondary | 透明 + 1px `--border` | `--fg` | 次行动（取消/返回） |
| Ghost | 透明 | `--accent` | 低强调（查看/折叠） |
| Destructive | `--danger` | `#fff` | 删除密钥/废弃母稿 |

- 尺寸：sm(高 32, pad 8×12) / md(高 36, pad 10×16) / lg(高 40, pad 12×20)。圆角 `--radius-sm`。
- 状态：Default / Hover(亮度变) / Active(降亮) / Focus(`--focus-ring`) / Disabled(opacity .5, 禁点) / Loading(左 16px `loader` 旋转 + 文案变"处理中…")。
- **动效**：120ms color transition，禁位移/缩放弹跳。

### 4.2 表单 / 输入 Input
- 文本输入：背景 `--surface`，1px `--border`，focus 时边框转 `--accent` + `--focus-ring`；错误态边框 `--danger` + 下方 `--danger` 文字提示（近字段，非顶部）。
- 密钥输入默认 `type=password` + 显示切换(`eye`/`eye-off`)；"测试连接"按钮内联。
- 开关 Switch：轨道 `--border`→`--accent`，禁 emoji，动效 120ms slide。
- 分段控件 Segmented（主题/渠道切换）：选中项 `--accent-soft` 底 + `--accent` 文字。

### 4.3 卡片 Card
- 背景 `--surface`，1px `--border`（`--elev-ring`），圆角 `--radius-md`(12)，内距 `--space-5`(20)。**禁 ≥24px 圆角、禁左侧彩色边条、禁渐变文字**。
- 选中态：边框转 `--accent` + 极轻 `--accent-soft` 底。Hover：边框微亮（无投影位移）。
- 用于：灵感卡 / 母稿卡 / Hook 候选卡 / 渠道交付物卡 / 分发状态卡。

### 4.4 列表 / 表格 List & Table
- 灵感收件箱、母稿库、分发看板用"行卡片 + 分隔线"混合：每行含 图标 + 标题 + 元数据(等宽) + 状态 pill + 行内操作(20px 图标)。
- 虚拟滚动：列表 >100 项启用。
- 空状态（Empty）：居中插画位(中性 SVG，非 emoji) + 引导文案 + 主行动按钮。

### 4.5 对话框 Dialog / 模态
- 圆角 `--radius-lg`(16)，`--shadow-lg`，遮罩 `rgba(16,24,20,0.4)`（深色下 `blur(2px)` 功能性毛玻璃）。
- 发布确认框（人工终审扳机）：明确展示"将存入以下渠道草稿箱（不发布）" + 渠道清单 + "确认存入"Primary / "取消"Secondary。
- 微信扫码接管：二维码区 + 倒计时(`clock`) + "请在手机端确认" + 超时错误态带重试。

### 4.6 标签 / 状态徽章 Badge & StatusPill
- 状态 pill：success(`--success-soft` 底 + `--success` 字 + `circle-check`) / pending(`--warn-soft`+`clock`) / in_progress(`--info-soft`+`loader`) / failed(`--danger-soft`+`circle-x`) / draft(中性 `--border`+`file`).
- 渠道标签：16px 品牌 glyph + 文字(微信/小红书/X/微博)，不用 emoji。

### 4.7 提示 Toast
- 右下角出现，`--surface` + `--shadow-md` + 左 20px 状态图标，3s 自动隐（error 型可手动关）。
- 类型：success(母稿已保存) / info(已降级为系统通知) / error(发布失败：渠道名+原因+重试)。

### 4.8 命令面板 Command Palette（⌘K）
- 居中浮层，输入框 + 模糊搜索动作（新建母稿 / 转译 / 发布 / 跳转配置）。Raycast/Linear 式效率入口。
- 列表项：图标 + 动作名 + 右侧快捷键提示(等宽)。

### 4.9 骨架屏 Skeleton（生成/加载态）
- 母稿展开、预览渲染时用 `--surface-warm` 块 + 缓慢微光(shimmer, 禁弹跳)占位，真实内容流式到达后替换。

---

## 5. 逐页线框描述（区域划分 + 桌面窗口响应式）

> 桌面窗口响应式（非移动端，而是窗口宽度变化）：
> - **宽屏 ≥1280px**：三栏（导航 240 + 主区 + 右栏上下文 380）。
> - **标准 960–1280px**：两栏（导航 220 + 主区），右栏改为从右侧滑出的抽屉（Drawer），点击上下文按钮唤起。
> - **窄窗 640–960px**：导航收为 64px 图标轨（icon-rail），主区全宽；右栏为全屏覆盖抽屉；母稿编辑器三栏纵向堆叠（输入→编辑器→质检）。
> - **最小窗口 900×600**（Tauri 下限）；低于则强制进入"专注模式"（仅编辑器）。
> 触摸目标最小 44×44px（即便桌面，图标按钮也保证可点区域）。

### 5.1 应用外壳 App Shell（所有页共有）

```
┌───────────────────────────────────────────────────────────────────────┐
│ [拖拽区]  SoloCreator Content OS          [search ⌘K]      [sun/moon] [bell] │ ← 标题栏(自定义，非系统按钮区)
├──────┬────────────────────────────────────────────────────────────────┤
│ 导航 │  主内容区 (Main)                                                 │
│ 240  │                                                                 │
│ ┌──┐ │  ┌─────────────────────────────────────────────────────────┐   │
│ │①│ │  │ 面包屑 / 页标题               [右栏上下文切换]           │   │
│ │②│ │  ├─────────────────────────────────────────────────────────┤   │
│ │③│ │  │                                                         │   │
│ │④│ │  │  页面专属内容                                            │   │
│ │ │ │  │                                                         │   │
│ └──┘ │  └─────────────────────────────────────────────────────────┘   │
│ ①●  │                                                                 │
│ ②   │  (② 母稿编辑器 / ③ 预览台 时，右侧自动展开上下文面板)           │
│ ③   │                                                                 │
│ ④●  │  右栏上下文面板 (Right, 380) — 仅 ②③ 显示                     │
└──────┴────────────────────────────────────────────────────────────────┘
```
状态点：① 旁红点=密钥缺失；④ 旁红点=有发布失败。导航底部："本地存储 · ~/.solo-creator/solo_creator.db" 小字 + 同步状态。

### 5.2 ① 密钥/配置中心 — 凭据保险箱

```
┌─ 密钥/配置中心 ───────────── 子标签: [凭据保险箱][模型与质检][渠道与驱动][偏好] ─┐
│                                                                              │
│  凭据保险箱                                            [+ 新增凭据]           │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 微信公众平台        AppID / AppSecret        [已连接●]  [测试][编辑] │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ DeepSeek API Key   sk-•••••••••••           [已连接●]  [测试][编辑] │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ X (Twitter) API   key/secret/token         [未配置○]  [测试][编辑] │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ 小红书 / 微博       CDP/CLI 连通性          [离线降级◐][重连]       │    │
│  ├────────────────────────────────────────────────────────────────────┤    │
│  │ 飞书通知 Webhook    https://open.feishu...  [已连接●]  [测试][编辑] │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  底栏: 所有密钥经 AES-256-GCM 加密存于 vault.enc · 明文永不落库             │
└──────────────────────────────────────────────────────────────────────────┘
```
- 编辑态：行内展开表单（密码框 + 显示切换 + 测试连接按钮）。
- Empty：首次进入显示"还没有任何密钥，从 DeepSeek 开始"引导卡。
- 响应式：窄窗下每行堆叠为卡（标签/值/状态纵向）。

### 5.3 ② 母稿创作台 — 灵感收件箱

```
┌─ 母稿创作台 ───── 子标签: [灵感收件箱][母稿库] ─────────────── [+ 新建闪念][雷达采集] ┐
│  筛选: [全部][未读][已收藏][已用]   搜索[…………]                            │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ [radar] 一人工作室是未来工作形态    X · 1.2k赞 · 痛点:效率焦虑  [未读]│ │
│  │ [inbox] 为什么 AI 写作都有股味     手动 · 收藏                     [已读]│ │
│  │ [inbox] 小红书排版总错乱           Obsidian · 短列表              [已用]│ │
│  │  ... (虚拟滚动 >100)                                                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│  空状态: [插画SVG] "灵感还空着" + [去采集 X 高赞雷达] / [手动输入]          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 5.4 ② 母稿创作台 — 母稿编辑器（核心三栏）

```
┌─ 母稿编辑器: 《一人工作室是未来工作形态》───────── 状态:[草稿] ── [保存][转译→] ┐
├───────────────┬────────────────────────────┬──────────────────────────────┤
│ 输入 / 灵感    │  母稿编辑器 (Markdown)      │  质检报告 + 黄金 Hook         │
│ (320, 左栏)    │  (flex-1, 中栏)             │  (380, 右栏上下文)           │
│               │                            │                              │
│ 原始闪念:     │  # 一人工作室是未来…       │  质检综合分                    │
│ [多行文本]    │  ## 痛点                    │  ████████░░ 86 / 100         │
│               │  你有没有发现…             │                              │
│ [展开母稿]    │  ## 机制                    │  命中问题 (3)                 │
│  (Primary)   │  ...                       │  · AI八股:"值得注意的是"→已修 │
│               │                            │  · 合规:无违禁词 达标            │
│ 离线降级提示: │  [实时预览切换]            │  · 事实:引用待核             │
│  "未检测到    │                            │                              │
│   DeepSeek    │                            │  黄金 Hook (5) — 选 1 为主    │
│   Key,离线    │                            │  ┌────────────────────────┐  │
│   模板展开"   │                            │  │① 反直觉 84 "谁说…”   ◉│  │
│  (info pill) │                            │  │② 好奇   79 "你大概率…" │  │
│               │                            │  │③ 痛点   81 "每天加班…" │  │
│               │                            │  │④ 故事   76 "我朋友…"   │  │
│               │                            │  │⑤ 逆向   72 "主流都错…" │  │
│               │                            │  └────────────────────────┘  │
└───────────────┴────────────────────────────┴──────────────────────────────┘
```
- Loading：中栏骨架屏 + 逐行打字机揭示（展开中）。
- Edge：母稿超长(>5000字) 顶部出现"内容较长，建议拆分"提示；离线时综合分旁注"离线"。
- 响应式：窄窗三栏纵向堆叠；右栏变为底部 Drawer，由"质检/Hook"按钮唤起。

### 5.5 ③ 多端实时预览 — 预览台

```
┌─ 多端实时预览: 《一人工作室…》──────── 主题:[minimal_dark▼][notion_light] [重新生成] ┐
├──────────────────────────────────────────────────────────────────────────────────┤
│ 渠道标签: [微信●][小红书●][X●][微博●]   生成状态: [4/4 完成 1.8s · 图片已换链]         │
│                                                                                  │
│ ┌─ 微信公众号 (Article HTML) ──────┐  ┌─ 小红书 (Card Flow 3:4 @2x) ──────┐     │
│ │ [iframe 渲染真实长图文]          │  │ [PNG 画廊, 视网膜]                │     │
│ │ 标题/正文/封面 真实排版          │  │ ▢ 封面 ▢ 内容1 ▢ 内容2 ▢ 总结     │     │
│ │ 字数: 1280  · 图片: 已换链      │  │ 共 4 页 · 1080×1440              │     │
│ └──────────────────────────────────┘  └──────────────────────────────────┘     │
│ ┌─ X / Twitter (Thread) ───────────┐  ┌─ 微博 (Short Text) ─────────────┐     │
│ │ 1/5  280/280 达标                   │  │ [文字预览]                      │     │
│ │ 2/5  276/280 达标                   │  │ 正文 + 话题 #一人工作室         │     │
│ │ … 尾条 Takeaway 达标               │  │ 配图: 3 张 (来自卡片流)         │     │
│ └──────────────────────────────────┘  └──────────────────────────────────┘     │
│ 底栏: [上一页][下一页] 分页浏览  ·  [↓ 导出 Markdown 镜像]  ·  [一键发布→]      │
└──────────────────────────────────────────────────────────────────────────────────┘
```
- Loading：四区各自骨架屏 + "转译中 ≤3s"。
- Error：某渠道失败 → 该区显示 `circle-x` + 原因 + [重试]，其余正常。
- 响应式：宽屏 2×2 网格；窄窗 单列纵向，分页切换。

### 5.6 ④ 发布状态看板 — 分发状态板 + 一键发布

```
┌─ 发布状态看板: 《一人工作室…》─────────────────── [一键存入草稿箱] (Primary, draftOnly) ┐
├──────────────────────────────────────────────────────────────────────────────────┤
│ 分发状态 (channel_dispatches)                                                    │
│ ┌────────────────────────────────────────────────────────────────────────────┐   │
│ │ [微信 glyph] 微信公众平台  driver:api     [已存草稿●]  draftId:mDAxxx [预览↗]│   │
│ │ [小红书 glyph] 小红书      driver:cdp    [进行中◐]    CDP 注入中…           │   │
│ │ [X glyph]    X/Twitter   driver:api     [已存草稿●]  draftId:1892xxx[预览↗]│   │
│ │ [微博 glyph] 微博        driver:cli     [失败X]      CDP超时 [重试][日志▾] │   │
│ └────────────────────────────────────────────────────────────────────────────┘   │
│ 幂等保护: 已成功渠道在重试时自动跳过 (DispatchLock)                                │
│                                                                                  │
│ 通知中心 (最近)                                                                  │
│  · 09:12 飞书卡片已发: 3/4 渠道草稿就绪 (微博失败)  [查看]                        │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ 发布确认对话框 (人工终审扳机) ────────────────────────────────────────────────┐
│  将以下渠道内容「仅存入草稿箱」，不会自动发布。你可在平台侧人工终审。            │
│  [x] 微信公众平台   [x] 小红书   [x] X/Twitter   [ ] 微博 (失败,可重试后加入)          │
│  [取消]                                    [确认存入草稿箱] (Primary)          │
└────────────────────────────────────────────────────────────────────────────────┘
```
- 微信登录失效时：对话框替换为"扫码接管"模态（二维码 + 倒计时 + 超时重试）。
- Empty：从未发布 → "还没有分发记录，先在 ② 创作一篇母稿"。
- v2 数据复盘：导航④下"数据复盘"入口存在但点击显示骨架占位："v2 将接入 post_analytics 复盘闭环"。

---

## 6. 前端技术栈提案（Tauri + React + Vite + Token 化样式）

> 用户已定 Tauri 封装。以下为 GUI 层提案，重点在"用 Token 而非硬编码"。

| 层 | 选型 | 理由 |
|---|---|---|
| 宿主壳 | **Tauri 2** | 本地优先、单文件 SQLite 友好、包体小、原生 WebView；与"数据不出本地"原则一致（用户已定） |
| UI 框架 | **React 18 + TypeScript** | 生态成熟、与引擎 TS 栈一致、组件化适合复杂工作台 |
| 构建 | **Vite** | 快冷启/HMR，Tauri 官方集成顺畅 |
| 样式 | **Tailwind CSS v4 + CSS 变量** | 通过 `@theme` 把 `design-tokens.css` 的变量映射为工具类，**实现层零硬编码颜色**；满足 P0-4。所有 `bg-*`/`text-*` 指向 token，禁止裸 hex |
| 组件层 | **自建 + Radix UI 原语** | Dialog/Tabs/Switch 用 Radix（无障碍内置），视觉套 Token；保持 Lucide 图标统一 |
| 图标 | **lucide-react**（锁定） | SPEC 已锁 `^0.380.0`，SVG 描边、尺寸 16/20/24、禁 emoji |
| 状态 | **Zustand**（轻）+ **TanStack Query** | 异步（转译/发布）用 Query 管 loading/error/retry；本地状态用 Zustand |
| 预览渲染 | **复用引擎 Playwright**（PNG 卡片）+ **沙箱 iframe**（微信 HTML） | 不重复造渲染；卡片流直接读 `assets/cards/*.png`，长图文用 `sandbox` iframe 展示真实排版 |
| Markdown | **react-markdown + remark** | 母稿编辑器实时预览，避免自研解析 |

**为什么不是「硬编码 CSS / 全局 styled 散写」**：P0-4 要求所有颜色经 Token。Tailwind v4 的 `@theme` 把 `design-tokens.css` 变量注册为 `colors.accent` 等，开发者写 `bg-accent text-accent-on` 即等价于引用 Token；任何裸 `#0D9488` 在 Code Review / lint 阶段被拦截。

**可访问性基线**：键盘可达全部操作（⌘K/焦点环/ARIA）、对比度 ≥4.5:1、动画 `prefers-reduced-motion` 全量降级、图标按钮均带 `aria-label`。

---

## 7. 设计令牌交付物（Phase 3 实现时拆为独立文件）

> 以下为设计侧 Token 源，实现阶段拆出 `design-tokens.css` 与 `design-tokens.json` 供前端 `import`。

### 7.1 design-tokens.css（节选核心变量；浅/深两套见 §3.2/§3.3）

```css
:root,
[data-theme="light"] {
  --bg:#FAFAF7; --surface:#FFFFFF; --surface-warm:#F4F3EF;
  --fg:#1A1D1A; --fg-2:#3F463F; --muted:#6B726B;
  --border:#E7E5E1; --border-soft:#F0EFEB;
  --accent:#0D9488; --accent-hover:#0F766E; --accent-active:#115E59;
  --accent-on:#FFFFFF; --accent-soft:#CCFBF1;
  --success:#16A34A; --warn:#D97706; --danger:#DC2626; --info:#0E7490;
  --success-soft:#DCFCE7; --warn-soft:#FEF3C7; --danger-soft:#FEE2E2; --info-soft:#CFFAFE;
  --ch-wechat:#07C160; --ch-xiaohongshu:#FF2442; --ch-x:#1A1A1A; --ch-weibo:#E6162D;
  --font-display:"Inter","Noto Sans SC",-apple-system,"PingFang SC",sans-serif;
  --font-body:"Inter","Noto Sans SC",-apple-system,"PingFang SC",sans-serif;
  --font-mono:"JetBrains Mono","Fira Code",ui-monospace,monospace;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:20px;
  --space-6:24px;--space-8:32px;--space-10:40px;--space-12:48px;--space-16:64px;
  --radius-xs:4px;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:20px;--radius-pill:9999px;
  --shadow-sm:0 1px 2px rgba(16,24,20,.04);--shadow-md:0 4px 12px rgba(16,24,20,.08);--shadow-lg:0 12px 32px rgba(16,24,20,.12);
  --focus-ring:0 0 0 3px var(--accent-soft);
  --motion-fast:120ms;--motion-base:180ms;--motion-slow:260ms;
  --ease-standard:cubic-bezier(0.2,0,0,1);
}
[data-theme="dark"] { /* 见 §3.3 完整定义 */ }
```

### 7.2 design-tokens.json（机器可读，前端 import 用）

```json
{
  "color": {
    "bg": { "light": "#FAFAF7", "dark": "#0E1110", "type": "color" },
    "surface": { "light": "#FFFFFF", "dark": "#161A18", "type": "color" },
    "fg": { "light": "#1A1D1A", "dark": "#E8EAE6", "type": "color" },
    "muted": { "light": "#6B726B", "dark": "#808880", "type": "color" },
    "border": { "light": "#E7E5E1", "dark": "#262B28", "type": "color" },
    "accent": { "light": "#0D9488", "dark": "#2DD4BF", "type": "color" },
    "accent-on": { "light": "#FFFFFF", "dark": "#052E2B", "type": "color" },
    "success": { "light": "#16A34A", "dark": "#22C55E", "type": "color" },
    "warn": { "light": "#D97706", "dark": "#F59E0B", "type": "color" },
    "danger": { "light": "#DC2626", "dark": "#F87171", "type": "color" }
  },
  "font": {
    "family": { "value": "Inter, Noto Sans SC, sans-serif", "type": "fontFamily" },
    "mono": { "value": "JetBrains Mono, Fira Code, monospace", "type": "fontFamily" }
  },
  "radius": {
    "sm": { "value": "8px", "type": "dimension" },
    "md": { "value": "12px", "type": "dimension" },
    "lg": { "value": "16px", "type": "dimension" },
    "pill": { "value": "9999px", "type": "dimension" }
  },
  "space": {
    "1": { "value": "4px", "type": "dimension" }, "2": { "value": "8px", "type": "dimension" },
    "3": { "value": "12px", "type": "dimension" }, "4": { "value": "16px", "type": "dimension" },
    "5": { "value": "20px", "type": "dimension" }, "6": { "value": "24px", "type": "dimension" }
  },
  "motion": {
    "base": { "value": "180ms", "type": "duration" },
    "ease": { "value": "cubic-bezier(0.2,0,0,1)", "type": "cubicBezier" }
  }
}
```

---

## 8. 组件 5 态 / 9 态覆盖矩阵（关键组件）

| 组件 | Loading | Empty | Error | Populated | Edge |
|---|---|---|---|---|---|
| 灵感收件箱 | 列表骨架 | "灵感还空着"引导 | 雷达采集失败+重试 | 行卡片列表 | >100 项虚拟滚动 |
| 母稿编辑器 | 中栏打字机揭示 | — | 展开失败+原因 | Markdown+预览 | 超长文拆分提示/离线降级标注 |
| 预览台 | 四区骨架+≤3s | — | 单渠道失败可重试 | 四端真实渲染 | 微信图片换链标注/字数溢出 |
| 分发看板 | 行内 spinner | "还没有分发记录" | 渠道红+日志折叠+重试 | 状态 pill+预览链接 | 幂等跳过已成功渠道 |
| 密钥保险箱 | 测试连接 spinner | "从 DeepSeek 开始" | 连接失败+诊断 | 已连接/未配置/降级 | 明文绝不回显 |

按钮另覆盖 Disabled / Active / Focus(可见环)。

---

## 9. P0 合规自检表

| P0 规则 | 本设计处置 | 状态 |
|---|---|---|
| ① 禁 emoji 功能图标 | 锁定 Lucide；图标映射表见 §3.10；emoji 正则扫描为零 | 通过 |
| ② 禁紫色→粉色渐变 | 主色墨青 `#0D9488`，无紫粉；无渐变文字/主视觉 | 通过 |
| ③ 禁空洞占位文案 | 所有示例为真实产品语境（一人工作室/去AI腔/草稿箱）；无 "Welcome to"/"Lorem" | 通过 |
| ④ 禁硬编码颜色 | 全部经 Token；仅 `#fff`/`#000` 字面允许；Tailwind v4 `@theme` 强制 | 通过 |
| ⑤ 禁弹跳缓动 | 缓动用 `cubic-bezier(0.2,0,0,1)`，无 `(0.68,-0.55,...)` | 通过 |
| ⑥ 禁千篇一律 Hero | 无营销 Hero；直接进工作台（母稿编辑器），展示真实产品内容 | 通过 |

---

## 10. 待用户拍板的设计取舍（3 个，见 §0）

1. **默认主题**：浅色纸感优先（建议） vs 纯深色工作台优先。
2. **品牌主色**：墨青 Teal `#0D9488`（建议） vs 墨黑+暖琥珀 vs 墨青+珊瑚红 CTA。
3. **母稿创作台布局 & 落地页**：三栏工作台 + 应用启动默认进母稿（建议）；v1 是否在导航保留「数据复盘」占位入口（建议保留骨架占位）。

---
*本文件即 v0.1 设计契约（同时承担 DESIGN.md 角色）。Phase 3 实现时由前端同学据 §3/§7 Token 落地，新增页面仅在 `design-system/pages/` 写差异覆盖，不整篇重写。*
