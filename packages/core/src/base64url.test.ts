import test from 'node:test';
import assert from 'node:assert/strict';

import { toBase64Url, fromBase64Url } from './base64url.ts';

// Deterministic PRNG so a failure is always reproducible from the seed alone.
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("matches Node's own base64url for every length up to 64 bytes", () => {
  const random = prng(0xc0ffee);
  for (let length = 0; length <= 64; length++) {
    const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
    const expected = Buffer.from(bytes).toString('base64url');
    assert.equal(toBase64Url(bytes), expected, `encoding ${length} bytes`);
    assert.deepEqual(fromBase64Url(expected), bytes, `decoding ${length} bytes`);
  }
});

test('round-trips the byte extremes', () => {
  for (const bytes of [
    new Uint8Array(0),
    Uint8Array.of(0),
    Uint8Array.of(255),
    new Uint8Array(32).fill(0),
    new Uint8Array(32).fill(255),
  ]) {
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  }
});

test('never emits characters that a URL or QR scanner would mangle', () => {
  const random = prng(7);
  const bytes = Uint8Array.from({ length: 512 }, () => Math.floor(random() * 256));
  assert.match(toBase64Url(bytes), /^[A-Za-z0-9_-]*$/);
});

test('rejects malformed input rather than guessing', () => {
  assert.throws(() => fromBase64Url('A'), /orphaned trailing character/);
  assert.throws(() => fromBase64Url('AB+C'), /invalid base64url character/);
  assert.throws(() => fromBase64Url('AB/C'), /invalid base64url character/);
  assert.throws(() => fromBase64Url('AB=='), /invalid base64url character/);
  assert.throws(() => fromBase64Url('ABÿC'), /invalid base64url character/);
});
