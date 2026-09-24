import { type ReactNode, useMemo } from 'react';
import type { FreeBlock } from '@timesync/core';

import { describeDuration, groupByDay } from '../daygroups.ts';

interface AvailabilityListProps {
  blocks: FreeBlock[];
  /** The viewer's own zone. Everything is rendered in it. */
  timeZone: string;
  now: Date;
  /** Optional per-block control, such as adding that time to a calendar. */
  renderAction?: (block: FreeBlock) => ReactNode;
}

export function AvailabilityList({ blocks, timeZone, now, renderAction }: AvailabilityListProps) {
  const groups = useMemo(() => groupByDay(blocks, timeZone, now), [blocks, timeZone, now]);

  // Bound to the zone we were handed rather than the system default, so
  // grouping and formatting can never disagree about which day it is.
  const formats = useMemo(
    () => ({
      day: new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone,
      }),
      time: new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
      }),
    }),
    [timeZone],
  );

  return (
    <div className="availability">
      {groups.map((group) => (
        <section key={group.key} className="day-group">
          <h2>
            {group.relative && <span className="relative">{group.relative}</span>}
            {formats.day.format(group.blocks[0]!.start)}
          </h2>
          <ul>
            {group.blocks.map((block) => (
              <li key={block.start.toISOString()}>
                <span className="slot-time">
                  {formats.time.format(block.start)} – {formats.time.format(block.end)}
                </span>
                <span className="slot-length">
                  {describeDuration((block.end.getTime() - block.start.getTime()) / 60_000)}
                </span>
                {renderAction && <span className="slot-action">{renderAction(block)}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
