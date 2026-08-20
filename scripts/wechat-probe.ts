import { chromium } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function main() {
  const PROFILE_DIR = path.join(process.env.HOME || os.homedir(), '.solo-creator', 'browser-profile');
  const EDGE = process.env.EDGE_PATH || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: EDGE, headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--no-first-run'],
    viewport: { width: 1280, height: 900 }
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto('https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&isNew=1&type=10', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const info = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || '').slice(0, 300),
    htmlLen: document.documentElement.outerHTML.length,
    hasAppmsgEditor: document.documentElement.outerHTML.includes('appmsg'),
    iframes: Array.from(document.querySelectorAll('iframe')).map((f: any) => f.src || f.getAttribute('data-src') || '(empty)').slice(0, 10)
  }));
  console.log(JSON.stringify(info, null, 1));

  // 截图保存供查看（用 base64 输出前 200 字符确认非空）
  const buf = await page.screenshot({ fullPage: false });
  console.log('screenshot bytes:', buf.length);

  await context.close();
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
