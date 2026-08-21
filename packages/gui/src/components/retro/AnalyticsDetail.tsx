import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Save, CircleAlert } from 'lucide-react';
import { AnalyticsListItem, AnalyticsMetrics } from '../../lib/engineClient';

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信公众平台',
  xiaohongshu: '小红书',
  x: 'X / Twitter',
  weibo: '微博'
};

const METRIC_FIELDS: Array<{ key: keyof AnalyticsMetrics; label: string }> = [
  { key: 'views', label: '阅读 views' },
  { key: 'likes', label: '点赞 likes' },
  { key: 'comments', label: '评论 comments' },
  { key: 'shares', label: '转发 shares' },
  { key: 'collected', label: '收藏 collected' }
];

const ZERO_METRICS: AnalyticsMetrics = {
  views: 0,
  likes: 0,
  comments: 0,
  shares: 0,
  collected: 0
};

interface AnalyticsDetailProps {
  item: AnalyticsListItem | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onSave: (metrics: AnalyticsMetrics) => void;
  onRefresh: () => void;
  saving: boolean;
  refreshing: boolean;
  emptyHint?: boolean;
}

export default function AnalyticsDetail({
  item,
  isLoading,
  isError,
  errorMessage,
  onSave,
  onRefresh,
  saving,
  refreshing,
  emptyHint
}: AnalyticsDetailProps) {
  const [form, setForm] = useState<AnalyticsMetrics>(ZERO_METRICS);

  useEffect(() => {
    if (item?.metrics) {
      setForm({ ...item.metrics });
    } else {
      setForm({ ...ZERO_METRICS });
    }
  }, [item?.dispatchId, item?.metrics, item?.fetchedAt]);

  if (emptyHint) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
        从左侧列表选择一条分发记录查看详情并手动录入指标
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin" />
        加载详情…
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <CircleAlert size={20} className="text-danger" />
        <p className="text-sm text-danger">详情不可用</p>
        <p className="text-xs text-muted">{errorMessage || '请重新选择列表项'}</p>
      </div>
    );
  }

  const unrecorded = item.metrics == null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">详情</p>
        <h2 className="mt-1 text-base font-semibold leading-snug">{item.title || '（无标题）'}</h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
          <span className="rounded-[var(--radius-pill)] border border-border px-2 py-0.5">
            {CHANNEL_LABELS[item.channel] || item.channel}
          </span>
          <span className="font-mono">{item.dispatchId}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">发布时间</dt>
          <dd>{item.publishedAt || '—'}</dd>
          <dt className="text-muted">抓取时间</dt>
          <dd>{item.fetchedAt || '—'}</dd>
          <dt className="text-muted">录入状态</dt>
          <dd>{unrecorded ? <span className="text-warn">未录入</span> : '已录入'}</dd>
        </dl>
      </div>

      <div className="rounded-[var(--radius-md)] border border-border bg-surface p-4">
        <p className="mb-3 text-sm font-medium">手动编辑指标</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {METRIC_FIELDS.map(({ key, label }) => (
            <label key={key} className="flex flex-col gap-1 text-xs">
              <span className="text-muted">{label}</span>
              <input
                type="number"
                min={0}
                step={1}
                className="rounded-[var(--radius-sm)] border border-border bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
                value={form[key]}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    [key]: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
                  }));
                }}
              />
            </label>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => onSave(form)}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
          <button
            type="button"
            disabled={refreshing}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            title="占位刷新：不打外部平台"
          >
            {refreshing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            刷新占位
          </button>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          「刷新占位」仅更新本地 fetched_at（无记录时写入全 0），不会访问外部平台，也不会触发 publish。
        </p>
      </div>
    </div>
  );
}
