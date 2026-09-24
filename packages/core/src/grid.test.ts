import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIME_OF_DAY_PRESETS,
  applyTimeOfDay,
  createAvailability,
  freeBlocks,
  localDays,
  resizeWindow,
  slotIndexAt,
} from './grid.ts';
import { decodeAvailability, encodeAvailability, totalSlots } from './codec.ts';
import { instantForLocal, zoneOffsetMinutes } from './timezone.ts';

const NY = 'America/New_York';
const UTC = 'UTC';
const KATHMANDU = 'Asia/Kathmandu'; // UTC+05:45, so midnight is not hour-aligned

function blank(timeZone: string, start: string, dayCount = 7) {
  const [year, month, day] = start.split('-').map(Number) as [number, number, number];
  return createAvailability({
    timeZone,
    start: { year, month, day },
    dayCount,
    slotMinutes: 15,
  });
}

test('creates an empty window anchored at local midnight', () => {
  const av = blank(NY, '2026-10-05');
  assert.equal(av.slots.length, totalSlots(av));
  assert.ok(av.slots.every((slot) => slot === 0));
  // 2026-10-05 00:00 in New York is 04:00 UTC (EDT, UTC-4).
  assert.equal(new Date(av.originMinute * 60_000).toISOString(), '2026-10-05T04:00:00.000Z');
});

test('aligns the origin down for zones with a non-hour offset', () => {
  const av = createAvailability({
    timeZone: KATHMANDU,
    start: { year: 2026, month: 10, day: 5 },
    dayCount: 3,
    slotMinutes: 60,
  });
  assert.equal(av.originMinute % 60, 0, 'origin must sit on a slot boundary');

  const midnight = instantForLocal(KATHMANDU, 2026, 10, 5, 0)!;
  const drift = midnight.getTime() / 60_000 - av.originMinute;
  assert.ok(
    drift >= 0 && drift < 60,
    `origin should precede midnight by under a slot, got ${drift}`,
  );
});

test('lists one local day per calendar date in an ordinary week', () => {
  const days = localDays(blank(NY, '2026-10-05'), NY);
  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((day) => day.day),
    [5, 6, 7, 8, 9, 10, 11],
  );
  assert.equal(days[0]!.weekday, 1, 'the 5th of October 2026 is a Monday');
});

test('a spring-forward day is 23 hours and its skipped hour has no slot', () => {
  // New York springs forward at 02:00 local on 2026-03-08.
  const av = blank(NY, '2026-03-06', 7);
  const days = localDays(av, NY);
  const transition = days.find((day) => day.day === 8)!;
  const next = days.find((day) => day.day === 9)!;

  const hours = (next.startsAt.getTime() - transition.startsAt.getTime()) / 3_600_000;
  assert.equal(hours, 23);

  // 02:00–02:59 local simply does not occur that day.
  assert.equal(slotIndexAt(av, NY, transition, 2 * 60), null);
  assert.equal(slotIndexAt(av, NY, transition, 2 * 60 + 45), null);
  // The hours on either side do.
  assert.ok(slotIndexAt(av, NY, transition, 60) !== null);
  assert.ok(slotIndexAt(av, NY, transition, 3 * 60) !== null);
});

test('a fall-back day is 25 hours long', () => {
  // New York falls back at 02:00 local on 2026-11-01.
  const av = blank(NY, '2026-10-30', 7);
  const days = localDays(av, NY);
  const transition = days.find((day) => day.month === 11 && day.day === 1)!;
  const next = days.find((day) => day.month === 11 && day.day === 2)!;

  assert.equal((next.startsAt.getTime() - transition.startsAt.getTime()) / 3_600_000, 25);
  assert.equal(zoneOffsetMinutes(NY, transition.startsAt), -4 * 60);
  assert.equal(zoneOffsetMinutes(NY, next.startsAt), -5 * 60);
});

test('painting a morning lands on the same local hours on both sides of a transition', () => {
  const av = blank(NY, '2026-03-06', 7);
  const painted = { ...av, slots: applyTimeOfDay(av, NY, TIME_OF_DAY_PRESETS[0]!, 1) };

  const localHour = (date: Date): number =>
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', hourCycle: 'h23' }).format(
        date,
      ),
    );

  // Every painted block must start at 08:00 local, transition or not — this is
  // the whole point of routing through the zone rather than a fixed stride.
  const blocks = freeBlocks(painted);
  assert.equal(blocks.length, 7);
  for (const block of blocks) {
    assert.equal(localHour(block.start), 8, `block starting ${block.start.toISOString()}`);
    assert.equal(localHour(block.end), 12, `block ending ${block.end.toISOString()}`);
  }
});

test('weekdaysOnly skips Saturday and Sunday', () => {
  const av = blank(UTC, '2026-10-05', 7); // Monday through Sunday
  const painted = {
    ...av,
    slots: applyTimeOfDay(av, UTC, TIME_OF_DAY_PRESETS[0]!, 1, { weekdaysOnly: true }),
  };
  assert.equal(freeBlocks(painted).length, 5);
});

test('applying a band then clearing it returns the window to empty', () => {
  const av = blank(NY, '2026-10-05');
  const band = TIME_OF_DAY_PRESETS[2]!;
  const painted = { ...av, slots: applyTimeOfDay(av, NY, band, 1) };
  assert.ok(painted.slots.some((slot) => slot === 1));

  const cleared = applyTimeOfDay(painted, NY, band, 0);
  assert.ok(cleared.every((slot) => slot === 0));
});

test('applyTimeOfDay does not mutate the availability it is given', () => {
  const av = blank(NY, '2026-10-05');
  const before = Uint8Array.from(av.slots);
  applyTimeOfDay(av, NY, TIME_OF_DAY_PRESETS[0]!, 1);
  assert.deepEqual(av.slots, before);
});

test('slotIndexAt refuses times outside the window', () => {
  const av = blank(NY, '2026-10-05', 2);
  const days = localDays(av, NY);
  assert.equal(slotIndexAt(av, NY, { year: 2026, month: 10, day: 4 }, 12 * 60), null);
  assert.equal(slotIndexAt(av, NY, { year: 2026, month: 10, day: 9 }, 12 * 60), null);
  assert.ok(slotIndexAt(av, NY, days[0]!, 12 * 60) !== null);
});

test('a painted window survives a round-trip through the codec', async () => {
  const av = blank(NY, '2026-03-06', 21);
  const painted = {
    ...av,
    slots: applyTimeOfDay(av, NY, TIME_OF_DAY_PRESETS[0]!, 1, { weekdaysOnly: true }),
  };

  const decoded = await decodeAvailability(await encodeAvailability(painted));
  assert.deepEqual(decoded.slots, painted.slots);
  assert.equal(decoded.timeZone, NY);
  assert.deepEqual(freeBlocks(decoded), freeBlocks(painted));
});

test('resizing a window keeps painted time at the same instants', () => {
  const av = blank(NY, '2026-03-06', 7);
  const painted = { ...av, slots: applyTimeOfDay(av, NY, TIME_OF_DAY_PRESETS[0]!, 1) };
  const before = freeBlocks(painted);

  const grown = resizeWindow(painted, NY, 14);
  assert.equal(grown.dayCount, 14);
  assert.deepEqual(freeBlocks(grown), before, 'growing must not move anything');

  const shrunk = resizeWindow(painted, NY, 3);
  assert.equal(shrunk.dayCount, 3);
  assert.deepEqual(freeBlocks(shrunk), before.slice(0, 3), 'shrinking drops the tail only');
});

test('freeBlocks merges adjacent slots and closes a run at the end', () => {
  const av = blank(UTC, '2026-10-05', 1);
  const slots = Uint8Array.from(av.slots);
  slots.fill(1, 0, 4); // 00:00-01:00
  slots.fill(1, 8, 12); // 02:00-03:00
  slots.fill(1, slots.length - 2, slots.length); // runs to the window edge

  const blocks = freeBlocks({ ...av, slots });
  assert.equal(blocks.length, 3);
  assert.equal((blocks[0]!.end.getTime() - blocks[0]!.start.getTime()) / 60_000, 60);
  assert.equal(blocks[2]!.end.getTime() / 60_000, av.originMinute + slots.length * av.slotMinutes);
});

test('freeBlocks can drop times that have already passed', () => {
  const av = blank(UTC, '2026-10-05', 3);
  const slots = Uint8Array.from(av.slots);
  slots.fill(1, 0, 4); // day 1, 00:00-01:00
  slots.fill(1, 96, 100); // day 2, 00:00-01:00
  slots.fill(1, 192, 196); // day 3, 00:00-01:00
  const painted = { ...av, slots };

  assert.equal(freeBlocks(painted).length, 3);

  // Midway through the second block: it is still running, so it survives whole.
  const during = new Date(Date.UTC(2026, 9, 6, 0, 30));
  const remaining = freeBlocks(painted, { after: during });
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0]!.start.toISOString(), '2026-10-06T00:00:00.000Z');

  // After everything has finished.
  assert.equal(freeBlocks(painted, { after: new Date(Date.UTC(2026, 9, 9)) }).length, 0);
});

test('a block ending exactly at the cutoff is treated as past', () => {
  const av = blank(UTC, '2026-10-05', 1);
  const slots = Uint8Array.from(av.slots);
  slots.fill(1, 0, 4);
  const painted = { ...av, slots };

  const exactly = new Date(Date.UTC(2026, 9, 5, 1, 0));
  assert.equal(freeBlocks(painted, { after: exactly }).length, 0);
  assert.equal(freeBlocks(painted, { after: new Date(exactly.getTime() - 1) }).length, 1);
});
