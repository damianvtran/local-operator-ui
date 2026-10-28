# PR #1444 — design review round 3 evidence

Frames and measurements for the scheduled-message edit dialog at PR head
`e9bb8ee7f04c076bc2015eaa071f93d737f4ce81` (branch `fix/schedule-edit-conflict`),
supporting `### Design review — round 3` on
https://github.com/damianvtran/local-operator-ui/pull/1444.

## How these frames were made

One story-scoped **static** Storybook 8 build (`storybook build`, config scoped to
`src/renderer/src/features/team-bridge/team-bridge-scheduled.stories.tsx`,
`NODE_OPTIONS=--max-old-space-size=1024`), in an in-repo worktree whose
`node_modules` is the primary checkout's tree by symlink (`pnpm-lock.yaml` byte-equal
to `origin/main`). No install. Served by a 40-line Node static file server on
`127.0.0.1:61444`.

Every frame is a real story state reached through the dialog's own submit path
(the committed `play`; for the `ru`/`fr` frames the same user steps driven
structurally, because the plays locate controls by their English names).

Frames were captured through the `browser` tool — the operator's own browser, one
tab — from a same-origin harness page that mounts the story iframe at the exact
CSS viewport. Each shot is the 2560x1440 device-pixel screenshot cut to the
viewport's top-left region (`0,0,w*2,h*2`) with a dependency-free PNG cropper, so
the published PNG is the rendered frame at 2x and nothing else.

`?args=theme:localOperatorLight|localOperatorDark`, and for the per-locale frames
`;locale:ru|fr`.

## Measurement method

The harness samples the dialog and its action button with `getBoundingClientRect()`
on every rAF tick *and* on every DOM mutation of the story document (background
tabs throttle rAF to about 1 Hz, so the mutation tap is what records each
intermediate state the play passes through), then reports: dialog rect, action
rect/label/enabled, `document.elementFromPoint` at the action's centre, the
scrolling body's `clientHeight`/`scrollHeight`/`overflow-y`, the alert's position
relative to the scroller, and any element wider than its box.

## Action geometry — every state, every size (CSS px, viewport = frame)

`800x572` is the app's minimum window (`WINDOW_MIN_HEIGHT = 600` less the 28 px
title bar). The dialog is `top-[12vh] h-[min(84vh,40rem)]`; the body scrolls; the
action row is the dialog's last flex child.

| state | viewport | dialog top..bottom | action top..bottom | action | enabled | elementFromPoint at action centre | body client/scroll |
|---|---|---|---|---|---|---|---|
| Reschedule | 800x572 | 68.6..549.1 | 492.1..524.1 | Review schedule | no (nothing changed yet) | the action | 299/328 |
| EditFailed | 800x572 | 68.6..549.1 | 492.1..524.1 | Confirm schedule | yes | the action | 299/425 |
| EditConflictWithDeltas | 800x572 | 68.6..549.1 | 492.1..524.1 | Review schedule | yes | the action | 299/338 |
| EditConflictTextReplaced | 800x572 | 68.6..549.1 | 492.1..524.1 | Close | yes | the action | 299/488 |
| EditConflict | 800x572 | 68.6..549.1 | 492.1..524.1 | Review schedule | yes | the action | 299/456 |
| EditGone | 800x572 | 68.6..549.1 | 492.1..524.1 | Close | yes | the action | 299/341 |
| Reschedule | 1280x720 | 86.4..691.2 | 634.2..666.2 | Review schedule | no | the action | 423/423 |
| EditFailed | 1280x720 | 86.4..691.2 | 634.2..666.2 | Confirm schedule | yes | the action | 423/425 |
| EditConflictWithDeltas | 1280x720 | 86.4..691.2 | 634.2..666.2 | Review schedule | yes | the action | 423/423 |
| EditConflictTextReplaced | 1280x720 | 86.4..691.2 | 634.2..666.2 | Close | yes | the action | 423/488 |
| EditConflict | 1280x720 | 86.4..691.2 | 634.2..666.2 | Review schedule | yes | the action | 423/456 |
| EditGone | 1280x720 | 86.4..691.2 | 634.2..666.2 | Close | yes | the action | 423/423 |

Identical numbers in both themes for all twelve rows. Bottom gap: 22.9 px at
800x572 and 28.8 px at 1280x720 — the dialog never reaches the viewport edge.

## Per-frame motion (D9/D10)

Sampled on every rAF tick and every mutation, from mount to settle, for all 20
state/size/theme runs. The action row's rect is **constant at every sample**: no
sample in any run has a different top or bottom. Examples (light, 800x572):

```
edit-failed                 raf@261  Review schedule   492.1..524.1  (disabled)
                            raf@295  Review schedule   492.1..524.1
                            raf@619  Confirm schedule  492.1..524.1
edit-conflict-with-deltas   raf@254  Review schedule   492.1..524.1  (disabled)
                            raf@290  Review schedule   492.1..524.1
                            raf@305  Confirm schedule  492.1..524.1
                            raf@332  Review schedule   492.1..524.1
```

That is Review → Confirm (+0 px) and confirm → conflict (+0 px), against 36 px /
92 px / 61.5 px measured in round 2. Idle settled frames are identical — a stable
layout, not an animation.

### Locale width (ru / fr) at 800x572

`conflict_images_added`/`_removed` run 227/219 characters in ru against 111/115 in
en; the four sentences total fr 1056 / ru 1047 against en 802. Measured, light:

| state | locale | alert height | alert inside scroller | body client/scroll | action | action rect | h-overflow |
|---|---|---|---|---|---|---|---|
| EditConflict | ru | 112 | yes | 299/476 | Проверить время | 492.1..524.1 | none |
| EditConflictWithDeltas | ru | 112 | yes | 299/358 | Проверить время | 492.1..524.1 | none |
| EditConflictTextReplaced | fr | 144 | yes | 299/508 | Fermer | 492.1..524.1 | none |
| EditFailed | fr | 65 | yes | 299/485 | Confirmer la planification | 492.1..524.1 | none |

No element in any state is wider than its box (`scrollWidth > clientWidth` on a clipping element: 0 across all 24 runs), the notice sits fully
inside the scroller at settle in every one, and the longer copy costs scroll depth
only — the action sits where it sits in English.

## Gate

- `dom_audit.mjs --channel chrome --viewport 800x572 --sel [role=dialog]` on the
  local static Storybook: **no contrast primary in any post-interaction state**.
  One contrast primary on `Reschedule` (the initial, nothing-changed state):
  "Review schedule" at **2.42:1** light. That is the shared disabled recipe
  (`ink-disabled`) on a genuinely disabled control, unchanged by this PR, and
  WCAG exempt (1.4.3 excludes inactive controls).
- The audit's **overlap** findings (e.g. `"Remove images" overlaps "Review
  schedule" by 46%`) are clipped-box artefacts, not drawn overlaps: it measures
  `getBoundingClientRect()` without ancestor clipping, so a box whose top (477) is
  below the scroller's bottom edge (476.1) is reported against the pinned action
  (492.1). `elementFromPoint` at the action's centre returns the action itself in
  all 20 state/size/theme runs, and every frame shows nothing painted over it.
- `contrast_pairs.py`, values from `styles/themes.generated.css`: the focus ring
  (`--lo-accent`) on `elevated` is **5.51:1** light (`#137742` on `#fefdfa`) and
  **6.34:1** dark (`#38c96a` on `#322D22`).
- `token_audit.py` on `team-bridge-scheduled.tsx`: no anomalies (its single colour
  hit is `#222233` inside comments referencing issue #223).
- `copy_scan.py` on `ui.teamBridge.json` for en, ru, fr: 0 findings.

## D11 — focus after "Use my text instead" (live, not source-only)

Driven through the `browser` tool on the built story
(`iframe.html?id=team-bridge-scheduled--edit-conflict-text-replaced`): a **real
pointer click** on the button, then `document.querySelector(':focus')` is the
restored `textarea` (`value="Release notes and the rollout checklist are ready."`),
and its computed style is `outline-width: 2px; outline-style: solid;
outline-color: rgb(19, 119, 66); outline-offset: 2px`. The refilled field takes
focus and shows the ring.

The browser tool has no key action, so no keyboard-driven frame is claimed and a
tab-through was not simulated. The ring is the app-wide `html :focus-visible` rule
in `styles/index.css`, not a per-component one, and a text field matches
`:focus-visible` however it is focused.

## D12 — the confirm question is below the fold at the minimum window (new, MINOR)

At 800x572 the Review step reveals the confirmation line inside the scroller and
`scrollTop` stays 0, so it lands under the fold:

| viewport | confirm line top..bottom | scroller bottom | visible | hidden |
|---|---|---|---|---|
| 800x572 | 520.7..540.7 | 476.1 | **no** | 64.6 px |
| 1280x720 | 538.5..558.5 | 618.2 | yes | 0 |

The action does become "Confirm schedule", so it is not a dead end; what is out of
sight is the sentence naming the date and time the user is about to commit. Same
family as code R4-01 (a notice arriving while the body is scrolled down).

## Frames

`sheet-*.png` are contact sheets (light 800, dark 800, light 1280, dark 1280,
locales); the `*-<theme>-<size>.png` files are the individual frames at 2x.
