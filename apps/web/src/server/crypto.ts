import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@/db";

/**
 * Broker credentials at rest are AES-256-GCM encrypted. The key comes from
 * JOURNAL_SECRET when set; otherwise a random key file is generated next to
 * the database — same trust boundary as the data it protects, so a copied
 * data directory keeps working while a leaked database file alone does not.
 */
const keyMaterial = (): Buffer => {
  const secret = process.env.JOURNAL_SECRET;
  if (secret && secret.length > 0) return scryptSync(secret, "luxalgo-trade-journal", 32);
  const dir = dataDir();
  const keyPath = join(dir, ".secret");
  if (!existsSync(keyPath)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return Buffer.from(readFileSync(keyPath, "utf8").trim(), "hex");
};

export const encryptJson = (value: unknown): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    iv.toString("base64"),
    encrypted.toString("base64"),
    cipher.getAuthTag().toString("base64"),
  ].join(".");
};

export const decryptJson = <T>(envelope: string): T => {
  const [iv, encrypted, tag] = envelope.split(".");
  if (!iv || !encrypted || !tag) throw new Error("Malformed credential envelope");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
};
