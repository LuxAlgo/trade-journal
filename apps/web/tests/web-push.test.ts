import { describe, expect, it } from "vitest";
import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import {
  encrypt,
  generateVapidKeys,
  sendPush,
  vapidAuthorization,
} from "../src/server/background-alerts/web-push";

// RFC 8291, Appendix A.
const vector = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const b = (s: string) => Buffer.from(s, "base64url");

/** What a browser does with a push message: the receiving half of RFC 8291. */
function decrypt(message: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const salt = message.subarray(0, 16);
  const idlen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idlen);
  const body = message.subarray(21 + idlen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const hmac = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();
  const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, n: number) =>
    hmac(hmac(s, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, n);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
  const ikm = hkdf(auth, ecdh.computeSecret(asPublic), info, 32);
  const decipher = createDecipheriv(
    "aes-128-gcm",
    hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
    hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  decipher.setAuthTag(body.subarray(-16));
  const plain = Buffer.concat([decipher.update(body.subarray(0, -16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

describe("push messages are encrypted as browsers expect", () => {
  it("matches the RFC 8291 example byte for byte", () => {
    const message = encrypt({
      p256dh: vector.uaPublic,
      auth: vector.auth,
      payload: Buffer.from(vector.plaintext),
      salt: b(vector.salt),
      serverPrivateKey: b(vector.asPrivate),
    });
    expect(message.toString("base64url")).toBe(vector.message);
  });

  it("a browser can decrypt a real message", () => {
    const message = encrypt({
      p256dh: vector.uaPublic,
      auth: vector.auth,
      payload: Buffer.from('{"title":"Chart alert"}'),
    });
    expect(decrypt(message, b(vector.uaPrivate), b(vector.auth))).toBe('{"title":"Chart alert"}');
  });
});

describe("VAPID identifies this server to the push service", () => {
  it("signs a JWT for the push service's origin with the server key", () => {
    const keys = generateVapidKeys();
    expect(b(keys.publicKey)).toHaveLength(65);
    const header = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      "mailto:me@example.com",
      Date.parse("2026-09-26T10:00:00Z"),
    );
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = token!.split(".");
    expect(JSON.parse(b(c!).toString())).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.parse("2026-09-26T22:00:00Z") / 1000,
      sub: "mailto:me@example.com",
    });
    const point = b(keys.publicKey);
    const publicKey = createPublicKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        x: point.subarray(1, 33).toString("base64url"),
        y: point.subarray(33).toString("base64url"),
      },
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${h}.${c}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        b(s!),
      ),
    ).toBe(true);
  });

  it("sends the encrypted body with the Web Push headers", async () => {
    const keys = generateVapidKeys();
    let seen: RequestInit | undefined;
    await sendPush(
      {
        endpoint: "https://fcm.googleapis.com/fcm/send/abc",
        keys: { p256dh: vector.uaPublic, auth: vector.auth },
      },
      "hello",
      { keys, subject: "mailto:me@example.com" },
      async (_url, init) => {
        seen = init;
        return new Response(null, { status: 201 });
      },
    );
    const headers = seen!.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(/^vapid t=/);
    expect(
      decrypt(Buffer.from(seen!.body as Uint8Array), b(vector.uaPrivate), b(vector.auth)),
    ).toBe("hello");
    await expect(
      sendPush(
        {
          endpoint: "https://fcm.googleapis.com/x",
          keys: { p256dh: vector.uaPublic, auth: vector.auth },
        },
        "x",
        { keys, subject: "mailto:me@example.com" },
        async () => new Response(null, { status: 410 }),
      ),
    ).rejects.toMatchObject({ statusCode: 410 });
  });
});
