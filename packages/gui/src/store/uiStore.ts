import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark';
type CardTheme = 'minimal_dark' | 'notion_light';

interface UiState {
  theme: Theme;
  commandPaletteOpen: boolean;
  sidebarCollapsed: boolean;
  selectedChannels: string[];
  cardTheme: CardTheme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSelectedChannels: (chs: string[]) => void;
  setCardTheme: (t: CardTheme) => void;
}

const applyTheme = (theme: Theme): void => {
  document.documentElement.setAttribute('data-theme', theme);
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      commandPaletteOpen: false,
      sidebarCollapsed: false,
      selectedChannels: ['wechat', 'xiaohongshu', 'x', 'weibo'],
      cardTheme: 'minimal_dark',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next: Theme = get().theme === 'light' ? 'dark' : 'light';
        applyTheme(next);
        set({ theme: next });
      },
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSelectedChannels: (selectedChannels) => set({ selectedChannels }),
      setCardTheme: (cardTheme) => set({ cardTheme })
    }),
    {
      name: 'solo-creator.ui',
      partialize: (state) => ({
        theme: state.theme,
        selectedChannels: state.selectedChannels,
        cardTheme: state.cardTheme
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) {
          applyTheme(state.theme);
        }
      }
    }
  )
);
