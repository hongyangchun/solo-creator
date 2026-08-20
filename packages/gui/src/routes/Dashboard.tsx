import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  LayoutDashboard,
  Send,
  CircleCheck,
  CircleX,
  Clock,
  LoaderCircle,
  RotateCw,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useDashboard, usePublish, useRetryDispatch } from '../lib/queries';
import { DispatchRecord, MasterListItem } from '../lib/engineClient';

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信公众平台',
  xiaohongshu: '小红书',
  x: 'X / Twitter',
  weibo: '微博'
};

const PUBLISH_CHANNELS = [
  { key: 'wechat', label: '微信' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'x', label: 'X' },
  { key: 'weibo', label: '微博' }
] as const;

function StatusPill({ status }: { status: string }) {
  if (status === 'drafted' || status === 'success') {
    return (
      <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-success-soft px-2 py-0.5 text-xs text-success">
        <CircleCheck size={12} /> 已存草稿
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-danger-soft px-2 py-0.5 text-xs text-danger">
        <CircleX size={12} /> 失败
      </span>
    );
  }
  if (status === 'in_progress') {
    return (
      <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-info-soft px-2 py-0.5 text-xs text-info">
        <LoaderCircle size={12} className="animate-spin" /> 进行中
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-border px-2 py-0.5 text-xs text-muted">
      <Clock size={12} /> 待处理
    </span>
  );
}

function DispatchRow({ record, onRetry }: { record: DispatchRecord; onRetry: (id: string) => void }) {
  const [openLog, setOpenLog] = useState(false);
  const failed = record.dispatch_status === 'failed';

  return (
    <div className="border-b border-border-soft px-4 py-3 last:border-0">
      <div className="flex items-center gap-3 text-sm">
        <span className="w-28 shrink-0 font-medium">{CHANNEL_LABELS[record.channel] || record.channel}</span>
        <StatusPill status={record.dispatch_status} />
        {record.draft_id && <span className="font-mono text-xs text-muted">{record.draft_id}</span>}
        <span className="ml-auto flex items-center gap-2">
          {record.preview_url && (
            <a href={record.preview_url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline underline-offset-2">
              预览 ↗
            </a>
          )}
          {failed && (
            <>
              <button
                className="flex items-center gap-1 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-xs hover:border-accent hover:text-accent"
                onClick={() => onRetry(record.id)}
              >
                <RotateCw size={12} /> 重试
              </button>
              <button aria-label="展开日志" onClick={() => setOpenLog(!openLog)} className="text-muted hover:text-fg">
                {openLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </>
          )}
        </span>
      </div>
      {openLog && failed && (
        <pre className="mt-2 overflow-auto rounded-[var(--radius-sm)] bg-surface-warm p-2 font-mono text-xs text-danger">
          {record.error_log || '（无详细日志）'}
        </pre>
      )}
    </div>
  );
}

function MasterCard({
  master,
  dispatches,
  publishing,
  onPublish,
  onRetry
}: {
  master: MasterListItem;
  dispatches: DispatchRecord[];
  publishing: boolean;
  onPublish: (id: string, channels: string[]) => void;
  onRetry: (id: string) => void;
}) {
  const [channels, setChannels] = useState<string[]>(['wechat']);

  const toggle = (key: string) => {
    setChannels((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  };

  const doPublish = () => {
    if (channels.length === 0) return;
    const labels = channels.map((c) => PUBLISH_CHANNELS.find((p) => p.key === c)?.label || c).join('、');
    if (!confirm(`将以下渠道内容「仅存入草稿箱」，不会自动发布。所选渠道：${labels}。确认存入？`)) return;
    onPublish(master.id, channels);
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{master.title}</div>
          <div className="font-mono text-xs text-muted">{master.id}</div>
        </div>
        <button
          className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-xs font-medium text-accent-on hover:bg-accent-hover disabled:opacity-50"
          disabled={publishing || channels.length === 0}
          onClick={doPublish}
        >
          {publishing ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}
          一键存入草稿箱
        </button>
        <Link
          to={`/preview/${master.id}`}
          className="rounded-[var(--radius-sm)] border border-border px-2 py-1.5 text-xs text-fg-2 hover:border-accent hover:text-accent"
        >
          预览
        </Link>
      </div>
      <div className="flex items-center gap-1.5 border-b border-border-soft px-4 py-2">
        <span className="mr-1 text-xs text-muted">发布渠道：</span>
        {PUBLISH_CHANNELS.map((c) => {
          const checked = channels.includes(c.key);
          return (
            <button
              key={c.key}
              aria-pressed={checked}
              onClick={() => toggle(c.key)}
              className={`flex items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-xs transition-colors duration-[120ms] ${
                checked ? 'bg-accent-soft font-medium text-accent' : 'border border-border text-fg-2 hover:border-accent hover:text-accent'
              }`}
            >
              {checked && <CircleCheck size={12} />}
              {c.label}
            </button>
          );
        })}
      </div>
      {dispatches.length > 0 ? (
        dispatches.map((d) => <DispatchRow key={d.id} record={d} onRetry={onRetry} />)
      ) : (
        <div className="px-4 py-3 text-xs text-muted">暂无分发记录</div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data, isLoading, isError, error } = useDashboard();
  const publish = usePublish();
  const retry = useRetryDispatch();
  const [publishingId, setPublishingId] = useState<string | null>(null);

  const masters = data?.masters || [];
  const dispatches = data?.dispatches || [];

  const dispatchesByMaster = masters.reduce<Record<string, DispatchRecord[]>>((acc, m: MasterListItem) => {
    acc[m.id] = dispatches.filter((d) => d.master_id === m.id);
    return acc;
  }, {});

  const doPublish = async (id: string, channels: string[]) => {
    setPublishingId(id);
    try {
      await publish.mutateAsync({ id, channels });
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-[900px] p-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard size={20} className="text-accent" />
        <h1 className="text-2xl font-semibold tracking-tight">发布状态看板</h1>
      </div>
      <p className="mt-1 text-sm text-muted">draftOnly 安全界：仅存草稿，绝不自动发布；最终发布在平台侧人工终审。</p>

      {isLoading && <div className="mt-10 text-center text-sm text-muted">加载看板数据…</div>}
      {isError && <div className="mt-10 text-center text-sm text-danger">读取失败：{error.message}</div>}

      {!isLoading && masters.length === 0 && (
        <div className="mt-10 rounded-[var(--radius-md)] border border-border bg-surface p-10 text-center text-sm text-muted">
          还没有分发记录。<Link to="/studio" className="text-accent hover:underline underline-offset-2">先在创作台写一篇母稿 →</Link>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {masters.map((m) => (
          <MasterCard
            key={m.id}
            master={m}
            dispatches={dispatchesByMaster[m.id] || []}
            publishing={publishingId === m.id}
            onPublish={doPublish}
            onRetry={(id) => retry.mutate(id)}
          />
        ))}
      </div>
    </div>
  );
}
