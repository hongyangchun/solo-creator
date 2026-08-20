import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { startEngineServer } from '../src/server/engineServer';
import { LocalKeyVault } from '../src/storage/LocalKeyVault';
import * as path from 'path';
import * as fs from 'fs';

const TEST_PORT = 39901;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const TEST_VAULT_DIR = path.join(process.env.HOME || '.', '.solo-creator-test-vault');

function request(method: string, pathName: string, body?: any): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${BASE}${pathName}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 0, json: raw });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('engineServer HTTP 契约（Spec §2）', () => {
  let server: http.Server;

  beforeAll(async () => {
    // 测试期把 HOME 指向隔离目录，避免污染真实 ~/.solo-creator
    process.env.HOME = TEST_VAULT_DIR;
    fs.mkdirSync(TEST_VAULT_DIR, { recursive: true });
    server = startEngineServer(TEST_PORT);
    await new Promise((r) => setTimeout(r, 300));
  });

  afterAll(() => {
    server.close();
    fs.rmSync(TEST_VAULT_DIR, { recursive: true, force: true });
  });

  it('GET /api/v1/health 返回 ok', async () => {
    const { status, json } = await request('GET', '/api/v1/health');
    expect(status).toBe(200);
    expect(json.code).toBe(0);
    expect(json.data.status).toBe('ok');
    expect(json.data.version).toBe('0.1.0');
  });

  it('POST /api/v1/secrets 写入后仅返回掩码，绝不回传 value', async () => {
    const { json } = await request('POST', '/api/v1/secrets', {
      key: 'DEEPSEEK_API_KEY',
      value: 'sk-test-1234-abcd'
    });
    expect(json.code).toBe(0);
    expect(json.data.masked).toContain('abcd');
    expect(JSON.stringify(json)).not.toContain('sk-test-1234');
  });

  it('GET /api/v1/secrets 列表：exists=true + 掩码，无明文', async () => {
    const { json } = await request('GET', '/api/v1/secrets');
    const target = json.data.find((s: any) => s.key === 'DEEPSEEK_API_KEY');
    expect(target.exists).toBe(true);
    expect(target.masked.endsWith('abcd')).toBe(true);
    expect(JSON.stringify(json)).not.toContain('sk-test-1234');
  });

  it('ADR-002 硬约束：GET /api/v1/secrets/:key（明文）必须被拒绝', async () => {
    const { json } = await request('GET', '/api/v1/secrets/DEEPSEEK_API_KEY');
    expect(json.code).toBe(403);
    expect(json.data).toBeNull();
    expect(JSON.stringify(json)).not.toContain('sk-test-1234');
  });

  it('密钥统一化：DeepSeekAdapter 经 LocalKeyVault 取 Key（无 env 兜底）', async () => {
    // 保险箱写入后，适配器应可用
    const vault = new LocalKeyVault();
    vault.setSecret('DEEPSEEK_API_KEY', 'sk-vault-only');
    const { DeepSeekAdapter } = await import('../src/llm/DeepSeekAdapter');
    const adapter = new DeepSeekAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('POST /api/v1/master 生成母稿（离线降级）并落库', async () => {
    const { json } = await request('POST', '/api/v1/master', {
      idea: '一人工作室是未来工作形态',
      topic: '自媒体创作'
    });
    expect(json.code).toBe(0);
    expect(json.data.id).toMatch(/^M-/);
    expect(json.data.generatedBy).toBe('offline'); // 测试环境无真实 Key 可达网络
    expect(json.data.hookCandidates.length).toBeGreaterThanOrEqual(5);
    expect(json.data.critic.score).toBeGreaterThan(0);
  });

  it('GET /api/v1/master 列表含刚生成的母稿', async () => {
    const { json } = await request('GET', '/api/v1/master?page=1&pageSize=10');
    expect(json.code).toBe(0);
    expect(json.data.total).toBeGreaterThanOrEqual(1);
    expect(json.data.items[0].id).toMatch(/^M-/);
  });

  it('PATCH /api/v1/master/:id 保存编辑', async () => {
    const list = await request('GET', '/api/v1/master');
    const id = list.json.data.items[0].id;
    const { json } = await request('PATCH', `/api/v1/master/${id}`, {
      title: '编辑后的标题'
    });
    expect(json.code).toBe(0);
    expect(json.data.title).toBe('编辑后的标题');
  });

  it('POST /api/v1/master/:id/transpile 返回四端 Payload', async () => {
    const list = await request('GET', '/api/v1/master');
    const id = list.json.data.items[0].id;
    const { json } = await request('POST', `/api/v1/master/${id}/transpile`, {
      channels: ['wechat', 'xiaohongshu', 'x', 'weibo']
    });
    expect(json.code).toBe(0);
    expect(json.data.wechat.type).toBe('article');
    expect(json.data.xiaohongshu.type).toBe('card_flow');
    expect(json.data.x.type).toBe('thread');
    expect(json.data.weibo.type).toBe('short_text');
  });

  it('POST /api/v1/master/:id/card-preview 返回 HTML 字符串数组（不经 Playwright）', async () => {
    const list = await request('GET', '/api/v1/master');
    const id = list.json.data.items[0].id;
    const { json } = await request('POST', `/api/v1/master/${id}/card-preview`, { theme: 'minimal_dark' });
    expect(json.code).toBe(0);
    expect(json.data.count).toBeGreaterThan(0);
    expect(json.data.cards[0]).toContain('<!DOCTYPE html>');
  });

  it('GET /api/v1/dashboard 返回聚合数据', async () => {
    const { json } = await request('GET', '/api/v1/dashboard');
    expect(json.code).toBe(0);
    expect(json.data.masters.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(json.data.dispatches)).toBe(true);
  });

  it('DELETE /api/v1/master/:id 删除后 404', async () => {
    const created = await request('POST', '/api/v1/master', { idea: '待删除的母稿' });
    const id = created.json.data.id;
    const del = await request('DELETE', `/api/v1/master/${id}`);
    expect(del.json.code).toBe(0);
    const gone = await request('GET', `/api/v1/master/${id}`);
    expect(gone.json.code).toBe(404);
  });

  it('未知端点返回 404 结构化错误', async () => {
    const { json } = await request('GET', '/api/v1/nonexistent');
    expect(json.code).toBe(404);
  });
});
