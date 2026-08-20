import { chromium, BrowserContext } from 'playwright';
import { PlatformDriver, LoginStateGuard } from './index';
import { PublishResult, ArticlePayload, UnifiedPayload } from '../types';

export class WeChatCdpDriver implements PlatformDriver {
  readonly id = 'wechat-cdp';
  readonly channel = 'wechat' as const;
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
    return payloadType === 'article';
  }

  async publish(payload: UnifiedPayload): Promise<PublishResult> {
    const article = payload as ArticlePayload;
    const browser = await chromium.connectOverCDP(this.cdpEndpoint);
    const context: BrowserContext = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    try {
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&isNew=1&type=10', {
        waitUntil: 'domcontentloaded'
      });

      // 登录态守卫：失效则阻塞等待扫码
      await LoginStateGuard.ensureLoggedIn(page, {
        loginCheckSelector: '.login__type__container__scan',
        qrCodeSelector: '.login__type__container__scan__qrcode',
        successRedirectUrlPart: 'mp.weixin.qq.com/cgi-bin/home'
      });

      await page.fill('#title', article.title);

      await page.evaluate((html) => {
        const ueditor = (globalThis as any).UE?.getEditor('js_editor');
        if (ueditor) {
          ueditor.setContent(html);
        }
      }, article.htmlContent);

      await page.click('#js_send');
      await page.waitForSelector('.weui-desktop-toast', { timeout: 5000 });

      return {
        success: true,
        channel: 'wechat',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        previewUrl: page.url(),
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'wechat',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        errorMessage: err.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      await page.close();
      await browser.close();
    }
  }
}
