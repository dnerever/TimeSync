import test from 'node:test';
import assert from 'node:assert/strict';

import { parseIcsBusy } from './icsparse.ts';

const NY = 'America/New_York';

const range = (from: string, to: string, defaultZone = NY) => ({
  from: new Date(from),
  to: new Date(to),
  defaultZone,
});

const WEEK = range('2026-10-05T00:00:00Z', '2026-10-12T00:00:00Z');

/** Wrap VEVENT bodies in a minimal calendar, with CRLF as real files use. */
function calendar(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
}

function event(...lines: string[]): string {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
}

const spans = (result: { intervals: Array<{ start: Date; end: Date }> }): string[] =>
  result.intervals.map(
    (interval) => `${interval.start.toISOString()}/${interval.end.toISOString()}`,
  );

test('reads a plain UTC event', () => {
  const ics = calendar(
    event('DTSTART:20261006T140000Z', 'DTEND:20261006T153000Z', 'SUMMARY:Standup'),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.events, 1);
  assert.deepEqual(spans(result), ['2026-10-06T14:00:00.000Z/2026-10-06T15:30:00.000Z']);
});

test('reads a zoned event using its TZID', () => {
  const ics = calendar(
    event(
      'DTSTART;TZID=America/New_York:20261006T100000',
      'DTEND;TZID=America/New_York:20261006T110000',
    ),
  );
  // 10:00 in New York during October is 14:00 UTC.
  assert.deepEqual(spans(parseIcsBusy(ics, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T15:00:00.000Z',
  ]);
});

test('treats a floating time as being in the default zone', () => {
  const ics = calendar(event('DTSTART:20261006T100000', 'DTEND:20261006T110000'));
  assert.deepEqual(spans(parseIcsBusy(ics, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T15:00:00.000Z',
  ]);
});

test('falls back for a zone the platform does not know, and says so', () => {
  const ics = calendar(
    event('DTSTART;TZID=W. Europe Standard Time:20261006T100000', 'DURATION:PT1H'),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.unknownZones.length, 1);
  assert.equal(result.unknownZones[0], 'W. Europe Standard Time');
  // Kept rather than dropped: under-blocking is the worse failure.
  assert.equal(result.intervals.length, 1);
});

test('supports DURATION in place of DTEND', () => {
  const ics = calendar(event('DTSTART:20261006T140000Z', 'DURATION:PT90M'));
  assert.deepEqual(spans(parseIcsBusy(ics, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T15:30:00.000Z',
  ]);

  const weeks = calendar(event('DTSTART:20261006T140000Z', 'DURATION:P1DT2H'));
  assert.deepEqual(spans(parseIcsBusy(weeks, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-07T16:00:00.000Z',
  ]);
});

test('an all-day event blocks its whole local day', () => {
  const ics = calendar(event('DTSTART;VALUE=DATE:20261006', 'DTEND;VALUE=DATE:20261007'));
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.allDay, 1);
  // Midnight to midnight in New York, which is 04:00Z to 04:00Z.
  assert.deepEqual(spans(result), ['2026-10-06T04:00:00.000Z/2026-10-07T04:00:00.000Z']);
});

test('skips cancelled and transparent events', () => {
  const ics = calendar(
    event('DTSTART:20261006T140000Z', 'DTEND:20261006T150000Z', 'STATUS:CANCELLED'),
    event('DTSTART:20261006T160000Z', 'DTEND:20261006T170000Z', 'TRANSP:TRANSPARENT'),
    event('DTSTART:20261006T180000Z', 'DTEND:20261006T190000Z'),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.events, 3);
  assert.equal(result.ignored, 2);
  assert.deepEqual(spans(result), ['2026-10-06T18:00:00.000Z/2026-10-06T19:00:00.000Z']);
});

test('unfolds long lines and tolerates bare LF', () => {
  const folded =
    'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261006T140000Z\nDTEND:2026100' +
    '\r\n 6T150000Z\nSUMMARY:A very long summary that was\r\n  folded\nEND:VEVENT\nEND:VCALENDAR';
  assert.deepEqual(spans(parseIcsBusy(folded, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T15:00:00.000Z',
  ]);
});

test('expands a daily rule across the window', () => {
  const ics = calendar(event('DTSTART:20261005T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY'));
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.intervals.length, 7);
  assert.equal(result.unsupportedRecurrence, 0);
  assert.equal(result.intervals[0]!.start.toISOString(), '2026-10-05T14:00:00.000Z');
  assert.equal(result.intervals[6]!.start.toISOString(), '2026-10-11T14:00:00.000Z');
});

test('honours INTERVAL, COUNT and UNTIL', () => {
  const everyOther = calendar(
    event('DTSTART:20261005T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;INTERVAL=2'),
  );
  assert.equal(parseIcsBusy(everyOther, WEEK).intervals.length, 4);

  const counted = calendar(
    event('DTSTART:20261005T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=3'),
  );
  assert.equal(parseIcsBusy(counted, WEEK).intervals.length, 3);

  const until = calendar(
    event('DTSTART:20261005T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;UNTIL=20261007T000000Z'),
  );
  assert.equal(parseIcsBusy(until, WEEK).intervals.length, 2);
});

test('expands a weekly rule with BYDAY', () => {
  // Monday 5 October; repeat Monday, Wednesday, Friday.
  const ics = calendar(
    event('DTSTART:20261005T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.deepEqual(
    result.intervals.map((interval) => interval.start.toISOString().slice(0, 10)),
    ['2026-10-05', '2026-10-07', '2026-10-09'],
  );
});

test('EXDATE removes a cancelled occurrence', () => {
  const ics = calendar(
    event(
      'DTSTART:20261005T140000Z',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY',
      'EXDATE:20261007T140000Z',
    ),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.intervals.length, 6);
  assert.equal(
    result.intervals.some((i) => i.start.toISOString() === '2026-10-07T14:00:00.000Z'),
    false,
  );
});

test('a recurrence rule it cannot expand still blocks and is reported', () => {
  // "The second Friday of every month" needs ordinal BYDAY handling.
  const ics = calendar(
    event('DTSTART:20261009T140000Z', 'DURATION:PT1H', 'RRULE:FREQ=MONTHLY;BYDAY=2FR'),
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.equal(result.unsupportedRecurrence, 1, 'must be reported, not silently dropped');
  assert.ok(result.intervals.length >= 1, 'the first occurrence still blocks');
});

test('clips to the requested range', () => {
  const ics = calendar(
    event('DTSTART:20261001T140000Z', 'DTEND:20261001T150000Z'), // before
    event('DTSTART:20261020T140000Z', 'DTEND:20261020T150000Z'), // after
    event('DTSTART:20261004T230000Z', 'DTEND:20261005T010000Z'), // straddles the start
  );
  const result = parseIcsBusy(ics, WEEK);

  assert.deepEqual(spans(result), ['2026-10-05T00:00:00.000Z/2026-10-05T01:00:00.000Z']);
});

test('overlapping periods are merged', () => {
  const ics = calendar(
    event('DTSTART:20261006T140000Z', 'DTEND:20261006T160000Z'),
    event('DTSTART:20261006T153000Z', 'DTEND:20261006T170000Z'),
    event('DTSTART:20261006T170000Z', 'DTEND:20261006T180000Z'),
  );
  assert.deepEqual(spans(parseIcsBusy(ics, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T18:00:00.000Z',
  ]);
});

test('a zero-length or backwards event blocks nothing', () => {
  const ics = calendar(
    event('DTSTART:20261006T140000Z', 'DTEND:20261006T140000Z'),
    event('DTSTART:20261006T160000Z', 'DTEND:20261006T150000Z'),
  );
  const result = parseIcsBusy(ics, WEEK);
  assert.deepEqual(result.intervals, []);
  assert.equal(result.ignored, 2);
});

test('quoted parameters containing a colon are parsed', () => {
  const ics = calendar(event('DTSTART;TZID="America/New_York":20261006T100000', 'DURATION:PT1H'));
  assert.deepEqual(spans(parseIcsBusy(ics, WEEK)), [
    '2026-10-06T14:00:00.000Z/2026-10-06T15:00:00.000Z',
  ]);
});

test('an empty or non-calendar file yields nothing rather than throwing', () => {
  for (const text of ['', 'not a calendar', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR']) {
    const result = parseIcsBusy(text, WEEK);
    assert.deepEqual(result.intervals, []);
    assert.equal(result.events, 0);
  }
});

test('a recurring event survives a daylight-saving change at a fixed local time', () => {
  // New York falls back on 1 November 2026. A 09:00 local daily meeting must
  // stay at 09:00 local, which means its UTC offset shifts.
  const ics = calendar(
    event(
      'DTSTART;TZID=America/New_York:20261030T090000',
      'DURATION:PT1H',
      'RRULE:FREQ=DAILY;COUNT=5',
    ),
  );
  const result = parseIcsBusy(ics, range('2026-10-29T00:00:00Z', '2026-11-06T00:00:00Z'));

  const localHour = (date: Date): string =>
    new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', hourCycle: 'h23' }).format(
      date,
    );

  assert.equal(result.intervals.length, 5);
  for (const interval of result.intervals) {
    assert.equal(localHour(interval.start), '09', interval.start.toISOString());
  }
  // And the offset really did change across the transition.
  assert.equal(result.intervals[0]!.start.toISOString(), '2026-10-30T13:00:00.000Z');
  assert.equal(result.intervals[4]!.start.toISOString(), '2026-11-03T14:00:00.000Z');
});
