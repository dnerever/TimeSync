/**
 * iCalendar output, for putting an agreed time into a real calendar.
 *
 * RFC 5545 is particular in ways that fail quietly rather than loudly: lines
 * must end CRLF, long lines must be folded at 75 octets (octets, not
 * characters — a folded emoji is a corrupt file), and commas, semicolons and
 * backslashes inside text must be escaped or they are read as field
 * separators. Calendar apps tend to respond to all of this by importing
 * nothing and saying nothing, so it is handled here and tested.
 */

const CRLF = '\r\n';

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** UTC, basic format: 20260924T140000Z */
export function formatIcsInstant(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Fold to 75 octets per line, continuing with a leading space.
 *
 * Measured in UTF-8 octets, and never mid-character: splitting a multi-byte
 * sequence produces a file that is not valid UTF-8.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const pieces: string[] = [];
  let current = '';
  let currentOctets = 0;
  // A continuation line carries a leading space, so it holds one octet less.
  let limit = 75;

  for (const character of line) {
    const width = encoder.encode(character).length;
    if (currentOctets + width > limit) {
      pieces.push(current);
      current = '';
      currentOctets = 0;
      limit = 74;
    }
    current += character;
    currentOctets += width;
  }
  pieces.push(current);

  return pieces.join(`${CRLF} `);
}

export interface IcsEvent {
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  /** Supplied in tests; otherwise generated. */
  uid?: string;
  /** Supplied in tests; otherwise now. */
  stamp?: Date;
}

function newUid(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${random}@timesync`;
}

export function buildIcs(event: IcsEvent): string {
  if (!(event.end.getTime() > event.start.getTime())) {
    throw new Error('an event must end after it starts');
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TimeSync//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${event.uid ?? newUid()}`,
    `DTSTAMP:${formatIcsInstant(event.stamp ?? new Date())}`,
    `DTSTART:${formatIcsInstant(event.start)}`,
    `DTEND:${formatIcsInstant(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description === undefined ? [] : [`DESCRIPTION:${escapeText(event.description)}`]),
    ...(event.location === undefined ? [] : [`LOCATION:${escapeText(event.location)}`]),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // A trailing CRLF: the spec ends every content line, the last one included.
  return lines.map(foldLine).join(CRLF) + CRLF;
}
