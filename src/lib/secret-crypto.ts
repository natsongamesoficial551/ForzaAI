import { getServerEnv } from "./server-env";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizeBase64(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function decodeKey(value: string): Uint8Array {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Uint8Array.from(trimmed.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  }

  const binary = atob(normalizeBase64(trimmed));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function getEncryptionKey(): Promise<CryptoKey> {
  const raw = decodeKey(getServerEnv("ENCRYPTION_KEY"));
  if (raw.byteLength !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as hex or base64");

  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encryptSecret(plainText: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey();
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));

  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(cipherText: string): Promise<string> {
  const [version, ivValue, encryptedValue] = cipherText.split(".");
  if (version !== "v1" || !ivValue || !encryptedValue) throw new Error("Invalid encrypted secret");

  const key = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivValue) },
    key,
    fromBase64(encryptedValue),
  );

  return decoder.decode(decrypted);
}
