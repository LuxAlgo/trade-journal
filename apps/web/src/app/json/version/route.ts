import { NextResponse } from "next/server";
import packageJson from "../../../../package.json";

/** DevTools and local tooling probe this path. It carries no journal data. */
export const GET = () =>
  NextResponse.json({ name: packageJson.name, version: packageJson.version });
