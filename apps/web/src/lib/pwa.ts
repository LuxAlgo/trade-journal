/**
 * The installable web app: its name, colours and the files a browser fetches to install
 * it. JOURNAL_APP_NAME / JOURNAL_APP_SHORT_NAME rename the installed app.
 */
export const appName = () => process.env.JOURNAL_APP_NAME?.trim() || "Trade Journal";
export const appShortName = () => process.env.JOURNAL_APP_SHORT_NAME?.trim() || "Journal";

export const APP_BACKGROUND = "#08080a";
export const APP_THEME = "#08080a";

/**
 * Paths the browser fetches without a session while installing or running the service
 * worker; none of them holds journal data. The auth middleware lets them through.
 */
export const isPublicAppAsset = (pathname: string) =>
  pathname === "/manifest.webmanifest" ||
  pathname === "/sw.js" ||
  pathname.startsWith("/icons/") ||
  pathname.startsWith("/apple-icon");
