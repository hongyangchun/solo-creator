# LLD-05: 可插拔多驱动发布调度子系统详细设计 (Pluggable Publisher)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
可插拔多驱动发布调度子系统是整个 SoloCreator Content OS 的**“物流配送中枢”**。它负责：
1. **多渠道驱动管理**：维护微信公众号、小红书、X (Twitter)、微博、知乎等渠道的所有驱动（API 驱动、CDP 浏览器驱动、CLI 驱动）；
2. **环境自检与智能路由**：根据用户配置（`auto` / `api` / `cdp` / `cli`）自动探测环境并执行优先级降级；
3. **直塞草稿箱保障**：严格控制发布行为为“存为草稿（Save as Draft）”，返回标准化发布结果与草稿预览 URL。

---

## 2. 核心架构与调度状态机

```
                        [PublisherRegistry.dispatch()]
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼ (preferredDriver !== 'auto')            ▼ (preferredDriver === 'auto')
       [加载指定类型的 Driver]                     [按优先级排序获取驱动列表]
                 │                                         │
                 ▼                                         ▼
       [driver.isAvailable()]                    [循环探测: for driver of candidates]
                 │                                         │
        ┌────────┴────────┐                       ┌────────┴────────┐
        ▼ (可用)          ▼ (不可用)              ▼ (首个可用)      ▼ (执行报错)
 [driver.publish()]   [抛出明确配置错误]      [driver.publish()]   [自动降级下一个 Driver]
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 核心接口定义

```typescript
export type DriverType = 'api' | 'cdp' | 'cli';
export type ChannelType = 'wechat' | 'x' | 'weibo' | 'xiaohongshu' | 'zhihu' | 'medium';

export interface PublishResult {
  success: boolean;
  channel: ChannelType;
  driverId: string;
  driverType: DriverType;
  mode: 'draft' | 'published';
  draftId?: string;
  previewUrl?: string;
  errorMessage?: string;
}

export interface PlatformDriver {
  readonly id: string;           // 如 'wechat-cdp', 'wechat-api', 'wechat-cli'
  readonly channel: ChannelType;
  readonly driverType: DriverType;
  readonly priority: number;     // 优先级数字越小越优先

  isAvailable(): Promise<boolean>;
  supportsPayload(payloadType: PayloadType): boolean;
  publish(payload: UnifiedPayload, options?: { draftOnly?: boolean }): Promise<PublishResult>;
}
```

---

## 4. 关键渠道驱动实现细节

### 4.1 微信公众号 CDP 驱动实现 (`WeChatCdpDriver`)

通过本地 Chrome CDP 接管已登录的微信公众平台后台，执行免密草稿箱直塞：

```typescript
import { PlatformDriver, PublishResult, ArticlePayload, UnifiedPayload } from '../types';
import { chromium, BrowserContext } from 'playwright';

export class WeChatCdpDriver implements PlatformDriver {
  readonly id = 'wechat-cdp';
  readonly channel = 'wechat';
  readonly driverType = 'cdp';
  readonly priority = 2;         // 次于官方 API 优先级

  constructor(private cdpEndpoint: string = 'http://127.0.0.1:9222') {}

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
      // 1. 打开微信公众平台草稿新建页
      await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&isNew=1&type=10', {
        waitUntil: 'domcontentloaded'
      });

      // 2. 注入标题
      await page.fill('#title', article.title);

      // 3. 注入富文本正文 HTML
      await page.evaluate((html) => {
        const ueditor = (window as any).UE?.getEditor('js_editor');
        if (ueditor) {
          ueditor.setContent(html);
        }
      }, article.htmlContent);

      // 4. 点击“保存为草稿”按钮
      await page.click('#js_send'); // 点击草稿箱存盘按钮
      await page.waitForSelector('.weui-desktop-toast', { timeout: 5000 });

      return {
        success: true,
        channel: 'wechat',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        previewUrl: page.url()
      };
    } catch (err: any) {
      return {
        success: false,
        channel: 'wechat',
        driverId: this.id,
        driverType: 'cdp',
        mode: 'draft',
        errorMessage: err.message
      };
    } finally {
      await page.close();
      await browser.close();
    }
  }
}
```

---

### 4.2 微信公众号官方 API 驱动 (`WeChatApiDriver`)

```typescript
export class WeChatApiDriver implements PlatformDriver {
  readonly id = 'wechat-api';
  readonly channel = 'wechat';
  readonly driverType = 'api';
  readonly priority = 1;         // 最高优先级

  constructor(private appId?: string, private appSecret?: string) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.appId && this.appSecret);
  }

  supportsPayload(payloadType: string): boolean {
    return payloadType === 'article';
  }

  async publish(payload: UnifiedPayload): Promise<PublishResult> {
    const article = payload as ArticlePayload;
    const accessToken = await this.getAccessToken();

    // 调用微信公众平台官方草稿箱新增接口: /cgi-bin/draft/add
    const res = await fetch(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articles: [{
          title: article.title,
          author: article.author || 'SoloCreator',
          digest: article.digest,
          content: article.htmlContent,
          thumb_media_id: 'COVER_MEDIA_ID',
          need_open_comment: 1
        }]
      })
    });

    const data = await res.json();
    if (data.media_id) {
      return {
        success: true,
        channel: 'wechat',
        driverId: this.id,
        driverType: 'api',
        mode: 'draft',
        draftId: data.media_id
      };
    }

    throw new Error(`微信 API 报错: ${data.errmsg} (${data.errcode})`);
  }

  private async getAccessToken(): Promise<string> {
    // 获取或复用缓存的 access_token
    return 'MOCK_ACCESS_TOKEN';
  }
}
```

---

### 4.3 微信公众号 CLI 驱动 (`WeChatCliDriver`)

直接复用已有的本地开源工具（如 `baoyu-post-to-wechat`）：

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export class WeChatCliDriver implements PlatformDriver {
  readonly id = 'wechat-cli';
  readonly channel = 'wechat';
  readonly driverType = 'cli';
  readonly priority = 3;

  constructor(private cliCommand: string = 'npx baoyu-post-to-wechat') {}

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which npx');
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
    const cmd = `${this.cliCommand} --title "${article.title}" --html "${article.htmlContent.replace(/"/g, '\\"')}" --draft`;

    const { stdout, stderr } = await execAsync(cmd);
    return {
      success: !stderr,
      channel: 'wechat',
      driverId: this.id,
      driverType: 'cli',
      mode: 'draft',
      previewUrl: stdout.trim()
    };
  }
}
```

---

## 5. 防风控与安全隔离机制

1. **CDP 独立自动化窗口池**：
   * 严禁直接在前台当前正在浏览的标签页注入脚本，每次直塞均使用 `context.newPage()` 在后台静默执行，并在存盘后自动关闭标签页；
2. **严格草稿箱防线**：
   * 驱动内部坚决不暴露任何“直接向全网广播发布”的 API 终点，彻底从代码层消除合规与误操作风险。

---

## 6. CDP 登录态失效捕获与交互式扫码接管状态机 (`LoginStateGuard`)

在工业级生产环境中，基于 CDP 驱动的浏览器 Session/Cookie 会因平台安全策略定期失效。若无捕获机制，会导致脚本因找不到 DOM 选择器而超时挂死或崩溃。

### 6.1 状态转移与交互流程

```
[CDP 打开后台页面]
        │
        ▼
[检查页面 DOM 状态] ────(包含登录/二维码特征)────► [触发 LoginStateGuard]
        │                                                  │
        ▼ (正常处于编辑后台)                                 ├─► 1. 截取二维码区域 PNG
[继续执行草稿直塞]                                          ├─► 2. 唤起系统原生通知 / 弹窗
                                                           ├─► 3. 轮询等待登录成功 (上限 120s)
                                                           │
                                                           ▼
                                               [登录成功: 自动重试直塞流程]
                                               [超时未扫: 标记 failed 并报错]
```

### 6.2 登录状态守卫与扫码等待实现

```typescript
import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export interface LoginGuardOptions {
  loginCheckSelector: string;   // 登录页特征选择器，如 '#login_container' 或 '.login__type__container'
  qrCodeSelector: string;        // 二维码 DOM 元素选择器
  successRedirectUrlPart: string;// 登录成功后的 URL 特征，如 'mp.weixin.qq.com/cgi-bin/home'
  timeoutMs?: number;            // 默认等待 120,000 ms
}

export class LoginStateGuard {
  static async ensureLoggedIn(page: Page, options: LoginGuardOptions): Promise<boolean> {
    const timeout = options.timeoutMs || 120000;
    const isLoginPage = await page.$(options.loginCheckSelector);

    if (!isLoginPage) {
      return true; // 登录态正常，无需接管
    }

    console.warn(`[LoginStateGuard] 检测到平台登录态已过期，准备拉起扫码接管流程...`);

    // 1. 等待二维码加载并截图
    await page.waitForSelector(options.qrCodeSelector, { timeout: 10000 });
    const qrElement = await page.$(options.qrCodeSelector);
    if (!qrElement) {
      throw new Error('未找到登录二维码元素，无法进行扫码接管');
    }

    const tmpQrPath = path.join(process.env.HOME || '.', '.solo-creator', 'temp', `login_qr_${Date.now()}.png`);
    fs.mkdirSync(path.dirname(tmpQrPath), { recursive: true });
    await qrElement.screenshot({ path: tmpQrPath });

    console.info(`[LoginStateGuard] 登录二维码已保存至: ${tmpQrPath}，请在手机上确认扫码。`);

    // 2. 轮询等待登录成功跳转
    try {
      await page.waitForURL((url) => url.href.includes(options.successRedirectUrlPart), {
        timeout,
        waitUntil: 'domcontentloaded'
      });
      console.info(`[LoginStateGuard] 扫码登录成功，会话已恢复！`);
      return true;
    } catch (e) {
      throw new Error(`登录超时（超过 ${timeout / 1000}s 未扫码），发布任务终止`);
    } finally {
      if (fs.existsSync(tmpQrPath)) {
        fs.unlinkSync(tmpQrPath); // 清理临时二维码截图
      }
    }
  }
}
```

---

## 7. 单渠道幂等分发与断点重试状态机 (`DispatchLockService`)

在“一鱼多吃”向微信公众号、小红书、X、微博等多渠道批量分发时，若某一渠道网络抖动失败，不能导致整个批次从头重跑（否则已成功的渠道会产生重复草稿）。

### 7.1 分发状态表驱动设计

每个渠道的分发动作均在数据库建立独立任务记录，并使用严格的状态锁控制：

```typescript
export type DispatchStatus = 'pending' | 'in_progress' | 'success' | 'failed';

export interface ChannelDispatchRecord {
  id: string;
  masterId: string;
  channel: ChannelType;
  status: DispatchStatus;
  retryCount: number;
  draftId?: string;
  previewUrl?: string;
  lastError?: string;
  updatedAt: string;
}

export class DispatchLockService {
  constructor(private storage: any) {}

  // 检查并加锁，防止并发重复发布
  async acquireLock(masterId: string, channel: ChannelType): Promise<boolean> {
    const record = await this.storage.getDispatchRecord(masterId, channel);
    if (record && record.status === 'success') {
      console.info(`[DispatchLock] 渠道 ${channel} 已成功存入草稿箱 (ID: ${record.draftId})，跳过重复执行`);
      return false;
    }
    if (record && record.status === 'in_progress') {
      console.warn(`[DispatchLock] 渠道 ${channel} 正在分发中，锁定中...`);
      return false;
    }

    await this.storage.updateDispatchStatus(masterId, channel, {
      status: 'in_progress',
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  // 释放锁并记录最终结果
  async releaseLock(
    masterId: string,
    channel: ChannelType,
    result: { success: boolean; draftId?: string; previewUrl?: string; error?: string }
  ): Promise<void> {
    await this.storage.updateDispatchStatus(masterId, channel, {
      status: result.success ? 'success' : 'failed',
      draftId: result.draftId,
      previewUrl: result.previewUrl,
      lastError: result.error,
      updatedAt: new Date().toISOString()
    });
  }
}
```
