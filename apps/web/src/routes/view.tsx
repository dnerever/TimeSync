import { useEffect, useState } from 'react';
import { decodeAvailability, extractPayload, slotStart, type Availability } from '@timesync/core';

/**
 * Contiguous runs of free time, for display. A placeholder: this becomes a
 * shared core helper at M4/M5, when overlap needs the same grouping.
 */
function freeBlocks(av: Availability): Array<{ start: Date; end: Date }> {
  const blocks: Array<{ start: Date; end: Date }> = [];
  let runStart: number | null = null;
  for (let i = 0; i <= av.slots.length; i++) {
    const free = i < av.slots.length && av.slots[i] === 1;
    if (free && runStart === null) runStart = i;
    if (!free && runStart !== null) {
      blocks.push({ start: slotStart(av, runStart), end: slotStart(av, i) });
      runStart = null;
    }
  }
  return blocks;
}

const when = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

export function ViewPage() {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const payload = extractPayload(window.location.href);
    if (payload === null) {
      setError('This link has no availability in it.');
      return;
    }
    decodeAvailability(payload).then(setAvailability, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not read this link.');
    });
  }, []);

  if (error) {
    return (
      <main>
        <h1>Nothing to show</h1>
        <p className="lede">{error}</p>
      </main>
    );
  }

  if (!availability) return <main>Reading…</main>;

  const blocks = freeBlocks(availability);

  return (
    <main>
      <h1>{availability.label ?? 'Shared availability'}</h1>
      <p className="lede">
        {blocks.length} open {blocks.length === 1 ? 'block' : 'blocks'} over {availability.dayCount}{' '}
        days, shown in your local time zone.
      </p>

      <div className="card placeholder">
        <strong>Overlap with your own calendar</strong>
        <p>Arriving in M5. For now this is the standalone view: the sharer&rsquo;s open times.</p>
      </div>

      <table>
        <tbody>
          {blocks.map((block) => (
            <tr key={block.start.toISOString()}>
              <td>{when.format(block.start)}</td>
              <td>{clock.format(block.end)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
