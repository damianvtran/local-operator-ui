# The pre-emptive quota notice, on the empty chat band

One quiet line beside `NoProviderLine`, shown before the first send rather than
after the refusal: a depleted balance, a spent plan window, or a Radient signup
grant still waiting behind email verification. The frames are the shipped
`QuotaNoticeLine` — the real hook, the real query, the real resend op — over a
stubbed desktop transport whose answers are the sibling core PRs' own shapes.

## What each directory holds

| directory | state | how the state is reached |
| --- | --- | --- |
| `depleted/` | a depleted DeepSeek balance | resting |
| `unverified/` | Radient unverified, the resend offer present | resting |
| `limit-reached/` | a spent Anthropic plan window, reset time in the sentence | resting |
| `sending/` | the resend press in flight | `press` on the button, shutter on `resend-phase=sending` |
| `sent/` | the server took the press; the receipt and the cooldown | `press`, shutter on `resend-phase=sent` |
| `rate-limited/` | the server's own cooldown refused a second mail | `press`, shutter on `resend-phase=rate_limited` |
| `dismissed/` | the line after Dismiss | `press` on dismiss, shutter on the line's absence |
| `resend-failed/` | a retryable press failure (502) | `press`, shutter on `resend-phase=failed` |
| `refresh-unchanged/` | "I verified" answered with the same verdict | `press` on the re-read, shutter on the status slot |
| `narrow-width/` | the longest body at the story's own 420px measure | resting |

The composer pair lives in the sibling directory `docs/evidence/chat-message-input/`:

| directory | state | how the state is reached |
| --- | --- | --- |
| `quota-notice/` | the notice on the REAL `MessageInput` (empty band, fixed-height column) | resting |
| `notice-dismissed/` | the same story after a real Dismiss | `press` on dismiss, shutter on the line's absence |

Those two exist because the line's position IS the round-1 finding (D1 / R1-M3 / U6):
mounted below the box it pushed the bottom-anchored composer up 37–54 px when it
arrived. The frames show the two states; the NUMBERS that the composer did not
move are below.

Every frame is captured at two themes (`localOperatorDark`, `localOperatorLight`)
because the line is a text-and-link surface and the roles it names
(`text-ink-dim`, `text-meta`, the link weight) have to hold in both. The story
pins the longest copy (`unverified`'s two lines and URL) into the narrow cell,
because wrapping is the failure this row exists to catch.

## The composer-geometry pair (design round 1, D1)

The line is a band child ABOVE the composer's foot, so the splash yields the
space and the composer does not move when the line arrives, clears, or is
dismissed. `scripts/quota-notice-geometry.mjs` measures that on the real
composer — `[data-lo-composer-foot]`'s top edge in both states, in the same
page, with the verdict held long enough to catch the pre-line layout:

```
node scripts/quota-notice-geometry.mjs http://localhost:6017

chat-message-input--quota-notice  @ 1024x820
  arrival     foot top=567.4 bottom=677.4 (h 110)  ->  top=567.4 bottom=677.4 (h 110)
              splash h 498 -> 441.8  (the space the line took)
              FOOT TOP SHIFT 0
  dismissal   foot top=567.4 bottom=677.4 (h 110)  ->  top=567.4 bottom=677.4 (h 110)
              FOOT TOP SHIFT 0
```

The splash pays for the line (498 → 441.8 px), the foot does not move, and the
probe exits non-zero if either transition shifts it by more than 1 px — so a
future mount inside the form fails the rig instead of needing a reader to spot
the 37 px.

## What produced these frames

```
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-quota-notice --allow-backend --theme-settle-ms=45000 \
  --themes=localOperatorDark,localOperatorLight
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-message-input--quota-notice --allow-backend \
  --theme-settle-ms=45000 --themes=localOperatorDark,localOperatorLight
node scripts/quota-notice-geometry.mjs http://localhost:6017
```

The composer rows' dismissal press waits 15 s for `[data-quota-notice-dismiss]`,
and on this loaded host the SECOND theme of a combined two-theme pass has timed
out there twice while the light pass alone settles on the first try (measured
2026-10-10, the same tree). Run the light theme on its own when the combined
run reports the press selector missing; the frame it leaves behind is the
previous pass's and is byte-identical once re-taken.

`--allow-backend` is required because the operator's own backend answers on
:1111 on this machine, and **no frame here talks to it** — every story installs
its own bridge over `window.api.desktop.request`, so a frame is a function of
this tree and of nothing else that was running. `--theme-settle-ms=45000` is
the loaded-machine raise of the sweep's 10 s budget: what has to arrive inside
it is the theme decorator's attribute, and the FIRST story of a cold run pays
the whole story graph's first compile — on this fleet that outran the default
and the failure reads `document carries theme ""`. Neither flag changes a
pixel of what is photographed.


## What is stubbed, and why the frames still bind

The transport is the ONLY fake, and it sits below `desktopResult` — the same
seam `radient-credits-guidance.stories.tsx` states for its account frames. The
notice fixtures are the core builders' words (`providers/quota_notice.py`'s
DeepSeek/Anthropic sentences, `radient_recovery.recovery_line`'s verification
copy), so a frame cannot certify copy the backend would not send. The two copy
changes round 1 added — a retryable failure, and a re-read that came back
unchanged — are the LINE's own sentences (`quota-notice.ts`), because they
report what this client's request did; the frames exist because they are states
a PRESS produces. The rig presses the real control and the shutter waits for
the state's own marker (`data-quota-notice-resend-phase`, the status slot, or
the line's disappearance for `dismissed`), so a frame filed under a state is
one the state was in.

Each navigation re-mounts the story, and the story's bridge clears the stored
dismissal as it installs, so the 120 s cooldown cannot expire between themes
and one row's dismissal cannot leak into the next.

## What the frames do NOT show

- **The backend's own live verdict.** `source` is always the stub's `live`;
  what a cold cache, a stale `resets_at_ms` past its rollover, or a bounded
  fetch that fails looks like is the core PR's own matrix, not this one's.
- **The composer around the LINE-ONLY frames.** The `chat-quota-notice/` band
  renders a stand-in box carrying the real composer box's roles
  (`rounded-frame border-control bg-surface p-4`) and the line's own `mt-2`
  slot; the shipped composer is exercised by `scripts/quota-notice.test.mjs`
  (mount, request discipline, dismissal, both presses) and photographed by the
  `chat-message-input--quota-notice` frames above.
- **`LowCreditsDialog`.** The pre-existing one-shot modal is deliberately
  untouched in this slice and both can fire on a first send; that overlap is a
  UX-review item recorded on the PR.
