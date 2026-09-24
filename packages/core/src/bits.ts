/**
 * The two candidate body encodings for a slot vector.
 *
 * Availability is blocky — long runs of free followed by long runs of busy —
 * so run-length encoding usually wins, but not always: a heavily fragmented
 * calendar produces more runs than bits. The codec encodes both and keeps
 * whichever is smaller, so neither has to be right in every case.
 *
 * Every decoder here is strict. Input arrives from an untrusted URL, so
 * anything malformed throws rather than yielding a plausible-looking result.
 */

export function packBitmap(slots: Uint8Array): Uint8Array {
  const out = new Uint8Array((slots.length + 7) >> 3);
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]) out[i >> 3]! |= 0b1000_0000 >> (i & 0b111);
  }
  return out;
}

export function unpackBitmap(bytes: Uint8Array, slotCount: number): Uint8Array {
  if (bytes.length !== (slotCount + 7) >> 3) {
    throw new Error('bitmap length does not match slot count');
  }
  const out = new Uint8Array(slotCount);
  for (let i = 0; i < slotCount; i++) {
    out[i] = (bytes[i >> 3]! >> (7 - (i & 0b111))) & 1;
  }
  return out;
}

/**
 * Alternating run lengths as LEB128 varints, always starting with a busy run
 * (a leading zero when the vector opens with free time).
 */
export function rleEncode(slots: Uint8Array): Uint8Array {
  const bytes: number[] = [];
  const pushVarint = (value: number): void => {
    let rest = value;
    while (rest >= 0x80) {
      bytes.push((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    bytes.push(rest);
  };

  let current = 0;
  let run = 0;
  for (const slot of slots) {
    const bit = slot ? 1 : 0;
    if (bit === current) {
      run++;
    } else {
      pushVarint(run);
      current = bit;
      run = 1;
    }
  }
  pushVarint(run);
  return Uint8Array.from(bytes);
}

export function rleDecode(bytes: Uint8Array, slotCount: number): Uint8Array {
  const out = new Uint8Array(slotCount);
  let i = 0;
  let offset = 0;
  let current = 0;

  while (i < bytes.length) {
    let run = 0;
    let shift = 0;
    for (;;) {
      if (i >= bytes.length) throw new Error('truncated run-length varint');
      const byte = bytes[i++]!;
      run += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 28) throw new Error('run-length varint out of range');
    }
    if (offset + run > slotCount) throw new Error('run-length data exceeds slot count');
    if (current === 1) out.fill(1, offset, offset + run);
    offset += run;
    current ^= 1;
  }

  if (offset !== slotCount) throw new Error('run-length data does not fill slot count');
  return out;
}
