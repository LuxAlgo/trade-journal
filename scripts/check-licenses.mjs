#!/usr/bin/env node
/**
 * Dependency license gate. Fails the build when any installed dependency
 * (lockfile-deep, via `pnpm licenses list`) carries a license outside the
 * allowlist. SPDX OR-expressions pass when any alternative is allowed;
 * AND-expressions require every part to be allowed.
 */
import { execSync } from "node:child_process";

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "MPL-2.0",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
]);

// Package-scoped exceptions, each with a reason. Add sparingly and explain why.
const EXCEPTIONS = {
  // Browser-support data used by the build toolchain (browserslist). Data
  // under an attribution license, not code; attribution ships in the package.
  "caniuse-lite": ["CC-BY-4.0"],
};

const allowedExpression = (expression) => {
  const clean = expression.replace(/^\(|\)$/g, "").trim();
  if (clean.includes(" OR ")) return clean.split(" OR ").some((part) => allowedExpression(part));
  if (clean.includes(" AND ")) return clean.split(" AND ").every((part) => allowedExpression(part));
  return ALLOWED.has(clean.trim());
};

const raw = execSync("pnpm licenses list --json", {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);

const violations = [];
for (const [license, packages] of Object.entries(byLicense)) {
  if (allowedExpression(license)) continue;
  for (const pkg of packages) {
    if (EXCEPTIONS[pkg.name]?.includes(license)) continue;
    violations.push(`${pkg.name} (${pkg.versions?.join(", ")}): ${license}`);
  }
}

if (violations.length > 0) {
  console.error(
    "Disallowed dependency licenses found:\n" + violations.map((v) => `  - ${v}`).join("\n"),
  );
  console.error(
    "\nReplace the dependency, or add a reviewed package-scoped exception in scripts/check-licenses.mjs.",
  );
  process.exit(1);
}
console.log("Dependency licenses OK.");
