import { LlmAdapter, ChatMessage, LlmChatOptions, LlmTaskQueue } from './LlmAdapter';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';

export class DeepSeekAdapter implements LlmAdapter {
  readonly id = 'deepseek';
  private queue = new LlmTaskQueue(2, 3);

  constructor(
    private apiKey?: string,
    private baseUrl: string = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL
  ) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  async chat(messages: ChatMessage[], options: LlmChatOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置，无法调用 LLM');
    }

    return this.queue.run(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 4096,
          ...(options.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (res.status === 429) {
        const err: any = new Error('DeepSeek API 限流 (429)');
        err.status = 429;
        throw err;
      }
      if (!res.ok) {
        throw new Error(`DeepSeek API 报错: ${res.status} ${await res.text()}`);
      }

      const data = (await res.json()) as any;
      return data.choices[0].message.content as string;
    });
  }
}
