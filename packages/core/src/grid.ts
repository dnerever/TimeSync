/**
 * The bridge between the painting UI and the payload.
 *
 * The UI thinks in local days and times of day. The payload is a flat vector of
 * absolute slots. Because `dayCount` counts 24-hour periods of absolute time, a
 * local day containing a daylight-saving transition is 23 or 25 hours long — so
 * day columns are derived from the zone here rather than assumed to be a fixed
 * stride through the vector.
 */

import { type Availability, type SlotMinutes, slotsPerDay, totalSlots } from './codec.ts';
import { instantForLocal, localParts, weekdayOf } from './timezone.ts';

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalDay extends CalendarDate {
  /** Instant of local midnight opening this day. */
  startsAt: Date;
  /** 0 = Sunday. */
  weekday: number;
}

export interface CreateAvailabilityOptions {
  timeZone: string;
  start: CalendarDate;
  dayCount: number;
  slotMinutes: SlotMinutes;
  label?: string;
}

export function createAvailability(options: CreateAvailabilityOptions): Availability {
  const midnight = instantForLocal(
    options.timeZone,
    options.start.year,
    options.start.month,
    options.start.day,
    0,
  );
  if (!midnight) throw new Error('that start date has no local midnight in this time zone');

  // A handful of zones sit at :45 or :30 offsets, so local midnight does not
  // always land on a slot boundary. Align down: the window opens slightly
  // before midnight, which costs nothing because the UI addresses slots by
  // local time rather than by raw index.
  const originMinute =
    Math.floor(midnight.getTime() / 60_000 / options.slotMinutes) * options.slotMinutes;

  const slotCount = options.dayCount * slotsPerDay(options.slotMinutes);
  return {
    originMinute,
    slotMinutes: options.slotMinutes,
    dayCount: options.dayCount,
    slots: new Uint8Array(slotCount),
    ...(options.label === undefined ? {} : { label: options.label }),
    timeZone: options.timeZone,
  };
}

/** Every local day the window touches, in order. */
export function localDays(av: Availability, timeZone: string): LocalDay[] {
  const endMinute = av.originMinute + totalSlots(av) * av.slotMinutes;
  const first = localParts(timeZone, new Date(av.originMinute * 60_000));

  const days: LocalDay[] = [];
  // +2 covers the partial day an aligned-down origin can expose at either end.
  for (let offset = 0; offset < av.dayCount + 2; offset++) {
    const walk = new Date(Date.UTC(first.year, first.month - 1, first.day) + offset * 86_400_000);
    const year = walk.getUTCFullYear();
    const month = walk.getUTCMonth() + 1;
    const day = walk.getUTCDate();

    const startsAt = instantForLocal(timeZone, year, month, day, 0);
    if (!startsAt) continue; // a zone whose transition swallows midnight itself
    if (startsAt.getTime() / 60_000 >= endMinute) break;

    days.push({ year, month, day, startsAt, weekday: weekdayOf(year, month, day) });
  }
  return days;
}

/**
 * Index of the slot covering a local time on a local date, or null when that
 * time falls outside the window or does not exist in this zone.
 */
export function slotIndexAt(
  av: Availability,
  timeZone: string,
  date: CalendarDate,
  minuteOfDay: number,
): number | null {
  const instant = instantForLocal(timeZone, date.year, date.month, date.day, minuteOfDay);
  if (!instant) return null;

  const offset = instant.getTime() / 60_000 - av.originMinute;
  if (offset < 0 || !Number.isInteger(offset / av.slotMinutes)) return null;

  const index = offset / av.slotMinutes;
  return index < av.slots.length ? index : null;
}

export interface TimeOfDayPreset {
  id: string;
  label: string;
  startMinute: number;
  endMinute: number;
}

export const TIME_OF_DAY_PRESETS: readonly TimeOfDayPreset[] = [
  { id: 'morning', label: 'Mornings', startMinute: 8 * 60, endMinute: 12 * 60 },
  { id: 'midday', label: 'Midday', startMinute: 11 * 60, endMinute: 14 * 60 },
  { id: 'afternoon', label: 'Afternoons', startMinute: 12 * 60, endMinute: 17 * 60 },
  { id: 'evening', label: 'Evenings', startMinute: 17 * 60, endMinute: 21 * 60 },
];

export interface ApplyOptions {
  /** Skip Saturday and Sunday. */
  weekdaysOnly?: boolean;
}

/**
 * Set or clear a local time-of-day band across every day in the window.
 * Returns a new slot vector; the input is not modified.
 */
export function applyTimeOfDay(
  av: Availability,
  timeZone: string,
  band: Pick<TimeOfDayPreset, 'startMinute' | 'endMinute'>,
  value: 0 | 1,
  options: ApplyOptions = {},
): Uint8Array {
  const slots = Uint8Array.from(av.slots);
  for (const day of localDays(av, timeZone)) {
    if (options.weekdaysOnly && (day.weekday === 0 || day.weekday === 6)) continue;
    for (let minute = band.startMinute; minute < band.endMinute; minute += av.slotMinutes) {
      const index = slotIndexAt(av, timeZone, day, minute);
      if (index !== null) slots[index] = value;
    }
  }
  return slots;
}

/**
 * Change how many days a window covers, keeping whatever is already painted.
 *
 * Slots are carried over by absolute instant rather than by index, so a
 * shortened window drops the tail and a lengthened one gains empty days,
 * without anything sliding by an hour across a transition.
 */
export function resizeWindow(av: Availability, timeZone: string, dayCount: number): Availability {
  const first = localDays(av, timeZone)[0];
  if (!first) throw new Error('window has no local days to anchor to');

  const next = createAvailability({
    timeZone,
    start: { year: first.year, month: first.month, day: first.day },
    dayCount,
    slotMinutes: av.slotMinutes,
    ...(av.label === undefined ? {} : { label: av.label }),
  });

  for (let i = 0; i < av.slots.length; i++) {
    if (av.slots[i] !== 1) continue;
    const offset = av.originMinute + i * av.slotMinutes - next.originMinute;
    if (offset < 0) continue;
    const index = offset / next.slotMinutes;
    if (Number.isInteger(index) && index < next.slots.length) next.slots[index] = 1;
  }
  return next;
}

/** Contiguous runs of free time, as absolute instants. */
export function freeBlocks(av: Availability): Array<{ start: Date; end: Date }> {
  const blocks: Array<{ start: Date; end: Date }> = [];
  const at = (index: number): Date => new Date((av.originMinute + index * av.slotMinutes) * 60_000);

  let runStart: number | null = null;
  for (let i = 0; i <= av.slots.length; i++) {
    const free = i < av.slots.length && av.slots[i] === 1;
    if (free && runStart === null) runStart = i;
    if (!free && runStart !== null) {
      blocks.push({ start: at(runStart), end: at(i) });
      runStart = null;
    }
  }
  return blocks;
}
