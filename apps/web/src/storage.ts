/**
 * Your availability lives here and nowhere else — one localStorage entry on
 * this device. Nothing in the app writes it anywhere a network request could
 * reach.
 *
 * localStorage rather than IndexedDB, deliberately. A window is at most a few
 * hundred bytes, and synchronous writes are what make saving on `pagehide`
 * actually work: an IndexedDB transaction started as the page goes away is
 * torn down before it can commit, which silently loses whatever was painted
 * last. Synchronous storage removes that failure entirely.
 *
 * The slot vector is stored as an uncompressed bitmap. The wire format
 * deflates, but that is async; here the few hundred wasted bytes buy a save
 * path that cannot be interrupted.
 */

import {
  type Availability,
  type SlotMinutes,
  SLOT_MINUTES,
  fromBase64Url,
  packBitmap,
  toBase64Url,
  totalSlots,
  unpackBitmap,
} from '@timesync/core';

const KEY = 'timesync:availability:v1';

interface StoredAvailability {
  originMinute: number;
  slotMinutes: number;
  dayCount: number;
  slots: string;
  label?: string;
  timeZone?: string;
}

export function saveAvailability(availability: Availability): void {
  const record: StoredAvailability = {
    originMinute: availability.originMinute,
    slotMinutes: availability.slotMinutes,
    dayCount: availability.dayCount,
    slots: toBase64Url(packBitmap(availability.slots)),
    ...(availability.label === undefined ? {} : { label: availability.label }),
    ...(availability.timeZone === undefined ? {} : { timeZone: availability.timeZone }),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Private windows and blocked site data both land here. Painting has to
    // keep working even when nothing can persist.
  }
}

export function loadAvailability(): Availability | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const record = JSON.parse(raw) as StoredAvailability;
    const slotMinutes = record.slotMinutes as SlotMinutes;
    if (!SLOT_MINUTES.includes(slotMinutes)) return null;

    const expected = totalSlots({ slotMinutes, dayCount: record.dayCount });
    const slots = unpackBitmap(fromBase64Url(record.slots), expected);

    return {
      originMinute: record.originMinute,
      slotMinutes,
      dayCount: record.dayCount,
      slots,
      ...(record.label === undefined ? {} : { label: record.label }),
      ...(record.timeZone === undefined ? {} : { timeZone: record.timeZone }),
    };
  } catch {
    // A record written by a future version, or corrupted. Starting fresh beats
    // refusing to load.
    return null;
  }
}
