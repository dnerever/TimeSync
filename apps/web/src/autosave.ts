import { useEffect, useRef } from 'react';
import type { Availability } from '@timesync/core';

import { saveAvailability } from './storage.ts';

/** Coalesces the flood of changes a drag produces into one write. */
const SETTLE_MS = 200;

/**
 * Saves availability shortly after editing stops, and immediately if the page
 * is about to go away.
 *
 * The flush is what makes this correct rather than merely usual. The main path
 * through this app is paint, then tap share straight away — and a debounce
 * that keeps being reset by further edits never fires at all, so the last
 * thing painted is exactly the thing most likely to be lost. Because saving is
 * synchronous, the flush completes even as the page unloads.
 */
export function useAutosave(availability: Availability | null): void {
  const latest = useRef<Availability | null>(availability);
  latest.current = availability;

  useEffect(() => {
    if (!availability) return;
    const timer = setTimeout(() => saveAvailability(availability), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [availability]);

  useEffect(() => {
    const flush = (): void => {
      if (latest.current) saveAvailability(latest.current);
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Unmounting is itself a reason to persist: the route changed.
      flush();
    };
  }, []);
}
