import { Page } from 'playwright';
import { PublishResult, ArticlePayload, UnifiedPayload } from '../types';
import { PlatformDriver } from './PlatformDriver';
import { LoginStateGuard } from './LoginStateGuard';
import { acquireBrowserContext, releaseBrowser } from './browserLauncher';

export class WeChatCdpDriver implements PlatformDriver {
  readonly id = 'wechat-cdp';
  readonly channel = 'wechat' as const;
  readonly driverType = 'cdp' as const;
  readonly priority = 2;

  async isAvailable(): Promise<boolean> {
    try {
      const { browser, mode } = await acquireBrowserContext();
      await releaseBrowser({ browser, context: browser.contexts()[0], mode });
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
    const acquired = await acquireBrowserContext();
    const page: Page = await acquired.context.newPage();

    try {
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&isNew=1&type=10', {
        waitUntil: 'domcontentloaded'
      });
      await page.waitForTimeout(3000);

      await LoginStateGuard.ensureLoggedIn(page, {
        loginCheckSelector: '.login__type__container__scan',
        qrCodeSelector: '.login__type__container__scan__qrcode',
        successRedirectUrlPart: 'mp.weixin.qq.com/cgi-bin/home'
      });

      const titleFilled = await this.fillTitle(page, article.title);
      if (!titleFilled) {
        throw new Error('未能定位微信标题输入框，请检查公众平台后台版本');
      }

      await this.setBody(page, article.htmlContent);
      await page.waitForTimeout(1000);

      const saveBtn = page.locator('#js_send, .btn_sure, a:has-text("保存")').first();
      await saveBtn.click();
      await page.waitForSelector('.weui-desktop-toast', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);

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
      await releaseBrowser(acquired);
    }
  }

  private async fillTitle(page: Page, title: string): Promise<boolean> {
    const selectors = ['#title', '#js_title', 'input.title_input', 'input[placeholder*="标题"]', 'textarea#title'];
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.fill(title);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private async setBody(page: Page, html: string): Promise<void> {
    const injected = await page.evaluate((content) => {
      const ueditor = (globalThis as any).UE?.getEditor('js_editor');
      if (ueditor && typeof ueditor.setContent === 'function') {
        ueditor.setContent(content);
        return true;
      }
      const editable = document.querySelector('#js_editor, .edui-body-container, [contenteditable="true"]') as HTMLElement | null;
      if (editable) {
        editable.innerHTML = content;
        return true;
      }
      return false;
    }, html);
    if (!injected) {
      console.warn('[WeChatCdpDriver] 正文注入失败（UEditor / contenteditable 均未命中），仅保存了标题');
    }
  }
}
