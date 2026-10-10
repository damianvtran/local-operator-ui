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
| `narrow-width/` | the longest body at the story's own 420px measure | resting |

Every frame is captured at two themes (`localOperatorDark`, `localOperatorLight`)
because the line is a text-and-link surface and the roles it names
(`text-ink-dim`, `text-meta`, the link weight) have to hold in both. The story
pins the longest copy (`unverified`'s two lines and URL) into the narrow cell,
because wrapping is the failure this row exists to catch.

## What produced these frames

```
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-quota-notice --allow-backend --theme-settle-ms=45000 \
  --themes=localOperatorDark,localOperatorLight
```

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
copy), so a frame cannot certify copy the backend would not send. The four
pressed rows exist because these are states a PRESS produces: the rig presses
the real control and the shutter waits for the state's own marker
(`data-quota-notice-resend-phase`, or the line's disappearance for `dismissed`),
so a frame filed under a state is one the state was in — the lesson the
sign-in set's four copies of a waiting panel recorded for this directory's
siblings.

Each navigation re-mounts the story, and the story's bridge clears the stored
dismissal as it installs, so the 120 s cooldown cannot expire between themes
and one row's dismissal cannot leak into the next.

## What the frames do NOT show

- **The backend's own live verdict.** `source` is always the stub's `live`;
  what a cold cache, a stale `resets_at_ms` past its rollover, or a bounded
  fetch that fails looks like is the core PR's own matrix, not this one's.
- **The composer around it.** The band renders a stand-in box carrying the
  real composer box's roles(`rounded-frame border-control bg-surface p-4`) and
  the line's own `mt-2` slot; the shipped composer is exercised by
  `scripts/quota-notice.test.mjs`, which mounts it and asserts the line appears
  on the empty band and is absent once a message exists.
- **`LowCreditsDialog`.** The pre-existing one-shot modal is deliberately
  untouched in this slice and both can fire on a first send; that overlap is a
  UX-review item recorded on the PR.
