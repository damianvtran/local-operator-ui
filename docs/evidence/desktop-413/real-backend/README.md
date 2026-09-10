# Real-backend verification for the desktop 413 fix

The rest of `docs/evidence/desktop-413/` was captured against the stub backend
in `harness/stub-backend.mjs`, which answers the shape of a receipt without ever
weighing a body. This directory closes that gap: every number and frame here
came from a real `local-operator serve` (version 0.52.7) on 127.0.0.1:8911,
reached through the shipped `requestDesktop` in `src/main/desktop-transport.ts`,
with the Vite renderer driven over raw CDP by the repo's own committed harness
(`harness/capture-413.mjs`, the same mechanism as `scripts/capture-evidence.mjs`).
No browser engine was installed for it — the browser tool and cmux were both
unavailable, so the harness drove the renderer directly.

Produced by a concurrent Local Operator review session, not by the author of the
change. It is preserved here because it is the only real-backend proof this PR
has, and because an independent reviewer measuring the boundary is worth more
than the author measuring it again.

## What these prove

| Claim | Evidence |
| --- | --- |
| Client and backend weigh the SAME bytes | `escaping.json`, `agreement.json` — `JSON.stringify` vs pydantic `model_dump_json().encode()` across 15 adversarial cases (kanji, emoji surrogate pairs, quotes, backslashes, NUL, `\u001f`, DEL, U+2028/2029, combining marks, U+FFFF, U+FEFF). Worst divergence: **0 bytes**. |
| The backend wall is exactly 900,000 | `measure.json` — 900,000 accepted, 900,001 → 422. The 880,000 client budget therefore sits on 20,000 bytes of genuine slack, not on a guess. |
| The client guard fires at the documented boundary | 879,997 → 200 admitted; 880,003 → 413 refused locally with **no HTTP request made**. |
| Image payloads at the budget really are admitted | `img-agreement.json` — 1 through 8 images at ~879,99x bytes, ASCII and multi-byte UTF-8, every one `200`, owner alive before and after. |
| The operator's reported dead end is fixed | `frames/` — five Retina screenshots admitted by the real server; two GIFs refused with the sized banner, **draft retained**, one attachment removed, retry admitted. |

## Frames

| Frame | What it shows |
| --- | --- |
| `frames/fits-composed.png` | Five 2880×1800 Retina screenshots staged in the composer. |
| `frames/fits-result.png` | Admitted by the real backend, composer cleared, no banner, model replied. |
| `frames/overflow-composed.png` | Two ~495 KB GIFs staged — GIF is exempt from the downscale ladder, so this is a genuine overflow. |
| `frames/overflow-result.png` | Refused client-side with the sized copy; draft retained, both attachments still present. |
| `frames/overflow-after-removing-one.png` | One GIF removed — the action the OLD latch forbade. |
| `frames/overflow-retry-accepted.png` | Retry admitted, banner cleared, model replied. |

## What these do NOT prove

- **They are pre-remediation.** Captured against committed head `089fcbc4`,
  before the round-1 remediation. They are evidence for the latch fix and the
  boundary behaviour, which that remediation did not change. They are **not**
  "after" frames: the refusal sentences visible in `overflow-result.png` are the
  pre-remediation wording, and the round-1 copy changes (the character-cap
  refusal, the dominant-term attribution, the actionable backstop sentence) are
  evidenced separately in the PR discussion, not here.
- **Not packaged Electron.** The renderer reaches main's `requestDesktop` through
  the dev proxy rather than IPC. Same function, different channel; the IPC
  channel and `electron-builder` packaging remain unexercised.
- **Not a model round-trip.** `200` is admission, not inference. Some runs
  returned `503 Session owner is unavailable`, which is an owner-liveness
  condition on a shared backend being probed concurrently by another agent — it
  does not correlate with payload size and is not attributable to this change.

## A correction worth keeping

An earlier analysis in the same scratch directory concluded that "text alone
cannot reach the message budget", generalising from ASCII, kanji and emoji. JSON
escaping breaks that: a C0 control character serializes as a 6-byte `\uXXXX`
sequence, so 200,000 NULs is 1,200,091 bytes — over both the client budget and
the backend wall, while still being schema-legal by character count. Verified
refused at 413. The shipped guard already handles it, but the claim itself is
false and is part of why the byte budget and the character cap have to be
checked independently rather than one being inferred from the other.

## These PNGs are deliberately outside the themed-frame gate

`pnpm check-evidence` walks `.webp` only, and asserts that a frame NAMED for a
theme is a picture of that theme — it exists to catch a Storybook frame that
rendered a spinner instead of the app. The frames here (and in `../round-2/`)
are scenario captures of a transport refusal, not theme frames: nothing in
`overflow-result.png` names a palette, so converting them to `.webp` would make
the gate fail with "no palette named overflow-result" rather than pass, while
lossily recompressing screenshots whose entire value is the legible refusal
sentence inside them.

So the gate does not cover these, by construction rather than by oversight, and
that is disclosed here rather than silently worked around. What asserts their
content is this README and a reader opening them. Teaching the gate about PNG
scenario evidence generally is worth doing, and is not this PR's job.
