import { SQLiteStorage } from '../storage/SQLiteStorage';
import { LocalKeyVault } from '../storage/LocalKeyVault';
import { DeepSeekAdapter } from '../llm/DeepSeekAdapter';
import { LlmAdapter } from '../llm/LlmAdapter';
import { MasterContentService } from '../critic/MasterContentService';
import { PublisherRegistry } from '../publisher';
import { WeChatApiDriver } from '../publisher/WeChatApiDriver';
import { WeChatCdpDriver } from '../publisher/WeChatCdpDriver';
import { XCdpDriver } from '../publisher/XCdpDriver';
import { XhsCdpDriver } from '../publisher/XhsCdpDriver';

export const ENGINE_VERSION = '0.1.0';

export interface EngineContextConfig {
  dbPath?: string;
  cdpEndpoint?: string;
}

/**
 * 引擎 Composition Root：CLI / HTTP sidecar / 未来 DSH 插件的唯一组装点。
 * 零 `@dsh/core` 依赖。PublisherRegistry 在此一次性注册四驱动。
 */
export interface EngineContext {
  storage: SQLiteStorage;
  vault: LocalKeyVault;
  llm: LlmAdapter;
  masterService: MasterContentService;
  registry: PublisherRegistry;
  /** 透传配置（本轮驱动仍可读 env；供后续 CDP 可配置化） */
  cdpEndpoint?: string;
  getVersion(): string;
  close(): void;
}

function buildPublisherRegistry(): PublisherRegistry {
  const registry = new PublisherRegistry();
  // 与历史 CLI / engineServer 一致：API 优先，CDP 降级
  registry.register(new WeChatApiDriver());
  registry.register(new WeChatCdpDriver());
  registry.register(new XCdpDriver());
  registry.register(new XhsCdpDriver());
  return registry;
}

export function createEngineContext(config: EngineContextConfig = {}): EngineContext {
  const storage = config.dbPath ? new SQLiteStorage(config.dbPath) : new SQLiteStorage();
  const vault = new LocalKeyVault();
  const llm = new DeepSeekAdapter();
  const masterService = new MasterContentService(llm);
  const registry = buildPublisherRegistry();
  const cdpEndpoint = config.cdpEndpoint ?? process.env.CHROME_CDP_ENDPOINT;

  return {
    storage,
    vault,
    llm,
    masterService,
    registry,
    cdpEndpoint,
    getVersion(): string {
      return ENGINE_VERSION;
    },
    close(): void {
      storage.close();
    }
  };
}
