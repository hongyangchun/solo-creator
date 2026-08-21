import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import AnalyticsList from '../components/retro/AnalyticsList';
import AnalyticsDetail from '../components/retro/AnalyticsDetail';
import {
  useAnalytics,
  useAnalyticsDetail,
  useUpsertAnalytics,
  useRefreshAnalytics
} from '../lib/queries';
import { AnalyticsMetrics } from '../lib/engineClient';

export default function Retro() {
  const listQuery = useAnalytics();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQuery = useAnalyticsDetail(selectedId);
  const upsert = useUpsertAnalytics();
  const refresh = useRefreshAnalytics();

  const items = listQuery.data?.items ?? [];

  useEffect(() => {
    if (!selectedId && items.length > 0) {
      setSelectedId(items[0].dispatchId);
    }
    if (selectedId && items.length > 0 && !items.some((i) => i.dispatchId === selectedId)) {
      setSelectedId(items[0].dispatchId);
    }
  }, [items, selectedId]);

  const handleSave = (metrics: AnalyticsMetrics) => {
    if (!selectedId) return;
    upsert.mutate({ dispatchId: selectedId, metrics });
  };

  const handleRefresh = () => {
    if (!selectedId) return;
    refresh.mutate(selectedId);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-accent" />
          <h1 className="text-lg font-semibold">数据复盘</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          本地 post_analytics 基础指标：列表 + 详情手动录入 / 刷新占位（不含平台自动回抓）。
        </p>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
        <section className="min-h-0 overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
          <AnalyticsList
            items={items}
            selectedId={selectedId}
            onSelect={setSelectedId}
            isLoading={listQuery.isLoading}
            isError={listQuery.isError}
            errorMessage={(listQuery.error as Error | null)?.message}
          />
        </section>
        <section className="min-h-0 overflow-hidden bg-bg">
          <AnalyticsDetail
            emptyHint={!selectedId && !listQuery.isLoading && !listQuery.isError}
            item={detailQuery.data}
            isLoading={Boolean(selectedId) && detailQuery.isLoading}
            isError={Boolean(selectedId) && detailQuery.isError}
            errorMessage={(detailQuery.error as Error | null)?.message}
            onSave={handleSave}
            onRefresh={handleRefresh}
            saving={upsert.isPending}
            refreshing={refresh.isPending}
          />
        </section>
      </div>
    </div>
  );
}
