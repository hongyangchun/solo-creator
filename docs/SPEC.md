# Spec - SoloCreator Content OS v1.0.0

> 生成日期：2026-08-19  
> 基于：PRD v3.0 (`SoloCreator_Modular_Architecture_PRD_and_Design.md`) + 架构文档 + 7 篇 LLD 详细设计  
> 状态：已确认 (Phase 1.5 锁定)

---

## 1. 产品定义
- **一句话描述**：专为自媒体与独立创作者打造的本地优先、极度模块化、直塞官方草稿箱的内容创作与多端分发系统。
- **目标用户**：科技/商业/泛知识领域个人创作者、一人超级工作室、独立出海开发者。
- **核心问题**：解决“一鱼多吃”排版格式错乱、传统自动化封号高危、多端发布运维繁重、以及 AI 生成内容“八股套话味重”的核心痛点。

---

## 2. MVP 范围（锁定——本版本严格交付以下范围）

| 优先级 | 核心模块 | 功能特性 | 验收标准摘要 |
|---|---|---|---|
| P0 | LLD-01 灵感输入 | X 高赞雷达采集 (`XRadarIngestor`) | 输入话题/博主抓取 500+ 赞帖子，提取核心观点与结构 |
| P0 | LLD-02 母稿质检 | 黄金 3 秒 Hook 矩阵 + 去 AI 味质检 | 生成 5 种 Hook；正则+启发式过滤 8 类 AI 模板套话 |
| P0 | LLD-03 转译矩阵 | 微信公众号、小红书、X、微博 4 平台适配 | 产出 HTML、CardFlow、Thread、ShortText 四大 Payload |
| P0 | LLD-04 卡片渲染 | 本地 Playwright 3:4 视网膜卡片渲染 | 渲染 1080×1440 2x PNG 卡片流，内嵌 WOFF2 防排版错位 |
| P0 | LLD-05 发布调度 | 微信公众号 CDP 直塞草稿箱 + 扫码守卫 | 无头/独立窗口直塞草稿箱，具备登录态失效二维码拦截状态机 |
| P0 | LLD-07 存储配置 | SQLite 本地存储 + 凭据保险箱 (`LocalKeyVault`) | 数据持久化本地，密钥经 AES-256-GCM / 钥匙串加密 |
| P1 | LLD-06 协同通知 | 飞书/本地系统通知草稿就绪与审阅链接 | 直塞完成后推送带预览链接的卡片通知 |

---

## 3. 明确不做（Out-of-Scope — 锁定）

| 不做的功能 | 原因 | 何时考虑 |
|---|---|---|
| 全自动静默直接向全网广播发布 | 极高封号风险与内容合规隐患，违背“人类保留最后 5% 扳机”铁律 | 永久不做，坚守草稿箱安全界 |
| 跨平台视频/音频剪辑与生成 | MVP 阶段算力开销大、ROI 低，核心聚焦图文多端打透 | v2.0 视用户反馈评估 |
| 多租户云端 SaaS 托管版本 | 破坏本地数据主权，且云端维护多用户 Session 极易被平台封锁 IP | 保持本地 CLI / 本地 Web 单机优先 |

---

## 4. 技术架构（锁定版本）

| 层级 | 技术选型 | 锁定版本 | 选型与锁定理由 |
|---|---|---|---|
| 核心运行时 | Node.js (TypeScript) | Node >= 20.0.0 (TS 5.4.0) | 跨平台原生支持优秀，生态成熟 |
| 浏览器自动化引擎 | Playwright (CDP) | ^1.44.0 | 稳定支持 ConnectOverCDP、视网膜截图与多上下文隔离 |
| 本地关系型数据库 | better-sqlite3 | ^9.6.0 | 单文件零配置、同步高并发、本地数据绝对主权 |
| 本地模板引擎 | Handlebars / Tailwind CSS | ^4.7.8 / ^3.4.0 | 零运行时纯 HTML 渲染，便于转译与注入 |
| 凭据加密 | Node.js `crypto` (AES-256-GCM) | 原生内置 | 免外部 C++ 编译依赖，PBKDF2 派生保护 Key |
| 图标规范 | Lucide Icons (SVG 描边) | ^0.380.0 | **规范锁定**：全项目禁止 emoji 作为功能图标 |

---

## 5. API 与核心 CLI 命令清单（锁定）

### 5.1 CLI 交互命令

```bash
# 1. 启动素材雷达采集
solo-creator radar --source=x --topic="AI Coding" --min-likes=500

# 2. 从灵感生成母稿并进行质检
solo-creator master create --idea-file="./idea.md" --critics=humanizer-zh,anti-slop

# 3. 触发多端一鱼多吃转译
solo-creator transpile --master-id="M-20260819-01" --channels=wechat,xiaohongshu,x,weibo

# 4. 执行本地 3:4 卡片渲染
solo-creator render --master-id="M-20260819-01" --theme=minimal_dark

# 5. 执行多渠道直塞草稿箱
solo-creator publish --master-id="M-20260819-01" --channels=wechat --mode=draft --driver=cdp
```

---

## 6. 数据库 Schema（锁定）

* `radar_items`：素材雷达采集表
* `master_posts`：母稿及 Hook 候选表
* `channel_dispatches`：多渠道分发记录与状态锁表
* `post_analytics`：数据表现与复盘指标表
* `persona_memory`：创作者风格沉淀知识库表

---

## 7. 验收标准（EARS 格式锁定）

| 编号 | 模块 | EARS 格式验收标准 | 优先级 |
|---|---|---|---|
| AC-01 | 转译 | While 输入有效母稿，系统**必须**在 3 秒内生成 4 种符合各平台排版规范的 Payload | P0 |
| AC-02 | 换链 | While 转译微信长图文，系统**必须**自动将外链图片转存至微信 CDN，防止微信裂图 | P0 |
| AC-03 | 渲染 | While 渲染小红书卡片，系统**必须**输出 3:4 比例 (1080×1440) @2x 无字体形变的 PNG 卡片流 | P0 |
| AC-04 | 守卫 | If 微信 CDP 登录态失效，系统**必须**自动截取二维码暂存并阻塞等待扫码，超时 120s 优雅报错 | P0 |
| AC-05 | 幂等 | If 重试批量发布任务，系统**必须**跳过已成功的渠道，禁止产生重复草稿 | P0 |
| AC-06 | 凭据 | While 存储 API Key 或平台 Token，系统**必须**使用 AES-256-GCM 加密，禁止数据库明文存储 | P0 |

---

## 8. 端到端验证步骤 (E2E)

```bash
# 1. 运行核心架构测试套件
npm test

# 2. 模拟从输入到草稿箱全流程
solo-creator pipeline --idea="为什么一人工作室是未来的工作形态" --channels=wechat,xiaohongshu --theme=notion_light
# 断言：
# 1. 生成 .solo-creator/posts/ 下的纯 Markdown 与 3:4 PNG 卡片流
# 2. 微信公众平台草稿箱出现最新文章，图片可正常预览无白块
# 3. 控制台与飞书收到草稿就绪提醒与 URL
```
