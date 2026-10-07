// Wire format of synced records: JSON, gzip-compressed above 512 bytes when
// that saves space. The connection to the backend is TLS, and the backend
// stores the records encrypted at rest.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Copies into a standalone ArrayBuffer (Convex `v.bytes()` and WebCrypto). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

export async function sha256Base64Url(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is not available");
  return toBase64Url(new Uint8Array(await subtle.digest("SHA-256", encoder.encode(text))));
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

/** Content of one record. */
export interface Envelope {
  entity: string;
  id: string;
  record: unknown;
}

/** Stable server ID of a local entity and ID. Entity names never contain "/". */
export const recordIdOf = (entity: string, id: string) => `${entity}/${id}`;

export async function encodeRecord(envelope: Envelope): Promise<Uint8Array> {
  const plain = encoder.encode(JSON.stringify(envelope));
  const packed = plain.length > 512 ? await compress(plain) : null;
  return packed && packed.length < plain.length ? packed : plain;
}

export async function decodeRecord(bytes: Uint8Array): Promise<Envelope> {
  // JSON text never starts with the gzip magic bytes.
  const plain = bytes[0] === 0x1f && bytes[1] === 0x8b ? await decompress(bytes) : bytes;
  const envelope = JSON.parse(decoder.decode(plain)) as Envelope;
  if (!envelope || typeof envelope.entity !== "string" || typeof envelope.id !== "string") {
    throw new Error("Invalid record envelope");
  }
  return envelope;
}
