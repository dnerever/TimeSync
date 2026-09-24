import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TIME_OF_DAY_PRESETS,
  type Availability,
  applyTimeOfDay,
  createAvailability,
  freeBlocks,
  localParts,
  resizeWindow,
} from '@timesync/core';

import { useAutosave } from '../autosave.ts';
import { ImportCard } from '../components/ImportCard.tsx';
import { ShareCard } from '../components/ShareCard.tsx';
import { WeekGrid } from '../components/WeekGrid.tsx';
import { loadAvailability } from '../storage.ts';

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const HOUR_WINDOWS = {
  waking: { label: 'Waking hours', fromMinute: 7 * 60, toMinute: 22 * 60 },
  full: { label: 'Full day', fromMinute: 0, toMinute: 24 * 60 },
} as const;

function startingAvailability(): Availability {
  const today = localParts(LOCAL_ZONE, new Date());
  return createAvailability({
    timeZone: LOCAL_ZONE,
    start: { year: today.year, month: today.month, day: today.day },
    dayCount: 21,
    slotMinutes: 15,
  });
}

export function HomePage() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const [hourWindow, setHourWindow] = useState<keyof typeof HOUR_WINDOWS>('waking');

  useEffect(() => {
    setAvailability(loadAvailability() ?? startingAvailability());
  }, []);

  useAutosave(availability);

  const onSlotsChange = useCallback((slots: Uint8Array) => {
    setAvailability((previous) => (previous ? { ...previous, slots } : previous));
  }, []);

  const onLabelChange = useCallback((label: string) => {
    setAvailability((previous) => {
      if (!previous) return previous;
      // Rebuilt rather than assigned undefined: the label is an optional
      // property, and exactOptionalPropertyTypes draws that distinction.
      const { label: _cleared, ...rest } = previous;
      return label.trim() === '' ? rest : { ...rest, label };
    });
  }, []);

  const blocks = useMemo(() => (availability ? freeBlocks(availability) : []), [availability]);

  if (!availability) return <main>Loading…</main>;

  const zone = availability.timeZone ?? LOCAL_ZONE;
  const applyPreset = (band: { startMinute: number; endMinute: number }, value: 0 | 1): void => {
    setAvailability({
      ...availability,
      slots: applyTimeOfDay(availability, zone, band, value, { weekdaysOnly }),
    });
  };

  return (
    <main>
      <h1>TimeSync</h1>
      <p className="lede">
        Paint when you&rsquo;re free, then share it. Everything below stays on this device until you
        choose to hand someone a link.
      </p>

      <div className="controls">
        <div className="control-group">
          <span className="control-label">Add</span>
          {TIME_OF_DAY_PRESETS.map((preset) => (
            <button key={preset.id} type="button" onClick={() => applyPreset(preset, 1)}>
              {preset.label}
            </button>
          ))}
        </div>

        <div className="control-group">
          <label>
            <input
              type="checkbox"
              checked={weekdaysOnly}
              onChange={(event) => setWeekdaysOnly(event.target.checked)}
            />{' '}
            Weekdays only
          </label>
          <label>
            Show{' '}
            <select
              value={hourWindow}
              onChange={(event) => setHourWindow(event.target.value as keyof typeof HOUR_WINDOWS)}
            >
              {Object.entries(HOUR_WINDOWS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Range{' '}
            <select
              value={availability.dayCount}
              onChange={(event) =>
                setAvailability(resizeWindow(availability, zone, Number(event.target.value)))
              }
            >
              {[7, 14, 21, 28].map((days) => (
                <option key={days} value={days}>
                  {days / 7} week{days > 7 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setAvailability({ ...availability, slots: new Uint8Array(availability.slots.length) })
            }
          >
            Clear all
          </button>
        </div>
      </div>

      <WeekGrid
        availability={availability}
        timeZone={zone}
        fromMinute={HOUR_WINDOWS[hourWindow].fromMinute}
        toMinute={HOUR_WINDOWS[hourWindow].toMinute}
        onChange={onSlotsChange}
      />

      <p className="summary">
        {blocks.length} open {blocks.length === 1 ? 'block' : 'blocks'} across{' '}
        {availability.dayCount} days.
      </p>

      <ImportCard availability={availability} timeZone={zone} onChange={onSlotsChange} />

      <ShareCard availability={availability} onLabelChange={onLabelChange} />
    </main>
  );
}
