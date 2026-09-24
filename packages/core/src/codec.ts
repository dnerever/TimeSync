/**
 * The share payload format.
 *
 * This is the one piece of TimeSync that is expensive to change: once someone
 * has a QR code on a fridge or in an email, its bytes have to keep decoding.
 * Hence the version nibble in byte 0 — a future format can coexist with this
 * one rather than replacing it.
 *
 *   byte 0        version (high nibble) | flags (low nibble)
 *   bytes 1..4    origin, minutes since the Unix epoch, UTC, big-endian
 *   byte 5        slot size index into SLOT_MINUTES
 *   byte 6        day count
 *   [FLAG_LABEL]  length byte + UTF-8 label
 *   [FLAG_TZ]     length byte + UTF-8 IANA time zone
 *   rest          deflate-raw(bitmap) or deflate-raw(RLE), per FLAG_RLE
 *
 * The origin is an absolute instant, never a local date. A month-long window
 * can straddle a daylight-saving transition, and local-time arithmetic would
 * silently shift every slot after it. Absolute instants make that class of bug
 * unrepresentable: the viewer renders in whatever zone they happen to be in,
 * and the arithmetic never has to know about either party's offset.
 */

import { toBase64Url, fromBase64Url } from './base64url.ts';
import { packBitmap, unpackBitmap, rleEncode, rleDecode } from './bits.ts';
import { deflateRaw, inflateRaw } from './compress.ts';

export const FORMAT_VERSION = 1;

export const SLOT_MINUTES = [15, 30, 60] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];

/** Roughly two months. Bounds both the QR size and untrusted allocations. */
export const MAX_DAY_COUNT = 62;
export const MAX_LABEL_BYTES = 48;
export const MAX_TIME_ZONE_BYTES = 48;
/** Generous next to a realistic ~170-character payload; a guard, not a target. */
export const MAX_PAYLOAD_CHARS = 4096;

const FLAG_RLE = 0b0001;
const FLAG_LABEL = 0b0010;
const FLAG_TZ = 0b0100;
const KNOWN_FLAGS = FLAG_RLE | FLAG_LABEL | FLAG_TZ;

export interface Availability {
  /** Absolute UTC start of slot 0, in whole minutes since the Unix epoch. */
  originMinute: number;
  slotMinutes: SlotMinutes;
  dayCount: number;
  /** One entry per slot, 1 = free. Length is always `totalSlots(av)`. */
  slots: Uint8Array;
  /** Optional display name for whoever is sharing. */
  label?: string;
  /** Optional IANA zone, only to show the sharer's local time alongside. */
  timeZone?: string;
}

export function slotsPerDay(slotMinutes: SlotMinutes): number {
  return (24 * 60) / slotMinutes;
}

export function totalSlots(av: Pick<Availability, 'slotMinutes' | 'dayCount'>): number {
  return av.dayCount * slotsPerDay(av.slotMinutes);
}

/** Absolute start instant of slot `index`. */
export function slotStart(
  av: Pick<Availability, 'originMinute' | 'slotMinutes'>,
  index: number,
): Date {
  return new Date((av.originMinute + index * av.slotMinutes) * 60_000);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function assertValid(av: Availability): void {
  if (!Number.isInteger(av.originMinute) || av.originMinute < 0 || av.originMinute > 0xffff_ffff) {
    throw new Error('originMinute must be a uint32 count of minutes since the epoch');
  }
  if (!SLOT_MINUTES.includes(av.slotMinutes)) {
    throw new Error(`slotMinutes must be one of ${SLOT_MINUTES.join(', ')}`);
  }
  // Slot boundaries have to line up with the grid, or two payloads built at
  // different moments can never be intersected slot-for-slot.
  if (av.originMinute % av.slotMinutes !== 0) {
    throw new Error('originMinute must fall on a slotMinutes boundary');
  }
  if (!Number.isInteger(av.dayCount) || av.dayCount < 1 || av.dayCount > MAX_DAY_COUNT) {
    throw new Error(`dayCount must be between 1 and ${MAX_DAY_COUNT}`);
  }
  if (av.slots.length !== totalSlots(av)) {
    throw new Error('slots length does not match dayCount and slotMinutes');
  }
  if (av.label !== undefined && encoder.encode(av.label).length > MAX_LABEL_BYTES) {
    throw new Error(`label exceeds ${MAX_LABEL_BYTES} bytes`);
  }
  if (av.timeZone !== undefined && encoder.encode(av.timeZone).length > MAX_TIME_ZONE_BYTES) {
    throw new Error(`timeZone exceeds ${MAX_TIME_ZONE_BYTES} bytes`);
  }
}

export async function encodeAvailability(av: Availability): Promise<string> {
  assertValid(av);

  // Encode both ways and keep the winner; which one wins depends on how
  // fragmented this particular calendar is.
  const [asBitmap, asRle] = await Promise.all([
    deflateRaw(packBitmap(av.slots)),
    deflateRaw(rleEncode(av.slots)),
  ]);
  const useRle = asRle.length < asBitmap.length;
  const body = useRle ? asRle : asBitmap;

  const label = av.label === undefined ? undefined : encoder.encode(av.label);
  const timeZone = av.timeZone === undefined ? undefined : encoder.encode(av.timeZone);

  let flags = 0;
  if (useRle) flags |= FLAG_RLE;
  if (label) flags |= FLAG_LABEL;
  if (timeZone) flags |= FLAG_TZ;

  const head: number[] = [
    (FORMAT_VERSION << 4) | flags,
    (av.originMinute >>> 24) & 0xff,
    (av.originMinute >>> 16) & 0xff,
    (av.originMinute >>> 8) & 0xff,
    av.originMinute & 0xff,
    SLOT_MINUTES.indexOf(av.slotMinutes),
    av.dayCount,
  ];
  if (label) head.push(label.length, ...label);
  if (timeZone) head.push(timeZone.length, ...timeZone);

  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);

  const payload = toBase64Url(out);
  if (payload.length > MAX_PAYLOAD_CHARS) {
    throw new Error('encoded payload is too large to share');
  }
  return payload;
}

export async function decodeAvailability(payload: string): Promise<Availability> {
  if (payload.length > MAX_PAYLOAD_CHARS) {
    throw new Error('payload exceeds maximum length');
  }
  const bytes = fromBase64Url(payload);
  if (bytes.length < 8) throw new Error('payload is too short to be valid');

  const version = bytes[0]! >> 4;
  if (version !== FORMAT_VERSION) {
    throw new Error(`unsupported payload version ${version}; this build reads v${FORMAT_VERSION}`);
  }
  const flags = bytes[0]! & 0b1111;
  if (flags & ~KNOWN_FLAGS) throw new Error('payload sets unknown flags');

  const originMinute = bytes[1]! * 2 ** 24 + ((bytes[2]! << 16) | (bytes[3]! << 8) | bytes[4]!);

  const slotMinutes = SLOT_MINUTES[bytes[5]!];
  if (slotMinutes === undefined) throw new Error('payload has an unknown slot size');
  if (originMinute % slotMinutes !== 0) {
    throw new Error('payload origin does not fall on a slot boundary');
  }

  const dayCount = bytes[6]!;
  if (dayCount < 1 || dayCount > MAX_DAY_COUNT) throw new Error('payload day count out of range');

  let cursor = 7;
  const readString = (limit: number, what: string): string => {
    if (cursor >= bytes.length) throw new Error(`payload truncated before ${what}`);
    const length = bytes[cursor++]!;
    if (length > limit) throw new Error(`payload ${what} exceeds ${limit} bytes`);
    if (cursor + length > bytes.length) throw new Error(`payload truncated inside ${what}`);
    const value = decoder.decode(bytes.subarray(cursor, cursor + length));
    cursor += length;
    return value;
  };

  const label = flags & FLAG_LABEL ? readString(MAX_LABEL_BYTES, 'label') : undefined;
  const timeZone = flags & FLAG_TZ ? readString(MAX_TIME_ZONE_BYTES, 'time zone') : undefined;

  const slotCount = dayCount * slotsPerDay(slotMinutes);
  const body = bytes.subarray(cursor);
  if (body.length === 0) throw new Error('payload has no body');

  const inflated = await inflateRaw(body, Math.max(slotCount, (slotCount + 7) >> 3) + 16);
  const slots =
    flags & FLAG_RLE ? rleDecode(inflated, slotCount) : unpackBitmap(inflated, slotCount);

  return {
    originMinute,
    slotMinutes,
    dayCount,
    slots,
    ...(label === undefined ? {} : { label }),
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

/**
 * The payload lives in the fragment, which browsers never put on the wire.
 * That is the whole privacy claim, so it is enforced in one place: nothing
 * else in the app may put availability into a path or query string.
 */
export function buildShareUrl(baseUrl: string | URL, payload: string): string {
  const url = new URL(baseUrl.toString());
  url.hash = `p=${payload}`;
  return url.toString();
}

export function extractPayload(url: string | URL): string | null {
  const hash = new URL(url.toString()).hash.replace(/^#/, '');
  if (hash === '') return null;
  return new URLSearchParams(hash).get('p');
}
