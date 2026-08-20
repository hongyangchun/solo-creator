import { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  KeyRound,
  PenLine,
  Monitor,
  LayoutDashboard,
  Sun,
  Moon,
  Search,
  Command,
  CircleCheck,
  CircleX,
  TriangleAlert
} from 'lucide-react';
import { useUiStore } from '../store/uiStore';
import { useSecrets } from '../lib/queries';

const NAV_ITEMS = [
  { to: '/settings/secrets', label: '密钥配置', icon: KeyRound },
  { to: '/studio', label: '母稿创作台', icon: PenLine },
  { to: '/preview/current', label: '多端预览', icon: Monitor },
  { to: '/dashboard', label: '发布看板', icon: LayoutDashboard }
] as const;

function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();

  useEffect(() => {
    const toggle = () => useUiStore.getState().setCommandPaletteOpen(!useUiStore.getState().commandPaletteOpen);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('solo:toggle-palette', toggle);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('solo:toggle-palette', toggle);
      window.removeEventListener('keydown', esc);
    };
  }, [setOpen]);

  if (!open) return null;

  const actions = [
    { label: '新建母稿', run: () => navigate('/studio') },
    { label: '多端预览', run: () => navigate('/preview/current') },
    { label: '配置密钥', run: () => navigate('/settings/secrets') },
    { label: '发布看板', run: () => navigate('/dashboard') },
    { label: '切换主题', run: () => useUiStore.getState().toggleTheme() }
  ];

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-start justify-center pt-[90px]"
      style={{ background: 'rgba(16,24,20,0.4)', backdropFilter: 'blur(2px)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[480px] rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-lg)]"
        style={{ marginTop: '10vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3 text-muted">
          <Search size={16} />
          <input
            autoFocus
            placeholder="搜索动作：新建母稿 / 预览 / 发布 / 配置…"
            className="w-full bg-transparent text-fg outline-none placeholder:text-muted"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const idx = Math.min(0, actions.length - 1);
                actions[idx].run();
                setOpen(false);
              }
            }}
          />
          <kbd className="font-mono text-xs text-muted">Esc</kbd>
        </div>
        <ul className="max-h-[320px] overflow-auto p-2">
          {actions.map((a) => (
            <li key={a.label}>
              <button
                className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left text-fg transition-colors duration-[120ms] hover:bg-accent-soft"
                onClick={() => {
                  a.run();
                  setOpen(false);
                }}
              >
                <Command size={16} className="text-accent" />
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AppShell() {
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const [engineOk, setEngineOk] = useState(false);
  const { data: secrets } = useSecrets();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // Tauri sidecar 晚于 webview 启动：未就绪时每 3s 轮询，就绪即停；失败静默重试
    const poll = () => {
      fetch('http://127.0.0.1:39281/api/v1/health')
        .then((r) => r.json())
        .then((j) => {
          if (cancelled) return;
          const ok = j?.data?.status === 'ok';
          setEngineOk(ok);
          if (!ok) timer = setTimeout(poll, 3000);
        })
        .catch(() => {
          if (cancelled) return;
          setEngineOk(false);
          timer = setTimeout(poll, 3000);
        });
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const missingSecrets = (secrets || []).filter((s) => !s.exists && s.key === 'DEEPSEEK_API_KEY').length > 0;

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {/* 标题栏：macOS 左侧预留 80px 红绿灯安全区 */}
      <header className="flex h-[44px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4" style={{ paddingLeft: '96px' }}>
        <span className="text-sm font-semibold tracking-tight">SoloCreator Content OS</span>
        <div className="ml-auto flex items-center gap-2">
          {!engineOk && (
            <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-warn-soft px-2 py-0.5 text-xs text-warn">
              <TriangleAlert size={12} /> 引擎未就绪
            </span>
          )}
          <button
            aria-label="打开命令面板"
            className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-border px-2 py-1 text-xs text-muted transition-colors duration-[120ms] hover:border-accent hover:text-accent"
            onClick={() => useUiStore.getState().setCommandPaletteOpen(true)}
          >
            <Search size={14} /> 搜索 <kbd className="font-mono">⌘K</kbd>
          </button>
          <button
            aria-label="切换主题"
            className="rounded-[var(--radius-sm)] border border-border p-1.5 text-muted transition-colors duration-[120ms] hover:border-accent hover:text-accent"
            onClick={toggleTheme}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左侧导航 */}
        <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-surface p-3">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
              <li key={to} className="relative">
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors duration-[120ms] ${
                      isActive ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-warm'
                    }`
                  }
                >
                  <Icon size={18} strokeWidth={1.75} />
                  {label}
                </NavLink>
                {to === '/settings/secrets' && missingSecrets && (
                  <span className="absolute right-3 top-2.5 h-2 w-2 rounded-[var(--radius-pill)] bg-warn" aria-label="有密钥未配置" />
                )}
              </li>
            ))}
          </ul>

          <div className="mt-auto flex items-center gap-2 px-3 text-xs text-muted">
            {engineOk ? <CircleCheck size={12} className="text-success" /> : <CircleX size={12} className="text-danger" />}
            本地引擎 {engineOk ? '已连接' : '未连接'} · 127.0.0.1:39281
          </div>
        </nav>

        {/* 主内容区 */}
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
