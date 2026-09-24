import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORMAT_VERSION,
  MAX_DAY_COUNT,
  type Availability,
  type SlotMinutes,
  buildShareUrl,
  decodeAvailability,
  encodeAvailability,
  extractPayload,
  slotStart,
  slotsPerDay,
  totalSlots,
} from './codec.ts';
import { toBase64Url, fromBase64Url } from './base64url.ts';

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const MINUTE = 60_000;
const utcMinute = (iso: string): number => Date.parse(iso) / MINUTE;

/**
 * A plausible calendar: jittered working hours on weekdays, meetings punched
 * out at random, weekends mostly busy. Uniform noise would be both unrealistic
 * and incompressible, which would make the size assertions meaningless.
 */
function realisticCalendar(
  random: () => number,
  dayCount: number,
  slotMinutes: SlotMinutes,
): Uint8Array {
  const perDay = slotsPerDay(slotMinutes);
  const perHour = 60 / slotMinutes;
  const slots = new Uint8Array(dayCount * perDay);
  for (let day = 0; day < dayCount; day++) {
    const base = day * perDay;
    if ((day + 1) % 7 === 0 || (day + 2) % 7 === 0) {
      if (random() < 0.4) {
        const start = base + Math.floor((12 + random() * 4) * perHour);
        slots.fill(1, start, Math.min(start + Math.floor(3 * perHour), base + perDay));
      }
      continue;
    }
    const startHour = 8 + Math.floor(random() * 2);
    const endHour = 16 + Math.floor(random() * 3);
    slots.fill(1, base + startHour * perHour, base + endHour * perHour);
    for (let meeting = 0; meeting < 3; meeting++) {
      const at = base + Math.floor((startHour + random() * (endHour - startHour - 1)) * perHour);
      slots.fill(0, at, Math.min(at + Math.max(1, Math.floor(perHour)), base + perDay));
    }
  }
  return slots;
}

function sample(overrides: Partial<Availability> = {}): Availability {
  const slotMinutes = overrides.slotMinutes ?? 15;
  const dayCount = overrides.dayCount ?? 21;
  return {
    originMinute: utcMinute('2026-10-05T00:00:00Z'),
    slotMinutes,
    dayCount,
    slots: realisticCalendar(prng(99), dayCount, slotMinutes),
    ...overrides,
  };
}

test('round-trips a realistic calendar exactly', async () => {
  const original = sample();
  const decoded = await decodeAvailability(await encodeAvailability(original));

  assert.equal(decoded.originMinute, original.originMinute);
  assert.equal(decoded.slotMinutes, original.slotMinutes);
  assert.equal(decoded.dayCount, original.dayCount);
  assert.deepEqual(decoded.slots, original.slots);
  assert.equal(decoded.label, undefined);
  assert.equal(decoded.timeZone, undefined);
});

test('round-trips optional label and time zone, including non-ASCII', async () => {
  const original = sample({ label: 'Jordan — mornings 🌅', timeZone: 'America/New_York' });
  const decoded = await decodeAvailability(await encodeAvailability(original));

  assert.equal(decoded.label, 'Jordan — mornings 🌅');
  assert.equal(decoded.timeZone, 'America/New_York');
  assert.deepEqual(decoded.slots, original.slots);
});

test('round-trips across every slot size and the full day-count range', async () => {
  for (const slotMinutes of [15, 30, 60] as const) {
    for (const dayCount of [1, 7, MAX_DAY_COUNT]) {
      const original = sample({ slotMinutes, dayCount });
      const decoded = await decodeAvailability(await encodeAvailability(original));
      assert.deepEqual(decoded.slots, original.slots, `${slotMinutes}min over ${dayCount}d`);
      assert.equal(decoded.dayCount, dayCount);
    }
  }
});

test('round-trips the degenerate all-free and all-busy calendars', async () => {
  for (const fill of [0, 1]) {
    const original = sample({ slots: new Uint8Array(21 * 96).fill(fill) });
    const decoded = await decodeAvailability(await encodeAvailability(original));
    assert.deepEqual(decoded.slots, original.slots, `all ${fill ? 'free' : 'busy'}`);
  }
});

test('a four-week payload still fits comfortably in a scannable QR', async () => {
  // The product rests on this: four weeks at 15-minute resolution has to fit
  // in a QR a phone can read off a screen. ~150 characters lands at version 9
  // (53x53 modules). 200 leaves headroom without hiding a real regression.
  const payload = await encodeAvailability(sample({ dayCount: 28, slotMinutes: 15 }));
  assert.ok(
    payload.length < 200,
    `four-week payload grew to ${payload.length} characters; QR density at risk`,
  );
});

test('slot instants are absolute, so a DST transition cannot shift them', async () => {
  // This window straddles the US spring-forward on 2026-03-08.
  const original = sample({
    originMinute: utcMinute('2026-03-05T00:00:00Z'),
    dayCount: 7,
    timeZone: 'America/New_York',
  });
  const decoded = await decodeAvailability(await encodeAvailability(original));

  const hourIn = (zone: string, date: Date): string =>
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hour12: false }).format(
      date,
    );

  // Same slot index, same absolute instant, on both sides of the transition.
  for (const index of [0, 96 * 3, 96 * 4, 96 * 6 + 95]) {
    assert.equal(
      slotStart(decoded, index).getTime(),
      slotStart(original, index).getTime(),
      `slot ${index} instant`,
    );
  }

  // And the local wall clock really does shift, which is exactly the bug that
  // storing local dates would have introduced.
  const before = slotStart(decoded, 96 * 1); // 2026-03-06T00:00Z
  const after = slotStart(decoded, 96 * 5); // 2026-03-10T00:00Z
  assert.equal(hourIn('America/New_York', before), '19');
  assert.equal(hourIn('America/New_York', after), '20');
});

test('the payload rides in the fragment, never the path or query', async () => {
  const payload = await encodeAvailability(sample());
  const url = buildShareUrl('https://timesync.app/', payload);

  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/');
  assert.equal(parsed.search, '');
  assert.ok(parsed.hash.startsWith('#p='));
  assert.equal(extractPayload(url), payload);
});

test('extractPayload returns null when there is nothing to read', () => {
  assert.equal(extractPayload('https://timesync.app/'), null);
  assert.equal(extractPayload('https://timesync.app/#'), null);
  assert.equal(extractPayload('https://timesync.app/#other=1'), null);
});

test('rejects a payload from a future format version', async () => {
  const bytes = fromBase64Url(await encodeAvailability(sample()));
  bytes[0] = ((FORMAT_VERSION + 1) << 4) | (bytes[0]! & 0b1111);
  await assert.rejects(() => decodeAvailability(toBase64Url(bytes)), /unsupported payload version/);
});

test('rejects unknown flags rather than misreading the body', async () => {
  const bytes = fromBase64Url(await encodeAvailability(sample()));
  bytes[0] = bytes[0]! | 0b1000;
  await assert.rejects(() => decodeAvailability(toBase64Url(bytes)), /unknown flags/);
});

test('rejects structurally invalid payloads', async () => {
  const valid = await encodeAvailability(sample());
  const bytes = fromBase64Url(valid);

  await assert.rejects(() => decodeAvailability(''), /too short/);
  await assert.rejects(() => decodeAvailability('AAAA'), /too short/);

  const truncated = toBase64Url(bytes.subarray(0, bytes.length - 3));
  await assert.rejects(() => decodeAvailability(truncated));

  const badSlotSize = Uint8Array.from(bytes);
  badSlotSize[5] = 9;
  await assert.rejects(() => decodeAvailability(toBase64Url(badSlotSize)), /unknown slot size/);

  const badDayCount = Uint8Array.from(bytes);
  badDayCount[6] = MAX_DAY_COUNT + 1;
  await assert.rejects(
    () => decodeAvailability(toBase64Url(badDayCount)),
    /day count out of range/,
  );

  const zeroDays = Uint8Array.from(bytes);
  zeroDays[6] = 0;
  await assert.rejects(() => decodeAvailability(toBase64Url(zeroDays)), /day count out of range/);

  // A bare 7-byte header is caught by the minimum-length guard first. To reach
  // the body check the header has to be long enough on its own, which needs an
  // optional field present.
  await assert.rejects(() => decodeAvailability(toBase64Url(bytes.subarray(0, 7))), /too short/);

  const labelled = fromBase64Url(await encodeAvailability(sample({ label: 'Jordan' })));
  const headerOnly = labelled.subarray(0, 7 + 1 + 'Jordan'.length);
  await assert.rejects(() => decodeAvailability(toBase64Url(headerOnly)), /no body/);
});

test('rejects availability that cannot be represented', async () => {
  await assert.rejects(
    () => encodeAvailability(sample({ dayCount: MAX_DAY_COUNT + 1 })),
    /dayCount must be between/,
  );
  await assert.rejects(
    () => encodeAvailability({ ...sample(), slots: new Uint8Array(5) }),
    /slots length does not match/,
  );
  await assert.rejects(
    () => encodeAvailability(sample({ originMinute: utcMinute('2026-10-05T00:07:00Z') })),
    /slotMinutes boundary/,
  );
  await assert.rejects(() => encodeAvailability(sample({ originMinute: -60 })), /must be a uint32/);
  await assert.rejects(
    () => encodeAvailability(sample({ label: 'x'.repeat(49) })),
    /label exceeds/,
  );
});

test('origin survives dates far enough out to outlive the format', async () => {
  // uint32 minutes runs to the year 10136; check a date well past any QR's life.
  const original = sample({ originMinute: utcMinute('2099-12-28T00:00:00Z') });
  const decoded = await decodeAvailability(await encodeAvailability(original));
  assert.equal(decoded.originMinute, original.originMinute);
  assert.equal(slotStart(decoded, 0).toISOString(), '2099-12-28T00:00:00.000Z');
});

test('totalSlots agrees with the slot vector the encoder accepts', () => {
  assert.equal(totalSlots({ slotMinutes: 15, dayCount: 1 }), 96);
  assert.equal(totalSlots({ slotMinutes: 30, dayCount: 2 }), 96);
  assert.equal(totalSlots({ slotMinutes: 60, dayCount: 7 }), 168);
});
