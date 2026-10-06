// End-to-end encryption for the cloud copy, on WebCrypto only.
//
// - The account has one random 256-bit data key. It never leaves the user's
//   devices unencrypted; the server stores it wrapped with a key derived from
//   the recovery key (HKDF-SHA-256, AES-256-GCM).
// - Each app derives its own subkeys from the data key: one AES-256-GCM key
//   for record content and one HMAC key for record IDs. The server therefore
//   sees neither content nor entity names nor local IDs.
// - A record's ciphertext is bound to its app and record ID (additional
//   authenticated data), so the server cannot swap records unnoticed.

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FORMAT = 1;
const FLAG_GZIP = 1;

const subtle = () => {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("WebCrypto is not available");
  return value;
};

export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Copies into a standalone ArrayBuffer (Convex `v.bytes()` and WebCrypto). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function sha256Base64Url(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await subtle().digest("SHA-256", encoder.encode(text))));
}

/** JSON with sorted object keys: equal content always gives equal text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

// ---- Recovery key ----
// 32 random bytes in Crockford base32: 52 characters in groups of four. No
// I, L, O or U; typing them is forgiven (I/L -> 1, O -> 0).
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

/** Null when the text cannot be a recovery key (wrong length or characters). */
export function parseRecoveryKey(text: string): Uint8Array | null {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  if (clean.length !== 52) return null;
  const bytes = new Uint8Array(32);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) return null;
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      if (index < 32) bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  // The last character carries four unused bits; they must be zero.
  return index === 32 && (value & ((1 << bits) - 1)) === 0 ? bytes : null;
}

// ---- Key wrapping ----

async function hkdf(secret: Uint8Array, info: string, usage: "wrap" | "data" | "id"): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", toArrayBuffer(secret), "HKDF", false, ["deriveKey"]);
  const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(info) };
  return usage === "id"
    ? subtle().deriveKey(params, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"])
    : subtle().deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(key: CryptoKey, plain: Uint8Array, aad: string, flags = 0): Promise<Uint8Array> {
  const iv = randomBytes(12);
  const cipher = new Uint8Array(await subtle().encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: encoder.encode(aad) }, key, toArrayBuffer(plain),
  ));
  const out = new Uint8Array(2 + iv.length + cipher.length);
  out[0] = FORMAT;
  out[1] = flags;
  out.set(iv, 2);
  out.set(cipher, 2 + iv.length);
  return out;
}

async function open(key: CryptoKey, sealed: Uint8Array, aad: string): Promise<{ plain: Uint8Array; flags: number }> {
  if (sealed.length < 2 + 12 + 16 || sealed[0] !== FORMAT) throw new Error("Unknown ciphertext format");
  const iv = sealed.slice(2, 14);
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: encoder.encode(aad) }, key, toArrayBuffer(sealed.slice(14)),
  );
  return { plain: new Uint8Array(plain), flags: sealed[1] };
}

export interface DataKey {
  keyId: string;
  /** 32 raw bytes. */
  key: Uint8Array;
}

export function createDataKey(): DataKey {
  return { keyId: toBase64Url(randomBytes(16)), key: randomBytes(32) };
}

export async function wrapDataKey(dataKey: DataKey, recoveryKey: Uint8Array): Promise<Uint8Array> {
  const kek = await hkdf(recoveryKey, "agentz-sync/v1/wrap", "wrap");
  return seal(kek, dataKey.key, `agentz-sync/v1/key/${dataKey.keyId}`);
}

/** Throws when the recovery key does not match. */
export async function unwrapDataKey(keyId: string, wrapped: Uint8Array, recoveryKey: Uint8Array): Promise<DataKey> {
  const kek = await hkdf(recoveryKey, "agentz-sync/v1/wrap", "wrap");
  const { plain } = await open(kek, wrapped, `agentz-sync/v1/key/${keyId}`);
  if (plain.length !== 32) throw new Error("Invalid data key");
  return { keyId, key: plain };
}

// ---- Records ----

async function compress(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Response(toArrayBuffer(bytes)).body!.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new Error("Compressed records need DecompressionStream");
  const stream = new Response(toArrayBuffer(bytes)).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Content of one record before encryption. */
export interface Envelope {
  entity: string;
  id: string;
  record: unknown;
}

export interface RecordCipher {
  keyId: string;
  /** Opaque, stable server ID for a local entity and ID. */
  recordId(entity: string, id: string): Promise<string>;
  encrypt(recordId: string, envelope: Envelope): Promise<Uint8Array>;
  decrypt(recordId: string, sealed: Uint8Array): Promise<Envelope>;
}

export async function createRecordCipher(dataKey: DataKey, app: string): Promise<RecordCipher> {
  const [contentKey, idKey] = await Promise.all([
    hkdf(dataKey.key, `agentz-sync/v1/${app}/data`, "data"),
    hkdf(dataKey.key, `agentz-sync/v1/${app}/id`, "id"),
  ]);
  const aad = (recordId: string) => `agentz-sync/v1/${app}/${recordId}`;
  return {
    keyId: dataKey.keyId,
    async recordId(entity, id) {
      const mac = await subtle().sign("HMAC", idKey, encoder.encode(`${entity}\u0000${id}`));
      return toBase64Url(new Uint8Array(mac));
    },
    async encrypt(recordId, envelope) {
      const plain = encoder.encode(JSON.stringify(envelope));
      const packed = plain.length > 512 ? await compress(plain) : null;
      return packed && packed.length < plain.length
        ? seal(contentKey, packed, aad(recordId), FLAG_GZIP)
        : seal(contentKey, plain, aad(recordId));
    },
    async decrypt(recordId, sealed) {
      const { plain, flags } = await open(contentKey, sealed, aad(recordId));
      const bytes = flags & FLAG_GZIP ? await decompress(plain) : plain;
      const envelope = JSON.parse(decoder.decode(bytes)) as Envelope;
      if (!envelope || typeof envelope.entity !== "string" || typeof envelope.id !== "string") {
        throw new Error("Invalid record envelope");
      }
      return envelope;
    },
  };
}
