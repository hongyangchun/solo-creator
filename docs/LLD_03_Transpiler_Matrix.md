# LLD-03: 多模态一鱼多吃转译器矩阵详细设计 (Transpiler Matrix)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
多模态转译器矩阵是连接“纯文本母稿”与“各平台定制化交付物”的**“媒介变压器”**。它负责：
1. **媒介形态重构**：将同一篇 Master Markdown 依据不同平台的受众心智、阅读节奏与排版规范，深度转译为不同形态的 `UnifiedPayload`；
2. **多端差异化适配**：
   * **小红书**：拆解为 4~7 页 3:4 视觉卡片规格（`CardFlowPayload`）；
   * **微信公众号**：生成内联 CSS 的富文本长图文排版（`ArticlePayload`），并经过 **微信 CDN 图片转存流水线**；
   * **X (Twitter)**：拆解为 280 字符分段的 Hook 连推（`ThreadPayload`）；
   * **微博 / 即刻**：提炼为短动态或头条文章（`ShortTextPayload`）；
3. **LLM 并发与限流保护**：内置并发队列与指数退避重试，防止一键多端转译触发 API 429 报错。

---

## 2. 核心架构与转译数据流

```
                        [标准 MasterPost 对象]
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  XhsTranspiler   │     │ WeChatTranspiler │     │ XThreadTranspiler│
│  (小红书卡片流)   │     │  (公众号排版HTML) │     │ (X 连推分段)      │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │                        ▼                        │
         │               ┌──────────────────┐              │
         │               │WeChatImageUpload │ (图片转存微信CDN)
         │               │换链中间件         │              │
         │               └────────┬─────────┘              │
         │                        │                        │
         ▼ (CardFlowPayload)      ▼ (ArticlePayload)       ▼ (ThreadPayload)
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ 调用本地卡片渲染器│     │  内联 CSS 富文本  │     │ 280字符长度硬切分 │
│ 生成 3:4 2x PNG  │     │  安全已换链 HTML │     │ 尾条加 Takeaway  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 转译器接口规范 (`PlatformTranspiler`)

```typescript
export interface TranspilerContext {
  targetChannel: string;
  themeId?: string;
  selectedHookId?: string;
  maxPages?: number;
  customPrompt?: string;
}

export interface PlatformTranspiler<T extends UnifiedPayload = UnifiedPayload> {
  readonly channel: string;      // 例如 'xiaohongshu', 'wechat', 'x'
  readonly outputType: PayloadType;

  /**
   * 将 MasterPost 转化为特定平台的统一载荷
   */
  transpile(master: MasterPost, ctx?: TranspilerContext): Promise<T>;
}
```

---

## 4. 关键转译器与生产级中间件实现

### 4.1 微信公众号图片转存中间件 (`WeChatImageUploaderMiddleware`)

微信公众平台严禁外链与本地图片，必须在转译时长图文内的所有图片上传并替换为 `mmbiz.qpic.cn` 专属链接：

```typescript
import * as fs from 'fs/promises';

export class WeChatImageUploaderMiddleware {
  constructor(private apiOrCdpUploader: (imageBuffer: Buffer) => Promise<string>) {}

  /**
   * 扫描 HTML 中的所有 <img> 标签，将本地或外部图片转存至微信 CDN 并替换 src
   */
  async processHtmlImages(htmlContent: string): Promise<string> {
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    let match;
    const matches: string[] = [];

    while ((match = imgRegex.exec(htmlContent)) !== null) {
      matches.push(match[1]);
    }

    let processedHtml = htmlContent;

    for (const src of matches) {
      // 如果已经是微信官方 CDN 链接则跳过
      if (src.includes('mmbiz.qpic.cn')) continue;

      try {
        let buffer: Buffer;
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const res = await fetch(src);
          buffer = Buffer.from(await res.arrayBuffer());
        } else {
          // 本地文件路径
          buffer = await fs.readFile(src);
        }

        // 上传到微信并获取专属 CDN 链接
        const wechatCdnUrl = await this.apiOrCdpUploader(buffer);

        // 全量替换 HTML 对应图片的 src
        processedHtml = processedHtml.replaceAll(src, wechatCdnUrl);
      } catch (err: any) {
        console.warn(`[WeChatImageUploader] 图片转存微信 CDN 失败 (${src}): ${err.message}`);
      }
    }

    return processedHtml;
  }
}
```

---

### 4.2 微信公众号长图文转译器 (`WeChatTranspiler`)

```typescript
export class WeChatTranspiler implements PlatformTranspiler<ArticlePayload> {
  readonly channel = 'wechat';
  readonly outputType = 'article';

  constructor(
    private themeEngine: WeChatThemeEngine,
    private imageUploader: WeChatImageUploaderMiddleware
  ) {}

  async transpile(master: MasterPost, ctx?: TranspilerContext): Promise<ArticlePayload> {
    const digest = master.masterMarkdown.slice(0, 120).replace(/[#*\n]/g, '') + '...';

    // 1. 渲染带内联样式的排版 HTML
    const rawHtml = await this.themeEngine.renderToWeChatHtml(master.masterMarkdown, {
      title: master.title,
      theme: ctx?.themeId || 'modern-minimal'
    });

    // 2. 执行图片转存中间件（杜绝白块/裂图）
    const safeHtml = await this.imageUploader.processHtmlImages(rawHtml);

    return {
      type: 'article',
      title: master.title,
      digest,
      markdownContent: master.masterMarkdown,
      htmlContent: safeHtml,
      tags: ['干货', '独立开发', 'AI']
    };
  }
}
```

---

### 4.3 LLM 并发队列与指数退避控制器 (`TranspilerTaskQueue`)

防止一键多端转译时并发请求触发 DeepSeek API 的 429 限流：

```typescript
export class TranspilerTaskQueue {
  private activeCount = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private concurrency: number = 2) {}

  async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this.activeCount++;
        try {
          // 包装指数退避重试 (最多 3 轮重试)
          const result = await this.executeWithRetry(task, 3);
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this.activeCount--;
          if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next();
          }
        }
      };

      if (this.activeCount < this.concurrency) {
        execute();
      } else {
        this.queue.push(execute);
      }
    });
  }

  private async executeWithRetry<T>(fn: () => Promise<T>, maxRetries: number, delayMs: number = 1500): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      if (maxRetries <= 0) throw err;
      // 若遇到 429 限流或网络抖动，执行指数随机退避
      console.warn(`[TaskQueue] 触发限流或网络异常，${delayMs}ms 后重试...`);
      await new Promise(r => setTimeout(r, delayMs + Math.random() * 500));
      return this.executeWithRetry(fn, maxRetries - 1, delayMs * 2);
    }
  }
}
```

---

## 5. 小红书与 X 连推转译器（规范保留）

* **小红书 (`XhsTranspiler`)**：拆解为 4~7 页 3:4 规格卡片流，调用本地卡片渲染器；
* **X (Twitter) (`XThreadTranspiler`)**：硬切分 280 字符，首条强钩子，尾条加 Takeaway。
