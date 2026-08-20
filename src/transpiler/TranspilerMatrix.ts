import { MasterPost, ArticlePayload, CardFlowPayload, ThreadPayload, ShortTextPayload, UnifiedPayload } from '../types';

export type TranspileTarget =
  | { channel: 'wechat'; format: 'article' }
  | { channel: 'xiaohongshu'; format: 'card_flow' }
  | { channel: 'x'; format: 'thread' }
  | { channel: 'weibo'; format: 'short_text' };

export class TranspilerMatrix {
  /**
   * 将母稿转译为各平台标准 Payload
   */
  static transpile(master: MasterPost, target: TranspileTarget): UnifiedPayload {
    switch (target.channel) {
      case 'wechat':
        return this.transpileToWechatArticle(master);
      case 'xiaohongshu':
        return this.transpileToXhsCardFlow(master);
      case 'x':
        return this.transpileToXThread(master);
      case 'weibo':
        return this.transpileToWeiboShortText(master);
      default:
        throw new Error(`不支持的转译渠道: ${(target as any).channel}`);
    }
  }

  // 1. 微信公众号长图文
  private static transpileToWechatArticle(master: MasterPost): ArticlePayload {
    const paragraphs = master.masterMarkdown.split(/\n{2,}/);
    const htmlContent = paragraphs
      .map((p) => {
        if (p.startsWith('## ')) return `<h2>${p.slice(3)}</h2>`;
        if (p.startsWith('# ')) return `<h1>${p.slice(2)}</h1>`;
        if (p.startsWith('- ')) {
          const items = p.split('\n').map((i) => `<li>${i.replace(/^- /, '')}</li>`).join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${p}</p>`;
      })
      .join('\n');

    return {
      type: 'article',
      title: master.title,
      author: 'SoloCreator',
      digest: master.keyTakeaways[0] || master.title,
      htmlContent,
      images: []
    };
  }

  // 2. 小红书卡片流 (需配合 CardRenderer 渲染 3:4 PNG)
  private static transpileToXhsCardFlow(master: MasterPost): CardFlowPayload {
    const cards = master.keyTakeaways.length
      ? master.keyTakeaways
      : master.masterMarkdown.split(/\n{2,}/).slice(0, 8);

    return {
      type: 'card_flow',
      title: master.title,
      caption: `${master.title}\n\n${master.suggestedTags.map((t) => `#${t}`).join(' ') || '#自媒体 #一人工作室'}`,
      cardImagePaths: cards.map((_, i) => `./cards/${master.id}/card_${String(i + 1).padStart(2, '0')}.png`),
      tags: master.suggestedTags
    };
  }

  // 3. X 连推 Thread
  private static transpileToXThread(master: MasterPost): ThreadPayload {
    const tweets: string[] = [];
    // 首推：Hook + 核心结论
    tweets.push(`${master.hookCandidates[0]?.hookText || master.title}\n\n🧵 Thread:`);
    // 中间推文：拆解要点
    const points = master.keyTakeaways.length
      ? master.keyTakeaways
      : master.masterMarkdown.split(/\n{2,}/).slice(1, 8);
    points.forEach((point, idx) => {
      const cleaned = point.replace(/^#+\s*/, '').slice(0, 260);
      tweets.push(`${idx + 1}. ${cleaned}`);
    });
    // 尾推：CTA
    tweets.push(`如果这条 Thread 对你有启发，欢迎转发 + 关注，我会持续分享一人工作室的实战方法。`);

    return { type: 'thread', tweets };
  }

  // 4. 微博短图文
  private static transpileToWeiboShortText(master: MasterPost): ShortTextPayload {
    const hook = master.hookCandidates.find((h) => h.type === 'pain_point') || master.hookCandidates[0];
    const digest = master.keyTakeaways[0] || master.title;

    return {
      type: 'short_text',
      text: `${hook?.hookText || master.title}\n\n${digest}\n\n${master.suggestedTags.map((t) => `#${t}#`).join(' ') || '#自媒体运营#'}`,
      tags: master.suggestedTags
    };
  }
}
