/**
 * Authenticated symmetric encryption for secrets at rest (#61). Server-only.
 *
 * AES-256-GCM with a 32-byte master key from PROVIDER_KEY_SECRET (base64). The
 * stored form is `iv.tag.ciphertext` (all base64); GCM's tag detects tampering
 * on decrypt. The master key never leaves the server.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function masterKey(): Buffer {
  // Destructured (not process.env.X) to satisfy biome + tsc index-signature rules.
  const { PROVIDER_KEY_SECRET } = process.env;
  if (!PROVIDER_KEY_SECRET) {
    throw new Error("PROVIDER_KEY_SECRET is not set — cannot encrypt provider keys.");
  }
  const key = Buffer.from(PROVIDER_KEY_SECRET, "base64");
  if (key.length !== 32) {
    throw new Error("PROVIDER_KEY_SECRET must decode to 32 bytes (base64).");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptSecret(blob: string): string {
  const [ivB64, tagB64, ctB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !ctB64) {
    throw new Error("malformed encrypted secret");
  }
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString(
    "utf8",
  );
}
