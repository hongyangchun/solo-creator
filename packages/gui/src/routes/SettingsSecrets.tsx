import { useState } from 'react';
import { KeyRound, Eye, EyeOff, Trash2, CircleCheck, CircleDashed, LoaderCircle } from 'lucide-react';
import { useSecrets, useSetSecret, useDeleteSecret } from '../lib/queries';
import { SecretItem } from '../lib/engineClient';

const SECRET_LABELS: Record<string, string> = {
  DEEPSEEK_API_KEY: 'DeepSeek API Key',
  WECHAT_APP_ID: '微信公众平台 AppID',
  WECHAT_APP_SECRET: '微信公众平台 AppSecret',
  X_API_KEY: 'X (Twitter) API Key',
  FEISHU_WEBHOOK_URL: '飞书通知 Webhook'
};

function SecretRow({ item }: { item: SecretItem }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const setSecret = useSetSecret();
  const deleteSecret = useDeleteSecret();
  const label = SECRET_LABELS[item.key] || item.key;

  const save = async () => {
    if (!value.trim()) return;
    await setSecret.mutateAsync({ key: item.key, value: value.trim() });
    setValue('');
    setEditing(false);
    setShow(false);
  };

  return (
    <div className="border-b border-border-soft px-5 py-4 last:border-0">
      <div className="flex items-center gap-3">
        <KeyRound size={16} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{label}</div>
          <div className="font-mono text-xs text-muted">{item.key}</div>
        </div>
        {item.exists ? (
          <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-success-soft px-2 py-0.5 text-xs text-success">
            <CircleCheck size={12} /> 已配置 · {item.masked}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-warn-soft px-2 py-0.5 text-xs text-warn">
            <CircleDashed size={12} /> 未配置
          </span>
        )}
        <button
          className="rounded-[var(--radius-sm)] border border-border px-2 py-1 text-xs text-fg-2 transition-colors duration-[120ms] hover:border-accent hover:text-accent"
          onClick={() => setEditing(!editing)}
        >
          {editing ? '取消' : '编辑'}
        </button>
        {item.exists && (
          <button
            aria-label={`删除 ${label}`}
            className="rounded-[var(--radius-sm)] border border-border p-1.5 text-muted transition-colors duration-[120ms] hover:border-danger hover:text-danger"
            onClick={() => deleteSecret.mutate(item.key)}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {editing && (
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <input
              type={show ? 'text' : 'password'}
              value={value}
              placeholder={`输入 ${label}（写入后加密存储，永不回显明文）`}
              className="w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 pr-10 text-sm outline-none transition-colors duration-[120ms] focus:border-accent"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <button
              aria-label={show ? '隐藏密钥' : '显示密钥'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <button
            className="flex items-center gap-1 rounded-[var(--radius-sm)] bg-accent px-3 py-2 text-sm font-medium text-accent-on transition-colors duration-[120ms] hover:bg-accent-hover disabled:opacity-50"
            disabled={!value.trim() || setSecret.isPending}
            onClick={save}
          >
            {setSecret.isPending && <LoaderCircle size={14} className="animate-spin" />}
            保存
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsSecrets() {
  const { data, isLoading, isError, error } = useSecrets();

  return (
    <div className="mx-auto max-w-[760px] p-6">
      <h1 className="text-2xl font-semibold tracking-tight">密钥 / 配置中心</h1>
      <p className="mt-1 text-sm text-muted">
        所有密钥经 AES-256-GCM 加密存于本地 vault.enc，明文永不离开引擎进程。
      </p>

      <div className="mt-6 rounded-[var(--radius-md)] border border-border bg-surface">
        {isLoading && <div className="p-8 text-center text-sm text-muted">正在读取密钥状态…</div>}
        {isError && <div className="p-8 text-center text-sm text-danger">读取失败：{error.message}</div>}
        {data && data.length === 0 && <div className="p-8 text-center text-sm text-muted">暂无密钥</div>}
        {data?.map((s) => <SecretRow key={s.key} item={s} />)}
      </div>

      <p className="mt-4 text-xs text-muted">配置 DeepSeek Key 后，母稿创作台将启用 LLM 深度展开；未配置时自动降级离线模板。</p>
    </div>
  );
}
