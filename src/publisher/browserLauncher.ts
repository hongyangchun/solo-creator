import { chromium, Browser, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AcquiredBrowser {
  browser: Browser;
  context: BrowserContext;
  mode: 'cdp' | 'launch';
}

const DEFAULT_EDGE =
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const PROFILE_DIR = path.join(process.env.HOME || os.homedir(), '.solo-creator', 'browser-profile');

/**
 * 获取一个浏览器上下文：
 * 1. 若配置了 CHROME_CDP_ENDPOINT 且可达 → 复用常驻调试浏览器 (connectOverCDP)
 * 2. 否则 → 用 Edge 二进制 + 已保存登录态的用户目录，按需拉起独立实例
 *
 * 登录 cookie 持久化在 PROFILE_DIR，首次扫码后无需重复登录。
 */
export async function acquireBrowserContext(): Promise<AcquiredBrowser> {
  const cdpEndpoint = process.env.CHROME_CDP_ENDPOINT || 'http://127.0.0.1:9222';

  // 模式 1：复用常驻 CDP 浏览器
  try {
    const probe = await chromium.connectOverCDP(cdpEndpoint, { timeout: 1500 });
    await probe.close(); // 仅探测，立刻断开
    const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 5000 });
    const context = browser.contexts()[0] || (await browser.newContext());
    return { browser, context, mode: 'cdp' };
  } catch {
    // 回退到按需拉起模式
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
