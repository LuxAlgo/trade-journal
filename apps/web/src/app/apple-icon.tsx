import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPhone and iPad (Next adds the apple-touch-icon link). */
export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} maskable />, size);
}
