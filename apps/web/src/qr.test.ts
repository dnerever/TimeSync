import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQr, describeDensity, qrToPath } from './qr.ts';

/**
 * Rebuild a module grid from the SVG path, so the run-merging is checked
 * against the matrix it came from rather than against itself.
 */
function gridFromPath(path: string, moduleCount: number): boolean[][] {
  const grid = Array.from({ length: moduleCount }, () =>
    new Array<boolean>(moduleCount).fill(false),
  );
  const segment = /M(-?\d+) (-?\d+)h(\d+)v1h(-?\d+)z/g;

  let match: RegExpExecArray | null;
  while ((match = segment.exec(path)) !== null) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    const width = Number(match[3]);
    assert.equal(Number(match[4]), -width, 'each run must close back on itself');
    for (let i = 0; i < width; i++) grid[y]![x + i] = true;
  }
  return grid;
}

test('the path covers exactly the dark modules', () => {
  for (const text of [
    'https://timesync.app/v#p=FwHHQcgAFQZKb3JkYW4',
    'https://timesync.app/v#p=' + 'A'.repeat(200),
    'x',
  ]) {
    const qr = buildQr(text);
    const grid = gridFromPath(qrToPath(qr), qr.moduleCount);

    let dark = 0;
    for (let row = 0; row < qr.moduleCount; row++) {
      for (let column = 0; column < qr.moduleCount; column++) {
        assert.equal(grid[row]![column], qr.isDark(row, column), `module ${row},${column}`);
        if (qr.isDark(row, column)) dark++;
      }
    }
    assert.ok(dark > 0, 'a code with no dark modules is not a code');
  }
});

test('module count and version stay consistent', () => {
  const qr = buildQr('https://timesync.app/v#p=' + 'A'.repeat(120));
  assert.equal(qr.moduleCount, 21 + 4 * (qr.version - 1));
  assert.ok(qr.version >= 1 && qr.version <= 40);
});

test('a longer payload needs a bigger code', () => {
  const small = buildQr('https://timesync.app/v#p=' + 'A'.repeat(20));
  const large = buildQr('https://timesync.app/v#p=' + 'A'.repeat(400));
  assert.ok(large.version > small.version);
});

test('a realistic share URL stays in comfortable scanning range', () => {
  // Mirrors the measured worst case: a four-week window plus name and zone.
  const url = 'https://timesync.app/v#p=' + 'A'.repeat(170);
  const qr = buildQr(url);
  assert.ok(qr.version <= 10, `expected version 10 or below, got ${qr.version}`);
  assert.equal(describeDensity(qr).level, 'comfortable');
});

test('density warnings escalate with version', () => {
  assert.equal(
    describeDensity({ version: 1, moduleCount: 21, isDark: () => false }).level,
    'comfortable',
  );
  assert.equal(
    describeDensity({ version: 10, moduleCount: 57, isDark: () => false }).level,
    'comfortable',
  );
  assert.equal(
    describeDensity({ version: 11, moduleCount: 61, isDark: () => false }).level,
    'dense',
  );
  assert.equal(
    describeDensity({ version: 16, moduleCount: 81, isDark: () => false }).level,
    'dense',
  );
  assert.equal(
    describeDensity({ version: 17, moduleCount: 85, isDark: () => false }).level,
    'crowded',
  );
});
