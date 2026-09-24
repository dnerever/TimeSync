/**
 * Turning a flat list of free blocks into the day-by-day shape the view reads.
 *
 * Kept apart from the component because the interesting parts — which local
 * day a block belongs to, and whether that day is today — are pure functions
 * of a time zone, and are worth testing without a DOM.
 */

import { type FreeBlock, localParts } from '@timesync/core';

export interface DayGroup {
  /** Days since the epoch, in the viewer's zone. Sorts chronologically. */
  key: number;
  /** 'Today', 'Tomorrow', or null when the date speaks for itself. */
  relative: string | null;
  blocks: FreeBlock[];
}

export function dayNumber(date: { year: number; month: number; day: number }): number {
  return Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
}

export function describeDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
  return `${hours}h ${rest}m`;
}

/**
 * Blocks are bucketed by the local day they *start* in. A block running past
 * midnight stays with the evening it began, which is how someone reading
 * "Friday, 10pm–1am" expects to find it.
 */
export function groupByDay(blocks: FreeBlock[], timeZone: string, now: Date): DayGroup[] {
  const today = dayNumber(localParts(timeZone, now));
  const groups = new Map<number, DayGroup>();

  for (const block of blocks) {
    const key = dayNumber(localParts(timeZone, block.start));
    let group = groups.get(key);
    if (!group) {
      const offset = key - today;
      group = {
        key,
        relative: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : null,
        blocks: [],
      };
      groups.set(key, group);
    }
    group.blocks.push(block);
  }

  return [...groups.values()].sort((a, b) => a.key - b.key);
}
