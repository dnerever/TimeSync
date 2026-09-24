/**
 * Base64url without padding, isomorphic between Node and the browser.
 *
 * Hand-rolled rather than going through `btoa`/`Buffer` so the same code runs
 * in both places with identical behaviour, and so the alphabet is guaranteed
 * URL-safe: a payload lands in a URL fragment and must survive being copied,
 * pasted, and round-tripped through a QR scanner untouched.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const REVERSE = /* @__PURE__ */ (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += ALPHABET[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += ALPHABET[b2 & 0b111111];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const remainder = text.length & 0b11;
  // A trailing single character cannot encode any whole byte.
  if (remainder === 1) throw new Error('invalid base64url: orphaned trailing character');

  const digit = (index: number): number => {
    const code = text.charCodeAt(index);
    const value = code < 128 ? REVERSE[code]! : -1;
    if (value < 0) throw new Error(`invalid base64url character at index ${index}`);
    return value;
  };

  const out = new Uint8Array((text.length >> 2) * 3 + (remainder === 0 ? 0 : remainder - 1));
  let o = 0;
  let i = 0;
  for (; i + 4 <= text.length; i += 4) {
    const a = digit(i);
    const b = digit(i + 1);
    const c = digit(i + 2);
    const d = digit(i + 3);
    out[o++] = (a << 2) | (b >> 4);
    out[o++] = ((b & 0b1111) << 4) | (c >> 2);
    out[o++] = ((c & 0b11) << 6) | d;
  }
  if (remainder === 2) {
    out[o++] = (digit(i) << 2) | (digit(i + 1) >> 4);
  } else if (remainder === 3) {
    const b = digit(i + 1);
    out[o++] = (digit(i) << 2) | (b >> 4);
    out[o++] = ((b & 0b1111) << 4) | (digit(i + 2) >> 2);
  }
  return out;
}
