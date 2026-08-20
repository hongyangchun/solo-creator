import { PublishResult, CardFlowPayload, UnifiedPayload } from '../types';
import { PlatformDriver } from './PlatformDriver';
import { LoginStateGuard } from './LoginStateGuard';
import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';

/**
 * 小红书 CDP 驱动：
 * 上传 3:4 卡片流 PNG + 填入标题正文，止步于"发布"按钮之前，人工终审后点击发送。
 */
export class XhsCdpDriver implements PlatformDriver {
  readonly id = 'xhs-cdp';
  readonly channel = 'xiaohongshu' as const;
  readonly driverType = 'cdp' as const;
  readonly priority = 2;

  constructor(private cdpEndpoint: string = process.env.CHROME_CDP_ENDPOINT || 'http://127.0.0.1:9222') {}

  async isAvailable(): Promise<boolean> {
    try {
      const browser = await chromium.connectOverCDP(this.cdpEndpoint, { timeout: 1500 });
      await browser.close();
      return true;
    } catch {
      return false;
    }
  }

  supportsPayload(payloadType: string): boolean {
    return payloadType === 'card_flow';
  }

  async publish(payload: UnifiedPayload): Promise<PublishResult> {
    const cardFlow = payload as CardFlowPayload;
    const browser = await chromium.connectOverCDP(this.cdpEndpoint);
    const context: BrowserContext = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    try {
      await page.goto('https://creator.xiaohongshu.com/publish/publish?source=official', {
        waitUntil: 'domcontentloaded'
      });

      // 登录态守卫：小红书创作平台未登录会出现扫码登录框
      await LoginStateGuard.ensureLoggedIn(page, {
        loginCheckSelector: '.qrcode',
        qrCodeSelector: '.qrcode img',
        successRedirectUrlPart: 'creator.xiaohongshu.com/publish'
      });

      // 1. 上传卡片图片（依次上传所有本地 PNG）
      const uploadInput = page.locator('input[type="file"]');
      await uploadInput.waitFor({ timeout: 10000 });

      // 过滤出真实存在的本地文件路径
      const validPaths = cardFlow.cardImagePaths.filter((p) => fs.existsSync(p));
      if (validPaths.length === 0) {
        throw new Error('没有找到已渲染的本地卡片图片，请先执行 render 命令');
      }
      await uploadInput.setInputFiles(validPaths);

      // 2. 等待图片上传完成并填入标题与正文
      await page.waitForTimeout(2000);
      const titleInput = page.locator('#titleTextArea, input[placeholder*="标题"]').first();
      if (await titleInput.count()) {
        await titleInput.fill(cardFlow.title.slice(0, 20));
      }

      const contentInput = page.locator('#postTextArea, div[contenteditable="true"]').first();
      if (await contentInput.count()) {
        await contentInput.fill(cardFlow.caption);
      }

      console.info(`[XhsCdpDriver] 已上传 ${validPaths.length} 张卡片并填入文案，请在浏览器中人工确认发布`);

      return {
        success: true,
        channel: 'xiaohongshu',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        previewUrl: page.url(),
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'xiaohongshu',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        errorMessage: err.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      await browser.close();
    }
  }
}
