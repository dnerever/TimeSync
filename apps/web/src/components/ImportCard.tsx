import { useRef, useState } from 'react';
import {
  type Availability,
  type IcsImportResult,
  applyBusy,
  parseIcsBusy,
  totalSlots,
} from '@timesync/core';

interface ImportCardProps {
  availability: Availability;
  timeZone: string;
  onChange: (slots: Uint8Array) => void;
}

interface Outcome {
  result: IcsImportResult;
  /** Slots before the import, so it can be undone. */
  previous: Uint8Array;
  cleared: number;
}

function countFree(slots: Uint8Array): number {
  let free = 0;
  for (const slot of slots) if (slot === 1) free++;
  return free;
}

export function ImportCard({ availability, timeZone, onChange }: ImportCardProps) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File): Promise<void> => {
    setError(null);
    try {
      const text = await file.text();
      const from = new Date(availability.originMinute * 60_000);
      const to = new Date(
        (availability.originMinute + totalSlots(availability) * availability.slotMinutes) * 60_000,
      );

      const result = parseIcsBusy(text, { from, to, defaultZone: timeZone });
      if (result.events === 0) {
        setError('No events found — is this a calendar (.ics) file?');
        return;
      }

      const previous = Uint8Array.from(availability.slots);
      const next = applyBusy(availability, result.intervals);
      setOutcome({ result, previous, cleared: countFree(previous) - countFree(next) });
      onChange(next);
    } catch {
      setError('That file could not be read.');
    }
  };

  const undo = (): void => {
    if (!outcome) return;
    onChange(outcome.previous);
    setOutcome(null);
  };

  return (
    <div className="card import">
      <strong>Block out your real commitments</strong>
      <p>
        Export your calendar as an <code>.ics</code> file and drop it here. TimeSync will clear any
        time you&rsquo;re already booked. The file is read in this browser and never uploaded.
      </p>

      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        <p>Drop a .ics file here</p>
        <button type="button" className="secondary" onClick={() => input.current?.click()}>
          Choose a file
        </button>
        <input
          ref={input}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = '';
          }}
        />
      </div>

      {error && <p className="feedback error">{error}</p>}

      {outcome && (
        <div className="import-result" aria-live="polite">
          <p>
            Read {outcome.result.events} {outcome.result.events === 1 ? 'event' : 'events'} and
            blocked out {outcome.result.intervals.length}{' '}
            {outcome.result.intervals.length === 1 ? 'busy period' : 'busy periods'}, clearing{' '}
            {outcome.cleared} {outcome.cleared === 1 ? 'slot' : 'slots'}.
          </p>

          {/*
            Anything the parser could not fully understand is said out loud.
            A missed busy period means TimeSync offers a time the user cannot
            make, which is worse than any amount of over-blocking.
          */}
          {outcome.result.unsupportedRecurrence > 0 && (
            <p className="warn">
              {outcome.result.unsupportedRecurrence}{' '}
              {outcome.result.unsupportedRecurrence === 1 ? 'event has' : 'events have'} a repeat
              pattern TimeSync can&rsquo;t follow fully — only the first occurrence was blocked.
              Check those dates yourself.
            </p>
          )}
          {outcome.result.unknownZones.length > 0 && (
            <p className="warn">
              Unrecognised time zone{outcome.result.unknownZones.length === 1 ? '' : 's'} (
              {outcome.result.unknownZones.join(', ')}) were read as {timeZone}, so those times may
              be shifted.
            </p>
          )}
          {outcome.result.allDay > 0 && (
            <p className="note">
              {outcome.result.allDay} all-day{' '}
              {outcome.result.allDay === 1 ? 'event blocked its' : 'events blocked their'} whole
              day.
            </p>
          )}
          {outcome.result.ignored > 0 && (
            <p className="note">
              {outcome.result.ignored} cancelled or free-marked{' '}
              {outcome.result.ignored === 1 ? 'event was' : 'events were'} left alone.
            </p>
          )}

          <button type="button" className="secondary" onClick={undo}>
            Undo this import
          </button>
        </div>
      )}
    </div>
  );
}
