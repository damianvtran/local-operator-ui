# QA-102 — independent verification of PR #102 against the REAL backend

Scope: `9f12fc8779fbddbdee450519da2b30811967fdaa..089fcbc44069bda7b1b8c4af8bbbb755458d3b07`

The committed evidence in `docs/evidence/desktop-413/` was captured against a
**stub** backend (`harness/stub-backend.mjs`) and says so plainly. This run
closes that gap: everything below is the real `local-operator serve` on
127.0.0.1:8911 (version 0.52.7), reached through the shipped
`requestDesktop` in `src/main/desktop-transport.ts`.

## 1. Does the client weigh the same bytes as the backend?

The 880,000 budget only protects anyone if `JSON.stringify` and pydantic's
`model_dump_json().encode()` agree. Measured on identical strings, backend
side via `Prompt(...)` imported from
`local_operator/server/routes/desktop_sessions.py`:

| case | client bytes | backend bytes | delta |
| --- | --- | --- | --- |
| ascii | 1091 | 1091 | same |
| kanji (3-byte UTF-8) | 3091 | 3091 | same |
| emoji (surrogate pairs) | 4091 | 4091 | same |
| quote / backslash | 2091 | 2091 | same |
| newline / tab | 2092 | 2092 | same |
| NUL / \u001f | 6092 | 6092 | same |
| DEL \u007f | 1091 | 1091 | same |
| U+2028 / U+2029 | 3092 | 3092 | same |
| combining marks | 3091 | 3091 | same |
| U+FFFF noncharacter | 3091 | 3091 | same |
| U+FEFF BOM | 3092 | 3092 | same |

**Worst divergence: 0 bytes.** Two inputs the backend refuses outright
(lone high surrogate → invalid string; U+00A0-only text → "Enter a message",
because pydantic treats it as blank) never reach the byte question.

## 2. Where is the backend's real wall?

POSTed raw, bypassing the client guard, bodies sized to the byte:

```
client_bytes= 890000  backend_status=200/503*
client_bytes= 899990  backend_status=200/503*
client_bytes= 900000  backend_status=200/503*   <- accepted by validation
client_bytes= 900001  backend_status=422        <- refused
client_bytes= 905000  backend_status=422        <- refused
```

The wall is **exactly 900,000**, matching `Prompt.nonempty`. The 880,000
client budget therefore sits 20,000 bytes below it, and because §1 shows zero
divergence, a client-accepted message cannot become a backend refusal.

(*503 = `Session owner is unavailable`, an owner-liveness condition, not
validation. 422 is the validation refusal, which is what this row tests.)

## 3. Client guard boundary

Through the shipped transport, message ops:

```
body_bytes = 879997  -> 200 admitted
body_bytes = 880003  -> 413 refused locally, no HTTP request made
```

Boundary is `>` as documented (880,000 itself passes).

## 4. An earlier analysis in this scratch dir was WRONG

`q3-fixed.mjs` concluded "text alone cannot reach the message budget" from
ASCII/kanji/emoji only. JSON **escaping** breaks that: a C0 control character
serializes as a 6-byte `\uXXXX` sequence.

```
ascii 'a'    1 B/char   @200,000 chars =   200000 B   under budget
backslash    2 B/char   @200,000 chars =   400000 B   under budget
NUL \u0000   6 B/char   @200,000 chars =  1200000 B   OVER backend wall
ctrl \u001f  6 B/char   @200,000 chars =  1200000 B   OVER backend wall
kanji 漢      3 B/char   @200,000 chars =   600000 B   under budget
```

Exercised for real:

```
NUL x200000 (schema-legal length) -> body 1,200,091 B -> 413 refused locally
NUL x146651 (largest that fits)   -> body   879,997 B -> 200 admitted
NUL x146652 (one char over)       -> body   880,003 B -> 413 refused locally
```

So text alone **can** exceed both limits, and the guard is what stops it.
This does not change the shipped code — the guard already handles it — but
it does mean the "images are the only way to reach the budget" reasoning
should not be relied on.

## 5. Image-bearing payloads at the budget, real backend

Fresh session per trial, at-budget payload, liveness pinged before and after:

```
images=1 utf8=false bytes=879997 send=200 owner_after=200
images=2 utf8=false bytes=879997 send=200 owner_after=200
images=3 utf8=false bytes=879989 send=200 owner_after=200
images=4 utf8=false bytes=879989 send=200 owner_after=200
images=5 utf8=false bytes=879981 send=200 owner_after=200
images=8 utf8=false bytes=879973 send=200 owner_after=200
images=1..8 utf8=true  ~879,99x  send=200 owner_after=200
```

Eight rounds of alternating tiny ping / at-budget send on fresh sessions:
`tinyFail=0 bigFail=0`. Six consecutive at-budget sends on ONE session: all
200, owner alive throughout.

**Note on 503s seen earlier in this session:** intermittent
`Session owner is unavailable` responses were traced to the shared backend on
:8911 being probed concurrently by another agent's QA run, plus ~200 sessions
created by this bisection against 21 live owner processes (owners get reaped).
Tiny payloads on fresh sessions: 12/12 succeeded. The 503s do **not**
correlate with payload size and are not attributable to this change.

## 6. Live UI, real backend

Captured with the repo's own committed harness
(`docs/evidence/desktop-413/harness/capture-413.mjs`, the same raw-CDP
mechanism as `scripts/capture-evidence.mjs`) pointed at the real backend
instead of the stub. The Local Operator browser tool and cmux were both
unavailable this session (extension needs updating; cmux socket refused), so
no new browser stack was introduced.

| Frame | Result |
| --- | --- |
| `fits-composed.png` | Five 2880x1800 Retina screenshots staged in the composer. |
| `fits-result.png` | **Admitted by the real backend** (`POST .../messages 200`), composer cleared, no banner, model replied. |
| `overflow-composed.png` | Two ~495 KB animated GIFs staged. |
| `overflow-result.png` | Refused client-side: "These images total 1.3 MB, more than the 880 KB one message can carry. Remove an image, or send them in a second message. Your draft is retained." Draft retained, 2 attachments still present. |
| `overflow-after-removing-one.png` | One GIF removed — the action the OLD latch forbade. |
| `overflow-retry-accepted.png` | Retry **admitted**, banner cleared, model replied. |

This is the regression the PR describes (banner advises removing an image;
old guard then refused exactly that) shown fixed against a real server.

## 7. Downscale ladder

The five noise fixtures land on the ladder's **512px rung**, which is correct
rather than a defect: they are full-field RGB noise, deliberately
incompressible, so PNG cannot shrink them. Simulated per rung (5 images, base64
totals, budget 880,000):

```
PNG  edge=1024 -> 9,721,596 B  over
PNG  edge=768  -> 5,336,244 B  over
PNG  edge=512  -> 2,352,188 B  over
JPEG edge=1024 q80 -> 1,786,016 B  over
JPEG edge=768  q70 ->   693,224 B  FITS
JPEG edge=512  q60 ->   208,848 B  FITS
```

A *realistic* UI screenshot (a real 2880x1800 app frame) at 5 copies is
998,880 B at the top PNG rung — still over 880,000, so even ordinary
screenshots exercise a lower rung. The ladder terminates rather than looping,
and GIFs are exempt (§6 overflow case proves the exemption holds end to end).

## 8. Shipped tests

```
scripts/desktop-contract.test.mjs            17 pass 0 fail
scripts/desktop-renderer-transport.test.mjs   8 pass 0 fail
scripts/canonical-chat.test.mjs              14 pass 0 fail
```
