export type NotifierEvent =
  | { kind: 'draft_ready'; channel: string; previewUrl?: string; title: string }
  | { kind: 'login_required'; channel: string; qrCodePath: string }
  | { kind: 'dispatch_failed'; channel: string; error: string }
  | { kind: 'pipeline_done'; masterId: string; summary: string };

export interface NotifierPayload {
  event: NotifierEvent;
  timestamp: string;
}

export interface NotifierPlugin {
  readonly id: string;
  notify(payload: NotifierPayload): Promise<void>;
}

/**
 * 控制台通知器（默认兜底）
 */
export class ConsoleNotifier implements NotifierPlugin {
  readonly id = 'console';

  async notify(payload: NotifierPayload): Promise<void> {
    const { event } = payload;
    switch (event.kind) {
      case 'draft_ready':
        console.log(`\n🔔 [通知] 《${event.title}》草稿已存入 ${event.channel} 草稿箱 ${event.previewUrl ? `→ ${event.previewUrl}` : ''}`);
        break;
      case 'login_required':
        console.log(`\n🔔 [通知] ${event.channel} 登录态失效，请扫码: ${event.qrCodePath}`);
        break;
      case 'dispatch_failed':
        console.log(`\n❌ [通知] ${event.channel} 分发失败: ${event.error}`);
        break;
      case 'pipeline_done':
        console.log(`\n🎉 [通知] 全流水线完成: ${event.summary}`);
        break;
    }
  }
}

/**
 * 飞书机器人通知器：推送交互式卡片，支持点击跳转草稿预览
 */
export class FeishuCardNotifier implements NotifierPlugin {
  readonly id = 'feishu';

  constructor(private webhookUrl: string = process.env.FEISHU_WEBHOOK_URL || '') {}

  async notify(payload: NotifierPayload): Promise<void> {
    if (!this.webhookUrl) {
      return; // 未配置则静默跳过
    }

    const { event } = payload;
    let title = 'SoloCreator 通知';
    let content = '';

    switch (event.kind) {
      case 'draft_ready':
        title = `草稿已就绪 · ${event.channel}`;
        content = `《${event.title}》已存入草稿箱`;
        break;
      case 'login_required':
        title = `需要扫码 · ${event.channel}`;
        content = `登录态已过期，请扫码恢复`;
        break;
      case 'dispatch_failed':
        title = `分发失败 · ${event.channel}`;
        content = event.error;
        break;
      case 'pipeline_done':
        title = '流水线完成';
        content = event.summary;
        break;
    }

    const card = {
      msg_type: 'interactive',
      card: {
        header: { title: { tag: 'plain_text', content: title } },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content } },
          ...(event.kind === 'draft_ready' && event.previewUrl
            ? [
                {
                  tag: 'action',
                  actions: [
                    {
                      tag: 'button',
                      text: { tag: 'plain_text', content: '查看草稿' },
                      type: 'primary',
                      url: event.previewUrl
                    }
                  ]
                }
              ]
            : [])
        ]
      }
    };

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(card)
      });
    } catch (err: any) {
      console.warn(`[FeishuCardNotifier] 推送失败: ${err.message}`);
    }
  }
}
