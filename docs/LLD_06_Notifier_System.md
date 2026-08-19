# LLD-06: 人机协同终审与通知子系统详细设计 (Notifier & Review System)

---

## 1. 模块定位与职责边界

### 1.1 模块定位
人机协同终审与通知子系统是整个流水线的**“前哨通讯官”**。它负责：
1. **多端状态汇总**：当各平台草稿箱注入完毕后，聚合微信、小红书、X、微博等各端的草稿预览链接；
2. **多渠道即时推送**：通过飞书交互卡片、企业微信机器人、Telegram Bot 或系统原生桌面通知，向创作者推送通知；
3. **轻量交互与终审扳机**：支持在飞书/企微卡片上**一键查看各端预览图**或**一键标记为已审阅**。

---

## 2. 核心架构与通知流时序

```
┌────────────────────────────────────────────────────────┐
│   PublisherRegistry (完成全渠道草稿箱注入)               │
└───────────────────────────┬────────────────────────────┘
                            │ 触发 onDispatchComplete 事件
                            ▼
┌────────────────────────────────────────────────────────┐
│     NotifierManager.dispatchDraftReadyNotification()   │
└───────────────────────────┬────────────────────────────┘
                            │ 格式化为富文本交互卡片
                            ▼
┌────────────────────────────────────────────────────────┐
│   [FeishuCardNotifier]  [WeComBotNotifier] [MacToast]  │
└───────────────────────────┬────────────────────────────┘
                            │ 发送至创作者手机/桌面
                            ▼
┌────────────────────────────────────────────────────────┐
│ 创作者 10 秒扫视卡片 ──► 点击各平台草稿预览链接 ──► 终审确认 │
└────────────────────────────────────────────────────────┘
```

---

## 3. TypeScript 接口契约与数据模型

### 3.1 核心通知载荷与接口

```typescript
export interface ChannelDispatchSummary {
  channel: string;
  driverType: 'api' | 'cdp' | 'cli';
  status: 'drafted' | 'failed';
  previewUrl?: string;
  cardImagePreviews?: string[]; // 缩略图路径
  error?: string;
}

export interface NotifierPayload {
  masterId: string;
  title: string;
  hookUsed: string;
  summary: string;
  dispatchedAt: Date;
  channelResults: ChannelDispatchSummary[];
}

export interface NotifierPlugin {
  readonly id: string;           // 如 'notifier-feishu-card', 'notifier-wecom-bot'
  readonly name: string;

  isAvailable(): Promise<boolean>;
  sendNotice(payload: NotifierPayload): Promise<void>;
}
```

---

## 4. 典型通知插件实现细节

### 4.1 飞书高交互卡片通知器 (`FeishuCardNotifier`)

在飞书群或私聊机器人中发送交互式富文本卡片：

```typescript
export class FeishuCardNotifier implements NotifierPlugin {
  readonly id = 'notifier-feishu-card';
  readonly name = '飞书互动卡片通知器';

  constructor(private webhookUrl?: string) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.webhookUrl);
  }

  async sendNotice(payload: NotifierPayload): Promise<void> {
    const cardContent = {
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: `🚀 今日多端草稿已就绪: ${payload.title}` },
          template: 'blue'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**黄金Hook**: ${payload.hookUsed}\n**摘要**: ${payload.summary}`
            }
          },
          { tag: 'hr' },
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: payload.channelResults.map(c => 
                `• **${c.channel.toUpperCase()}** (${c.driverType}): ${c.status === 'drafted' ? '✅ 已存入草稿箱' : '❌ 失败: ' + c.error}`
              ).join('\n')
            }
          },
          {
            tag: 'action',
            actions: payload.channelResults
              .filter(c => c.previewUrl)
              .map(c => ({
                tag: 'button',
                text: { tag: 'plain_text', content: `查看 ${c.channel} 草稿` },
                type: 'primary',
                url: c.previewUrl
              }))
          }
        ]
      }
    };

    await fetch(this.webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardContent)
    });
  }
}
```

---

## 5. 异常处理与静默降级

1. **Webhook 鉴权失效或网络抖动**：
   * 自动降级为系统原生桌面通知（`node-notifier` / macOS 通知中心）；
2. **免打扰时段控制**：
   * 支持在 `config.yaml` 中配置静默时段（如 23:00 ~ 07:00），非工作时间只入库不响铃。
