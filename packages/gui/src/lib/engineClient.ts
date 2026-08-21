// 引擎 HTTP 客户端（D1 主路径：前端直连 127.0.0.1，零 Rust 代理）
const ENGINE_BASE = 'http://127.0.0.1:39281/api/v1';

export interface EngineEnvelope<T = unknown> {
  code: number;
  data: T;
  message: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${ENGINE_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = (await res.json()) as EngineEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(json.message || `引擎错误 ${json.code}`);
  }
  return json.data;
}

export const engine = {
  health: () => request<{ status: string; version: string }>('GET', '/health'),
  // ① 密钥
  listSecrets: () => request<SecretItem[]>('GET', '/secrets'),
  setSecret: (key: string, value: string) => request<{ key: string; masked: string }>('POST', '/secrets', { key, value }),
  deleteSecret: (key: string) => request<{ key: string }>('DELETE', `/secrets/${key}`),
  // ② 母稿
  createMaster: (idea: string, topic?: string) => request<MasterPostDetail>('POST', '/master', { idea, topic }),
  listMasters: (page = 1, pageSize = 20) => request<{ total: number; items: MasterListItem[] }>('GET', `/master?page=${page}&pageSize=${pageSize}`),
  getMaster: (id: string) => request<MasterPostDetail>('GET', `/master/${id}`),
  updateMaster: (id: string, patch: { title?: string; masterMarkdown?: string }) => request<MasterPostDetail>('PATCH', `/master/${id}`, patch),
  deleteMaster: (id: string) => request<{ id: string }>('DELETE', `/master/${id}`),
  // ③ 预览
  transpile: (id: string, channels: string[]) => request<Record<string, ChannelPayload>>('POST', `/master/${id}/transpile`, { channels }),
  cardPreview: (id: string, theme: 'minimal_dark' | 'notion_light') =>
    request<{ theme: string; count: number; cards: string[] }>('POST', `/master/${id}/card-preview`, { theme }),
  render: (id: string, theme: 'minimal_dark' | 'notion_light') => request<{ jobId: string }>('POST', `/master/${id}/render`, { theme }),
  // ④ 发布
  publish: (id: string, channels: string[]) => request<{ jobId: string; results: PublishResultItem[] }>('POST', `/master/${id}/publish`, { channels, draftOnly: true }),
  dispatches: (id: string) => request<DispatchRecord[]>('GET', `/master/${id}/dispatch`),
  dashboard: () => request<{ masters: MasterListItem[]; dispatches: DispatchRecord[] }>('GET', '/dashboard'),
  retryDispatch: (id: string) => request<PublishResultItem>('POST', `/dispatch/${id}/retry`),
  // ⑤ 数据复盘（含 analytics API）
  listAnalytics: () => request<AnalyticsListResponse>('GET', '/analytics'),
  getAnalytics: (dispatchId: string) => request<AnalyticsListItem>('GET', `/analytics/${dispatchId}`),
  upsertAnalytics: (dispatchId: string, body: UpsertAnalyticsBody) =>
    request<AnalyticsListItem>('PUT', `/analytics/${dispatchId}`, body),
  refreshAnalytics: (dispatchId: string) =>
    request<RefreshAnalyticsResult>('POST', `/analytics/${dispatchId}/refresh`),
  // ⑥ 应用配置（I3）
  getAppConfig: () => request<AppConfigResponse>('GET', '/config'),
  putAppConfig: (patch: Partial<AppConfigPatch>) => request<AppConfigResponse>('PUT', '/config', patch),
  probeDrivers: (cdpEndpoint?: string) =>
    request<DriverProbeResponse>('POST', '/config/drivers/probe', cdpEndpoint ? { cdpEndpoint } : {})
};

export function subscribeJob(jobId: string, onEvent: (job: JobProgress) => void): () => void {
  const es = new EventSource(`${ENGINE_BASE}/jobs/${jobId}/stream`);
  es.onmessage = (e) => onEvent(JSON.parse(e.data));
  return () => es.close();
}

// ---- 与引擎契约对齐的类型（types/index.ts）----
export interface SecretItem {
  key: string;
  masked: string;
  exists: boolean;
}

export interface HookCandidate {
  type: 'curiosity_gap' | 'counter_intuitive' | 'pain_point' | 'authority' | 'storytelling';
  hookText: string;
}

export interface MasterPostDetail {
  id: string;
  title: string;
  rawIdea: string;
  masterMarkdown: string;
  hookCandidates: HookCandidate[];
  keyTakeaways: string[];
  suggestedTags: string[];
  createdAt: string;
  critic?: { score: number; passed: boolean };
  generatedBy?: 'llm' | 'offline';
}

export interface MasterListItem {
  id: string;
  title: string;
  raw_idea: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type ChannelPayload =
  | { type: 'article'; title: string; htmlContent: string }
  | { type: 'card_flow'; title: string; caption: string; cardImagePaths: string[] }
  | { type: 'thread'; tweets: string[] }
  | { type: 'short_text'; text: string };

export interface PublishResultItem {
  success: boolean;
  channel: string;
  driverId: string;
  mode: 'draft' | 'published';
  draftId?: string;
  previewUrl?: string;
  errorMessage?: string;
}

export interface DispatchRecord {
  id: string;
  master_id: string;
  channel: string;
  payload_type: string;
  dispatch_status: string;
  draft_id: string | null;
  preview_url: string | null;
  error_log: string | null;
  dispatched_at: string | null;
}

export interface JobProgress {
  id: string;
  kind: 'render' | 'publish';
  progress: number;
  total: number;
  status: 'running' | 'done' | 'failed';
  message: string;
  result?: { imagePaths?: string[] };
}

/** 基础指标（与 post_analytics 列对齐） */
export interface AnalyticsMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collected: number;
}

export type UpsertAnalyticsBody = AnalyticsMetrics;

/** 列表/详情共用行（dispatch 驱动 LEFT JOIN） */
export interface AnalyticsListItem {
  dispatchId: string;
  masterId: string;
  channel: string;
  title: string;
  publishedAt: string | null;
  metrics: AnalyticsMetrics | null;
  fetchedAt: string | null;
  analyticsId: string | null;
}

export type AnalyticsDetail = AnalyticsListItem;

export interface RefreshAnalyticsResult extends AnalyticsListItem {
  mode: 'placeholder';
  created: boolean;
}

export interface AnalyticsListResponse {
  total: number;
  items: AnalyticsListItem[];
}

// ---- I3 应用配置 ----
export interface AppConfigResponse {
  cdpEndpoint: string;
  llmEnabled?: boolean;
  criticEnabled: boolean;
}

export interface AppConfigPatch {
  cdpEndpoint?: string;
  llmEnabled?: boolean;
  criticEnabled?: boolean;
}

export interface DriverProbeResult {
  channel: string;
  driverId: string;
  available: boolean;
  error: string | null;
}

export interface DriverProbeResponse {
  cdpEndpoint: string;
  results: DriverProbeResult[];
}
