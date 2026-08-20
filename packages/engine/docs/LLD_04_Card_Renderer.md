# LLD-04: 本地 3:4 视网膜卡片渲染引擎详细设计 (Local Card Renderer)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
本地卡片渲染引擎是整个系统的**“视觉印刷工坊”**。它负责：
1. **毫秒级本地无头渲染**：完全基于本地 Headless 浏览器（Playwright / Puppeteer）将结构化卡片规范（`CardContentSpec`）转换为高清晰度 3:4 比例 PNG 图片；
2. **多套设计主题热插拔**：支持极简科技风、暖色插画风、黑金商务风等主题模板的动态切换；
3. **跨平台字体绝对一致性**：内嵌 WOFF2 商用免费字体，彻底消除 macOS/Windows/Linux 字宽差异导致的换行错位；
4. **资产全生命周期管理与垃圾回收 (GC)**：定期自动清理历史过期卡片，防止磁盘无上限膨胀。

---

## 2. 核心架构与渲染管线时序

```
[CardContentSpec 卡片规格数组]
               │
               ▼
┌────────────────────────────────────────┐
│     ThemeTemplateManager.getTheme()    │ ──► 加载对应主题 SVG / HTML 模板
└──────────────────────┬─────────────────┘
                       │ 注入内联 WOFF2 字体 (跨平台防换行变形)
                       ▼
┌────────────────────────────────────────┐
│      Headless Browser (Playwright)     │ ──► 本地单例无头浏览器会话池
└──────────────────────┬─────────────────┘
                       │ 设定 Viewport: 1080x1440, deviceScaleFactor: 2
                       ▼
┌────────────────────────────────────────┐
│        page.screenshot({ type: 'png' })│ ──► 毫秒级栅格化压制
└──────────────────────┬─────────────────┘
                       │
                       ▼
┌────────────────────────────────────────┐
│      AssetManager 归档与 GC 注册       │ ──► 自动打上 7 天过期时间戳
└────────────────────────────────────────┘
```

---

## 3. 跨平台字体防变形设计规范

为了保证卡片在 **macOS、Windows 与 Linux (Docker)** 上渲染出的字宽、行高与换行点 100% 像素级一致，主题模板严禁使用不可控的系统默认字体，必须内联引入商用免费的 `Noto Sans SC`（思源黑体）WOFF2 字体：

```css
@font-face {
  font-family: 'EmbeddedNotoSans';
  src: url('data:font/woff2;base64,d09GMgABAAAA...') format('woff2');
  font-weight: 400 700;
  font-display: block;
}

body {
  font-family: 'EmbeddedNotoSans', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
```

---

## 4. 本地资产管理器与垃圾回收 (`AssetManager`)

```typescript
import * as path from 'path';
import * as fs from 'fs/promises';

export class AssetManager {
  constructor(
    private baseDir: string = path.join(process.env.HOME || '.', '.solo-creator', 'assets'),
    private maxAgeDays: number = 7
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(path.join(this.baseDir, 'cards'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'covers'), { recursive: true });
  }

  getCardOutputDir(dateStr: string = new Date().toISOString().slice(0, 10)): string {
    return path.join(this.baseDir, 'cards', dateStr);
  }

  /**
   * 自动垃圾回收：扫描并删除超过 maxAgeDays 天的历史卡片图片
   */
  async runGarbageCollection(): Promise<{ deletedFilesCount: number; freedBytes: number }> {
    const cardsRootDir = path.join(this.baseDir, 'cards');
    let deletedCount = 0;
    let freedBytes = 0;

    try {
      const dateDirs = await fs.readdir(cardsRootDir);
      const now = Date.now();
      const maxAgeMs = this.maxAgeDays * 24 * 60 * 60 * 1000;

      for (const dir of dateDirs) {
        const dirPath = path.join(cardsRootDir, dir);
        const stats = await fs.stat(dirPath);

        if (stats.isDirectory() && (now - stats.mtimeMs > maxAgeMs)) {
          const files = await fs.readdir(dirPath);
          for (const file of files) {
            const filePath = path.join(dirPath, file);
            const fileStat = await fs.stat(filePath);
            freedBytes += fileStat.size;
            deletedCount++;
            await fs.unlink(filePath);
          }
          await fs.rmdir(dirPath);
        }
      }
    } catch (err: any) {
      console.warn(`[AssetManager] GC 垃圾回收警告: ${err.message}`);
    }

    return { deletedFilesCount: deletedCount, freedBytes };
  }
}
```

---

## 5. 本地卡片渲染引擎实现 (`LocalCardRenderer`)

```typescript
import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import { AssetManager } from './AssetManager';

export class LocalCardRenderer {
  private browser: Browser | null = null;
  private themes: Map<string, CardTheme> = new Map();

  constructor(private assetManager: AssetManager) {}

  async init(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    await this.assetManager.init();
  }

  registerTheme(theme: CardTheme): void {
    this.themes.set(theme.id, theme);
  }

  async renderCardDeck(pages: CardContentSpec[], themeId: string = 'dark-tech'): Promise<string[]> {
    await this.init();
    const theme = this.themes.get(themeId) || this.getDefaultTheme();
    const outputDir = this.assetManager.getCardOutputDir();
    await fs.mkdir(outputDir, { recursive: true });

    const outputPaths: string[] = [];
    const page: Page = await this.browser!.newPage({
      viewport: { width: 540, height: 720 }, // 3:4 比例
      deviceScaleFactor: 2                   // 2x 视网膜输出 1080x1440
    });

    try {
      for (const spec of pages) {
        const html = theme.compileHtml(spec);
        await page.setContent(html, { waitUntil: 'load' });

        const fileName = `card_${Date.now()}_p${spec.pageIndex}.png`;
        const filePath = path.join(outputDir, fileName);

        await page.screenshot({ path: filePath, type: 'png' });
        outputPaths.push(filePath);
      }
    } finally {
      await page.close();
    }

    return outputPaths;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  private getDefaultTheme(): CardTheme {
    return new DarkTechTheme();
  }
}
```
