import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveCdpEndpoint } from '../config/AppConfig';

export interface AcquiredBrowser {
  browser: Browser;
  context: BrowserContext;
  mode: 'cdp' | 'launch';
}

const DEFAULT_EDGE =
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const PROFILE_DIR = path.join(process.env.HOME || os.homedir(), '.solo-creator', 'browser-profile');

export interface AcquireOptions {
  /** 显式 CDP 端点（如 app_config 存储值）；缺省时动态解析 env → 默认 */
  cdpEndpoint?: string | null;
}

/**
 * 获取一个浏览器上下文：
 * 1. 若配置了 CDP 端点且可达 → 复用常驻调试浏览器 (connectOverCDP)
 * 2. 否则 → 用 Edge 二进制 + 已保存登录态的用户目录，按需拉起独立实例
 *
 * 登录 cookie 持久化在 PROFILE_DIR，首次扫码后无需重复登录。
 * 端点解析在每次调用时进行（app_config 更新后下一次 publish/probe 即生效）。
 */
export async function acquireBrowserContext(opts: AcquireOptions = {}): Promise<AcquiredBrowser> {
  const cdpEndpoint = resolveCdpEndpoint(opts.cdpEndpoint);

  // 模式 1：复用常驻 CDP 浏览器
  // 注意：仅验证"能否 connectOverCDP"是不够的——9222 等调试端口可能被
  // Electron 等非调试浏览器占用（能连但 newPage 异常），因此必须真实开一页验证。
  let cdpBrowser: Browser | null = null;
  try {
    cdpBrowser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 });
    const context = cdpBrowser.contexts()[0] || (await cdpBrowser.newContext());
    // 探测：能正常开页才认为该 CDP 端点真正可用（探测页立即关闭，连接复用）
    const page = await context.newPage();
    await page.close();
    return { browser: cdpBrowser, context, mode: 'cdp' };
  } catch (err) {
    if (cdpBrowser) {
      // 连接已建立但开页失败（典型：端口被 Electron 等非调试浏览器占用）——友好提示并断开
      console.warn(
        `[browserLauncher] CDP 端点 ${cdpEndpoint} 可连接但无法开页（可能被非调试浏览器占用），降级处理: ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      await cdpBrowser.close().catch(() => undefined);
    }
    // 连接本身就失败：静默降级到按需拉起模式
  }

  // 模式 2：按需拉起独立 Edge 实例（携带已保存登录态）
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const edgePath = process.env.EDGE_PATH || DEFAULT_EDGE;
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: edgePath,
    headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'],
    viewport: { width: 1280, height: 900 }
  });

  return { browser: context.browser()!, context, mode: 'launch' };
}

/**
 * CDP 端点双检探测：connectOverCDP + newPage。
 * 用于设置页「探测连接」，短超时（默认 3s），绝不拉起浏览器。
 */
export async function probeCdpEndpoint(
  cdpEndpoint: string,
  timeoutMs = 3000
): Promise<{ available: boolean; error?: string }> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs });
    const ctx = browser.contexts()[0] || (await browser.newContext());
    const page = await ctx.newPage();
    await page.close();
    return { available: true };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/**
 * 释放浏览器：CDP 模式仅断开连接（保留常驻浏览器），拉起模式关闭实例。
 * 注意：Playwright 中 connectOverCDP 获得的 browser.close() 仅断开连接、不杀进程。
 */
export async function releaseBrowser(acquired: AcquiredBrowser): Promise<void> {
  try {
    if (acquired.mode === 'cdp') {
      await acquired.browser.close();
    } else {
      await acquired.context.close();
    }
  } catch {
    // 忽略释放异常
  }
}
