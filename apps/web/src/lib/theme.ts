export type Theme = "dark" | "light";
export const THEME_KEY = "journal-theme-v1";
export const themePreference = (value: string | null): Theme =>
  value === "light" ? "light" : "dark";

// Runs in <head>, before the page paints. A saved light theme must not flash dark
// while React hydrates. No OS preference override: dark is the product default.
export const THEME_INIT_SCRIPT = `(()=>{let theme="dark";try{theme=localStorage.getItem(${JSON.stringify(THEME_KEY)})==="light"?"light":"dark"}catch{}document.documentElement.classList.toggle("dark",theme==="dark")})();`;
