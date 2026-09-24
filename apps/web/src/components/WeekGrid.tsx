import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Availability, type LocalDay, localDays, slotIndexAt } from '@timesync/core';

interface WeekGridProps {
  availability: Availability;
  timeZone: string;
  /** Local minute-of-day the grid starts showing. */
  fromMinute: number;
  /** Local minute-of-day the grid stops at, exclusive. */
  toMinute: number;
  onChange: (slots: Uint8Array) => void;
}

const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayNumber = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const timeLabel = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

function formatMinute(minuteOfDay: number): string {
  return timeLabel.format(new Date(Date.UTC(2020, 0, 1) + minuteOfDay * 60_000));
}

export function WeekGrid({
  availability,
  timeZone,
  fromMinute,
  toMinute,
  onChange,
}: WeekGridProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [focused, setFocused] = useState<{ row: number; column: number }>({ row: 0, column: 0 });

  // Painting mode is captured on pointer-down: dragging across cells applies
  // one consistent value rather than toggling each cell it passes over, which
  // is what makes a drag feel like a brush instead of a switch.
  const painting = useRef<0 | 1 | null>(null);

  const days = useMemo(() => localDays(availability, timeZone), [availability, timeZone]);
  const weeks = Math.max(1, Math.ceil(days.length / 7));
  const week = Math.min(weekOffset, weeks - 1);
  const visibleDays = days.slice(week * 7, week * 7 + 7);

  const rows = useMemo(() => {
    const minutes: number[] = [];
    for (let minute = fromMinute; minute < toMinute; minute += availability.slotMinutes) {
      minutes.push(minute);
    }
    return minutes;
  }, [fromMinute, toMinute, availability.slotMinutes]);

  // Which slot each cell addresses depends only on the window's geometry, not
  // on what is painted — so this survives repainting without redoing several
  // hundred time-zone conversions on every pointer move.
  const cells = useMemo(
    () =>
      rows.map((minute) =>
        visibleDays.map((day) => slotIndexAt(availability, timeZone, day, minute)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry only
    [
      rows,
      visibleDays,
      timeZone,
      availability.originMinute,
      availability.slotMinutes,
      availability.slots.length,
    ],
  );

  useEffect(() => {
    const stop = (): void => {
      painting.current = null;
    };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, []);

  const paint = useCallback(
    (index: number | null, value: 0 | 1) => {
      if (index === null || availability.slots[index] === value) return;
      const slots = Uint8Array.from(availability.slots);
      slots[index] = value;
      onChange(slots);
    },
    [availability, onChange],
  );

  const move = (row: number, column: number, extend: boolean): void => {
    const nextRow = Math.max(0, Math.min(rows.length - 1, row));
    const nextColumn = Math.max(0, Math.min(visibleDays.length - 1, column));
    setFocused({ row: nextRow, column: nextColumn });
    if (extend && painting.current !== null) {
      paint(cells[nextRow]?.[nextColumn] ?? null, painting.current);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent, row: number, column: number): void => {
    const extend = event.shiftKey;
    const index = cells[row]?.[column] ?? null;

    switch (event.key) {
      case 'ArrowUp':
        if (extend && index !== null) painting.current = availability.slots[index] === 1 ? 0 : 1;
        move(row - 1, column, extend);
        break;
      case 'ArrowDown':
        if (extend && index !== null) painting.current = availability.slots[index] === 1 ? 0 : 1;
        move(row + 1, column, extend);
        break;
      case 'ArrowLeft':
        move(row, column - 1, false);
        break;
      case 'ArrowRight':
        move(row, column + 1, false);
        break;
      case 'Home':
        move(0, column, false);
        break;
      case 'End':
        move(rows.length - 1, column, false);
        break;
      case ' ':
      case 'Enter':
        if (index !== null) paint(index, availability.slots[index] === 1 ? 0 : 1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="grid-wrap">
      <div className="grid-nav">
        <button type="button" onClick={() => setWeekOffset(week - 1)} disabled={week === 0}>
          ← Earlier
        </button>
        <span>
          Week {week + 1} of {weeks}
        </span>
        <button type="button" onClick={() => setWeekOffset(week + 1)} disabled={week >= weeks - 1}>
          Later →
        </button>
      </div>

      <div
        className="grid"
        role="grid"
        aria-label="Your availability. Arrow keys move, space toggles, shift and arrows paint."
        style={{ gridTemplateColumns: `4.5rem repeat(${visibleDays.length}, 1fr)` }}
      >
        <div className="grid-corner" role="presentation" />
        {visibleDays.map((day: LocalDay) => (
          <div
            key={`${day.year}-${day.month}-${day.day}`}
            className="grid-head"
            role="columnheader"
          >
            <strong>{dayHeading.format(day.startsAt)}</strong>
            <small>{dayNumber.format(day.startsAt)}</small>
          </div>
        ))}

        {rows.map((minute, row) => (
          <div key={minute} className="grid-row" role="row" style={{ display: 'contents' }}>
            <div className="grid-time" role="rowheader">
              {minute % 60 === 0 ? formatMinute(minute) : ''}
            </div>
            {visibleDays.map((day, column) => {
              const index = cells[row]?.[column] ?? null;
              const free = index !== null && availability.slots[index] === 1;
              const isFocused = focused.row === row && focused.column === column;

              return (
                <button
                  key={`${day.year}-${day.month}-${day.day}-${minute}`}
                  type="button"
                  role="gridcell"
                  aria-selected={free}
                  aria-label={`${dayNumber.format(day.startsAt)} ${formatMinute(minute)} ${
                    index === null ? 'unavailable' : free ? 'free' : 'busy'
                  }`}
                  disabled={index === null}
                  tabIndex={isFocused ? 0 : -1}
                  className={[
                    'cell',
                    free ? 'cell-free' : '',
                    index === null ? 'cell-void' : '',
                    minute % 60 === 0 ? 'cell-hour' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onFocus={() => setFocused({ row, column })}
                  onKeyDown={(event) => onKeyDown(event, row, column)}
                  onPointerDown={(event) => {
                    if (index === null) return;
                    // Releasing capture is what lets pointerenter fire on the
                    // other cells during a touch drag.
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    const value = availability.slots[index] === 1 ? 0 : 1;
                    painting.current = value;
                    paint(index, value);
                  }}
                  onPointerEnter={() => {
                    if (painting.current !== null) paint(index, painting.current);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
