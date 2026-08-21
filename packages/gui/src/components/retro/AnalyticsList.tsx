import { LoaderCircle, Inbox, CircleAlert } from 'lucide-react';
import { AnalyticsListItem } from '../../lib/engineClient';

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信公众平台',
  xiaohongshu: '小红书',
  x: 'X / Twitter',
  weibo: '微博'
};

function MetricCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-muted">未录入</span>;
  }
  return <span className="font-mono text-xs tabular-nums">{value}</span>;
}

interface AnalyticsListProps {
  items: AnalyticsListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
}

export default function AnalyticsList({
  items,
  selectedId,
  onSelect,
  isLoading,
  isError,
  errorMessage
}: AnalyticsListProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted">
        <LoaderCircle size={16} className="animate-spin" />
        加载复盘列表…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <CircleAlert size={20} className="text-danger" />
        <p className="text-sm text-danger">加载失败</p>
        <p className="max-w-xs text-xs text-muted">{errorMessage || '请确认引擎 sidecar 已启动'}</p>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Inbox size={24} className="text-muted" />
        <p className="text-sm font-medium">尚无分发记录</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted">
          请先在「发布状态看板」对母稿执行存草稿，或对已有 dispatch 运行种子脚本 / 手动录入指标。
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide text-muted">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">渠道</th>
            <th className="px-3 py-2 font-medium">标题</th>
            <th className="px-3 py-2 font-medium">发布时间</th>
            <th className="px-3 py-2 font-medium">阅读</th>
            <th className="px-3 py-2 font-medium">点赞</th>
            <th className="px-3 py-2 font-medium">评论</th>
            <th className="px-3 py-2 font-medium">转发</th>
            <th className="px-3 py-2 font-medium">收藏</th>
            <th className="px-3 py-2 font-medium">抓取时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const active = item.dispatchId === selectedId;
            const m = item.metrics;
            return (
              <tr
                key={item.dispatchId}
                className={`cursor-pointer border-b border-border-soft transition-colors hover:bg-accent-soft/40 ${
                  active ? 'bg-accent-soft/60' : ''
                }`}
                onClick={() => onSelect(item.dispatchId)}
              >
                <td className="px-3 py-2.5 font-medium">{CHANNEL_LABELS[item.channel] || item.channel}</td>
                <td className="max-w-[180px] truncate px-3 py-2.5" title={item.title}>
                  {item.title || '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{item.publishedAt || '—'}</td>
                <td className="px-3 py-2.5">
                  <MetricCell value={m?.views ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  <MetricCell value={m?.likes ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  <MetricCell value={m?.comments ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  <MetricCell value={m?.shares ?? null} />
                </td>
                <td className="px-3 py-2.5">
                  <MetricCell value={m?.collected ?? null} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{item.fetchedAt || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
