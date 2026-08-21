import { describe, it, expect } from 'vitest';
import {
  SqliteAppConfigStore,
  resolveCdpEndpoint,
  isValidCdpEndpoint,
  DEFAULT_CDP_ENDPOINT
} from '../src/config/AppConfig';
import { SQLiteStorage } from '../src/storage/SQLiteStorage';
import { MasterContentService } from '../src/critic/MasterContentService';
import { HumanizerZhCritic } from '../src/critic/HumanizerZhCritic';
import * as path from 'path';
import * as fs from 'fs';

const TEST_DIR = path.join(process.env.HOME || '.', '.solo-creator-test-config');
const TEST_DB = path.join(TEST_DIR, 'test.db');

function makeStorage(): SQLiteStorage {
  return new SQLiteStorage(TEST_DB);
}

describe('AppConfig（I3：app_config 存储 + 端点解析）', () => {
  it('isValidCdpEndpoint：http(s) 前缀校验', () => {
    expect(isValidCdpEndpoint('http://127.0.0.1:9333')).toBe(true);
    expect(isValidCdpEndpoint('https://localhost:9222')).toBe(true);
    expect(isValidCdpEndpoint('127.0.0.1:9333')).toBe(false);
    expect(isValidCdpEndpoint('ftp://x')).toBe(false);
    expect(isValidCdpEndpoint('')).toBe(false);
    expect(isValidCdpEndpoint(42)).toBe(false);
  });

  it('resolveCdpEndpoint：显式参数 > env > 默认 9333', () => {
    const saved = process.env.CHROME_CDP_ENDPOINT;
    try {
      delete process.env.CHROME_CDP_ENDPOINT;
      expect(resolveCdpEndpoint(null)).toBe(DEFAULT_CDP_ENDPOINT);
      expect(resolveCdpEndpoint(undefined)).toBe(DEFAULT_CDP_ENDPOINT);
      expect(resolveCdpEndpoint('http://explicit:1')).toBe('http://explicit:1');

      process.env.CHROME_CDP_ENDPOINT = 'http://from-env:9222';
      expect(resolveCdpEndpoint(null)).toBe('http://from-env:9222');
      expect(resolveCdpEndpoint('http://explicit:1')).toBe('http://explicit:1');
    } finally {
      if (saved === undefined) delete process.env.CHROME_CDP_ENDPOINT;
      else process.env.CHROME_CDP_ENDPOINT = saved;
    }
  });

  it('SqliteAppConfigStore：读写 + 事务批量 + 覆盖', () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    const storage = makeStorage();
    const store = new SqliteAppConfigStore((storage as any).db as any);
    expect(store.getAppConfig()).toEqual({}); // 未写入 = 空（现状默认）

    store.setAppConfig({ cdpEndpoint: 'http://127.0.0.1:9334', llmEnabled: false, criticEnabled: true });
    expect(store.getAppConfig()).toEqual({
      cdpEndpoint: 'http://127.0.0.1:9334',
      llmEnabled: false,
      criticEnabled: true
    });

    store.setAppConfig({ cdpEndpoint: 'http://127.0.0.1:9335' });
    const partial = store.getAppConfig();
    expect(partial.cdpEndpoint).toBe('http://127.0.0.1:9335');
    expect(partial.llmEnabled).toBe(false); // 未覆盖项保留

    storage.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('SQLiteStorage.getConfigStore()：同库实例读写一致', () => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
    const storage = makeStorage();
    storage.getConfigStore().setAppConfig({ criticEnabled: false });
    expect(storage.getConfigStore().getAppConfig().criticEnabled).toBe(false);
    storage.close();
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });
});

/** 假 LLM：始终可用，返回固定 JSON；用于验证 llmEnabled 强制离线路径 */
class FakeLlm {
  readonly id = 'fake';
  called = 0;
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async chat(): Promise<string> {
    this.called++;
    return JSON.stringify({ title: 'LLM 标题', markdown: '赋能 抓手 闭环正文', takeaways: ['a'] });
  }
}

describe('MasterContentService 生成选项（I3 开关接入）', () => {
  it('criticEnabled=false 跳过质检：八股词原样保留', async () => {
    const fake = new FakeLlm();
    const svc = new MasterContentService(fake as any);
    const post = await svc.createMasterPost('测试灵感', '自媒体创作', {
      llmEnabled: false,
      criticEnabled: false
    });
    expect(post.masterMarkdown).toContain('测试灵感'); // 规则模式内容
    // 未过质检：规则模式正文即原文，无八股词被替换的保证（关键：不再强制 evaluate）
    const critic = HumanizerZhCritic.evaluate(post.masterMarkdown);
    // 与默认路径对比意义：关闭时内容 == 输入原文（规则模式 markdown = rawIdea）
    expect(post.masterMarkdown).toBe('测试灵感');
    expect(critic.purifiedContent).toBe(post.masterMarkdown); // 该文本本无八股词
  });

  it('llmEnabled=false 强制离线：可用 LLM 也不被调用', async () => {
    const fake = new FakeLlm();
    const svc = new MasterContentService(fake as any);
    await svc.createMasterPost('离线强制', '自媒体创作', { llmEnabled: false });
    expect(fake.called).toBe(0);
  });

  it('默认行为不变：llmEnabled 未传时可用 LLM 被调用', async () => {
    const fake = new FakeLlm();
    const svc = new MasterContentService(fake as any);
    await svc.createMasterPost('默认路径', '自媒体创作');
    expect(fake.called).toBe(1);
  });
});
