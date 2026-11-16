/** Non-sensitive UI preferences stored in readable cookies so the server renders them without a flash. */
export const THEME_COOKIE = 'rp_theme';
export const NAV_COOKIE = 'rp_nav';
export type ThemeChoice = 'light' | 'dark' | 'system';
export type NavState = 'expanded' | 'collapsed';

/** Product decision: light is the default until the user chooses otherwise. */
export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'dark' || value === 'system' || value === 'light' ? value : 'light';
}

export function parseNav(value: string | undefined): NavState {
  return value === 'collapsed' ? 'collapsed' : 'expanded';
}

export function colorSchemeMeta(theme: ThemeChoice): string {
  return theme === 'system' ? 'light dark' : theme;
}

export function writePreferenceCookie(name: string, value: string): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}
