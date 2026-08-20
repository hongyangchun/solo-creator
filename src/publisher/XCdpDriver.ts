import { PublishResult, ThreadPayload, UnifiedPayload, PayloadType } from '../types';
import { PlatformDriver } from './PlatformDriver';
import { LoginStateGuard } from './LoginStateGuard';
import { chromium, BrowserContext } from 'playwright';

/**
 * X (Twitter) CDP 驱动：
 * 打开 x.com/compose 填入 Thread 首推与配图，止步于"确认发布"之前，由人工终审点击发送。
 */
export class XCdpDriver implements PlatformDriver {
  readonly id = 'x-cdp';
  readonly channel = 'x' as const;
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

  supportsPayload(payloadType: PayloadType): boolean {
    return payloadType === 'thread' || payloadType === 'short_text';
  }

  async publish(payload: UnifiedPayload): Promise<PublishResult> {
    const thread = payload as ThreadPayload;
    const browser = await chromium.connectOverCDP(this.cdpEndpoint);
    const context: BrowserContext = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();

    try {
      await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' });

      // 登录态守卫：X 未登录会跳转到 /login
      await LoginStateGuard.ensureLoggedIn(page, {
        loginCheckSelector: '[data-testid="loginButton"]',
        qrCodeSelector: 'label[data-testid="LoginForm_Login_Button"]',
        successRedirectUrlPart: 'x.com/compose'
      });

      // 填入首推文本（注意：这里只填入，绝不点击发推按钮）
      const composer = page.locator('[data-testid="tweetTextarea_0"]');
      await composer.waitFor({ timeout: 10000 });
      await composer.fill(thread.tweets[0]);

      // 剩余推文以 thread 形式追加到本地草稿清单，由人工在界面复制补充
      console.info(`[X-CdpDriver] 已填入首推，剩余 ${thread.tweets.length - 1} 条请在界面点击"+"逐条粘贴后人工发布`);

      return {
        success: true,
        channel: 'x',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        previewUrl: page.url(),
        timestamp: new Date().toISOString()
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'x',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        errorMessage: err.message,
        timestamp: new Date().toISOString()
      };
    } finally {
      // 保留页面供人工终审，仅断开 CDP 连接
      await browser.close();
    }
  }
}
