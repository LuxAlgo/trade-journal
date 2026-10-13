import type { MetadataRoute } from "next";
import { APP_BACKGROUND, APP_THEME, appName, appShortName } from "@/lib/pwa";

export const dynamic = "force-dynamic";

/** Web app manifest: lets the browser install the journal as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: appName(),
    short_name: appShortName(),
    description: "Your self-hosted trade journal: trades, charts, daily notes and alerts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: APP_BACKGROUND,
    theme_color: APP_THEME,
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Charts", url: "/charts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      {
        name: "Daily journal",
        url: "/journal",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      { name: "Trades", url: "/trades", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
