import { useEffect, useState } from 'react';
import { Cable, LoaderCircle, CircleCheck, CircleX, Info } from 'lucide-react';
import { useAppConfig, usePutAppConfig, useProbeDrivers } from '../lib/queries';
import { DriverProbeResponse } from '../lib/engineClient';

const CHANNEL_LABELS: Record<string, string> = {
  wechat: '微信公众号',
  xiaohongshu: '小红书',
  x: 'X (Twitter)'
};

export default function SettingsChannels() {
  const { data, isLoading, isError, error } = useAppConfig();
  const putConfig = usePutAppConfig();
  const probe = useProbeDrivers();
  const [endpoint, setEndpoint] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (data?.cdpEndpoint) setEndpoint(data.cdpEndpoint);
  }, [data?.cdpEndpoint]);

  const save = async () => {
    setSaveError('');
    try {
      await putConfig.mutateAsync({ cdpEndpoint: endpoint.trim() });
    } catch (err: any) {
      setSaveError(err.message || '保存失败');
    }
  };

  const doProbe = async () => {
    // 探测使用当前输入框值（未保存也可先探测），不落库
    await probe.mutateAsync(endpoint.trim() || undefined);
  };

  const probeData: DriverProbeResponse | undefined = probe.data ?? undefined;
  const inputInvalid = endpoint.trim() !== '' && !/^https?:\/\/.+/i.test(endpoint.trim());

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Cable size={16} className="text-muted" />
          CDP 浏览器端点
        </h2>
        <p className="mt-1 text-xs text-muted">
          各 CDP 驱动（微信 / 小红书 / X）连接常驻调试浏览器的地址。保存后下一次发布或探测即生效，无需重启引擎。
        </p>

        {isLoading && <div className="mt-4 text-sm text-muted">正在读取配置…</div>}
        {isError && <div className="mt-4 text-sm text-danger">读取失败：{error.message}</div>}

        {data && (
          <>
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                value={endpoint}
                placeholder="http://127.0.0.1:9333"
                className={`flex-1 rounded-[var(--radius-sm)] border bg-surface px-3 py-2 font-mono text-sm outline-none transition-colors duration-[120ms] ${
                  inputInvalid ? 'border-danger' : 'border-border focus:border-accent'
                }`}
                onChange={(e) => setEndpoint(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !inputInvalid && endpoint.trim() && save()}
              />
              <button
                className="rounded-[var(--radius-sm)] bg-accent px-3 py-2 text-sm font-medium text-accent-on transition-colors duration-[120ms] hover:bg-accent-hover disabled:opacity-50"
                disabled={inputInvalid || !endpoint.trim() || putConfig.isPending}
                onClick={save}
              >
                {putConfig.isPending && <LoaderCircle size={14} className="mr-1 inline animate-spin" />}
                保存
              </button>
              <button
                className="rounded-[var(--radius-sm)] border border-border px-3 py-2 text-sm text-fg-2 transition-colors duration-[120ms] hover:border-accent hover:text-accent disabled:opacity-50"
                disabled={probe.isPending || inputInvalid}
                onClick={doProbe}
              >
                {probe.isPending && <LoaderCircle size={14} className="mr-1 inline animate-spin" />}
                探测连接
              </button>
            </div>

            {inputInvalid && <p className="mt-2 text-xs text-danger">端点必须以 http:// 或 https:// 开头。</p>}
            {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
            {putConfig.isSuccess && !saveError && !putConfig.isPending && (
              <p className="mt-2 text-xs text-success">已保存。</p>
            )}
          </>
        )}
      </section>

      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">驱动可用性</h2>
        <p className="mt-1 text-xs text-muted">
          点击上方「探测连接」后显示。探测执行真实的 connectOverCDP + 开页双检，可排除端口被非调试浏览器占用的情况。
        </p>

        {probe.isPending && <div className="mt-4 text-sm text-muted">探测中（最长约 3 秒）…</div>}

        {probe.isError && (
          <div className="mt-4 text-sm text-danger">探测失败：{(probe.error as Error).message}</div>
        )}

        {probeData && (
          <div className="mt-4">
            <p className="font-mono text-xs text-muted">端点：{probeData.cdpEndpoint}</p>
            <ul className="mt-2 space-y-2">
              {probeData.results.map((r) => (
                <li
                  key={r.channel}
                  className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-border-soft px-3 py-2 text-sm"
                >
                  {r.available ? (
                    <CircleCheck size={16} className="mt-0.5 shrink-0 text-success" />
                  ) : (
                    <CircleX size={16} className="mt-0.5 shrink-0 text-danger" />
                  )}
                  <div className="min-w-0 flex-1">
                    <span>{CHANNEL_LABELS[r.channel] || r.channel}</span>
                    <span className="ml-2 font-mono text-xs text-muted">{r.driverId}</span>
                    {!r.available && r.error && (
                      <p className="mt-1 break-all text-xs text-muted">{r.error}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!probeData && !probe.isPending && !probe.isError && (
          <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] bg-surface-warm px-3 py-2 text-xs text-muted">
            <Info size={14} className="mt-0.5 shrink-0" />
            尚未探测。默认端点为 http://127.0.0.1:9333（本机 9222 常被其他调试进程占用）。
          </div>
        )}
      </section>
    </div>
  );
}
