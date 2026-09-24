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

| #      | Milestone  | What lands                                                         | Status  |
| ------ | ---------- | ------------------------------------------------------------------ | ------- |
| M0     | Scaffold   | Workspace, TS, Vite + React + TanStack Router, static build        | ✅ done |
| M1     | Codec      | Payload format, encode/decode, round-trip and tamper tests         | ✅ done |
| M2     | Paint      | Week grid, drag select, time-of-day presets, local persistence     | ✅ done |
| **M3** | **Share**  | **Encode → URL → QR render, copy, download PNG, density warnings** | next    |
| M4     | View       | Decode fragment; standalone mode as a clean bookable list          |         |
| M5     | Overlap    | Intersect with saved availability; propose a time; `.ics` for both |         |
| M6     | ICS import | File drop, then the proxy decision below                           |         |
| M7     | Polish     | PWA/offline, keyboard a11y, privacy page                           |         |

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

## The ICS question (M6)

Feed import and a zero-knowledge design pull against each other. Google's `.ics`
endpoint returns `200` with no `Access-Control-Allow-Origin`, confirmed
2026-09-23, so a browser `fetch()` from our origin is blocked. Resolution, in
order of preference:

1. **File drop** — the user downloads their `.ics` and drags it in. Parsed
   entirely in-browser. Zero servers, zero compromise, works with every provider.
2. **Stateless proxy**, opt-in and plainly labelled — a small worker that fetches
   the feed and returns free/busy intervals only, stripping event titles before
   they come back, storing and logging nothing. The UI must say that subscribing
   sends the feed URL to a server, and that drag-and-drop does not.
3. **OAuth** stays off the roadmap. It would need an always-on server holding
   refresh tokens, and it undermines the central claim.

## Risks

- **Fragments persist in browser history.** Someone's availability sits in the
  scanner's URL bar. Mitigate with an expiry in the payload and a viewer that
  clears the fragment after decoding.
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
