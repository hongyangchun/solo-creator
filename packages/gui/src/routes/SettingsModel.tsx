import { useEffect, useState } from 'react';
import { Sparkles, ShieldCheck, LoaderCircle } from 'lucide-react';
import { useAppConfig, usePutAppConfig } from '../lib/queries';

function Toggle({
  checked,
  onChange,
  disabled
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={`relative h-6 w-11 rounded-[var(--radius-pill)] transition-colors duration-[120ms] disabled:opacity-50 ${
        checked ? 'bg-accent' : 'bg-border'
      }`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-transform duration-[120ms] ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export default function SettingsModel() {
  const { data, isLoading, isError, error } = useAppConfig();
  const putConfig = usePutAppConfig();

  const [llmEnabled, setLlmEnabled] = useState(true);
  const [criticEnabled, setCriticEnabled] = useState(true);
  const [llmTouched, setLlmTouched] = useState(false);

  useEffect(() => {
    if (!data) return;
    setLlmEnabled(data.llmEnabled ?? true); // undefined = 未显式覆盖，界面默认开
    setCriticEnabled(data.criticEnabled);
    setLlmTouched(data.llmEnabled !== undefined);
  }, [data]);

  if (isLoading) return <div className="p-8 text-center text-sm text-muted">正在读取配置…</div>;
  if (isError) return <div className="p-8 text-center text-sm text-danger">读取失败：{error.message}</div>;
  if (!data) return null;

  const saveLlm = async (next: boolean) => {
    setLlmEnabled(next);
    setLlmTouched(true);
    await putConfig.mutateAsync({ llmEnabled: next });
  };

  const saveCritic = async (next: boolean) => {
    setCriticEnabled(next);
    await putConfig.mutateAsync({ criticEnabled: next });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles size={16} className="text-muted" />
              LLM 深度生成
            </h2>
            <p className="mt-1 text-xs text-muted">
              开启时优先调用 DeepSeek 展开母稿长文；关闭后强制使用离线规则模板（比环境变量优先）。
              未显式配置时按「密钥中心」是否存有 DeepSeek Key 自动判断。
            </p>
            <p className="mt-1 text-xs text-muted">
              当前状态：
              {llmTouched ? (llmEnabled ? '已显式开启' : '已显式关闭（强制离线）') : '未显式配置（自动：有无 Key 即是否可用）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {putConfig.isPending && <LoaderCircle size={14} className="animate-spin text-muted" />}
            <Toggle checked={llmEnabled} onChange={saveLlm} disabled={putConfig.isPending} />
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck size={16} className="text-muted" />
              Humanizer 中文质检
            </h2>
            <p className="mt-1 text-xs text-muted">
              开启时母稿输出前强制过 HumanizerZhCritic 去 AI 味（替换八股词）；关闭后内容原样输出、跳过质检打分。
              默认开启。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {putConfig.isPending && <LoaderCircle size={14} className="animate-spin text-muted" />}
            <Toggle checked={criticEnabled} onChange={saveCritic} disabled={putConfig.isPending} />
          </div>
        </div>
      </section>

      {putConfig.isError && (
        <p className="text-xs text-danger">保存失败：{(putConfig.error as Error).message}</p>
      )}
    </div>
  );
}
