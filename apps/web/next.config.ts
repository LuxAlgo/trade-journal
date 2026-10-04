import type { NextConfig } from "next";
import path from "node:path";

// Manual equivalent of `createNextIntlPlugin("./src/i18n/request.ts")` (kept
// while the official plugin is blocked by the @swc/core native-binding cache
// on this machine): alias `next-intl/config` for both Turbopack (relative) and
// webpack (absolute), exactly as the plugin does for Next 15.x.
const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@luxalgo/journal-core", "@luxalgo/journal-importers"],
  serverExternalPackages: ["better-sqlite3"],
  // Runtime journal files belong on the user's disk, never in a deployable bundle.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "../../outputs/**/*", "../../.runtime-backup*/**/*"],
  },
  // Message catalogs are read at request time from disk (i18n/request.ts);
  // trace them into the standalone bundle or every locale resolves to an error.
  outputFileTracingIncludes: {
    "/**": ["./messages/**"],
  },
  turbopack: {
    resolveAlias: {
      "next-intl/config": "./src/i18n/request.ts",
    },
  },
  webpack(config, context) {
    config.resolve ??= {};
    config.resolve.alias ??= {};
    config.resolve.alias["next-intl/config"] = path.resolve(
      config.context,
      "./src/i18n/request.ts",
    );
    return config;
  },
};

export default nextConfig;
