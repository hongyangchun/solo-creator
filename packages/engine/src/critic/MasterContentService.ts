import { LlmAdapter } from '../llm/LlmAdapter';
import { HookGeneratorService } from '../critic/HookGeneratorService';
import { HumanizerZhCritic } from '../critic/HumanizerZhCritic';
import { MasterPost } from '../types';

/** 生成选项（I3 app_config 接入；未写入配置 = 现状默认行为） */
export interface MasterGenerateOptions {
  /** false = 强制离线规则模式（优先于 LLM Key 是否存在） */
  llmEnabled?: boolean;
  /** false = 跳过 HumanizerZhCritic 去 AI 味质检 */
  criticEnabled?: boolean;
}

/**
 * 母稿生成服务：
 * 1. 优先调用 LLM 展开完整长文母稿
 * 2. LLM 不可用时自动降级为规则式生成（离线模式）
 * 3. 输出前强制过 HumanizerZhCritic 去 AI 味质检
 */
export class MasterContentService {
  constructor(private llm: LlmAdapter) {}

  async createMasterPost(rawIdea: string, topic: string = '自媒体创作', opts: MasterGenerateOptions = {}): Promise<MasterPost> {
    const llmAllowed = opts.llmEnabled !== false;
    const criticAllowed = opts.criticEnabled !== false;
    let title = rawIdea.slice(0, 30);
    let markdown = rawIdea;
    let takeaways: string[] = [rawIdea];
    let source: 'llm' | 'rule' = 'rule';

    const llmReady = llmAllowed ? await this.llm.isAvailable() : false;
    if (llmReady) {
      try {
        const result = await this.generateWithLlm(rawIdea, topic);
        title = result.title;
        markdown = result.markdown;
        takeaways = result.takeaways;
        source = 'llm';
      } catch (err: any) {
        console.warn(`[MasterContentService] LLM 生成失败，降级规则模式: ${err.message}`);
      }
    }

    // 质检（criticEnabled=false 时跳过，内容原样输出）
    const purified = criticAllowed
      ? (() => {
          const critic = HumanizerZhCritic.evaluate(markdown);
          return critic.passed ? critic.purifiedContent : HumanizerZhCritic.evaluate(critic.purifiedContent).purifiedContent;
        })()
      : markdown;

    const hooks = HookGeneratorService.generateHooks(topic, rawIdea);

    return {
      id: `M-${Date.now()}`,
      rawIdea,
      title,
      hookCandidates: hooks.map((h) => ({ type: h.type, hookText: h.hookText })),
      masterMarkdown: purified,
      keyTakeaways: takeaways,
      suggestedTags: [topic, '一人工作室'].filter((t, i, arr) => arr.indexOf(t) === i),
      createdAt: new Date().toISOString(),
      ...(source === 'llm' ? {} : {})
    };
  }

  private async generateWithLlm(
    rawIdea: string,
    topic: string
  ): Promise<{ title: string; markdown: string; takeaways: string[] }> {
    const prompt = `你是一位资深自媒体写作者。请基于以下核心灵感，写一篇 1200 字左右的深度长文母稿。

【核心灵感】${rawIdea}
【主题领域】${topic}

要求：
1. 标题简短有力（20 字以内），不用夸张词汇
2. 开头直接切入，3 句话内给出核心观点
3. 用具体案例和数字支撑论点，不用空洞形容词
4. 段落之间用自然过渡，不用"值得注意的是""总而言之"等套话
5. 禁止使用：赋能、抓手、闭环、底层逻辑、颠覆性、史诗级

请输出纯 JSON：
{"title": "...", "markdown": "正文（用 ## 分节）", "takeaways": ["要点1", "要点2", "要点3"]}`;

    const res = await this.llm.chat(
      [
        { role: 'system', content: 'You are a professional content writer. Respond in JSON only.' },
        { role: 'user', content: prompt }
      ],
      { responseFormat: 'json', maxTokens: 4096, temperature: 0.7 }
    );

    const parsed = JSON.parse(res);
    return {
      title: String(parsed.title || rawIdea.slice(0, 30)),
      markdown: String(parsed.markdown || rawIdea),
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways.map(String) : [rawIdea]
    };
  }
}
