import test from 'node:test';
import assert from 'node:assert/strict';

import { type Availability, type SlotMinutes, slotsPerDay } from './codec.ts';
import { overlappingBlocks } from './overlap.ts';

const MINUTE = 60_000;
const utcMinute = (iso: string): number => Date.parse(iso) / MINUTE;

/** A window starting at an absolute instant, with free time set by hour ranges. */
function window(
  startIso: string,
  slotMinutes: SlotMinutes,
  dayCount: number,
  free: Array<[number, number]> = [],
): Availability {
  const perDay = slotsPerDay(slotMinutes);
  const perHour = 60 / slotMinutes;
  const slots = new Uint8Array(dayCount * perDay);
  for (const [from, to] of free) {
    slots.fill(1, Math.round(from * perHour), Math.round(to * perHour));
  }
  return { originMinute: utcMinute(startIso), slotMinutes, dayCount, slots };
}

const span = (block: { start: Date; end: Date }): string =>
  `${block.start.toISOString().slice(11, 16)}-${block.end.toISOString().slice(11, 16)}`;

test('finds the time both windows have free', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [[9, 12]]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[10, 14]]);

  assert.deepEqual(overlappingBlocks(mine, theirs).map(span), ['10:00-12:00']);
});

test('returns nothing when the free time never coincides', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [[9, 11]]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[13, 15]]);

  assert.deepEqual(overlappingBlocks(mine, theirs), []);
});

test('keeps separate stretches separate', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [
    [9, 11],
    [14, 16],
  ]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[8, 17]]);

  assert.deepEqual(overlappingBlocks(mine, theirs).map(span), ['09:00-11:00', '14:00-16:00']);
});

test('mixed slot sizes intersect at the finer resolution', () => {
  // An hour-granular window free 09:00-11:00, against a quarter-hour window
  // free 09:45-10:30. The answer is the finer span, not the coarser one.
  const coarse = window('2026-10-05T00:00:00Z', 60, 1, [[9, 11]]);
  const fine = window('2026-10-05T00:00:00Z', 15, 1, [[9.75, 10.5]]);

  assert.deepEqual(overlappingBlocks(coarse, fine).map(span), ['09:45-10:30']);
});

test('a candidate straddling two busy-adjacent slots is treated as busy', () => {
  // The coarse window is free only 10:00-11:00. A fine slot at 09:45 sits
  // inside the busy 09:00 hour, so it must not be offered.
  const coarse = window('2026-10-05T00:00:00Z', 60, 1, [[10, 11]]);
  const fine = window('2026-10-05T00:00:00Z', 15, 1, [[9, 12]]);

  assert.deepEqual(overlappingBlocks(coarse, fine).map(span), ['10:00-11:00']);
});

test('windows offset by a partial hour still line up correctly', () => {
  // Origins 45 minutes apart, as a +05:45 zone produces.
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [[9, 12]]);
  const theirs = window('2026-10-04T23:15:00Z', 15, 1, [[9.75, 13]]);

  // theirs is free from 23:15 + 9h45m = 09:00 the next day.
  assert.deepEqual(overlappingBlocks(mine, theirs).map(span), ['09:00-12:00']);
});

test('only the shared date range is considered', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 2, [[9, 12]]);
  const theirs = window('2026-10-06T00:00:00Z', 15, 2, [[9, 12]]);

  // Day two of mine overlaps day one of theirs; both are free 09:00-12:00,
  // but mine's free hours were only set on its first day.
  assert.deepEqual(overlappingBlocks(mine, theirs), []);
});

test('time outside either window is never offered', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [[0, 24]]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[0, 24]]);

  const blocks = overlappingBlocks(mine, theirs);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.start.toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(blocks[0]!.end.toISOString(), '2026-10-06T00:00:00.000Z');
});

test('past mutual time can be dropped', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [
    [9, 11],
    [14, 16],
  ]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[0, 24]]);

  const after = new Date('2026-10-05T12:00:00Z');
  assert.deepEqual(overlappingBlocks(mine, theirs, { after }).map(span), ['14:00-16:00']);
});

test('slivers can be filtered out', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [
    [9, 9.25],
    [14, 16],
  ]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 1, [[0, 24]]);

  assert.deepEqual(overlappingBlocks(mine, theirs).map(span), ['09:00-09:15', '14:00-16:00']);
  assert.deepEqual(overlappingBlocks(mine, theirs, { minimumMinutes: 30 }).map(span), [
    '14:00-16:00',
  ]);
});

test('intersection does not depend on argument order', () => {
  const mine = window('2026-10-05T00:00:00Z', 60, 2, [[9, 17]]);
  const theirs = window('2026-10-05T00:00:00Z', 15, 3, [[10, 12]]);

  assert.deepEqual(
    overlappingBlocks(mine, theirs).map(span),
    overlappingBlocks(theirs, mine).map(span),
  );
});

test('windows that do not overlap in time at all yield nothing', () => {
  const mine = window('2026-10-05T00:00:00Z', 15, 1, [[0, 24]]);
  const theirs = window('2026-11-05T00:00:00Z', 15, 1, [[0, 24]]);

  assert.deepEqual(overlappingBlocks(mine, theirs), []);
});
