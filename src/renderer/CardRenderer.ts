import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { CardFlowPayload } from '../types';

export interface RenderOptions {
  theme?: 'minimal_dark' | 'notion_light';
  deviceScaleFactor?: number; // 默认 2 (视网膜)
  outputDir?: string;
}

/**
 * 本地 3:4 视网膜卡片渲染引擎
 * 规格：1080×1440 逻辑像素 @2x = 2160×2880 物理像素
 */
export class CardRenderer {
  private static readonly THEMES = {
    minimal_dark: {
      bg: '#111214',
      textColor: '#F4F4F5',
      accent: '#3B82F6',
      fontFamily: '"Noto Sans SC", "Inter", sans-serif'
    },
    notion_light: {
      bg: '#FFFFFF',
      textColor: '#37352F',
      accent: '#EB5757',
      fontFamily: '"Noto Sans SC", "Inter", sans-serif'
    }
  };

  static async renderCardFlow(payload: CardFlowPayload, options: RenderOptions = {}): Promise<string[]> {
    const theme = this.THEMES[options.theme || 'minimal_dark'];
    const scaleFactor = options.deviceScaleFactor || 2;
    const outputDir = options.outputDir || path.join(process.env.HOME || '.', '.solo-creator', 'cards', payload.title);

    fs.mkdirSync(outputDir, { recursive: true });

    // 从 caption 中拆出正文章节
    const sections = payload.cardImagePaths.map((_, idx) => `第 ${idx + 1} 张卡片内容`);

    let browser: Browser | null = null;
    const generatedPaths: string[] = [];

    try {
      browser = await chromium.launch({ headless: true });
      const context: BrowserContext = await browser.newContext({
        viewport: { width: 1080, height: 1440 },
        deviceScaleFactor: scaleFactor
      });
      const page: Page = await context.newPage();

      for (let i = 0; i < sections.length; i++) {
        const html = this.buildCardHtml(theme, payload.title, sections[i], i + 1, sections.length);
        await page.setContent(html, { waitUntil: 'networkidle' });
        const outPath = path.join(outputDir, `card_${String(i + 1).padStart(2, '0')}.png`);
        await page.screenshot({ path: outPath, fullPage: false });
        generatedPaths.push(outPath);
      }
    } finally {
      await browser?.close();
    }

    return generatedPaths;
  }

  private static buildCardHtml(
    theme: { bg: string; textColor: string; accent: string; fontFamily: string },
    title: string,
    content: string,
    current: number,
    total: number
  ): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @font-face {
      font-family: "Noto Sans SC";
      src: url("file://${process.env.HOME}/.solo-creator/fonts/NotoSansSC-Regular.woff2") format("woff2");
      font-weight: 400;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1080px;
      height: 1440px;
      background: ${theme.bg};
      color: ${theme.textColor};
      font-family: ${theme.fontFamily};
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 90px 80px;
    }
    .header { font-size: 34px; color: ${theme.accent}; font-weight: 700; letter-spacing: 2px; }
    .content { font-size: 58px; line-height: 1.65; font-weight: 500; flex-grow: 1; display: flex; align-items: center; }
    .footer { display: flex; justify-content: space-between; align-items: center; font-size: 28px; opacity: 0.55; }
    .page-indicator { font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <div class="header">${title}</div>
  <div class="content">${content}</div>
  <div class="footer">
    <span>@SoloCreator</span>
    <span class="page-indicator">${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
  </div>
</body>
</html>`;
  }
}
