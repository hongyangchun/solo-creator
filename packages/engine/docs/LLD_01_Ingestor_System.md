# LLD-01: 素材输入与爆款雷达子系统详细设计 (Ingestor & Radar System)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
素材输入与爆款雷达子系统是整个 SoloCreator Content OS 的**“第一道进水阀”**。它负责：
1. **多源素材捕获**：从多种数据源（X 高赞推文、微信公众号爆文、本地 Markdown 笔记库、语音转录音频、手动输入闪念）获取原始素材；
2. **格式标准化**：将非结构化输入转换为系统统一的 `RawIdeaPayload` 格式；
3. **爆款价值打分与初筛**：通过预置的多维度算法对采集到的海量素材进行自动化打分与痛点提取，过滤纯水文；
4. **定时调度运行**：支持通过 Cron 表达式在后台静默运行（支持 DSH `ctx.jobs` 与独立 Node-Cron）。

---

## 2. 核心架构与处理时序

```
┌────────────────────────────────────────────────────────────────────────┐
│                        IngestorRegistry (输入源注册中心)               │
├────────────────────────────────────────────────────────────────────────┤
│  [XRadarIngestor]   [WeChatRssIngestor]   [ObsidianVaultIngestor] ...  │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 1. 定时触发 / 主动调用 fetchIdeas()
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        RawIdeaPayload 标准化通道                        │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 2. 传递给打分引擎
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       ViralScoringEngine (爆款评估引擎)                 │
│                       · 反常识指数 · 痛点共鸣度 · 互动密度              │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ 3. 过滤出 Top 候选素材
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│              SQLite 持久化 (radar_items) ──► 推送每日选题晨报           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 标准输入数据载荷 (`RawIdeaPayload`)

```typescript
export interface RawIdeaPayload {
  id: string;                    // UUID v4
  source: 'x' | 'wechat' | 'obsidian' | 'voice' | 'manual' | 'rss';
  title: string;                 // 提取的标题或摘要
  rawText: string;               // 原始内容全文
  sourceUrl?: string;            // 原始来源 URL
  author?: string;               // 原作者信息
  metadata?: {
    likes?: number;              // 点赞数
    reposts?: number;            // 转发数
    comments?: number;           // 评论数
    tags?: string[];             // 原始标签
    vaultFilePath?: string;      // 本地文件路径 (如果是本地笔记)
  };
  viralScore?: number;           // 算法计算出的爆款评分 (0 ~ 100)
  painPoints?: string[];         // 自动提炼出的核心痛点
  createdAt: Date;
}
```

### 3.2 插件扩展契约 (`IngestorPlugin`)

```typescript
export interface IngestorPlugin {
  readonly id: string;           // 插件唯一标识，如 'ingestor-x-radar'
  readonly name: string;
  readonly description: string;
  readonly defaultCron?: string; // 默认定时策略，例如 '0 7 * * *'

  /**
   * 探测当前插件环境是否可用（如网络连通、本地目录是否存在、API Token 是否配置）
   */
  isAvailable(): Promise<boolean>;

  /**
   * 执行单次抓取或监听
   */
  fetchIdeas(params?: {
    limit?: number;
    keywords?: string[];
    minLikes?: number;
  }): Promise<RawIdeaPayload[]>;
}
```

---

## 4. 核心实现与核心算法

### 4.1 爆款价值打分算法 (`ViralScoringEngine`)

打分公式设计：
$$\text{Score} = w_1 \cdot S_{\text{counter-intuitive}} + w_2 \cdot S_{\text{pain-point}} + w_3 \cdot S_{\text{engagement}} + w_4 \cdot S_{\text{relevance}}$$

```typescript
export class ViralScoringEngine {
  constructor(private llmAdapter: LlmAdapter) {}

  async scoreIdea(idea: RawIdeaPayload, userInterests: string[]): Promise<{
    score: number;
    painPoints: string[];
    reasoning: string;
  }> {
    // 1. 计算外部热度基础分 (如果有外部点赞数据)
    let engagementScore = 50;
    if (idea.metadata?.likes) {
      if (idea.metadata.likes >= 2000) engagementScore = 100;
      else if (idea.metadata.likes >= 500) engagementScore = 80;
      else engagementScore = 60;
    }

    // 2. 调用 LLM 进行“反常识”与“痛点”深度语义评估
    const prompt = `
你是一位顶级自媒体主编。请评估以下素材的传播潜力和创作价值：
标题: ${idea.title}
内容: ${idea.rawText.slice(0, 800)}
创作者关注领域: ${userInterests.join(', ')}

请输出 JSON 格式：
{
  "counterIntuitiveScore": 0-100, // 是否颠覆常规认知/带来顿悟感
  "painPointScore": 0-100,        // 是否切中真实强烈的痛点
  "relevanceScore": 0-100,        // 与创作者领域的匹配度
  "extractedPainPoints": ["痛点1", "痛点2"],
  "briefReason": "一句话评估理由"
}`;

    const res = await this.llmAdapter.chat([
      { role: 'system', content: 'You are an expert content strategist. Respond strictly in JSON.' },
      { role: 'user', content: prompt }
    ], { responseFormat: 'json' });

    const analysis = JSON.parse(res);

    // 加权综合计算
    const finalScore = Math.round(
      0.35 * analysis.counterIntuitiveScore +
      0.35 * analysis.painPointScore +
      0.15 * analysis.relevanceScore +
      0.15 * engagementScore
    );

    return {
      score: finalScore,
      painPoints: analysis.extractedPainPoints || [],
      reasoning: analysis.briefReason || ''
    };
  }
}
```

---

### 4.2 X (Twitter) 500+ 高赞雷达采集器实现 (`XRadarIngestor`)

```typescript
import { IngestorPlugin, RawIdeaPayload } from '../types';

export class XRadarIngestor implements IngestorPlugin {
  readonly id = 'ingestor-x-radar';
  readonly name = 'X 500+ 爆款推文雷达';
  readonly description = '自动监听 X 平台高赞技术、AI 与独立开发推文';

  constructor(private apiKey?: string, private customScraperCmd?: string) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey || this.customScraperCmd);
  }

  async fetchIdeas(params?: { limit?: number; keywords?: string[]; minLikes?: number }): Promise<RawIdeaPayload[]> {
    const minLikes = params?.minLikes || 500;
    const keywords = params?.keywords || ['AI', 'IndieHacker', 'BuildInPublic'];
    
    // 如果配置了专用 CLI/脚本（如 Grok X search 或本地爬虫），优先调用
    const rawItems = await this.executeXSearch(keywords, minLikes, params?.limit || 20);

    return rawItems.map(item => ({
      id: crypto.randomUUID(),
      source: 'x',
      title: item.text.slice(0, 60) + '...',
      rawText: item.text,
      sourceUrl: item.url,
      author: item.authorUsername,
      metadata: {
        likes: item.likeCount,
        reposts: item.retweetCount,
        tags: item.hashtags
      },
      createdAt: new Date(item.createdAt)
    }));
  }

  private async executeXSearch(keywords: string[], minLikes: number, limit: number): Promise<any[]> {
    // 实际实现：调用 X API v2 或调用本地 Grok/Playwright 抓取进程
    return [];
  }
}
```

---

## 5. 异常处理与降级机制

1. **网络超时或平台限流 (Rate Limit)**：
   * 自动退避重试（Exponential Backoff，最大重试 3 次）；
   * 触发限流时静默记录日志并跳过，绝不中断系统主进程。
2. **本地笔记监听异常**：
   * 若用户本地 Obsidian 目录未找到，自动向控制台发出警告并设置 `isAvailable() = false`，不抛未捕获异常。
3. **数据重复入库防范**：
   * 基于 `sourceUrl` 或 `md5(rawText)` 在 SQLite 中做唯一索引去重（`INSERT OR IGNORE`）。
