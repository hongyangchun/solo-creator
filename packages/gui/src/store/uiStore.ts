import { create } from 'zustand';

type Theme = 'light' | 'dark';

interface UiState {
  theme: Theme;
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  selectedChannels: string[];
  cardTheme: 'minimal_dark' | 'notion_light';
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSelectedChannels: (chs: string[]) => void;
  setCardTheme: (t: 'minimal_dark' | 'notion_light') => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'light',
  commandPaletteOpen: false,
  sidebarCollapsed: false,
  selectedChannels: ['wechat', 'xiaohongshu', 'x', 'weibo'],
  cardTheme: 'minimal_dark',
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = (document.documentElement.getAttribute('data-theme') || 'light') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    set({ theme: next as Theme });
  },
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSelectedChannels: (selectedChannels) => set({ selectedChannels }),
  setCardTheme: (cardTheme) => set({ cardTheme })
}));
