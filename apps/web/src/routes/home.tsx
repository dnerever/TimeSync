import { useState } from 'react';
import { buildShareUrl, encodeAvailability, slotsPerDay, type Availability } from '@timesync/core';

/**
 * A stand-in calendar so the encode/share path can be exercised end to end
 * before the painting grid exists. Replaced wholesale in M2.
 */
function demoAvailability(): Availability {
  const slotMinutes = 15;
  const dayCount = 21;
  const perDay = slotsPerDay(slotMinutes);
  const perHour = 60 / slotMinutes;

  // Start at the next midnight UTC so the origin lands on a slot boundary.
  const origin = new Date();
  origin.setUTCHours(0, 0, 0, 0);

  const slots = new Uint8Array(dayCount * perDay);
  for (let day = 0; day < dayCount; day++) {
    const base = day * perDay;
    const weekday = new Date(origin.getTime() + day * 86_400_000).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    slots.fill(1, base + 9 * perHour, base + 12 * perHour);
    slots.fill(1, base + 14 * perHour, base + 17 * perHour);
  }

  return {
    originMinute: origin.getTime() / 60_000,
    slotMinutes,
    dayCount,
    slots,
    label: 'Demo',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function HomePage() {
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const generate = async (): Promise<void> => {
    const payload = await encodeAvailability(demoAvailability());
    setShareUrl(buildShareUrl(window.location.origin + '/v', payload));
  };

  return (
    <main>
      <h1>TimeSync</h1>
      <p className="lede">A calendar that makes finding time easy while respecting your privacy.</p>

      <div className="card placeholder">
        <strong>Availability grid</strong>
        <p>Drag-to-paint week grid with morning / midday / afternoon presets — arriving in M2.</p>
      </div>

      <div className="card">
        <strong>Codec check</strong>
        <p>
          Encodes a sample three-week calendar and puts it in a link fragment, the same path a real
          share will take.
        </p>
        <button onClick={() => void generate()}>Generate a demo link</button>
        {shareUrl && (
          <p>
            <code>{shareUrl}</code>
            <br />
            <small>
              {shareUrl.split('#p=')[1]?.length ?? 0} characters after the <code>#</code> — and
              everything after it stays on this device.
            </small>
            <br />
            <a href={shareUrl}>Open it</a>
          </p>
        )}
      </div>
    </main>
  );
}
