// uuidv7 — time-sortable IDs that the client can mint offline.
// Implements RFC 9562 §5.7 (60-bit Unix-ms timestamp + 12-bit randA + 62-bit randB + version/variant bits).
//
// We deliberately don't pull a library for this: the implementation is short,
// stable, and lets us keep the protocol package free of runtime deps beyond zod.

const HEX = "0123456789abcdef";

function randBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    s += HEX[(b >>> 4) & 0xf];
    s += HEX[b & 0xf];
  }
  return s;
}

let lastMs = 0;
let monotonic = 0;

export function uuidv7(nowMs: number = Date.now()): string {
  // Monotonic guard: if the clock didn't advance, force a tick forward so two
  // uuids minted in the same ms still sort in mint order.
  let ms = nowMs;
  if (ms <= lastMs) {
    monotonic++;
    ms = lastMs;
  } else {
    monotonic = 0;
    lastMs = ms;
  }

  const bytes = new Uint8Array(16);
  // 48 bits of timestamp (ms since epoch) in the first 6 bytes.
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;

  const rand = randBytes(10);
  for (let i = 0; i < 10; i++) bytes[6 + i] = rand[i] ?? 0;

  // Set version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // Set RFC 9562 variant bits (10) in the high two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  // Sub-ms monotonic counter sits in the low 12 bits of bytes 6..7 (the randA field).
  // Always set it (even when zero) so the first call in a new ms doesn't carry
  // random bits in this field that could sort above later calls.
  bytes[6] = (bytes[6] & 0xf0) | ((monotonic >> 8) & 0x0f);
  bytes[7] = monotonic & 0xff;

  const hex = toHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidv7(s: string): boolean {
  return UUID_RE.test(s);
}
