export * from './types';
export {
  createEngineContext,
  ENGINE_VERSION,
  type EngineContext,
  type EngineContextConfig
} from './core/createEngineContext';

import {
  createEngineContext,
  type EngineContext,
  type EngineContextConfig
} from './core/createEngineContext';
import { SQLiteStorage } from './storage/SQLiteStorage';
import { LocalKeyVault } from './storage/LocalKeyVault';
import { LlmAdapter } from './llm/LlmAdapter';
import { MasterContentService } from './critic/MasterContentService';
import { PublisherRegistry } from './publisher';

/**
 * SoloCreator 业务门面：对 createEngineContext 的薄类封装。
 * CLI / HTTP / 未来 dsh-plugin 共用同一 Composition Root，零 `@dsh/core` 依赖。
 */
export class SoloCreatorCore {
  readonly storage: SQLiteStorage;
  readonly vault: LocalKeyVault;
  readonly llm: LlmAdapter;
  readonly masterService: MasterContentService;
  readonly registry: PublisherRegistry;
  readonly cdpEndpoint?: string;

  private readonly ctx: EngineContext;

  constructor(config: EngineContextConfig = {}) {
    this.ctx = createEngineContext(config);
    this.storage = this.ctx.storage;
    this.vault = this.ctx.vault;
    this.llm = this.ctx.llm;
    this.masterService = this.ctx.masterService;
    this.registry = this.ctx.registry;
    this.cdpEndpoint = this.ctx.cdpEndpoint;
  }

  getVersion(): string {
    return this.ctx.getVersion();
  }

  close(): void {
    this.ctx.close();
  }
}
