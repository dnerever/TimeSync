import test from 'node:test';
import assert from 'node:assert/strict';

import { buildIcs, formatIcsInstant } from './ics.ts';

const fixed = {
  start: new Date('2026-10-05T14:00:00Z'),
  end: new Date('2026-10-05T16:00:00Z'),
  uid: 'test-uid@timesync',
  stamp: new Date('2026-09-23T22:00:00Z'),
};

const lines = (ics: string): string[] => ics.split('\r\n');

test('produces a well-formed calendar', () => {
  const ics = buildIcs({ ...fixed, summary: 'Jordan and you' });

  assert.deepEqual(lines(ics).slice(0, 5), [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeSync//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
  ]);
  assert.ok(ics.includes('UID:test-uid@timesync\r\n'));
  assert.ok(ics.includes('DTSTAMP:20260923T220000Z\r\n'));
  assert.ok(ics.includes('DTSTART:20261005T140000Z\r\n'));
  assert.ok(ics.includes('DTEND:20261005T160000Z\r\n'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
});

test('every line ends CRLF, including the last', () => {
  const ics = buildIcs({ ...fixed, summary: 'Coffee' });
  assert.ok(ics.endsWith('\r\n'));
  // No bare newlines anywhere.
  assert.equal(/(?<!\r)\n/.test(ics), false);
});

test('escapes the characters iCalendar treats as separators', () => {
  const ics = buildIcs({
    ...fixed,
    summary: 'Lunch, drinks; maybe',
    description: 'Path C:\\Users\\jd\nSecond line',
  });

  assert.ok(ics.includes('SUMMARY:Lunch\\, drinks\\; maybe\r\n'));
  const description = lines(ics).find((line) => line.startsWith('DESCRIPTION:'));
  assert.ok(description?.includes('C:\\\\Users\\\\jd\\nSecond line'), description);
});

test('folds long lines at 75 octets with a leading space', () => {
  const ics = buildIcs({ ...fixed, summary: 'x'.repeat(200) });
  const encoder = new TextEncoder();

  for (const line of lines(ics)) {
    assert.ok(encoder.encode(line).length <= 75, `line too long: ${line.length}`);
  }
  // Unfolding restores the original value.
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${'x'.repeat(200)}`));
});

test('folding never splits a multi-byte character', () => {
  // Four-octet characters, so a naive byte split would land mid-sequence.
  const summary = '🌅'.repeat(60);
  const ics = buildIcs({ ...fixed, summary });

  // Re-encoding and decoding must round-trip: an invalid split would not.
  const bytes = new TextEncoder().encode(ics);
  const restored = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assert.equal(restored, ics);

  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${summary}`));
});

test('omits optional fields that were not given', () => {
  const ics = buildIcs({ ...fixed, summary: 'Just a time' });
  assert.equal(ics.includes('DESCRIPTION:'), false);
  assert.equal(ics.includes('LOCATION:'), false);
});

test('includes optional fields that were', () => {
  const ics = buildIcs({
    ...fixed,
    summary: 'Appointment',
    description: 'Booked through TimeSync',
    location: 'The surgery',
  });
  assert.ok(ics.includes('DESCRIPTION:Booked through TimeSync\r\n'));
  assert.ok(ics.includes('LOCATION:The surgery\r\n'));
});

test('refuses an event that does not move forwards', () => {
  assert.throws(
    () => buildIcs({ ...fixed, end: fixed.start, summary: 'Nothing' }),
    /must end after it starts/,
  );
  assert.throws(
    () => buildIcs({ ...fixed, end: new Date('2026-10-05T13:00:00Z'), summary: 'Backwards' }),
    /must end after it starts/,
  );
});

test('generates a unique id when none is supplied', () => {
  const first = buildIcs({ start: fixed.start, end: fixed.end, summary: 'A' });
  const second = buildIcs({ start: fixed.start, end: fixed.end, summary: 'A' });

  const uidOf = (ics: string): string => lines(ics).find((line) => line.startsWith('UID:')) ?? '';
  assert.notEqual(uidOf(first), uidOf(second));
  assert.ok(uidOf(first).length > 'UID:'.length);
});

test('instants are UTC basic format', () => {
  assert.equal(formatIcsInstant(new Date('2026-01-02T03:04:05Z')), '20260102T030405Z');
  assert.equal(formatIcsInstant(new Date('2026-12-31T23:59:00Z')), '20261231T235900Z');
});
