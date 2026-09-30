# Update indicator and reload picker — round 1 frames

Frames for the drain cluster **#672** (quiet update indicator + per-segment
following) and **#679** (the reload picker closes on success).

This directory is on its own branch (`pr-evidence-update-reload-ux-0929`) and is
**not part of `main`**. The branch is an orphan, mirroring
`pr-evidence-hub-update-indicators-0929`: one top-level directory of frames, no
shared history with the product tree.

## Naming and the two trees

`<area>--<state>--<theme>.png`, under `before/` and `after/`, both caught at
1280x800, dpr 1, headless.

- **`before/`** is the **base tree**, `origin/main` **`89684a3f20`** — main as it
  stood when these frames were shot. Main has moved since (`073164505e`, #572);
  the label is that base, not current main.
- **`after/`** is the **drain head**, **`300309fd8a`** — the tree this PR ships,
  captured at that revision with a clean working tree, so the label names the
  bytes exactly.

Both sets come from Storybook driven over raw CDP by a private headless Chromium
(`--use-mock-keychain`, scratch `--user-data-dir`, reaped on exit) — the same
discipline `scripts/capture-evidence.mjs` uses. The stories are the shipped
components; nothing here is a hand-drawn mock of the change.

The two in-flight states (`downloaded`, `install-in-flight`) are **byte-identical
in both themes across the two trees**, which is the claim that #672's change left
them alone: those are states a user entered, and they are deliberately not gated.

### Why the after set was re-taken, and what moved

The first after take was made from a working tree that carried the indicator
stories' wrapper fix but had **not committed it** — the fix removed a
`bg-surface` block that reads as a reserved row in exactly the two states whose
claim is that there is nothing there (`AtRest`, `BelowFollowedSegment`). Its only
committed home is `300309fd8a`, so no published revision described the bytes the
frames were of while the old label named `d2a8ab3eca`. Rather than annotate a
label, the whole after set was re-taken at the clean head.

25 of the 26 frames came back **byte-identical** to the first take — which is
itself the check that the earlier take really was of the fixed wrapper. The frame
that changed for another reason is
`common-updatenotification--install-in-flight--localOperatorLight.png`: in the
first take it was a **Storybook error page** (a transient `Failed to fetch
dynamically imported module` in the preview), which a screenshot cannot tell from
a story. The rig now asks the page what it rendered and refuses such a frame
before the shot is taken, and the frame here is the real panel. That is also why
every frame is screened at capture time rather than trusted: an error page in a
set is worse than a missing frame, because it looks like evidence.

## What the frames are of

| Story | Before | After |
| --- | --- | --- |
| `common-updatenotification--update-available` | a picture of the offer CARD, as the app painted it for its own periodic news | the same card. NOTE: this story draws its OWN copy of the card rather than mounting the shipped component, so its frame is identical in both sets and says nothing about WHEN the card is raised — the reachability rule is what the section story below shows |
| `common-updatequietindicator--at-rest` | — | nothing at all: no row, no height, no pixels |
| `common-updatequietindicator--app-update` | — | the quiet band, one surface |
| `common-updatequietindicator--both-surfaces` | — | both surfaces, in the order the band lists them |
| `common-updatequietindicator--below-followed-segment` | — | nothing: a patch release to a surface following majors only |
| `common-updatequietindicator--long-version` | — | a long version string, which does not make the band taller |
| `common-updatequietindicator--drawing-both-controls` | — | the band's two controls, gate bypassed |
| `settings-updatefollowing--default` | — | the new control, shipped default |
| `settings-updatefollowing--mixed-segments` | — | app follows majors, server follows every release |
| `settings-updatefollowing--majors-only` | — | the quietest card the control forms |
| `settings-app-updates-section--server-update-offered` | the section with no notification preference, the card over its content | the same section with the preference. The card is up because this story **presses the real Check-for-updates control** — an explicit check opens the detail, which is #672's loud path; it is not the app's own periodic news |
| `common-updatenotification--downloaded` | ready to install | unchanged — the two frames are byte-identical |
| `common-updatenotification--install-in-flight` | install running | unchanged — the two frames are byte-identical |

## States that need the LIVE app (for QA / the UX walk)

- **The reload picker's two frames (#679).** Storybook has no desktop bridge, so
  a *successful* reload cannot be performed there: `desktopResult` reaches
  `window.api.desktop.request`, and a stubbed bridge would be photographing the
  stub. The pair the issue asks for — **dialog open with its receipt** (before)
  and **dialog gone with the receipt as a toast** (after) — is therefore a
  live-app capture. The behaviour itself is proven, not asserted: the shipped
  picker is driven through its own submit control in
  `scripts/reload-picker-close.test.mjs`, which fails on the old shape.
- **The band inside the real shell.** The indicator frames put the band on the
  shell's own ground at the bottom edge; the live app is what shows it under the
  sidebar and a real transcript.
- **A hover on the band** (`:hover` is browser state, not story state).

## What a frame cannot say

Nothing here is a contrast or spacing measurement. `pnpm check-themes` holds the
floors (`accent` ink on `surface`, the focus outline), and
`scripts/update-indicator-segments.test.mjs` holds the gate.
