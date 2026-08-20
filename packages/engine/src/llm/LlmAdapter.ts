export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  responseFormat?: 'json' | 'text';
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM 推理适配器 SPI（LLD 七大可插拔槽位之一）
 * 实现：DeepSeekAdapter（OpenAI 兼容协议）/ RuleBasedFallbackAdapter（离线降级）
 */
export interface LlmAdapter {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<string>;
}

export class LlmTaskQueue {
  private running = 0;
  private queue: (() => void)[] = [];

  constructor(private concurrency: number = 2, private maxRetries: number = 3) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await task();
      } catch (err: any) {
        lastError = err;
        const isRateLimit = err?.status === 429;
        if (!isRateLimit || attempt === this.maxRetries) break;
        // 指数退避：2s, 4s, 8s
        const delayMs = 2000 * Math.pow(2, attempt);
        console.warn(`[LlmTaskQueue] 429 限流，${delayMs / 1000}s 后重试 (${attempt + 1}/${this.maxRetries})...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    this.running--;
    const next = this.queue.shift();
    if (next) next();
    throw lastError;
  }
}
