import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export interface LoginGuardOptions {
  loginCheckSelector: string;
  qrCodeSelector: string;
  successRedirectUrlPart: string;
  timeoutMs?: number;
}

/**
 * CDP 登录态失效守卫：
 * 检测平台登录页特征 → 截取二维码 → 轮询等待扫码 → 恢复会话
 */
export class LoginStateGuard {
  static async ensureLoggedIn(page: Page, options: LoginGuardOptions): Promise<boolean> {
    const timeout = options.timeoutMs || 120000;
    const isLoginPage = await page.$(options.loginCheckSelector);

    if (!isLoginPage) {
      return true; // 登录态正常
    }

    console.warn(`[LoginStateGuard] 检测到平台登录态已过期，准备拉起扫码接管流程...`);

    await page.waitForSelector(options.qrCodeSelector, { timeout: 10000 });
    const qrElement = await page.$(options.qrCodeSelector);
    if (!qrElement) {
      throw new Error('未找到登录二维码元素，无法进行扫码接管');
    }

    const tmpQrPath = path.join(process.env.HOME || '.', '.solo-creator', 'temp', `login_qr_${Date.now()}.png`);
    fs.mkdirSync(path.dirname(tmpQrPath), { recursive: true });
    await qrElement.screenshot({ path: tmpQrPath });

    console.info(`[LoginStateGuard] 登录二维码已保存至: ${tmpQrPath}，请在手机上确认扫码。`);

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
        fs.unlinkSync(tmpQrPath);
      }
    }
  }
}
