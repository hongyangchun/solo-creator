import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppShell from './components/AppShell';
import SettingsSecrets from './routes/SettingsSecrets';
import Studio from './routes/Studio';
import Preview from './routes/Preview';
import Dashboard from './routes/Dashboard';
import Retro from './routes/Retro';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
});

export default function App() {
  useEffect(() => {
    // 全局快捷键：⌘K 命令面板 / Esc 关闭
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('solo:toggle-palette'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/studio" replace />} />
            <Route path="/settings/secrets" element={<SettingsSecrets />} />
            <Route path="/studio" element={<Studio />} />
            <Route path="/preview/:masterId" element={<Preview />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/retro" element={<Retro />} />
          </Route>
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
