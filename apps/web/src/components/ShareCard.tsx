import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_LABEL_BYTES,
  type Availability,
  buildShareUrl,
  encodeAvailability,
} from '@timesync/core';

import { QUIET_ZONE, buildQr, describeDensity, qrToPath, qrToPngBlob } from '../qr.ts';
import { downloadBlob } from '../download.ts';

interface ShareCardProps {
  availability: Availability;
  onLabelChange: (label: string) => void;
}

type Feedback = { kind: 'copied' | 'saved' | 'error'; message: string } | null;

export function ShareCard({ availability, onLabelChange }: ShareCardProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let current = true;
    void encodeAvailability(availability).then(
      (payload) => {
        if (current) setShareUrl(buildShareUrl(`${window.location.origin}/v`, payload));
      },
      () => {
        if (current) setShareUrl(null);
      },
    );
    return () => {
      current = false;
    };
  }, [availability]);

  useEffect(
    () => () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    },
    [],
  );

  // An all-busy window encodes perfectly well, but a code that says "never
  // free" is not worth handing anyone — so the card stays quiet until there is
  // something to share.
  const hasFreeTime = useMemo(
    () => availability.slots.some((slot) => slot === 1),
    [availability.slots],
  );

  const qr = useMemo(
    () => (shareUrl && hasFreeTime ? buildQr(shareUrl) : null),
    [shareUrl, hasFreeTime],
  );
  const path = useMemo(() => (qr ? qrToPath(qr) : ''), [qr]);
  const density = qr ? describeDensity(qr) : null;

  const say = (kind: Exclude<Feedback, null>['kind'], message: string): void => {
    setFeedback({ kind, message });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2500);
  };

  const copy = async (): Promise<void> => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      say('copied', 'Link copied.');
    } catch {
      say('error', 'Could not copy — select the link and copy it manually.');
    }
  };

  const download = async (): Promise<void> => {
    if (!qr) return;
    try {
      downloadBlob(await qrToPngBlob(qr), 'timesync-availability.png');
      say('saved', 'Image saved.');
    } catch {
      say('error', 'Could not create the image.');
    }
  };

  const share = async (): Promise<void> => {
    if (!shareUrl) return;
    try {
      await navigator.share({ title: 'My availability', url: shareUrl });
    } catch {
      // Includes the user simply dismissing the sheet, which is not an error.
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const size = qr ? qr.moduleCount + QUIET_ZONE * 2 : 0;

  return (
    <div className="card share">
      <strong>Share</strong>

      <label className="share-name">
        Your name <small>(optional, shown to whoever opens this)</small>
        <input
          type="text"
          value={availability.label ?? ''}
          maxLength={MAX_LABEL_BYTES / 2}
          placeholder="e.g. Jordan"
          onChange={(event) => onLabelChange(event.target.value)}
        />
      </label>

      {qr && shareUrl && hasFreeTime ? (
        <>
          <div className="qr-frame">
            <svg
              viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${size} ${size}`}
              width="220"
              height="220"
              role="img"
              aria-label="QR code containing your availability"
              shapeRendering="crispEdges"
            >
              {/* Fixed black on white: many scanners reject an inverted code,
                  so this deliberately ignores the page theme. */}
              <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={size} height={size} fill="#fff" />
              <path d={path} fill="#000" />
            </svg>
          </div>

          <p className="qr-meta">
            Version {qr.version} · {qr.moduleCount}×{qr.moduleCount} modules · {shareUrl.length}{' '}
            characters
            <br />
            <span className={`density density-${density?.level}`}>{density?.note}</span>
          </p>

          <div className="share-actions">
            <button type="button" onClick={() => void copy()}>
              Copy link
            </button>
            <button type="button" className="secondary" onClick={() => void download()}>
              Save QR image
            </button>
            {canShare && (
              <button type="button" className="secondary" onClick={() => void share()}>
                Share…
              </button>
            )}
          </div>

          <p
            aria-live="polite"
            className={feedback?.kind === 'error' ? 'feedback error' : 'feedback'}
          >
            {feedback?.message ?? ''}
          </p>

          <details>
            <summary>Show the link</summary>
            <code className="share-url">{shareUrl}</code>
          </details>
        </>
      ) : (
        <p className="lede">Paint some time above and a code will appear here.</p>
      )}

      <p className="privacy-note">
        Everything after the <code>#</code> is your availability, and browsers never send that part
        to a server. This code is a snapshot — it can&rsquo;t be revoked once shared, so reissue one
        when things change.
      </p>
    </div>
  );
}
