import * as http from 'http';
import { SQLiteStorage } from '../storage/SQLiteStorage';
import { LocalKeyVault } from '../storage/LocalKeyVault';
import { MasterContentService } from '../critic/MasterContentService';
import { HumanizerZhCritic } from '../critic/HumanizerZhCritic';
import { HookGeneratorService } from '../critic/HookGeneratorService';
import { DeepSeekAdapter } from '../llm/DeepSeekAdapter';
import { TranspilerMatrix, TranspileTarget } from '../transpiler/TranspilerMatrix';
import { CardRenderer } from '../renderer/CardRenderer';
import { PublisherRegistry } from '../publisher';
import { WeChatApiDriver } from '../publisher/WeChatApiDriver';
import { ChannelType, MasterPost, UnifiedPayload } from '../types';

const PORT = Number(process.env.ENGINE_PORT || 39281);
const VERSION = '0.1.0';

// ---- 响应形状 { code, data, message } ----
function ok(data: unknown, res: http.ServerResponse): void {
  const body = JSON.stringify({ code: 0, data, message: '' });
  res.writeHead(200, jsonHeaders());
  res.end(body);
}

function fail(code: number, message: string, res: http.ServerResponse, status = 200): void {
  res.writeHead(status, jsonHeaders());
  res.end(JSON.stringify({ code, data: null, message }));
}

function jsonHeaders(): http.OutgoingHttpHeaders {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---- 密钥掩码：仅末 4 位，明文永不外泄（ADR-002）----
const KNOWN_SECRET_KEYS = [
  'DEEPSEEK_API_KEY',
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'X_API_KEY',
  'X_API_SECRET',
  'X_ACCESS_TOKEN',
  'X_ACCESS_SECRET',
  'FEISHU_WEBHOOK_URL'
];

function maskSecret(value: string | null): string {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(value.length - 4, 24))}${value.slice(-4)}`;
}

// ---- 长任务进度（内存态 Job 注册表，SSE 推送）----
interface Job {
  id: string;
  kind: 'render' | 'publish';
  progress: number;
  total: number;
  status: 'running' | 'done' | 'failed';
  message: string;
  result?: unknown;
}

const jobs = new Map<string, Job>();

function pushJob(res: http.ServerResponse, job: Job): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*',
    Connection: 'keep-alive'
  });
  const send = () => res.write(`data: ${JSON.stringify(job)}\n\n`);
  send();
  const timer = setInterval(() => {
    send();
    if (job.status !== 'running') {
      clearInterval(timer);
      res.end();
    }
  }, 400);
}

async function runRenderJob(masterId: string, theme: 'minimal_dark' | 'notion_light', storage: SQLiteStorage): Promise<Job> {
  const job: Job = { id: `J-${Date.now()}`, kind: 'render', progress: 0, total: 100, status: 'running', message: '准备渲染' };
  jobs.set(job.id, job);
  try {
    const master = storage.getMasterPost(masterId);
    if (!master) throw new Error(`母稿不存在: ${masterId}`);
    const payload = TranspilerMatrix.transpile(master, { channel: 'xiaohongshu', format: 'card_flow' }) as any;
    job.message = 'Playwright 渲染中';
    const paths = await CardRenderer.renderCardFlow(payload, { theme });
    job.progress = 100;
    job.status = 'done';
    job.message = `已生成 ${paths.length} 张卡片`;
    job.result = { imagePaths: paths };
  } catch (err: any) {
    job.status = 'failed';
    job.message = err.message;
  }
  return job;
}

// ---- 发布驱动注册（与 CLI 一致：API 优先，CDP 降级）----
function buildRegistry(): PublisherRegistry {
  const registry = new PublisherRegistry();
  registry.register(new WeChatApiDriver());
  return registry;
}

// ---- 渠道→转译目标映射 ----
function targetFor(channel: string): TranspileTarget | null {
  switch (channel) {
    case 'wechat':
      return { channel: 'wechat', format: 'article' };
    case 'xiaohongshu':
      return { channel: 'xiaohongshu', format: 'card_flow' };
    case 'x':
      return { channel: 'x', format: 'thread' };
    case 'weibo':
      return { channel: 'weibo', format: 'short_text' };
    default:
      return null;
  }
}

export function startEngineServer(port: number = PORT): http.Server {
  const storage = new SQLiteStorage();
  const vault = new LocalKeyVault();
  const llm = new DeepSeekAdapter();
  const masterService = new MasterContentService(llm);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    const p = url.pathname;
    const m = req.method || 'GET';

    if (m === 'OPTIONS') {
      res.writeHead(204, jsonHeaders());
      return res.end();
    }

    try {
      // ===== 健康检查 =====
      if (p === '/api/v1/health' && m === 'GET') {
        return ok({ status: 'ok', version: VERSION }, res);
      }

      // ===== ① 密钥中心 =====
      if (p === '/api/v1/secrets' && m === 'POST') {
        const { key, value } = await readJsonBody(req);
        if (!key || !value) return fail(422, 'key 与 value 必填', res);
        vault.setSecret(key, String(value));
        return ok({ key, masked: maskSecret(String(value)) }, res); // value 绝不回传
      }
      if (p === '/api/v1/secrets' && m === 'GET') {
        const list = KNOWN_SECRET_KEYS.map((key) => {
          const val = vault.getSecret(key);
          return { key, masked: maskSecret(val), exists: Boolean(val) };
        });
        return ok(list, res);
      }
      const maskedMatch = p.match(/^\/api\/v1\/secrets\/([^/]+)\/masked$/);
      if (maskedMatch && m === 'GET') {
        const val = vault.getSecret(maskedMatch[1]);
        return ok({ key: maskedMatch[1], masked: maskSecret(val), exists: Boolean(val) }, res);
      }
      const delSecret = p.match(/^\/api\/v1\/secrets\/([^/]+)$/);
      if (delSecret && m === 'DELETE') {
        // LocalKeyVault 无 delete API：以覆盖空串实现语义删除（空串视同未配置）
        vault.setSecret(delSecret[1], '');
        return ok({ key: delSecret[1], deleted: true }, res);
      }
      // ⛔ ADR-002：GET /api/v1/secrets/:key（明文）故意缺失 —— 落到这里即拒绝
      const plainGet = p.match(/^\/api\/v1\/secrets\/([^/]+)$/);
      if (plainGet && m === 'GET') {
        return fail(403, '安全约束：密钥明文不可读取（ADR-002）', res);
      }

      // ===== ② 母稿创作台 =====
      if (p === '/api/v1/master' && m === 'POST') {
        const { idea, topic } = await readJsonBody(req);
        if (!idea) return fail(422, 'idea 必填', res);
        const post = await masterService.createMasterPost(String(idea), topic || '自媒体创作');
        storage.saveMasterPost(post);
        const critic = HumanizerZhCritic.evaluate(post.masterMarkdown);
        const llmReady = await llm.isAvailable();
        return ok({ ...post, critic: { score: critic.score, passed: critic.passed }, generatedBy: llmReady ? 'llm' : 'offline' }, res);
      }
      if (p === '/api/v1/master' && m === 'GET') {
        const page = Number(url.searchParams.get('page') || 1);
        const pageSize = Number(url.searchParams.get('pageSize') || 20);
        return ok(storage.listMasterPosts(page, pageSize), res);
      }
      const masterOne = p.match(/^\/api\/v1\/master\/([^/]+)$/);
      if (masterOne) {
        const id = masterOne[1];
        if (m === 'GET') {
          const post = storage.getMasterPost(id);
          if (!post) return fail(404, `母稿不存在: ${id}`, res);
          return ok(post, res);
        }
        if (m === 'PATCH') {
          const patch = await readJsonBody(req);
          const updated = storage.updateMasterPost(id, patch);
          if (!updated) return fail(404, `母稿不存在: ${id}`, res);
          return ok(storage.getMasterPost(id), res);
        }
        if (m === 'DELETE') {
          const deleted = storage.deleteMasterPost(id);
          if (!deleted) return fail(404, `母稿不存在: ${id}`, res);
          return ok({ id, deleted: true }, res);
        }
      }

      // ===== ③ 预览：转译 / 卡片预览 / 渲染 =====
      const transpileM = p.match(/^\/api\/v1\/master\/([^/]+)\/transpile$/);
      if (transpileM && m === 'POST') {
        const { channels } = await readJsonBody(req);
        const post = storage.getMasterPost(transpileM[1]);
        if (!post) return fail(404, `母稿不存在: ${transpileM[1]}`, res);
        const list: string[] = Array.isArray(channels) && channels.length ? channels : ['wechat', 'xiaohongshu', 'x', 'weibo'];
        const out: Record<string, UnifiedPayload> = {};
        for (const ch of list) {
          const target = targetFor(ch);
          if (!target) return fail(422, `不支持渠道: ${ch}`, res);
          out[ch] = TranspilerMatrix.transpile(post, target);
        }
        return ok(out, res);
      }

      const cardM = p.match(/^\/api\/v1\/master\/([^/]+)\/card-preview$/);
      if (cardM && m === 'POST') {
        const { theme } = await readJsonBody(req);
        const post = storage.getMasterPost(cardM[1]);
        if (!post) return fail(404, `母稿不存在: ${cardM[1]}`, res);
        const t = theme === 'notion_light' ? 'notion_light' : 'minimal_dark';
        const payload = TranspilerMatrix.transpile(post, { channel: 'xiaohongshu', format: 'card_flow' }) as any;
        const cards = payload.cardImagePaths.map((_: string, i: number) =>
          CardRenderer.buildCardHtml(CardRenderer.getTheme(t), post.title, `第 ${i + 1} 张卡片内容`, i + 1, payload.cardImagePaths.length)
        );
        return ok({ theme: t, count: cards.length, cards }, res);
      }

      const renderM = p.match(/^\/api\/v1\/master\/([^/]+)\/render$/);
      if (renderM && m === 'POST') {
        const { theme } = await readJsonBody(req);
        const t = theme === 'notion_light' ? 'notion_light' : 'minimal_dark';
        const job = await runRenderJob(renderM[1], t, storage);
        return ok({ jobId: job.id, status: job.status }, res);
      }

      // ===== ④ 发布与看板 =====
      const publishM = p.match(/^\/api\/v1\/master\/([^/]+)\/publish$/);
      if (publishM && m === 'POST') {
        const { channels, draftOnly = true } = await readJsonBody(req);
        const post = storage.getMasterPost(publishM[1]);
        if (!post) return fail(404, `母稿不存在: ${publishM[1]}`, res);
        const registry = buildRegistry();
        const list: string[] = Array.isArray(channels) && channels.length ? channels : ['wechat'];
        const job: Job = {
          id: `J-${Date.now()}`,
          kind: 'publish',
          progress: 0,
          total: list.length,
          status: 'running',
          message: '开始分发'
        };
        jobs.set(job.id, job);
        const results: any[] = [];
        for (let i = 0; i < list.length; i++) {
          const ch = list[i] as ChannelType;
          const target = targetFor(ch);
          if (!target) {
            results.push({ channel: ch, success: false, errorMessage: `不支持渠道: ${ch}` });
            continue;
          }
          const payload = TranspilerMatrix.transpile(post, target);
          const result = await registry.dispatch(ch, payload, { draftOnly: Boolean(draftOnly) });
          results.push(result);
          storage.saveDispatchRecord({
            id: `D-${Date.now()}-${i}`,
            masterId: post.id,
            channel: ch,
            payloadType: payload.type,
            payloadJson: JSON.stringify(payload),
            driverUsed: result.driverId,
            status: result.success ? 'drafted' : 'failed',
            draftId: result.draftId,
            previewUrl: result.previewUrl
          });
          job.progress = i + 1;
          job.message = `${ch}: ${result.success ? '草稿已存' : result.errorMessage}`;
        }
        job.status = 'done';
        return ok({ jobId: job.id, results }, res);
      }

      const dispatchM = p.match(/^\/api\/v1\/master\/([^/]+)\/dispatch$/);
      if (dispatchM && m === 'GET') {
        return ok(storage.getDispatchesByMaster(dispatchM[1]), res);
      }

      if (p === '/api/v1/dashboard' && m === 'GET') {
        const masters = storage.listMasterPosts(1, 50).items;
        const dispatches = storage.listAllDispatches();
        return ok({ masters, dispatches }, res);
      }

      const retryM = p.match(/^\/api\/v1\/dispatch\/([^/]+)\/retry$/);
      if (retryM && m === 'POST') {
        const record = storage.getDispatchById(retryM[1]);
        if (!record) return fail(404, `分发记录不存在: ${retryM[1]}`, res);
        const post = storage.getMasterPost(record.master_id);
        if (!post) return fail(404, `母稿不存在: ${record.master_id}`, res);
        const target = targetFor(record.channel);
        if (!target) return fail(422, `不支持渠道: ${record.channel}`, res);
        const payload = TranspilerMatrix.transpile(post, target);
        const result = await buildRegistry().dispatch(record.channel as ChannelType, payload, { draftOnly: true });
        storage.saveDispatchRecord({
          id: record.id,
          masterId: record.master_id,
          channel: record.channel,
          payloadType: record.payload_type,
          payloadJson: record.payload_json,
          driverUsed: result.driverId,
          status: result.success ? 'drafted' : 'failed',
          draftId: result.draftId,
          previewUrl: result.previewUrl
        });
        return ok(result, res);
      }

      // ===== SSE 长任务进度 =====
      const jobM = p.match(/^\/api\/v1\/jobs\/([^/]+)\/stream$/);
      if (jobM && m === 'GET') {
        const job = jobs.get(jobM[1]);
        if (!job) return fail(404, `任务不存在: ${jobM[1]}`, res);
        return pushJob(res, job);
      }

      return fail(404, `未知端点: ${m} ${p}`, res);
    } catch (err: any) {
      return fail(500, `引擎内部错误: ${err.message}`, res);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[engine-server] listening on http://127.0.0.1:${port} (v${VERSION})`);
  });

  return server;
}

// 直接运行入口（node dist/server/engineServer.js）
if (require.main === module) {
  startEngineServer();
}
