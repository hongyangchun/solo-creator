import { describe, it, expect, vi, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { WeChatApiDriver } from '../src/publisher/WeChatApiDriver';
import { ArticlePayload } from '../src/types';

const article = {
  type: 'article',
  title: '测试标题',
  author: 'SoloCreator',
  digest: '测试摘要',
  htmlContent: '<h1>hello</h1><p>body</p>'
} as ArticlePayload;

describe('WeChatApiDriver 官方 API 契约', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('缺少凭据应返回失败（不触网）', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-home-'));
    const old = process.env.HOME;
    process.env.HOME = tmp; // 确保无 vault.enc，凭据必为空
    try {
      const driver = new WeChatApiDriver();
      const res = await driver.publish(article);
      expect(res.success).toBe(false);
      expect(res.errorMessage).toContain('WECHAT_APP_ID');
    } finally {
      process.env.HOME = old;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('成功路径：应构造正确的 token 与 draft/add 请求体', async () => {
    const calls: { url: string; init?: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: any) => {
        calls.push({ url, init });
        if (url.includes('/cgi-bin/token')) {
          return { json: async () => ({ access_token: 'TOKEN123', expires_in: 7200 }) };
        }
        if (url.includes('/cgi-bin/draft/add')) {
          return { json: async () => ({ media_id: 'MEDIA_ABC' }) };
        }
        return { json: async () => ({}) };
      })
    );

    const driver = new WeChatApiDriver('APPID_X', 'SECRET_Y');
    const res = await driver.publish(article);

    expect(res.success).toBe(true);
    expect(res.draftId).toBe('MEDIA_ABC');
    expect(res.driverType).toBe('api');
    expect(res.mode).toBe('draft');

    const tokenCall = calls.find((c) => c.url.includes('/cgi-bin/token'))!;
    expect(tokenCall.url).toContain('appid=APPID_X');
    expect(tokenCall.url).toContain('secret=SECRET_Y');
    expect(tokenCall.url).toContain('grant_type=client_credential');

    const draftCall = calls.find((c) => c.url.includes('/cgi-bin/draft/add'))!;
    expect(draftCall.url).toContain('access_token=TOKEN123');
    const body = JSON.parse(draftCall.init.body);
    expect(body.articles[0].title).toBe('测试标题');
    expect(body.articles[0].content).toContain('<h1>hello</h1>');
    expect(body.articles[0].need_open_comment).toBe(1);
  });

  it('API 报错应原样带回 errmsg', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/cgi-bin/token')) {
          return { json: async () => ({ access_token: 'T' }) };
        }
        return { json: async () => ({ errcode: 40013, errmsg: 'invalid appid' }) };
      })
    );
    const driver = new WeChatApiDriver('bad', 'bad');
    const res = await driver.publish(article);
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain('invalid appid');
  });
});
