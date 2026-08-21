import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/settings/secrets', label: '凭据', enabled: true },
  { to: '/settings/preferences', label: '偏好', enabled: true },
  { to: '/settings/drivers', label: '渠道与驱动', enabled: false, hint: 'I3' },
  { to: '/settings/models', label: '模型与质检', enabled: false, hint: 'I3' }
] as const;

export default function SettingsLayout() {
  return (
    <div className="mx-auto max-w-[760px] p-6">
      <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
      <p className="mt-1 text-sm text-muted">凭据、偏好与后续驱动/模型配置的统一入口。</p>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-border-soft">
        {TABS.map((tab) =>
          tab.enabled ? (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `rounded-t-[var(--radius-sm)] px-3 py-2 text-sm transition-colors duration-[120ms] ${
                  isActive
                    ? 'border-b-2 border-accent font-medium text-accent'
                    : 'text-fg-2 hover:text-accent'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ) : (
            <span
              key={tab.to}
              title={`${tab.label}将在 ${tab.hint} 提供`}
              className="cursor-not-allowed px-3 py-2 text-sm text-muted opacity-60"
              aria-disabled="true"
            >
              {tab.label}
              <span className="ml-1 font-mono text-[10px]">{tab.hint}</span>
            </span>
          )
        )}
      </div>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
