import * as path from 'path';
import { Database } from 'better-sqlite3';

/** 应用配置（I3：渠道与驱动 / 模型与质检）持久化形态 */
export interface AppConfig {
  /** CDP 调试端点，默认 http://127.0.0.1:9333 */
  cdpEndpoint: string;
  /** 显式关闭 LLM（强制离线模式）；未写入时按有无 DeepSeek Key 自动 */
  llmEnabled: boolean;
  /** 显式关闭 HumanizerZhCritic 质检；默认 true */
  criticEnabled: boolean;
}

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9333';

export interface AppConfigStore {
  getAppConfig(): Partial<AppConfig>;
  setAppConfig(patch: Partial<AppConfig>): void;
}

/**
 * 基于 SQLite app_config 表（key-value 行）的配置存取。
 * 表由 SQLiteStorage 建，这里只做读写，保持薄层、可注入。
 */
export class SqliteAppConfigStore implements AppConfigStore {
  constructor(private db: Database.Database) {}

  getAppConfig(): Partial<AppConfig> {
    const rows = this.db.prepare('SELECT key, value FROM app_config').all() as Array<{ key: string; value: string }>;
    const out: Partial<AppConfig> = {};
    for (const row of rows) {
      if (row.key === 'cdpEndpoint') out.cdpEndpoint = row.value;
      if (row.key === 'llmEnabled') out.llmEnabled = row.value === 'true';
      if (row.key === 'criticEnabled') out.criticEnabled = row.value === 'true';
    }
    return out;
  }

  setAppConfig(patch: Partial<AppConfig>): void {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
    const tx = this.db.transaction(() => {
      if (typeof patch.cdpEndpoint === 'string') stmt.run('cdpEndpoint', patch.cdpEndpoint);
      if (typeof patch.llmEnabled === 'boolean') stmt.run('llmEnabled', patch.llmEnabled ? 'true' : 'false');
      if (typeof patch.criticEnabled === 'boolean') stmt.run('criticEnabled', patch.criticEnabled ? 'true' : 'false');
    });
    tx();
  }
}

/**
 * 端点解析（I3 优先级）：
 *   ① 显式参数（probe/publish 调用时传入的最新存储值）
 *   ② 环境变量 CHROME_CDP_ENDPOINT（保持 CLI 兼容）
 *   ③ 默认 http://127.0.0.1:9333
 */
export function resolveCdpEndpoint(explicit?: string | null): string {
  if (explicit && explicit.trim()) return explicit.trim();
  const env = process.env.CHROME_CDP_ENDPOINT;
  if (env && env.trim()) return env.trim();
  return DEFAULT_CDP_ENDPOINT;
}

/** 校验 CDP 端点：必须 http(s):// 前缀 */
export function isValidCdpEndpoint(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\/.+/i.test(v.trim());
}
