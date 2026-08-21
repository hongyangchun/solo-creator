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

  // ===== 发布链路渠道级容错契约（回归 #7/#8/#9）=====
  // 测试环境无微信密钥、无可用 CDP 浏览器，两条失败路径正好互补：
  //  - wechat：API 驱动密钥缺失跳过 + CDP 驱动探测失败 → registry 返回结构化失败（不 throw）
  //  - weibo：无任何注册驱动 → registry 直接 throw → engineServer catch 兜底落库（#8 核心路径）
  describe('发布渠道级容错（回归 #7/#8/#9）', () => {
    let retryDispatchId = '';
    let savedCdpEndpoint: string | undefined;
    let savedEdgePath: string | undefined;

    beforeAll(() => {
      // 隔离浏览器环境：CDP 指向必拒端口、Edge 指向不存在路径，
      // 使 CDP 驱动 isAvailable() 确定性快速返回 false，绝不拉起真实浏览器窗口
      savedCdpEndpoint = process.env.CHROME_CDP_ENDPOINT;
      savedEdgePath = process.env.EDGE_PATH;
      process.env.CHROME_CDP_ENDPOINT = 'http://127.0.0.1:1';
      process.env.EDGE_PATH = '/nonexistent/solo-creator-qa-test-edge';
    });

    afterAll(() => {
      if (savedCdpEndpoint === undefined) delete process.env.CHROME_CDP_ENDPOINT;
      else process.env.CHROME_CDP_ENDPOINT = savedCdpEndpoint;
      if (savedEdgePath === undefined) delete process.env.EDGE_PATH;
      else process.env.EDGE_PATH = savedEdgePath;
    });

    it('A+B: publish 含不支持渠道不 500，逐渠道落库 failed 且 error_log 非空', async () => {
      // Arrange：先造一篇母稿（离线降级可成功）
      const created = await request('POST', '/api/v1/master', { idea: '发布容错契约验证', topic: '自媒体创作' });
      expect(created.json.code).toBe(0);
      expect(created.json.data.id).toMatch(/^M-/);
      const masterId: string = created.json.data.id;

      // Act：发布到 wechat（驱动全不可用）+ weibo（无驱动触发 throw）
      const pub = await request('POST', `/api/v1/master/${masterId}/publish`, {
        channels: ['wechat', 'weibo'],
        draftOnly: true
      });

      // Assert：HTTP 200 + code:0，绝不能 500
      expect(pub.status).toBe(200);
      expect(pub.json.code).toBe(0);
      expect(pub.json.data.results).toHaveLength(2);

      const byChannel: Record<string, any> = {};
      for (const r of pub.json.data.results) byChannel[r.channel] = r;

      // weibo：engineServer catch 兜底构造的结构化失败（#8），形状完整
      expect(byChannel.weibo.success).toBe(false);
      expect(byChannel.weibo.driverId).toBe('none');
      expect(byChannel.weibo.errorMessage).toContain('没有可用');

      // wechat：API 无密钥跳过 + CDP 探测失败 → registry 结构化失败，字段完整
      expect(byChannel.wechat.success).toBe(false);
      expect(byChannel.wechat.driverId).toBe('none');
      expect(byChannel.wechat.mode).toBe('draft');
      expect(byChannel.wechat.errorMessage).toBeTruthy();

      // 落库：两条 failed 记录都在（catch 路径与 return 路径都要落库）
      const dispatches = await request('GET', `/api/v1/master/${masterId}/dispatch`);
      expect(dispatches.json.code).toBe(0);
      expect(dispatches.json.data).toHaveLength(2);
      const wechatRec = dispatches.json.data.find((r: any) => r.channel === 'wechat');
      const weiboRec = dispatches.json.data.find((r: any) => r.channel === 'weibo');
      expect(wechatRec).toBeTruthy();
      expect(weiboRec).toBeTruthy();
      expect(wechatRec.dispatch_status).toBe('failed');
      expect(weiboRec.dispatch_status).toBe('failed');

      // B：失败记录 error_log 非空（GUI「展开日志」的数据源，#9）
      expect(String(wechatRec.error_log ?? '').length).toBeGreaterThan(0);
      expect(String(weiboRec.error_log ?? '').length).toBeGreaterThan(0);

      retryDispatchId = weiboRec.id; // 供测试 C
    }, 15000);

    it('C: retry 失败渠道返回结构化结果不 500', async () => {
      if (!retryDispatchId) throw new Error('前置失败：未拿到测试 A 落库的 dispatch id');
      const retry = await request('POST', `/api/v1/dispatch/${retryDispatchId}/retry`);
      expect(retry.status).toBe(200);
      expect(retry.json.code).toBe(0);
      expect(retry.json.data).toBeTypeOf('object');
      expect(retry.json.data.success).toBe(false);
      expect(retry.json.data.driverId).toBe('none');
      expect(String(retry.json.data.errorMessage ?? '').length).toBeGreaterThan(0);
    }, 15000);
  });

  // ===== Analytics Retro MVP 契约 =====
  describe('Analytics Retro MVP（/api/v1/analytics）', () => {
    let analyticsMasterId = '';
    let analyticsDispatchId = '';

    it('准备：母稿 + publish 产生 dispatch（可无 analytics）', async () => {
      process.env.CHROME_CDP_ENDPOINT = 'http://127.0.0.1:1';
      process.env.EDGE_PATH = '/nonexistent/solo-creator-qa-test-edge';
      const created = await request('POST', '/api/v1/master', {
        idea: '复盘契约母稿',
        topic: '自媒体创作'
      });
      expect(created.json.code).toBe(0);
      analyticsMasterId = created.json.data.id;
      const pub = await request('POST', `/api/v1/master/${analyticsMasterId}/publish`, {
        channels: ['wechat'],
        draftOnly: true
      });
      expect(pub.json.code).toBe(0);
      const dispatches = await request('GET', `/api/v1/master/${analyticsMasterId}/dispatch`);
      expect(dispatches.json.data.length).toBeGreaterThanOrEqual(1);
      analyticsDispatchId = dispatches.json.data[0].id;
    }, 15000);

    it('GET /api/v1/analytics 列表含未录入 dispatch（metrics null）', async () => {
      const { status, json } = await request('GET', '/api/v1/analytics');
      expect(status).toBe(200);
      expect(json.code).toBe(0);
      expect(json.data.total).toBeGreaterThanOrEqual(1);
      const row = json.data.items.find((i: any) => i.dispatchId === analyticsDispatchId);
      expect(row).toBeTruthy();
      expect(row.metrics).toBeNull();
      expect(row.fetchedAt).toBeNull();
      expect(row.analyticsId).toBeNull();
      expect(row.channel).toBeTruthy();
      expect(typeof row.title).toBe('string');
    });

    it('GET /api/v1/analytics/:id 详情；非法 id → 422', async () => {
      const okRes = await request('GET', `/api/v1/analytics/${analyticsDispatchId}`);
      expect(okRes.json.code).toBe(0);
      expect(okRes.json.data.dispatchId).toBe(analyticsDispatchId);
      expect(okRes.json.data.metrics).toBeNull();

      const bad = await request('GET', '/api/v1/analytics/D-not-exist');
      expect(bad.json.code).toBe(422);
      expect(bad.json.data).toBeNull();
    });

    it('PUT upsert 指标并再次 GET 一致；负值 → 422', async () => {
      const put = await request('PUT', `/api/v1/analytics/${analyticsDispatchId}`, {
        views: 1200,
        likes: 88,
        comments: 12,
        shares: 5,
        collected: 30
      });
      expect(put.json.code).toBe(0);
      expect(put.json.data.metrics).toEqual({
        views: 1200,
        likes: 88,
        comments: 12,
        shares: 5,
        collected: 30
      });
      expect(put.json.data.fetchedAt).toBeTruthy();
      expect(put.json.data.analyticsId).toMatch(/^A-/);

      const again = await request('GET', `/api/v1/analytics/${analyticsDispatchId}`);
      expect(again.json.data.metrics.views).toBe(1200);

      const neg = await request('PUT', `/api/v1/analytics/${analyticsDispatchId}`, {
        views: -1,
        likes: 0,
        comments: 0,
        shares: 0,
        collected: 0
      });
      expect(neg.json.code).toBe(422);

      const missingDispatch = await request('PUT', '/api/v1/analytics/D-missing', {
        views: 1,
        likes: 0,
        comments: 0,
        shares: 0,
        collected: 0
      });
      expect(missingDispatch.json.code).toBe(422);
    });

    it('POST refresh：已有行仅刷 fetched_at，mode=placeholder，created=false', async () => {
      const before = await request('GET', `/api/v1/analytics/${analyticsDispatchId}`);
      const prevViews = before.json.data.metrics.views;
      const refresh = await request('POST', `/api/v1/analytics/${analyticsDispatchId}/refresh`);
      expect(refresh.json.code).toBe(0);
      expect(refresh.json.data.mode).toBe('placeholder');
      expect(refresh.json.data.created).toBe(false);
      expect(refresh.json.data.metrics.views).toBe(prevViews);
      expect(refresh.json.data.fetchedAt).toBeTruthy();

      const bad = await request('POST', '/api/v1/analytics/D-missing/refresh');
      expect(bad.json.code).toBe(422);
    });

    it('POST refresh：无 analytics 行时插全 0，created=true', async () => {
      const pub = await request('POST', `/api/v1/master/${analyticsMasterId}/publish`, {
        channels: ['xiaohongshu'],
        draftOnly: true
      });
      expect(pub.json.code).toBe(0);
      const dispatches = await request('GET', `/api/v1/master/${analyticsMasterId}/dispatch`);
      const fresh = dispatches.json.data.find((d: any) => d.channel === 'xiaohongshu');
      expect(fresh).toBeTruthy();
      const detailBefore = await request('GET', `/api/v1/analytics/${fresh.id}`);
      expect(detailBefore.json.data.metrics).toBeNull();

      const refresh = await request('POST', `/api/v1/analytics/${fresh.id}/refresh`);
      expect(refresh.json.code).toBe(0);
      expect(refresh.json.data.mode).toBe('placeholder');
      expect(refresh.json.data.created).toBe(true);
      expect(refresh.json.data.metrics).toEqual({
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        collected: 0
      });
    }, 15000);
  });
});
