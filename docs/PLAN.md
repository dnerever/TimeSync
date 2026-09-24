# TimeSync — implementation plan

A calendar that makes finding time easy while respecting your privacy.

## The product

You paint your availability on a week grid, then hand it to someone as a link or
a QR code. Whoever opens it either sees your open times as a plain list — the
receptionist at a doctor's office, who has nothing of their own saved — or sees
the **overlap** with their own availability, if they're a friend who also uses
TimeSync.

The driving use case is offline and in person: a receptionist scans a code from
your phone screen. No app install, no signup, no account on the other end. That
constraint shapes everything below.

## The privacy claim is structural, not a promise

The shared payload rides in the **URL fragment** — everything after the `#`.
Browsers never transmit a fragment to the server. So the claim isn't "we don't
look at your calendar", it's "your calendar never reaches us". There is no
database to breach and no retention policy to trust.

Consequences we accept:

- A shared code is a frozen snapshot. It cannot be revoked or updated after the
  fact; you reissue instead.
- The QR grows with the date range. Measurements below show this is not a real
  constraint at the ranges people actually share.

Consequences we defend:

- No analytics on the view route. Some analytics scripts transmit
  `location.href`, fragment included. **Verify before adding any.**
- `Referrer-Policy: no-referrer`, set in `index.html`.
- Path-based routing only. A hash router would fight the payload for the
  fragment.

## The core bet, measured

Realistic irregular calendars — jittered working hours, meetings punched out,
weekends mostly busy — bit-packed, run-length encoded, deflated, base64url'd:

| Range   | Granularity | Payload | Full URL | QR version |
| ------- | ----------- | ------- | -------- | ---------- |
| 1 week  | 15 min      | ~48 ch  | 70       | v5 (37×37) |
| 2 weeks | 15 min      | ~88 ch  | 110      | v7 (45×45) |
| 3 weeks | 15 min      | ~121 ch | 144      | v8 (49×49) |
| 4 weeks | 15 min      | ~147 ch | 168      | v9 (53×53) |

A v9 QR scans easily off a phone screen. Four weeks at 15-minute resolution fits
with headroom, so the date range never has to be compromised. Dropping to
30-minute slots saves only about one QR version — not worth the fidelity.

`codec.test.ts` pins the four-week payload under 200 characters, so a size
regression fails loudly rather than quietly degrading real codes.

In reserve if the format ever needs more fields: an all-uppercase base32 URL
would let the QR use alphanumeric mode, roughly 17% denser than byte mode.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Static site — Vite + React 19 + TS         │
│                                             │
│  localStorage: your own availability        │
│  No accounts. No database. No server calls. │
└─────────────────────────────────────────────┘
                    │
     timesync.app/v#p=A3kZ2w...  ← fragment
                    │               never transmitted
                    ▼
      recipient's browser decodes locally
```

The only server component on the roadmap is an optional, stateless ICS proxy
(M6). Everything else is static hosting.

## Payload format

```
byte 0        version (high nibble) | flags (low nibble)
bytes 1..4    origin, minutes since the Unix epoch, UTC, big-endian
byte 5        slot size index into SLOT_MINUTES
byte 6        day count
[FLAG_LABEL]  length byte + UTF-8 label
[FLAG_TZ]     length byte + UTF-8 IANA time zone
rest          deflate-raw(bitmap) or deflate-raw(RLE), per FLAG_RLE
```

**The origin is an absolute instant, never a local date.** A month-long window
can straddle a daylight-saving transition, and local-time arithmetic would
silently shift every slot after it. Absolute instants make that class of bug
unrepresentable.

The follow-on: `dayCount` counts 24-hour periods of _absolute_ time, so a local
day on a DST boundary is 23 or 25 hours long and the UI derives its day columns
from the time zone rather than assuming a fixed stride.

### Local storage is synchronous, on purpose

The plan originally said IndexedDB. It is the wrong tool here, and the reason is
worth keeping: an IndexedDB transaction started as the page unloads is torn down
before it commits, so the save-on-`pagehide` that protects unsaved painting
silently does nothing. Verified in a browser — edits made within the debounce
window were lost on navigation.

A window is a few hundred bytes, so `localStorage` holds it comfortably and
writes synchronously, which makes the flush actually complete. The slot vector
is stored as an uncompressed bitmap: the wire format deflates, but that is
async, and here a few hundred wasted bytes buy a save path that cannot be
interrupted.

**The body is encoded twice** — as a bitmap and as run lengths — keeping
whichever compresses smaller. Blocky calendars favour run lengths, fragmented
ones favour the bitmap, and neither has to win in every case.

The version nibble means a future format can coexist with this one. Codes
already printed or emailed keep decoding.

## Milestones

| #   | Milestone  | What lands                                                     | Status   |
| --- | ---------- | -------------------------------------------------------------- | -------- |
| M0  | Scaffold   | Workspace, TS, Vite + React + TanStack Router, static build    | ✅ done  |
| M1  | Codec      | Payload format, encode/decode, round-trip and tamper tests     | ✅ done  |
| M2  | Paint      | Week grid, drag select, time-of-day presets, local persistence | ✅ done  |
| M3  | Share      | QR render, copy link, save PNG, Web Share, density warnings    | ✅ done  |
| M4  | View       | Decode fragment, clear it, grouped list in the viewer's zone   | ✅ done  |
| M5  | Overlap    | Intersect two windows, propose a time, `.ics` export           | ✅ done  |
| M6  | ICS import | Drag in an exported calendar; busy time blocked out            | ✅ done  |
| M7  | Polish     | PWA/offline, keyboard a11y, privacy page                       | **next** |

### QR rendering is client-side and theme-proof

The code contains the availability itself, so handing the URL to a server-side
image generator would quietly undo the point of keeping the payload in the
fragment. Rendering runs entirely in the browser, from the raw module matrix:
one merged SVG path rather than a rect per module, which for a version 9 code
is the difference between a handful of nodes and about 2,800.

The code is fixed black on white in both themes. Plenty of scanners reject an
inverted code, and one that fails at a reception desk is worse than one that
looks out of place in dark mode.

Error correction is level M. Level L would be one version smaller, but the
codes are small enough that tolerating a little glare or a thumb over a corner
is the better trade when someone is reading a phone screen across a desk.

Verified by scanning the output back: both the on-screen SVG and the saved PNG
decode to the exact share URL, and following it renders the sharer's times.

### Clearing the fragment makes second links the normal case

Once the viewer clears the fragment, the address bar sits at a bare `/v`. So
opening a second code goes from `/v` to `/v#p=...` — a change of fragment only,
which browsers treat as a **same-document navigation**: nothing reloads and
nothing remounts. Without a `hashchange` listener the page keeps showing the
previous person's times, and the privacy measure above turns that from an edge
case into the ordinary one. Found by driving the app, not by reading it.

### Overlap is computed over absolute time, not by index

Two windows arrive from different devices and need not agree about anything:
different slot sizes, different date ranges, and — because a zone at a `:45`
offset shifts the whole grid — origins that do not share a slot boundary.
Walking two slot vectors in step would produce plausible nonsense the moment
the grids disagreed, so the intersection is computed over absolute minutes at
the finer of the two resolutions.

Where a candidate interval straddles two slots of a source, every slot it
touches must be free. Erring toward "busy" is the right way to be wrong here:
offering a time someone cannot make is worse than missing one.

The result is a list of blocks rather than an `Availability`, because an
overlap is an arbitrary span while an `Availability` is a whole number of days,
and padding one into the other would invent time nobody offered.

Mutual gaps shorter than 30 minutes are not offered. A ten-minute sliver is not
a meeting.

### iCalendar fails quietly, so it is tested

RFC 5545 is particular in ways that produce no error: lines must end CRLF, long
lines must fold at 75 **octets** (a folded emoji is a corrupt file), and commas,
semicolons and backslashes in text must be escaped or they read as field
separators. Calendar apps tend to respond by importing nothing and saying
nothing, so each of those has a test, including one that round-trips a
multi-byte summary through a strict UTF-8 decoder.

## The ICS question, answered (M6)

Feed import and a zero-knowledge design pull against each other. Google's
`.ics` endpoint returns `200` with no `Access-Control-Allow-Origin`, confirmed
2026-09-23, so a browser `fetch()` from our origin is blocked.

**Resolved in favour of the file drop.** The user exports their calendar and
drags the file in; it is parsed in the browser and never uploaded. That keeps
the privacy claim structural rather than promised, and it works with every
provider instead of one.

The stateless proxy stays available if subscribe-and-refresh is ever wanted
badly enough, but it is no longer on the critical path. It would have to be
opt-in and plainly labelled, because subscribing sends the feed URL to a
server, and drag-and-drop does not. OAuth stays off the roadmap: it needs an
always-on server holding refresh tokens, and it undermines the central claim.

### Under-blocking is the failure that matters

If an imported busy period is missed, TimeSync offers a time the user cannot
make — the exact mistake the rest of the app works to avoid. Over-blocking is
merely inconvenient. So the parser rounds against the user's free time
throughout: a meeting landing mid-slot takes the whole slot, an unrecognised
time zone falls back to the viewer's rather than dropping the event, and an
event whose recurrence rule cannot be expanded still blocks its first
occurrence.

Everything not fully understood is counted and shown in the interface rather
than swallowed: unexpandable repeat rules, substituted time zones, all-day
events, and cancelled or free-marked events that were deliberately left alone.
An import can also be undone in one click.

RFC 5545 is enormous and most of it does not bear on "when are they busy".
Handled: folded lines, quoted parameters, UTC / zoned / floating / date-only
values, `DTEND` or `DURATION`, `STATUS:CANCELLED`, `TRANSP:TRANSPARENT`,
`EXDATE`, and `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` with `INTERVAL`, `COUNT`,
`UNTIL` and plain `BYDAY`. Not handled, and reported: ordinal `BYDAY` ("2FR"),
`BYSETPOS`, `BYMONTHDAY` and friends.

## Risks

- ~~**Fragments persist in browser history.**~~ Handled in M4: the viewer
  clears the fragment with `replaceState` once decoding succeeds, keeping the
  availability in memory only. A failed decode keeps it, so a mangled link can
  still be inspected. Reloading afterwards shows an empty state explaining why,
  and a copy button beforehand lets anyone keep the link deliberately.
- **Analytics leaking the fragment.** See the privacy section. Verify, don't
  assume.
- **Drag-paint accessibility.** A mouse-drag grid is a genuine a11y trap. The
  keyboard path ships with the grid in M2, not bolted on at M7.
- **No revocation.** Inherent to the design. State it plainly in the UI rather
  than burying it.
- **SPA fallback on the host.** `/v` must serve `index.html`. Confirm when the
  host is chosen.

## After v1

Live friend sync (needs identity and a relay), group merge for three or more
people, server-backed revocable short links, a native app with an in-app QR
scanner.
