/**
 * Local wall-clock time to absolute instants, and back.
 *
 * The payload grid is absolute (see codec.ts), but people paint in local time:
 * "Tuesday morning" means a wall clock, not an offset from an epoch. Everything
 * that crosses between the two goes through here, so the conversion exists in
 * exactly one place and daylight-saving edge cases are handled once.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let existing = formatters.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, existing);
  }
  return existing;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(timeZone: string, at: Date): LocalParts {
  const parts = formatter(timeZone).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`time zone ${timeZone} produced no ${type}`);
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Minutes this zone is ahead of UTC at a given instant. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const local = localParts(timeZone, at);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return (asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/** Weekday of a calendar date, 0 = Sunday. Independent of any zone. */
export function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The instant at which a given local wall-clock time occurs.
 *
 * Returns null when that time does not exist — the hour a spring-forward skips
 * has no instant, and silently snapping to a neighbouring hour would put
 * availability somewhere the user never painted. During a fall-back, where a
 * local time occurs twice, this resolves to the first occurrence.
 */
export function instantForLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): Date | null {
  const wall = Date.UTC(year, month - 1, day) + minuteOfDay * 60_000;

  // Two passes: the first guess uses the offset at the wall-clock reading, the
  // second corrects it using the offset actually in force at that instant.
  let guess = wall - zoneOffsetMinutes(timeZone, new Date(wall)) * 60_000;
  guess = wall - zoneOffsetMinutes(timeZone, new Date(guess)) * 60_000;

  // Round-trip to confirm we landed on the requested wall clock rather than
  // inside a gap.
  const check = localParts(timeZone, new Date(guess));
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour * 60 + check.minute !== minuteOfDay
  ) {
    return null;
  }
  return new Date(guess);
}
