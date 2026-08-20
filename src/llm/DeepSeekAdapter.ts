import { LlmAdapter, ChatMessage, LlmChatOptions, LlmTaskQueue } from './LlmAdapter';
import { LocalKeyVault } from '../storage/LocalKeyVault';

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';

export class DeepSeekAdapter implements LlmAdapter {
  readonly id = 'deepseek';
  private queue = new LlmTaskQueue(2, 3);
  private apiKey?: string;

  constructor(
    apiKey?: string,
    private baseUrl: string = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL
  ) {
    // 密钥解析顺序：显式参数 → LocalKeyVault 保险箱。
    // Spec §3：不再回退 process.env.DEEPSEEK_API_KEY（密钥统一经保险箱，GUI 才能接管）。
    this.apiKey = apiKey || DeepSeekAdapter.resolveKeyFromVault();
  }

  private static resolveKeyFromVault(): string | undefined {
    try {
      return new LocalKeyVault().getSecret('DEEPSEEK_API_KEY') ?? undefined;
    } catch {
      return undefined;
    }
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
