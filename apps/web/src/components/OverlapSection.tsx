import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { type Availability, type FreeBlock, buildIcs, overlappingBlocks } from '@timesync/core';

import { AvailabilityList } from './AvailabilityList.tsx';
import { downloadBlob } from '../download.ts';

interface OverlapSectionProps {
  /** The availability that arrived in the link. */
  theirs: Availability;
  /** This device's own painted availability, if there is any. */
  mine: Availability | null;
  timeZone: string;
  now: Date;
}

/** Below this, a mutual gap is not worth offering as a meeting. */
const MINIMUM_MINUTES = 30;

export function OverlapSection({ theirs, mine, timeZone, now }: OverlapSectionProps) {
  const [copied, setCopied] = useState(false);

  const blocks = useMemo(
    () =>
      mine ? overlappingBlocks(mine, theirs, { after: now, minimumMinutes: MINIMUM_MINUTES }) : [],
    [mine, theirs, now],
  );

  const whose = theirs.label ?? 'Them';

  const formats = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone,
      }),
      time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone }),
    }),
    [timeZone],
  );

  if (!mine) {
    return (
      <div className="card">
        <strong>Compare with your own calendar</strong>
        <p>
          Paint your own availability and TimeSync will show only the times you and {whose} both
          have free. It stays on your device — comparing happens right here in this browser.
        </p>
        <p>
          <Link to="/">Paint your availability →</Link>
        </p>
      </div>
    );
  }

  if (blocks.length === 0) {
    return (
      <div className="card">
        <strong>No shared time</strong>
        <p>
          Nothing in {whose}&rsquo;s times lines up with yours for at least {MINIMUM_MINUTES}{' '}
          minutes. Their full availability is below, in case something can move.
        </p>
      </div>
    );
  }

  const addToCalendar = (block: FreeBlock): void => {
    const ics = buildIcs({
      start: block.start,
      end: block.end,
      summary: theirs.label ? `${theirs.label} and you` : 'TimeSync',
      description: 'A time you both had free, found with TimeSync.',
    });
    const stamp = block.start.toISOString().slice(0, 10);
    downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), `timesync-${stamp}.ics`);
  };

  const copyTimes = async (): Promise<void> => {
    const text = blocks
      .map(
        (block) =>
          `${formats.day.format(block.start)}, ${formats.time.format(block.start)}–${formats.time.format(block.end)}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* The times are listed below and can still be copied by hand. */
    }
  };

  return (
    <section className="overlap">
      <h2 className="overlap-heading">You&rsquo;re both free</h2>
      <p className="lede">
        {blocks.length} {blocks.length === 1 ? 'time works' : 'times work'} for both you and {whose}
        , of at least {MINIMUM_MINUTES} minutes.
      </p>

      <AvailabilityList
        blocks={blocks}
        timeZone={timeZone}
        now={now}
        renderAction={(block) => (
          <button type="button" className="secondary small" onClick={() => addToCalendar(block)}>
            Add to calendar
          </button>
        )}
      />

      <div className="share-actions">
        <button type="button" className="secondary" onClick={() => void copyTimes()}>
          Copy these times
        </button>
      </div>
      <p aria-live="polite" className="feedback">
        {copied ? 'Times copied.' : ''}
      </p>
    </section>
  );
}
