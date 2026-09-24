/**
 * Finding the time two people both have free.
 *
 * The two windows arrive from different devices and need not agree about
 * anything: different slot sizes, different date ranges, and — because a zone
 * at a :45 offset shifts the whole grid — origins that do not even share a
 * slot boundary. So the intersection is computed over absolute time rather
 * than by walking two slot vectors in step, which would silently produce
 * plausible nonsense the moment the grids disagreed.
 *
 * Where a candidate interval straddles two slots of a source, every slot it
 * touches must be free. Erring toward "busy" is the right way to be wrong
 * here: offering a time someone cannot make is worse than missing one.
 */

import type { Availability } from './codec.ts';
import type { FreeBlock } from './grid.ts';

export interface OverlapOptions {
  /** Drop mutual time that has already passed. */
  after?: Date;
  /** Ignore slivers shorter than this. A ten-minute gap is not a meeting. */
  minimumMinutes?: number;
}

function endMinuteOf(av: Availability): number {
  return av.originMinute + av.slots.length * av.slotMinutes;
}

/** True when every slot of `av` touching [start, end) is free. */
function freeThroughout(av: Availability, start: number, end: number): boolean {
  if (start < av.originMinute || end > endMinuteOf(av)) return false;

  const first = Math.floor((start - av.originMinute) / av.slotMinutes);
  const last = Math.ceil((end - av.originMinute) / av.slotMinutes) - 1;

  for (let index = first; index <= last; index++) {
    if (av.slots[index] !== 1) return false;
  }
  return true;
}

/**
 * Contiguous stretches both windows have free, as absolute instants.
 *
 * Returns blocks rather than an Availability on purpose: an overlap is an
 * arbitrary span of time, while an Availability is a whole number of days, and
 * padding one into the other would invent time nobody offered.
 */
export function overlappingBlocks(
  a: Availability,
  b: Availability,
  options: OverlapOptions = {},
): FreeBlock[] {
  // Every supported slot size divides every larger one, and each origin is
  // aligned to its own size, so the finer size is a grid both sit on.
  const step = Math.min(a.slotMinutes, b.slotMinutes);
  const start = Math.max(a.originMinute, b.originMinute);
  const end = Math.min(endMinuteOf(a), endMinuteOf(b));

  const cutoff = options.after === undefined ? -Infinity : options.after.getTime() / 60_000;
  const minimum = options.minimumMinutes ?? 0;

  const blocks: FreeBlock[] = [];
  let runStart: number | null = null;

  const close = (runEnd: number): void => {
    if (runStart === null) return;
    if (runEnd - runStart >= minimum && runEnd > cutoff) {
      blocks.push({
        start: new Date(runStart * 60_000),
        end: new Date(runEnd * 60_000),
      });
    }
    runStart = null;
  };

  for (let minute = start; minute < end; minute += step) {
    const mutual =
      freeThroughout(a, minute, minute + step) && freeThroughout(b, minute, minute + step);
    if (mutual && runStart === null) runStart = minute;
    if (!mutual) close(minute);
  }
  close(end);

  return blocks;
}
