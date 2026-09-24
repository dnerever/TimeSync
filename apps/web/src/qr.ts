/**
 * QR rendering, done from the raw module matrix.
 *
 * Everything here runs in the browser. A QR of a TimeSync link contains the
 * availability itself, so handing the URL to a server-side image generator
 * would quietly undo the whole point of keeping the payload in the fragment.
 */

import qrcode from 'qrcode-generator';

export interface QrMatrix {
  moduleCount: number;
  /** QR version, 1–40. Module count is 21 + 4 × (version − 1). */
  version: number;
  isDark: (row: number, column: number) => boolean;
}

/**
 * Error correction level M tolerates a little glare or a thumb over a corner,
 * which matters when the code is being read off a phone screen held at arm's
 * length across a reception desk. L would be one version smaller; the codes
 * are small enough that the robustness is the better trade.
 */
const ERROR_CORRECTION = 'M';

/** Modules of quiet zone. The spec requires four; scanners rely on it. */
export const QUIET_ZONE = 4;

export function buildQr(text: string): QrMatrix {
  const qr = qrcode(0, ERROR_CORRECTION); // 0 picks the smallest version that fits
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  return {
    moduleCount,
    version: (moduleCount - 21) / 4 + 1,
    isDark: (row, column) => qr.isDark(row, column),
  };
}

/**
 * One SVG path for the whole code, merging each row's dark modules into runs.
 * A rect per module would be several thousand DOM nodes for a version 9 code.
 */
export function qrToPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.moduleCount; row++) {
    let runStart = -1;
    for (let column = 0; column <= matrix.moduleCount; column++) {
      const dark = column < matrix.moduleCount && matrix.isDark(row, column);
      if (dark && runStart === -1) runStart = column;
      if (!dark && runStart !== -1) {
        parts.push(`M${runStart} ${row}h${column - runStart}v1h${runStart - column}z`);
        runStart = -1;
      }
    }
  }
  return parts.join('');
}

/**
 * A PNG of the code, for saving or sending.
 *
 * Always black on white, never the page's theme colours: plenty of scanners
 * refuse an inverted code, and one that fails at a reception desk is worse
 * than one that looks out of place in dark mode.
 */
export async function qrToPngBlob(matrix: QrMatrix, modulePixels = 8): Promise<Blob> {
  const side = (matrix.moduleCount + QUIET_ZONE * 2) * modulePixels;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('this browser would not provide a canvas');

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, side, side);
  context.fillStyle = '#000000';
  for (let row = 0; row < matrix.moduleCount; row++) {
    for (let column = 0; column < matrix.moduleCount; column++) {
      if (!matrix.isDark(row, column)) continue;
      context.fillRect(
        (column + QUIET_ZONE) * modulePixels,
        (row + QUIET_ZONE) * modulePixels,
        modulePixels,
        modulePixels,
      );
    }
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('could not encode the image'));
    }, 'image/png');
  });
}

export interface Density {
  level: 'comfortable' | 'dense' | 'crowded';
  note: string;
}

/**
 * How hard this code will be to scan. Present payloads sit around version 9,
 * so this is a guard against future growth rather than a live constraint.
 */
export function describeDensity(matrix: QrMatrix): Density {
  if (matrix.version <= 10) {
    return { level: 'comfortable', note: 'Scans easily from a phone screen.' };
  }
  if (matrix.version <= 16) {
    return {
      level: 'dense',
      note: 'Still scannable, but hold the screen steady. A shorter range makes it simpler.',
    };
  }
  return {
    level: 'crowded',
    note: 'This code is hard to scan. Share a shorter date range, or send the link instead.',
  };
}
