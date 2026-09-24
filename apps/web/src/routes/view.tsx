import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { type Availability, decodeAvailability, extractPayload, freeBlocks } from '@timesync/core';

import { AvailabilityList } from '../components/AvailabilityList.tsx';
import { OverlapSection } from '../components/OverlapSection.tsx';
import { loadAvailability } from '../storage.ts';

const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

type State =
  | { status: 'reading' }
  | { status: 'missing' }
  | { status: 'unreadable'; reason: string }
  | { status: 'ready'; availability: Availability };

export function ViewPage() {
  const [state, setState] = useState<State>({ status: 'reading' });
  const [copied, setCopied] = useState(false);

  // Captured on the first render, before the fragment is cleared below. A ref
  // rather than state because StrictMode runs effects twice, and by the second
  // pass the address bar no longer holds the payload.
  const captured = useRef<string | null | undefined>(undefined);
  if (captured.current === undefined) captured.current = extractPayload(window.location.href);

  const originalUrl = useRef(window.location.href);
  const now = useMemo(() => new Date(), []);
  // Read once: nothing on this page edits it, and comparing happens locally.
  const mine = useMemo(() => loadAvailability(), []);

  useEffect(() => {
    let current = true;

    const read = (payload: string | null): void => {
      if (payload === null) {
        setState({ status: 'missing' });
        return;
      }
      setState({ status: 'reading' });
      void decodeAvailability(payload).then(
        (availability) => {
          if (!current) return;
          setState({ status: 'ready', availability });
          // Someone else's availability should not linger in this browser's
          // address bar or history. It stays in memory while the page is open,
          // and goes no further. replaceState does not fire hashchange, so
          // this cannot loop.
          window.history.replaceState(null, '', window.location.pathname);
        },
        (cause: unknown) => {
          if (!current) return;
          setState({
            status: 'unreadable',
            reason: cause instanceof Error ? cause.message : 'the link could not be read',
          });
        },
      );
    };

    read(captured.current ?? null);

    // Opening a second link is a same-document navigation: only the fragment
    // changes, so nothing remounts, and without this the page would keep
    // showing the previous person's times. Clearing the fragment above makes
    // that the normal case rather than an edge one.
    const onHashChange = (): void => {
      const next = extractPayload(window.location.href);
      if (next === null) return;
      originalUrl.current = window.location.href;
      read(next);
    };

    window.addEventListener('hashchange', onHashChange);
    return () => {
      current = false;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(originalUrl.current);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Nothing useful to say here; the link can still be copied by hand. */
    }
  };

  if (state.status === 'reading') return <main>Reading…</main>;

  if (state.status === 'missing') {
    return (
      <main>
        <h1>Nothing to show</h1>
        <p className="lede">This link doesn&rsquo;t carry any availability.</p>
        <p>
          TimeSync clears shared availability from the address bar once it has been read, so
          reloading won&rsquo;t bring it back. Ask whoever shared it for a fresh link or code.
        </p>
        <p>
          <Link to="/">Make your own TimeSync →</Link>
        </p>
      </main>
    );
  }

  if (state.status === 'unreadable') {
    return (
      <main>
        <h1>This link didn&rsquo;t open</h1>
        <p className="lede">{state.reason}.</p>
        <p>
          It may have been cut short when it was copied, or made by a newer version of TimeSync. Ask
          for a fresh one.
        </p>
        <p>
          <Link to="/">Make your own TimeSync →</Link>
        </p>
      </main>
    );
  }

  const { availability } = state;
  const upcoming = freeBlocks(availability, { after: now });
  const total = freeBlocks(availability).length;
  const sharerZone = availability.timeZone;
  const differentZone = sharerZone !== undefined && sharerZone !== VIEWER_ZONE;

  return (
    <main>
      <h1>{availability.label ?? 'Shared availability'}</h1>

      <OverlapSection theirs={availability} mine={mine} timeZone={VIEWER_ZONE} now={now} />

      {upcoming.length === 0 ? (
        <>
          <p className="lede">
            {total === 0
              ? 'No times were shared in this link.'
              : 'Every time in this link has already passed.'}
          </p>
          <p>A shared code covers a fixed set of dates. Ask for an up-to-date one.</p>
        </>
      ) : (
        <>
          <p className="lede">
            {upcoming.length} open {upcoming.length === 1 ? 'time' : 'times'} coming up, shown in
            your own time zone.
          </p>

          {differentZone && (
            <p className="zone-note">
              {availability.label ? `${availability.label} is` : 'This was shared'} in{' '}
              <strong>{sharerZone.replace(/_/g, ' ')}</strong>. Times below are converted to{' '}
              <strong>{VIEWER_ZONE.replace(/_/g, ' ')}</strong>.
            </p>
          )}

          <h2 className="section-heading">
            {availability.label ? `${availability.label}'s times` : 'Their times'}
          </h2>
          <AvailabilityList blocks={upcoming} timeZone={VIEWER_ZONE} now={now} />
        </>
      )}

      <div className="card">
        <strong>Keep this link?</strong>
        <p>
          It has been removed from your address bar so it doesn&rsquo;t sit in your history. Copy it
          now if you want to keep it.
        </p>
        <button type="button" onClick={() => void copy()}>
          Copy link
        </button>
        <p aria-live="polite" className="feedback">
          {copied ? 'Link copied.' : ''}
        </p>
      </div>

      <p className="privacy-note">
        This availability was read entirely in your browser — the part of the link that carries it
        is never sent to a server. <Link to="/">Make your own TimeSync →</Link>
      </p>
    </main>
  );
}
