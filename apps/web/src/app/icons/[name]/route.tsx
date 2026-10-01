import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app-icon";

const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "icon-192.png": { size: 192, maskable: false },
  "icon-512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "badge-96.png": { size: 96, maskable: false },
};

export const dynamic = "force-static";
export const generateStaticParams = () => Object.keys(SIZES).map((name) => ({ name }));

/** PNG icons for the web app manifest and notifications. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const spec = SIZES[(await params).name];
  if (!spec) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIcon size={spec.size} maskable={spec.maskable} />, {
    width: spec.size,
    height: spec.size,
  });
}
