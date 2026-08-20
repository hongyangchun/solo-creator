import { PublishResult, ArticlePayload, UnifiedPayload } from '../types';
import { PlatformDriver } from './PlatformDriver';
import { LocalKeyVault } from '../storage/LocalKeyVault';

/**
 * 微信公众号官方 API 驱动（优先级最高）：
 * 使用 AppID + AppSecret 获取 access_token，调用 /cgi-bin/draft/add 直存草稿箱。
 * 无需浏览器、不受登录态过期影响，是微信场景最稳定的方案。
 */
export class WeChatApiDriver implements PlatformDriver {
  readonly id = 'wechat-api';
  readonly channel = 'wechat' as const;
  readonly driverType = 'api' as const;
  readonly priority = 1;

  private vault = new LocalKeyVault();

  constructor(private appId?: string, private appSecret?: string) {}

  async isAvailable(): Promise<boolean> {
    const id = this.appId || this.vault.getSecret('WECHAT_APP_ID');
    const secret = this.appSecret || this.vault.getSecret('WECHAT_APP_SECRET');
    return Boolean(id && secret);
  }

  supportsPayload(payloadType: string): boolean {
    return payloadType === 'article';
  }

  async publish(payload: UnifiedPayload): Promise<PublishResult> {
    const article = payload as ArticlePayload;
    const appId = this.appId || this.vault.getSecret('WECHAT_APP_ID');
    const appSecret = this.appSecret || this.vault.getSecret('WECHAT_APP_SECRET');

    if (!appId || !appSecret) {
      return this.fail('未配置 WECHAT_APP_ID / WECHAT_APP_SECRET，无法使用 API 驱动');
    }

    try {
      const token = await this.getAccessToken(appId, appSecret);
      const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articles: [
            {
              title: article.title,
              author: article.author || 'SoloCreator',
              digest: article.digest || article.title,
              content: this.htmlToWechat(article.htmlContent),
              need_open_comment: 1
            }
          ]
        })
      });
      const data = (await res.json()) as any;
      if (data.media_id) {
        return {
          success: true,
          channel: 'wechat',
          driverId: this.id,
          driverType: 'api',
          mode: 'draft',
          draftId: data.media_id,
          previewUrl: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=drafter#wechat_redirect`,
          timestamp: new Date().toISOString()
        };
      }
      return this.fail(`微信 API 报错: ${data.errmsg} (${data.errcode})`);
    } catch (err: any) {
      return this.fail(err.message);
    }
  }

  private async getAccessToken(appId: string, appSecret: string): Promise<string> {
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`
    );
    const data = (await res.json()) as any;
    if (data.access_token) return data.access_token;
    throw new Error(`获取 access_token 失败: ${data.errmsg} (${data.errcode})`);
  }

  private htmlToWechat(html: string): string {
    // 微信正文支持白名单标签，清理 script/style 等危险标签
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '');
  }

  private fail(msg: string): PublishResult {
    return {
      success: false,
      channel: 'wechat',
      driverId: this.id,
      driverType: 'api',
      mode: 'draft',
      errorMessage: msg,
      timestamp: new Date().toISOString()
    };
  }
}
