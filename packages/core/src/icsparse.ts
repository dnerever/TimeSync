/**
 * Reading an exported calendar to find when someone is already busy.
 *
 * This is the import half of the `.ics` story. It runs entirely in the
 * browser on a file the user drags in — no feed URL, no server, nothing that
 * leaves the device.
 *
 * The failure mode that matters is under-blocking. If a busy period is missed,
 * TimeSync offers a time the user cannot make, which is exactly the mistake
 * the rest of the app works to avoid. So anything not understood is counted
 * and reported rather than quietly dropped, and the caller is expected to say
 * so. Over-blocking is merely inconvenient; under-blocking breaks a promise.
 *
 * RFC 5545 is enormous and most of it does not matter for "when are they
 * busy". What is handled: folded lines, parameters, UTC / zoned / floating /
 * date-only values, DTEND or DURATION, STATUS:CANCELLED, TRANSP:TRANSPARENT,
 * EXDATE, and the recurrence rules calendars actually emit. What is not is
 * counted in `unsupportedRecurrence`.
 */

import { instantForLocal, localParts } from './timezone.ts';

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface IcsImportResult {
  /** Busy periods clipped to the requested range, sorted and merged. */
  intervals: BusyInterval[];
  /** VEVENT blocks seen in the file. */
  events: number;
  /** Events skipped because they are cancelled or explicitly non-blocking. */
  ignored: number;
  /** All-day events treated as blocking the whole day. */
  allDay: number;
  /**
   * Events whose recurrence rule could not be expanded. They contribute their
   * first occurrence only, so the result may under-block — tell the user.
   */
  unsupportedRecurrence: number;
  /** Time zone identifiers the platform did not recognise. */
  unknownZones: string[];
}

export interface IcsImportRange {
  from: Date;
  to: Date;
  /** Zone for floating times, which carry no zone of their own. */
  defaultZone: string;
}

interface Property {
  name: string;
  params: Map<string, string>;
  value: string;
}

/**
 * Undo the 75-octet folding: a line beginning with a space or tab continues
 * the previous one. Files in the wild use bare LF as often as CRLF.
 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line !== '') {
      lines.push(line);
    }
  }
  return lines;
}

/** `NAME;TZID=Europe/London;X="a:b":value` */
function parseProperty(line: string): Property | null {
  // Find the colon that ends the name and parameters, ignoring quoted ones.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts: string[] = [];
  let current = '';
  quoted = false;
  for (const char of head) {
    if (char === '"') quoted = !quoted;
    else if (char === ';' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  const name = (parts.shift() ?? '').toUpperCase();
  const params = new Map<string, string>();
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).replace(/^"|"$/g, ''));
  }
  return { name, params, value };
}

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;

interface Moment {
  instant: Date;
  dateOnly: boolean;
}

function toMoment(
  value: string,
  params: Map<string, string>,
  defaultZone: string,
  unknownZones: Set<string>,
): Moment | null {
  const tzid = params.get('TZID');
  const zone = resolveZone(tzid, defaultZone, unknownZones);

  const dateMatch = DATE_ONLY.exec(value);
  if (dateMatch) {
    const instant = instantForLocal(
      zone,
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3]),
      0,
    );
    return instant ? { instant, dateOnly: true } : null;
  }

  const timeMatch = DATE_TIME.exec(value);
  if (!timeMatch) return null;

  const [, year, month, day, hour, minute, second, utc] = timeMatch;
  if (utc) {
    return {
      instant: new Date(
        Date.UTC(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
        ),
      ),
      dateOnly: false,
    };
  }

  const base = instantForLocal(
    zone,
    Number(year),
    Number(month),
    Number(day),
    Number(hour) * 60 + Number(minute),
  );
  if (!base) return null;
  return { instant: new Date(base.getTime() + Number(second) * 1000), dateOnly: false };
}

/**
 * Outlook emits zone names like "W. Europe Standard Time" that Intl rejects.
 * Falling back to the viewer's own zone keeps the event rather than dropping
 * it; the substitution is reported so the user knows times may be shifted.
 */
function resolveZone(
  tzid: string | undefined,
  defaultZone: string,
  unknownZones: Set<string>,
): string {
  if (tzid === undefined) return defaultZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tzid });
    return tzid;
  } catch {
    unknownZones.add(tzid);
    return defaultZone;
  }
}

/** `P1DT2H30M`, `PT45M`, `P2W` */
function parseDuration(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value,
  );
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    (Number(weeks ?? 0) * 7 * 24 * 60 +
      Number(days ?? 0) * 24 * 60 +
      Number(hours ?? 0) * 60 +
      Number(minutes ?? 0) +
      Number(seconds ?? 0) / 60) *
    60_000;
  return sign === '-' ? -total : total;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

interface Recurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: Date;
  byDay: number[];
  supported: boolean;
}

function parseRecurrence(value: string, unknownZones: Set<string>): Recurrence | null {
  const fields = new Map<string, string>();
  for (const part of value.split(';')) {
    const equals = part.indexOf('=');
    if (equals !== -1) fields.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1));
  }

  const freq = fields.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return null;
  }

  const byDayRaw = fields.get('BYDAY');
  const byDay: number[] = [];
  let supported = true;

  if (byDayRaw !== undefined) {
    for (const token of byDayRaw.split(',')) {
      // An ordinal prefix ("2FR", "-1SU") picks one weekday of the month; that
      // needs BYSETPOS-style handling this does not do.
      if (/^[+-]?\d/.test(token)) {
        supported = false;
        continue;
      }
      const day = WEEKDAYS[token.toUpperCase()];
      if (day === undefined) supported = false;
      else byDay.push(day);
    }
  }

  // Rules that select within a period rather than simply repeating it.
  for (const field of ['BYSETPOS', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO', 'BYMONTH']) {
    if (fields.has(field)) supported = false;
  }

  const untilRaw = fields.get('UNTIL');
  const until = untilRaw
    ? (toMoment(untilRaw, new Map(), 'UTC', unknownZones)?.instant ?? undefined)
    : undefined;

  const countRaw = fields.get('COUNT');
  const interval = Number(fields.get('INTERVAL') ?? 1);

  return {
    freq,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    ...(countRaw === undefined ? {} : { count: Number(countRaw) }),
    ...(until === undefined ? {} : { until }),
    byDay,
    supported,
  };
}

/** Guards against a malformed rule producing an unbounded walk. */
const MAX_OCCURRENCES = 2000;

function expand(
  start: Date,
  durationMs: number,
  rule: Recurrence,
  range: IcsImportRange,
  zone: string,
  excluded: Set<number>,
): BusyInterval[] {
  const out: BusyInterval[] = [];
  const limit = rule.until
    ? Math.min(rule.until.getTime(), range.to.getTime())
    : range.to.getTime();

  const parts = localParts(zone, start);
  const minuteOfDay = parts.hour * 60 + parts.minute;

  let emitted = 0;
  let step = 0;

  while (step < MAX_OCCURRENCES) {
    // The start of this repetition's period, as a local calendar date.
    let periodStart: Date | null;
    if (rule.freq === 'DAILY') {
      periodStart = shiftDays(zone, parts, step * rule.interval, minuteOfDay);
    } else if (rule.freq === 'WEEKLY') {
      periodStart = shiftDays(zone, parts, step * rule.interval * 7, minuteOfDay);
    } else if (rule.freq === 'MONTHLY') {
      periodStart = shiftMonths(zone, parts, step * rule.interval, minuteOfDay);
    } else {
      periodStart = shiftMonths(zone, parts, step * rule.interval * 12, minuteOfDay);
    }
    step++;
    if (!periodStart) continue;
    if (periodStart.getTime() > limit) break;

    // WEEKLY with BYDAY repeats on several days within each week.
    const candidates: Date[] = [];
    if (rule.freq === 'WEEKLY' && rule.byDay.length > 0) {
      const weekParts = localParts(zone, periodStart);
      const weekday = new Date(
        Date.UTC(weekParts.year, weekParts.month - 1, weekParts.day),
      ).getUTCDay();
      for (const target of rule.byDay) {
        const delta = target - weekday;
        const occurrence = shiftDays(zone, weekParts, delta, minuteOfDay);
        if (occurrence) candidates.push(occurrence);
      }
    } else {
      candidates.push(periodStart);
    }

    for (const occurrence of candidates) {
      if (occurrence.getTime() < start.getTime()) continue;
      if (occurrence.getTime() > limit) continue;
      if (excluded.has(occurrence.getTime())) continue;

      emitted++;
      if (rule.count !== undefined && emitted > rule.count) return out;

      const end = new Date(occurrence.getTime() + durationMs);
      if (end > range.from) out.push({ start: occurrence, end });
    }

    if (rule.count !== undefined && emitted >= rule.count) break;
  }

  return out;
}

function shiftDays(
  zone: string,
  from: { year: number; month: number; day: number },
  days: number,
  minuteOfDay: number,
): Date | null {
  const moved = new Date(Date.UTC(from.year, from.month - 1, from.day) + days * 86_400_000);
  return instantForLocal(
    zone,
    moved.getUTCFullYear(),
    moved.getUTCMonth() + 1,
    moved.getUTCDate(),
    minuteOfDay,
  );
}

function shiftMonths(
  zone: string,
  from: { year: number; month: number; day: number },
  months: number,
  minuteOfDay: number,
): Date | null {
  const total = from.year * 12 + (from.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  // A 31st that does not exist in the target month simply has no occurrence,
  // which matches how calendars treat it.
  const probe = new Date(Date.UTC(year, month - 1, from.day));
  if (probe.getUTCMonth() + 1 !== month) return null;
  return instantForLocal(zone, year, month, from.day, minuteOfDay);
}

function mergeIntervals(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: BusyInterval[] = [];

  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

export function parseIcsBusy(text: string, range: IcsImportRange): IcsImportResult {
  const unknownZones = new Set<string>();
  const intervals: BusyInterval[] = [];

  let events = 0;
  let ignored = 0;
  let allDay = 0;
  let unsupportedRecurrence = 0;

  let current: Property[] | null = null;

  for (const line of unfold(text)) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === 'BEGIN' && property.value.toUpperCase() === 'VEVENT') {
      current = [];
      continue;
    }
    if (property.name === 'END' && property.value.toUpperCase() === 'VEVENT') {
      if (current) {
        events++;
        const produced = readEvent(current, range, unknownZones);
        if (produced.skipped) ignored++;
        if (produced.allDay) allDay++;
        if (produced.unsupportedRecurrence) unsupportedRecurrence++;
        intervals.push(...produced.intervals);
      }
      current = null;
      continue;
    }
    if (current) current.push(property);
  }

  // Clip to the requested range; anything outside it cannot affect the window.
  const clipped = intervals
    .map((interval) => ({
      start: new Date(Math.max(interval.start.getTime(), range.from.getTime())),
      end: new Date(Math.min(interval.end.getTime(), range.to.getTime())),
    }))
    .filter((interval) => interval.end > interval.start);

  return {
    intervals: mergeIntervals(clipped),
    events,
    ignored,
    allDay,
    unsupportedRecurrence,
    unknownZones: [...unknownZones],
  };
}

interface EventResult {
  intervals: BusyInterval[];
  skipped: boolean;
  allDay: boolean;
  unsupportedRecurrence: boolean;
}

function readEvent(
  properties: Property[],
  range: IcsImportRange,
  unknownZones: Set<string>,
): EventResult {
  const empty: EventResult = {
    intervals: [],
    skipped: false,
    allDay: false,
    unsupportedRecurrence: false,
  };
  const find = (name: string): Property | undefined => properties.find((p) => p.name === name);

  const status = find('STATUS')?.value.toUpperCase();
  const transparency = find('TRANSP')?.value.toUpperCase();
  // Cancelled events do not block, and TRANSPARENT is the calendar saying
  // outright that this one does not occupy the owner's time.
  if (status === 'CANCELLED' || transparency === 'TRANSPARENT') {
    return { ...empty, skipped: true };
  }

  const dtStart = find('DTSTART');
  if (!dtStart) return { ...empty, skipped: true };

  const start = toMoment(dtStart.value, dtStart.params, range.defaultZone, unknownZones);
  if (!start) return { ...empty, skipped: true };

  const zone = resolveZone(dtStart.params.get('TZID'), range.defaultZone, unknownZones);

  let endMs: number | null = null;
  const dtEnd = find('DTEND');
  const duration = find('DURATION');

  if (dtEnd) {
    const end = toMoment(dtEnd.value, dtEnd.params, range.defaultZone, unknownZones);
    if (end) endMs = end.instant.getTime();
  } else if (duration) {
    const span = parseDuration(duration.value);
    if (span !== null) endMs = start.instant.getTime() + span;
  }

  if (endMs === null) {
    // No end at all: a date-only event covers its day, a timed one is an
    // instant and blocks nothing measurable.
    endMs = start.instant.getTime() + (start.dateOnly ? 86_400_000 : 0);
  }

  const durationMs = endMs - start.instant.getTime();
  if (durationMs <= 0) return { ...empty, skipped: true };

  const excluded = new Set<number>();
  for (const property of properties) {
    if (property.name !== 'EXDATE') continue;
    for (const value of property.value.split(',')) {
      const moment = toMoment(value, property.params, range.defaultZone, unknownZones);
      if (moment) excluded.add(moment.instant.getTime());
    }
  }

  const rruleProperty = find('RRULE');
  if (!rruleProperty) {
    const end = new Date(endMs);
    const inRange = end > range.from && start.instant < range.to;
    return {
      intervals: inRange ? [{ start: start.instant, end }] : [],
      skipped: false,
      allDay: start.dateOnly,
      unsupportedRecurrence: false,
    };
  }

  const rule = parseRecurrence(rruleProperty.value, unknownZones);
  if (!rule) {
    // An unreadable rule still blocks its first occurrence, and is reported.
    const end = new Date(endMs);
    return {
      intervals:
        end > range.from && start.instant < range.to ? [{ start: start.instant, end }] : [],
      skipped: false,
      allDay: start.dateOnly,
      unsupportedRecurrence: true,
    };
  }

  return {
    intervals: expand(start.instant, durationMs, rule, range, zone, excluded),
    skipped: false,
    allDay: start.dateOnly,
    unsupportedRecurrence: !rule.supported,
  };
}
