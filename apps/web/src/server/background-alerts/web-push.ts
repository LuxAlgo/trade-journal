import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

/**
 * Web Push with Node's own crypto, no dependency: message encryption per RFC 8291
 * (aes128gcm, RFC 8188) and VAPID authentication per RFC 8292 (an ES256 JWT).
 */

const b64url = (buffer: Buffer) => buffer.toString("base64url");
const fromB64url = (value: string) => Buffer.from(value, "base64url");

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url (what browsers take as applicationServerKey). */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
}

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]);
  return { publicKey: b64url(point), privateKey: jwk.d };
}

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** HKDF-SHA256 for outputs of at most 32 bytes (all Web Push needs). */
const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) =>
  hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

export interface EncryptInput {
  /** The browser's `keys.p256dh` and `keys.auth`, base64url. */
  p256dh: string;
  auth: string;
  payload: Buffer;
  /** Fixed values for test vectors; random otherwise. */
  salt?: Buffer;
  serverPrivateKey?: Buffer;
}

/** The encrypted request body (one aes128gcm record). */
export function encrypt({ p256dh, auth, payload, salt, serverPrivateKey }: EncryptInput): Buffer {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  const ecdh = createECDH("prime256v1");
  if (serverPrivateKey) ecdh.setPrivateKey(serverPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const recordSalt = salt ?? randomBytes(16);
  const cek = hkdf(recordSalt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(recordSalt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single, last record: the payload then the 0x02 delimiter, no padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  recordSalt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/** The VAPID Authorization header for a push service origin. */
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now(),
): string {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: subject,
      }),
    ),
  );
  const point = fromB64url(keys.publicKey);
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
    },
  });
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

export class PushError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Send one push message; throws PushError with the push service's status on failure. */
export async function sendPush(
  target: PushTarget,
  payload: string,
  options: { keys: VapidKeys; subject: string; ttl?: number; urgency?: "high" | "normal" },
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const body = encrypt({ ...target.keys, payload: Buffer.from(payload) });
  const response = await fetcher(target.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(options.ttl ?? 3600),
      Urgency: options.urgency ?? "high",
      Authorization: vapidAuthorization(target.endpoint, options.keys, options.subject),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new PushError(`Push service answered ${response.status}`, response.status);
  return response.status;
}
