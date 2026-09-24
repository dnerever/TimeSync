import test from 'node:test';
import assert from 'node:assert/strict';

import { packBitmap, unpackBitmap, rleEncode, rleDecode } from './bits.ts';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Blocky, like a real calendar, rather than uniform noise. */
function blockySlots(random: () => number, length: number): Uint8Array {
  const slots = new Uint8Array(length);
  let i = 0;
  let value = 0;
  while (i < length) {
    const run = 1 + Math.floor(random() * 20);
    if (value) slots.fill(1, i, Math.min(i + run, length));
    i += run;
    value ^= 1;
  }
  return slots;
}

test('bitmap round-trips at every length near a byte boundary', () => {
  const random = prng(11);
  for (let length = 1; length <= 96; length++) {
    const slots = blockySlots(random, length);
    assert.deepEqual(unpackBitmap(packBitmap(slots), length), slots, `length ${length}`);
  }
});

test('run-length round-trips, including vectors that open free or end free', () => {
  const random = prng(12);
  for (let length = 1; length <= 96; length++) {
    const slots = blockySlots(random, length);
    assert.deepEqual(rleDecode(rleEncode(slots), length), slots, `length ${length}`);
  }
  for (const slots of [Uint8Array.of(1), Uint8Array.of(0), new Uint8Array(64).fill(1)]) {
    assert.deepEqual(rleDecode(rleEncode(slots), slots.length), slots);
  }
});

test('run-length handles runs longer than one varint byte', () => {
  const slots = new Uint8Array(5000);
  slots.fill(1, 1000, 4000);
  assert.deepEqual(rleDecode(rleEncode(slots), slots.length), slots);
});

test('run-length encoding normalises any truthy value to 1', () => {
  const slots = Uint8Array.of(3, 7, 0, 200);
  assert.deepEqual(rleDecode(rleEncode(slots), 4), Uint8Array.of(1, 1, 0, 1));
});

test('decoders reject corrupt input instead of returning a plausible answer', () => {
  const slots = blockySlots(prng(13), 64);
  const encoded = rleEncode(slots);

  assert.throws(() => rleDecode(encoded, 63), /exceeds slot count|does not fill/);
  assert.throws(() => rleDecode(encoded, 65), /does not fill slot count/);
  assert.throws(() => rleDecode(Uint8Array.of(0x80), 8), /truncated run-length varint/);
  assert.throws(
    () => rleDecode(Uint8Array.of(0x80, 0x80, 0x80, 0x80, 0x80, 0x80), 8),
    /varint out of range/,
  );

  assert.throws(() => unpackBitmap(packBitmap(slots), 65), /does not match slot count/);
  assert.throws(() => unpackBitmap(new Uint8Array(2), 64), /does not match slot count/);
});

test('run-length beats a bitmap on realistic availability', () => {
  // Not a hard guarantee of the format, but if this ever flips it means the
  // fixture stopped resembling a calendar.
  const slots = blockySlots(prng(14), 28 * 96);
  assert.ok(
    rleEncode(slots).length < packBitmap(slots).length,
    'expected run-length to win on blocky data',
  );
});
