import type { ThemeId } from '../shared/contracts';

/** Versioned, data-only design tokens. Future theme import can validate this shape. */
export interface ThemeDefinition {
  schemaVersion: 1;
  id: ThemeId;
  name: string;
  caption: string;
  colorScheme: 'dark' | 'light';
  tokens: Record<'bg' | 'sidebar' | 'panel' | 'raised' | 'hover' | 'input' | 'text' | 'muted' | 'dim' | 'line' | 'line-strong' | 'accent' | 'accent-text' | 'accent-soft' | 'accent-line' | 'green' | 'cyan' | 'warning' | 'shadow' | 'wave' | 'scroll', string>;
}

export const themes: Record<ThemeId, ThemeDefinition> = {
  dark: {
    schemaVersion: 1, id: 'dark', name: '石墨', caption: '专注每一处细节', colorScheme: 'dark',
    tokens: { bg: '#111418', sidebar: '#0d1014', panel: '#15191e', raised: '#1b2026', hover: '#20262d', input: '#101419', text: '#f2efe8', muted: '#9099a4', dim: '#717d8a', line: '#ffffff0e', 'line-strong': '#ffffff17', accent: '#d6b66f', 'accent-text': '#191a17', 'accent-soft': '#d6b66f12', 'accent-line': '#d6b66f3b', green: '#77b69f', cyan: '#7dacbf', warning: '#edac7f', shadow: '#00000066', wave: '#49515b', scroll: '#404852' },
  },
  light: {
    schemaVersion: 1, id: 'light', name: '纸白', caption: '留白，专注聆听', colorScheme: 'light',
    tokens: { bg: '#f6f4ef', sidebar: '#eeece6', panel: '#f1efe9', raised: '#fffdf8', hover: '#e8e6df', input: '#fbfaf6', text: '#20262d', muted: '#6c756f', dim: '#7d847c', line: '#292d2510', 'line-strong': '#292d2523', accent: '#177c73', 'accent-text': '#ffffff', 'accent-soft': '#177c730d', 'accent-line': '#177c7342', green: '#37795f', cyan: '#377787', warning: '#a95827', shadow: '#2e38251f', wave: '#b7c1b9', scroll: '#c4c7bd' },
  },
  duel: {
    schemaVersion: 1, id: 'duel', name: '决斗', caption: '进入声音的战场', colorScheme: 'dark',
    tokens: { bg: '#08151c', sidebar: '#061016', panel: '#0b1b23', raised: '#102630', hover: '#14313d', input: '#07141b', text: '#e7f2f4', muted: '#8aabb7', dim: '#658895', line: '#5edae610', 'line-strong': '#5edae61f', accent: '#5edae6', 'accent-text': '#071b23', 'accent-soft': '#5edae60d', 'accent-line': '#5edae639', green: '#8ccdb6', cyan: '#e6b55a', warning: '#e6b55a', shadow: '#000c1480', wave: '#2d5462', scroll: '#2b5360' },
  },
};
export const themeOptions = Object.values(themes);
export function applyTheme(id: ThemeId) {
  const theme = themes[id];
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = theme.colorScheme;
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(`--${name}`, value);
}
