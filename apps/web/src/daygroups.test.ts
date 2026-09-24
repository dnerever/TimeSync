import test from 'node:test';
import assert from 'node:assert/strict';

import { dayNumber, describeDuration, groupByDay } from './daygroups.ts';

const NY = 'America/New_York';
const TOKYO = 'Asia/Tokyo';

const at = (iso: string): Date => new Date(iso);
const block = (start: string, end: string) => ({ start: at(start), end: at(end) });

test('blocks land in the viewer day they start in', () => {
  const now = at('2026-10-05T12:00:00Z');
  const groups = groupByDay(
    [
      block('2026-10-05T13:00:00Z', '2026-10-05T15:00:00Z'),
      block('2026-10-05T18:00:00Z', '2026-10-05T20:00:00Z'),
      block('2026-10-06T13:00:00Z', '2026-10-06T15:00:00Z'),
    ],
    NY,
    now,
  );

  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.blocks.length, 2);
  assert.equal(groups[1]!.blocks.length, 1);
});

test('today and tomorrow are labelled, later days are not', () => {
  const now = at('2026-10-05T12:00:00Z'); // 08:00 in New York
  const groups = groupByDay(
    [
      block('2026-10-05T14:00:00Z', '2026-10-05T15:00:00Z'),
      block('2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z'),
      block('2026-10-08T14:00:00Z', '2026-10-08T15:00:00Z'),
    ],
    NY,
    now,
  );

  assert.deepEqual(
    groups.map((group) => group.relative),
    ['Today', 'Tomorrow', null],
  );
});

test('the same instant can be today for one viewer and tomorrow for another', () => {
  // At this moment it is the 5th in New York but already the 6th in Tokyo.
  const now = at('2026-10-05T20:00:00Z');
  // The block falls after New York's midnight but before Tokyo's.
  const blocks = [block('2026-10-06T05:00:00Z', '2026-10-06T06:00:00Z')];

  assert.equal(groupByDay(blocks, NY, now)[0]!.relative, 'Tomorrow', '01:00 on the 6th in NY');
  assert.equal(groupByDay(blocks, TOKYO, now)[0]!.relative, 'Today', '14:00 on the 6th in Tokyo');
});

test('a block running past midnight stays with the evening it began', () => {
  const now = at('2026-10-05T12:00:00Z');
  // 22:00 to 01:00 New York time.
  const groups = groupByDay([block('2026-10-06T02:00:00Z', '2026-10-06T05:00:00Z')], NY, now);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.relative, 'Today');
});

test('groups come back in chronological order regardless of input order', () => {
  const now = at('2026-10-05T12:00:00Z');
  const groups = groupByDay(
    [
      block('2026-10-09T14:00:00Z', '2026-10-09T15:00:00Z'),
      block('2026-10-06T14:00:00Z', '2026-10-06T15:00:00Z'),
      block('2026-10-07T14:00:00Z', '2026-10-07T15:00:00Z'),
    ],
    NY,
    now,
  );
  assert.deepEqual(
    groups.map((group) => group.key),
    [...groups.map((group) => group.key)].sort((a, b) => a - b),
  );
});

test('day numbers are stable across a daylight-saving transition', () => {
  // New York springs forward on 2026-03-08; consecutive dates must stay
  // consecutive even though that day is only 23 hours long.
  const seventh = dayNumber({ year: 2026, month: 3, day: 7 });
  const eighth = dayNumber({ year: 2026, month: 3, day: 8 });
  const ninth = dayNumber({ year: 2026, month: 3, day: 9 });
  assert.equal(eighth - seventh, 1);
  assert.equal(ninth - eighth, 1);
});

test('durations read the way someone would say them', () => {
  assert.equal(describeDuration(15), '15 min');
  assert.equal(describeDuration(45), '45 min');
  assert.equal(describeDuration(60), '1 hour');
  assert.equal(describeDuration(120), '2 hours');
  assert.equal(describeDuration(90), '1h 30m');
  assert.equal(describeDuration(255), '4h 15m');
});

test('an empty list produces no groups', () => {
  assert.deepEqual(groupByDay([], NY, at('2026-10-05T12:00:00Z')), []);
});
