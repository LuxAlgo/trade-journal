import { createHash } from "node:crypto";

/**
 * A stored chart snapshot as a response. Browsers revalidate every time (the image changes
 * with the analysis), and an unchanged image answers 304 instead of sending megabytes.
 */
export function pngResponse(request: Request, image: Buffer): Response {
  const etag = `"${createHash("sha1").update(image).digest("base64url")}"`;
  const headers = {
    "Content-Type": "image/png",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-cache",
    ETag: etag,
  };
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers });
  // A view over the stored bytes: no copy.
  const body = new Uint8Array(
    image.buffer,
    image.byteOffset,
    image.byteLength,
  ) as Uint8Array<ArrayBuffer>;
  return new Response(body, { headers });
}
