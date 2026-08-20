# SoloCreator Content OS (自媒体一人超级工作室)
## 极度模块化系统架构设计方案与完整产品需求文档 (PRD v3.0)

---

## 1. 系统愿景与六大架构设计原则

### 1.1 系统愿景
构建一个**完全本地化、极度模块化、驱动与插件全链路可插拔**的独立创作者工作流操作系统。
核心使命：**将创作者从 80% 的排版、切图、格式转译、多平台搬运与数据复盘等脏活中彻底解脱，让一个人的创作产能媲美 4 人的专业新媒体运营团队。**

### 1.2 六大核心设计原则 (Architectural Principles)

```
                     ┌────────────────────────────────────────┐
                     │         六大核心系统设计原则            │
                     └───────────────────┬────────────────────┘
          ┌──────────────────┬───────────┴──────────┬──────────────────┐
          ▼                  ▼                      ▼                  ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ 1. 核心与宿主解耦 │ │ 2. 全生命周期插拔  │ │ 3. 标准交付物抽象 │ │ 4. 直塞草稿防翻车 │
│ (Hexagonal/微内核)│ │ (7 大插件扩展槽位) │ │ (平台无关 Payload)│ │ (人机协同安全界) │
└──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘
          ▲                                                            ▲
          └──────────────────────────────┬─────────────────────────────┘
                                         ▼
                        ┌──────────────────────────────────┐
                        │ 5. 本地优先与隐私安全 (SQLite+CDP)│
                        │ 6. 极低推理成本自进化 (DeepSeek) │
                        └──────────────────────────────────┘
```

1. **核心业务与宿主底座完全解耦（Hexagonal Architecture）**：
   * 业务核心（母稿生成、去 AI 味、排版渲染、发布调度）不依赖任何特定框架（不强绑 DSH，也不强绑 WorkBuddy）。
   * DSH、WorkBuddy、Node CLI 或桌面 Tauri 壳仅作为最外层的**宿主适配器（Host Adapter）**存在。
2. **全生命周期 7 大插件插拔扩展点（Full-Lifecycle Pluggability）**：
   * 不仅“发布驱动”可插拔，从素材输入、AI 模型适配、审校质检、排版主题、通知提醒到数据复盘，全链路每一个环节均具备标准的 SPI 插件接口。
3. **平台无关的统一交付物规范（Unified Content Payloads）**：
   * 转译器只负责将母稿输出为标准化的 4 种交付物（长图文、3:4 卡片流、连推 Thread、短动态），发布驱动只消费标准化交付物，实现转译与发布的彻底正交。
4. **直塞草稿箱与人机协同安全界（Draft-First Safeguard）**：
   * 默认行为永远是“存为草稿”，彻底杜绝全自动发布导致的封号、风控与内容翻车风险。
5. **本地优先与数据主权（Local-First & BYOK）**：
   * 数据存储全部采用本地 SQLite，用户自填 DeepSeek API Key，凭据与草稿绝对不出本地。
6. **低成本反思与风格自进化（Self-Evolving Persona）**：
   * 借力 DeepSeek 极低推理成本，实现每日自动化爆款雷达监听与数据复盘自更新。

---

## 2. 系统总体技术架构拓扑 (Architecture Topology)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 最外层：多宿主运行时适配器                              │
│   ┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────────────────────┐   │
│   │  DSH 微内核插件      │  │ WorkBuddy Skill 体系│  │ 独立 Desktop / CLI 运行环境  │   │
│   │  (@solo/dsh-plugin) │  │ (skill-solo-creator)│  │ (Tauri 客户端 / npx 命令行)  │   │
│   └──────────┬──────────┘  └──────────┬──────────┘  └──────────────┬───────────────┘   │
└──────────────┼────────────────────────┼────────────────────────────┼───────────────────┘
               └────────────────────────┼────────────────────────────┘
                                        ▼ (统一调度接口)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        核心中枢：插件加载器与总线调度器 (PluginBus)                     │
│                        · 插件生命周期管理 · 依赖注入 · 事件总线广播                    │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          全生命周期 7 大可插拔插件矩阵 (SPI Matrix)                    │
│                                                                                        │
│  [1. Ingestor Plugins]   ──►  [2. LLM Provider Adapters] ──►  [3. Critic & Quality Gate]│
│  · X 500+ 高赞雷达            · DeepSeek (主力超低成本)        · 去中文 AI 腔 (Humanizer)│
│  · 本地笔记监听 (Obsidian)     · Claude / OpenAI (复杂反思)     · 广告法/限流敏感词过滤 │
│  · 语音录音/播客 Whisper      · Ollama (本地离线小模型)        · 黄金 3 秒 Hook 评分器 │
│                                                                                        │
│  [4. Theme & Renderers]  ──►  [5. Pluggable Drivers]     ──►  [6. Notifier Plugins]    │
│  · 小红书 3:4 SVG 卡片主题    · 微信: API / CDP / CLI          · 飞书互动卡片(点确认)  │
│  · 公众号研报/极简排版        · X (Twitter): API / CDP / CLI   · 企业微信/TelegramBot  │
│  · AI 封面图生成 (SD/Flux)    · 小红书: CDP / API / CLI        · 原生系统桌面弹窗提醒   │
│                               · 微博: API / CDP / CLI                                  │
│                                                                                        │
│  [7. Analytics & Storage Adapters]                                                     │
│  · 数据抓取: 微信/小红书/X 展现量、完播率、互动率回流                                  │
│  · 存储后端: SQLiteStorage (默认零配置) / LocalMarkdown (纯文件系统)                   │
└────────────────────────────────────────┬───────────────────────────────────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 底层基础设施与数据存储                                 │
│    · 本地 SQLite (radar_items, master_posts, drafts, analytics, persona_memory)        │
│    · 本地 Chrome CDP (独立 Debugging 端口，无感接管本地登录态)                         │
│    · DeepSeek API (V3 / V4 / R1 高性价比推理引擎)                                      │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 全生命周期 7 大可插拔插件接口与 SPI 契约规范

### 3.1 槽位 1：素材输入与情报采集插件 (`IngestorPlugin`)
负责从各个渠道拉取灵感与爆款情报，标准化为统一的 `RawIdeaPayload`：
```typescript
export interface RawIdeaPayload {
  id: string;
  source: 'x' | 'wechat' | 'obsidian' | 'voice' | 'manual';
  title: string;
  rawText: string;
  sourceUrl?: string;
  author?: string;
  viralMetrics?: { likes?: number; reposts?: number; reads?: number };
  createdAt: Date;
}

export interface IngestorPlugin {
  readonly id: string;           // 例如 'ingestor-x-radar', 'ingestor-obsidian-vault'
  readonly name: string;
  readonly description: string;

  /**
   * 探测数据源是否可用（如网络联通、本地目录是否存在）
   */
  isAvailable(): Promise<boolean>;

  /**
   * 执行单次抓取或监听
   */
  fetchIdeas(params?: { limit?: number; keywords?: string[] }): Promise<RawIdeaPayload[]>;
}
```

---

### 3.2 槽位 2：大模型推理引擎适配器 (`LlmAdapter`)
负责大模型底层的统一调用抽象，支持根据任务类型在 DeepSeek、Claude、OpenAI、Ollama 之间无缝切换：
```typescript
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface LlmAdapter {
  readonly id: string;           // 例如 'deepseek', 'claude', 'ollama'
  readonly name: string;

  chat(messages: LlmMessage[], options?: LlmOptions): Promise<string>;
  stream(messages: LlmMessage[], options?: LlmOptions): AsyncIterable<string>;
}
```

---

### 3.3 槽位 3：审校与合规质检插件 (`CriticRulePlugin`)
在母稿展开后执行多道过滤质检，支持插拔自定义审查规则：
```typescript
export interface CriticIssue {
  type: 'ai_flavor' | 'compliance_violation' | 'weak_hook' | 'fact_error';
  severity: 'warning' | 'error';
  message: string;
  matchedText?: string;
  suggestion?: string;
}

export interface CriticResult {
  passed: boolean;
  score: number;                 // 0 ~ 100 综合质量分
  issues: CriticIssue[];
  repairedText?: string;         // 自动去 AI 味或修复后的文本
}

export interface CriticRulePlugin {
  readonly id: string;           // 例如 'critic-humanizer-zh', 'critic-ad-compliance'
  readonly name: string;
  readonly order: number;        // 检查流水线中的执行顺序

  inspect(content: string, context?: { platform?: string }): Promise<CriticResult>;
}
```

---

### 3.4 槽位 4：视觉卡片与排版主题插件 (`ThemeTemplatePlugin`)
负责将结构化文本或卡片规格渲染为具有特定视觉美感的 HTML/SVG：
```typescript
export interface CardContentSpec {
  pageIndex: number;
  totalPages: number;
  type: 'cover' | 'content' | 'summary';
  title: string;
  highlightHook?: string;
  bodyParagraphs: string[];
  tags: string[];
  authorInfo?: { name: string; avatarUrl?: string };
}

export interface ThemeTemplatePlugin {
  readonly id: string;           // 例如 'theme-xhs-dark-tech', 'theme-wechat-research'
  readonly name: string;
  readonly targetFormat: 'xiaohongshu_card' | 'wechat_article_html';

  /**
   * 渲染单个卡片或整篇文章排版
   */
  renderCardSvg(cardData: CardContentSpec): Promise<string>;
  renderArticleHtml(markdownText: string, metadata: { title: string; digest: string }): Promise<string>;
}
```

---

### 3.5 槽位 5：可插拔发布驱动矩阵 (`PlatformDriver`)
统一调度 API、CDP 浏览器直塞或本地 CLI 进行草稿箱注入：
```typescript
export type DriverType = 'api' | 'cdp' | 'cli';
export type ChannelType = 'wechat' | 'x' | 'weibo' | 'xiaohongshu' | 'zhihu' | 'medium';

export interface PublishOptions {
  draftOnly?: boolean;          // 默认 true，只存草稿
  timeoutMs?: number;
}

export interface PublishResult {
  success: boolean;
  channel: ChannelType;
  driverId: string;
  driverType: DriverType;
  mode: 'draft' | 'published';
  draftId?: string;
  previewUrl?: string;
  errorMessage?: string;
}

export interface PlatformDriver {
  readonly id: string;          // 例如 'wechat-api', 'wechat-cdp', 'wechat-cli'
  readonly channel: ChannelType;
  readonly driverType: DriverType;
  readonly priority: number;    // 自动探测优先级（数字越小越优先）

  isAvailable(): Promise<boolean>;
  supportsPayload(payloadType: PayloadType): boolean;
  publish(payload: UnifiedPayload, options?: PublishOptions): Promise<PublishResult>;
}
```

---

### 3.6 槽位 6：人机协同与通知插件 (`NotifierPlugin`)
当所有平台的草稿箱全部注入完成后，向创作者发起轻量通知与终审确认：
```typescript
export interface NotifierPayload {
  masterTitle: string;
  masterId: string;
  totalChannels: number;
  successfulChannels: string[];
  previewLinks: Record<string, string>; // { wechat: 'https://...', xhs: '...' }
  dispatchedAt: Date;
}

export interface NotifierPlugin {
  readonly id: string;           // 例如 'notifier-feishu-card', 'notifier-macos-toast'
  readonly name: string;

  isAvailable(): Promise<boolean>;
  sendDraftReadyNotice(payload: NotifierPayload): Promise<void>;
}
```

---

### 3.7 槽位 7：数据统计与复盘插件 (`AnalyticsFetcherPlugin`)
自动定期拉取各平台发布后 24~48 小时的数据反馈，驱动创作者 Persona 自进化：
```typescript
export interface PostPerformanceMetrics {
  views: number;                 // 阅读量 / 展现量
  likes: number;                 // 点赞数
  comments: number;              // 评论数
  shares: number;                // 转发 / 分享数
  collected?: number;            // 收藏数 (小红书/知乎)
  completionRate?: number;       // 完播率 / 读完率
  ctr?: number;                  // 点击率
}

export interface AnalyticsFetcherPlugin {
  readonly channel: ChannelType;
  readonly id: string;

  isAvailable(): Promise<boolean>;
  fetchMetrics(postOrDraftId: string): Promise<PostPerformanceMetrics>;
}
```

---

## 4. 平台无关的统一交付物规范 (Unified Payloads)

转译器输出给发布驱动的数据载荷严格标准化，彻底隔离生成与分发：

```typescript
export type PayloadType = 'article' | 'card_flow' | 'thread' | 'short_text';

// 1. 长图文交付物（适用于：微信公众号、知乎专栏、Medium）
export interface ArticlePayload {
  type: 'article';
  title: string;
  digest: string;
  markdownContent: string;
  htmlContent: string;           // 带内联样式的富文本排版 HTML
  coverImagePath?: string;       // 本地封面图片绝对路径
  tags: string[];
  author?: string;
}

// 2. 卡片流交付物（适用于：小红书、Instagram）
export interface CardFlowPayload {
  type: 'card_flow';
  title: string;
  caption: string;               // 种草文案与正文
  cardImagePaths: string[];      // 3:4 比例的 PNG 视网膜图片路径数组
  tags: string[];
}

// 3. 连推交付物（适用于：X / Twitter Thread）
export interface ThreadPayload {
  type: 'thread';
  tweets: string[];              // 连推推文数组 [主推Hook, 论点1, 论点2, ..., Takeaway]
  mediaAttachments?: string[][]; // 对应每条推文附加的本地图片路径
  tags: string[];
}

// 4. 短动态交付物（适用于：微博、即刻、朋友圈文案）
export interface ShortTextPayload {
  type: 'short_text';
  text: string;
  images?: string[];             // 最多 9 张配图路径
  topic?: string;
}

export type UnifiedPayload = ArticlePayload | CardFlowPayload | ThreadPayload | ShortTextPayload;
```

---

## 5. 本地 SQLite 核心数据模型 (Schema)

```sql
-- 1. 选题雷达表
CREATE TABLE IF NOT EXISTS radar_items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,          -- 'x', 'wechat', 'obsidian', 'rss'
    title TEXT NOT NULL,
    url TEXT,
    author TEXT,
    raw_content TEXT,
    viral_score REAL DEFAULT 0,    -- 综合热度评分
    status TEXT DEFAULT 'unread',  -- 'unread', 'shortlisted', 'discarded', 'used'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 核心母稿表
CREATE TABLE IF NOT EXISTS master_posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    raw_idea TEXT,                 -- 原始输入闪念/速记
    master_markdown TEXT NOT NULL, -- 展开后的标准母稿 Markdown
    hook_candidates JSON,          -- 5 个黄金 Hook 候选项
    status TEXT DEFAULT 'draft',   -- 'draft', 'transpiled', 'archived'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 各渠道转译产物与分发状态表
CREATE TABLE IF NOT EXISTS channel_dispatches (
    id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL REFERENCES master_posts(id) ON DELETE CASCADE,
    channel TEXT NOT NULL,         -- 'wechat', 'x', 'weibo', 'xiaohongshu'
    payload_type TEXT NOT NULL,    -- 'article', 'card_flow', 'thread', 'short_text'
    payload_json JSON NOT NULL,    -- 序列化后的 UnifiedPayload
    driver_used TEXT,              -- 实际使用的驱动 ID，例如 'wechat-cdp'
    dispatch_status TEXT DEFAULT 'pending', -- 'pending', 'drafted', 'published', 'failed'
    draft_id TEXT,                 -- 平台草稿 ID
    preview_url TEXT,              -- 平台草稿预览链接
    error_log TEXT,
    dispatched_at DATETIME
);

-- 4. 内容反馈与复盘指标表
CREATE TABLE IF NOT EXISTS post_analytics (
    id TEXT PRIMARY KEY,
    dispatch_id TEXT NOT NULL REFERENCES channel_dispatches(id) ON DELETE CASCADE,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    collected INTEGER DEFAULT 0,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. 创作者风格记忆表 (Persona Memory)
CREATE TABLE IF NOT EXISTS persona_memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,           -- 风格偏好、禁止词库、高转化开篇模式
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. 统一配置中心规范 (`~/.solo-creator/config.yaml`)

```yaml
# ==========================================
# SoloCreator Content OS 完整插拔配置文件
# ==========================================

# 1. 大模型推理提供方 (槽位 2)
llm:
  default: "deepseek"
  adapters:
    deepseek:
      apiKey: "env:DEEPSEEK_API_KEY"
      model: "deepseek-chat"       # 主力高性价比
    claude:
      apiKey: "env:ANTHROPIC_API_KEY"
      model: "claude-3-5-sonnet"   # 高阶长链反思备用

# 2. 质检与审校规则链 (槽位 3)
critic:
  enabledRules:
    - "critic-humanizer-zh"        # 强制去中文 AI 腔
    - "critic-ad-compliance"       # 广告法极限词检查
    - "critic-hook-strength"       # 黄金 3 秒标题评分
  minPassScore: 80

# 3. 视觉卡片与排版主题 (槽位 4)
theme:
  xiaohongshu: "theme-xhs-dark-tech"
  wechat: "theme-wechat-research"

# 4. 本地浏览器 CDP 驱动配置
browser:
  cdpEndpoint: "http://127.0.0.1:9222"
  headless: false
  autoSaveDraft: true              # 坚决只存草稿

# 5. 各渠道发布驱动策略 (槽位 5)
channels:
  wechat:
    driver: "auto"                 # 'auto' | 'api' | 'cdp' | 'cli'
    api:
      appId: "wx_xxxxxx"
      appSecret: "env:WECHAT_SECRET"
    cli:
      command: "npx baoyu-post-to-wechat"

  weibo:
    driver: "cli"
    cli:
      command: "npx baoyu-post-to-weibo"

  xiaohongshu:
    driver: "cdp"                  # 国内无写草稿公开 API，强制走 CDP 直塞

  x:
    driver: "api"
    api:
      apiKey: "env:TWITTER_API_KEY"
      apiSecret: "env:TWITTER_API_SECRET"
      accessToken: "env:TWITTER_ACCESS_TOKEN"
      accessSecret: "env:TWITTER_ACCESS_SECRET"

# 6. 人机协同通知 (槽位 6)
notifier:
  provider: "feishu-card"          # 'feishu-card' | 'wecom-bot' | 'macos-toast'
  webhookUrl: "env:FEISHU_BOT_WEBHOOK"

# 7. 素材情报雷达 (槽位 1)
radar:
  enabled: true
  cron: "0 7 * * *"                # 每天早晨 7:00 自动监听
  sources:
    - "ingestor-x-radar"
    - "ingestor-obsidian-vault"
  minViralLikes: 500
```

---

## 7. 研发里程碑与敏捷排期 (Roadmap)

```
阶段一：核心域、转译器与质检 (Sprint 1 · Day 1 ~ 3)
├── 搭建 SQLite 数据存储层与抽象接口定义 (SPI Interfaces)
├── 实现 MasterContentService + Critic (Humanizer-zh 去 AI 味)
└── 实现 小红书 (CardFlow)、公众号 (HTML)、X (Thread) 转译器

阶段二：卡片渲染引擎与首批驱动 (Sprint 2 · Day 4 ~ 7)
├── 实现 LocalCardRenderer (本地 HTML/SVG 模板毫秒级转 3:4 2x PNG)
├── 编写 WeChatCdpDriver、WeChatApiDriver、WeChatCliDriver
├── 编写 XhsCdpDriver、XCdpDriver、WeiboCliDriver
└── 实现 PublisherRegistry 动态调度与智能降级

阶段三：宿主接入与端到端交付 (Sprint 3 · Day 8 ~ 10)
├── 封装 DSH 微内核插件 (dsh-plugin/) 与 WorkBuddy Skill
├── 编写 Notifier 飞书/企微卡片提醒插件
└── 全链路实测：输入一段语音/随笔 ──► 15 秒内 4 平台草稿箱全部就绪！
```
