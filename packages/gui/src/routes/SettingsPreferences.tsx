import { useUiStore } from '../store/uiStore';

const CHANNELS = [
  { key: 'wechat', label: '微信公众号' },
  { key: 'xiaohongshu', label: '小红书' },
  { key: 'x', label: 'X (Twitter)' },
  { key: 'weibo', label: '微博' }
] as const;

export default function SettingsPreferences() {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  const cardTheme = useUiStore((s) => s.cardTheme);
  const setCardTheme = useUiStore((s) => s.setCardTheme);
  const selectedChannels = useUiStore((s) => s.selectedChannels);
  const setSelectedChannels = useUiStore((s) => s.setSelectedChannels);

  const toggleChannel = (key: string) => {
    if (selectedChannels.includes(key)) {
      setSelectedChannels(selectedChannels.filter((c) => c !== key));
    } else {
      setSelectedChannels([...selectedChannels, key]);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">界面主题</h2>
        <p className="mt-1 text-xs text-muted">与顶栏快捷切换同步；偏好会写入本地存储。</p>
        <div className="mt-3 flex gap-2">
          {(
            [
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' }
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm transition-colors duration-[120ms] ${
                theme === opt.value
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-border text-fg-2 hover:border-accent hover:text-accent'
              }`}
              onClick={() => setTheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">卡片主题</h2>
        <p className="mt-1 text-xs text-muted">影响预览/渲染卡片风格默认值。</p>
        <div className="mt-3 flex gap-2">
          {(
            [
              { value: 'minimal_dark', label: 'Minimal Dark' },
              { value: 'notion_light', label: 'Notion Light' }
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-sm transition-colors duration-[120ms] ${
                cardTheme === opt.value
                  ? 'border-accent bg-accent-soft font-medium text-accent'
                  : 'border-border text-fg-2 hover:border-accent hover:text-accent'
              }`}
              onClick={() => setCardTheme(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-md)] border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">默认渠道</h2>
        <p className="mt-1 text-xs text-muted">用于创作/发布流程的默认勾选渠道。</p>
        <ul className="mt-3 space-y-2">
          {CHANNELS.map((ch) => {
            const checked = selectedChannels.includes(ch.key);
            return (
              <li key={ch.key}>
                <label className="flex cursor-pointer items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    checked={checked}
                    onChange={() => toggleChannel(ch.key)}
                  />
                  <span>{ch.label}</span>
                  <span className="font-mono text-xs text-muted">{ch.key}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
