# Oversize message refusal (desktop 413)

A long message with five pasted screenshots was refused with "This desktop
request is too large" before any HTTP request was made. These frames show the
refusal, the trap that followed it, and the same payload being accepted after
the change.

## Which surface produced these frames, and what they do not prove

**Surface:** the app's own chat components served by the Vite browser dev
server (`harness/chat-413.vite.mjs`), which mounts `src/renderer/index.html`
and `main.tsx` with the app's real CSP. Its `/__desktop` route is the
committed `desktopProxyPlugin`, which calls the SAME `requestDesktop` in
`src/main/desktop-transport.ts` that Electron's IPC handler calls — so the
per-op budget lookup and the 413 under test are the shipping ones.

**Capture:** `harness/capture-413.mjs`, driving Chrome over raw CDP the same
way `scripts/capture-evidence.mjs` does — private `--headless=new` profile
under the system temp dir, swept on exit, `Page.captureScreenshot` at
deviceScaleFactor 2. The browser tool was unavailable this session; no other
browser stack was installed. Frames are 2880x1800, unaltered.

**Backend:** `harness/stub-backend.mjs` on port 8788, a disposable stand-in
that logs the byte count of every body it receives and mirrors the two limits
that matter from `local_operator/server/routes/desktop_sessions.py`: it
refuses past 900,000 bytes and maps that refusal to 409. The operator's own
backend was not started, stopped or contacted.

**These frames therefore do NOT prove:** packaged Electron IPC, the native
file dialog (the harness answers `show-open-dialog` with fixture paths),
native window behaviour, or a real backend's replies. The transport guard, the
downscale ladder, the pre-flight check and the draft-latch behaviour are all
renderer/main code and are exercised for real; the channel carrying them and
the server answering them are stand-ins. A packaged-app run remains ungathered
and is named here rather than implied.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [Before: composed](before-composed.png) | Five 2880x1800 screenshots (~865 KB of base64 each) plus a long message, staged in the composer. |
| [Before: refused](before-refused.png) | "Desktop controls need a compatible backend connection. Your message is kept below — send it again, or discard it to write something else." No `/messages` request reached the backend at all. |
| [Before: the trap](before-latch-refuses-edit.png) | The banner says to send it again, so an attachment was removed to make it fit — and the send was then refused as "The previous send has not been confirmed. Retry it unchanged, or discard it to send something different." The advice and the guard contradict each other, and the guard wins. |
| [After: same payload sent](after-sent.png) | The identical five-screenshot message is admitted: composer cleared, session created, no banner. |
| [After: genuine overflow](after-overflow-refusal.png) | Two large GIFs, which the ladder deliberately does not re-encode: "These images total 1.3 MB, more than the 880 KB one message can carry. Remove an image, or send them in a second message." |
| [After: the remedy works](after-overflow-retry-accepted.png) | One GIF removed and the message sent — the action the previous banner advised and the latch forbade. |

## Measured bytes at the transport boundary

Recorded by the stub backend, which logs `Buffer.concat(chunks).length` for
every body it receives. The before/after runs sent the SAME payload.

```
BEFORE (transport guard at the bare 262144 literal)
  POST /v1/desktop/sessions                     bytes=63
  (no POST .../messages line — the guard returned 413 before fetch)

AFTER (per-op budget, images bounded client-side)
  POST .../messages  bytes=753987  images=5  text_chars=164
```

The five screenshots are 4.3 MB of base64 as pasted. They arrive as 753,987
bytes because `boundImageForWire` bounds each to a 1024px long edge first —
the same `IMAGE_INGEST_MAX_EDGE` the TUI applies at
`local_operator/imaging.py:154`. Raising the budget alone would not have been
enough: 4.3 MB does not fit under any budget this transport can offer.

The genuine-overflow run and the retry that followed it:

```
  (refusal — no POST .../messages, the renderer refused before admission)
  POST .../messages  bytes=660537  images=1  text_chars=103
```

## Reproducing

```
node docs/evidence/desktop-413/harness/stub-backend.mjs &
npx vite --config docs/evidence/desktop-413/harness/chat-413.vite.mjs &
node docs/evidence/desktop-413/harness/capture-413.mjs <out-dir> fits
node docs/evidence/desktop-413/harness/capture-413.mjs <out-dir> overflow
```

The screenshot fixtures are generated, not committed — five 2880x1800 PNGs and
two ~495 KB GIFs under `/tmp/desktop-413-fixtures`. `capture-413.mjs` prints
the banner text it observed, so a run that captures a blank frame fails
visibly rather than silently.
