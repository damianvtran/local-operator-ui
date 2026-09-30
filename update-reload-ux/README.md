# Update indicator and reload picker — frames (rounds 1–3)

Frames for the drain cluster **#672** (quiet update indicator + per-segment
following) and **#679** (the reload picker closes on success), plus the
remediation takes of 2026-09-30.

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
- **`after/`** is the take re-shot for the round-2 and round-3 remediations — of
  **`adbd67c793`** (the round-3 commit), whose captured paths the fold that
  followed (`9a6924d780`) leaves byte-unchanged. Frames whose story did not move are
  byte-identical to the earlier takes; the states each round changed are re-taken
  and listed below, and the ONE frame that is deliberately not from the latest rig
  is called out under round 3 (`server-update-offered`, six pixels away from what
  the same rig draws at this head).

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

### The round-1 remediation re-take (2026-09-30)

The remediation commit `2664aebe9e` changes what these stories DRAW, so their
`after/` frames were re-taken at the new head `3d307e2e7a`, both themes:

- the band's visible text now states availability — `Application update 0.30.1
  available` / `Server update 0.55.10 available` — instead of naming only a
  version (`app-update`, `both-surfaces`);
- the live region is mounted EMPTY at rest and the control is drawn into it, so
  `at-rest` is a picture of an element that exists and paints nothing: measured
  with sharp as **1 distinct colour across all 1,024,000 px, both themes**, while
  the band is still **28 px** (rows 148..175) in `app-update` and `both-surfaces`;
- the settings block gained a real heading step and a re-worded sentence, and its
  rows say `Application updates` (`updatefollowing--default`,
  `updatefollowing--majors-only`, whose label is now `Breaking changes only`);
- the shipped release card gained its close control (review U1), visible in
  `settings-app-updates-section--server-update-offered`.

NEW: `settings-app-updates-section--followed-control-visible` is design D1's
frame — the section at rest, no press, so both select triggers are readable
instead of sitting under the fixed card.

### The round-3 re-take (2026-09-30)

Design round 2 left three frames in the set showing the PRE-remediation copy (its
D11): `long-version`, `drawing-both-controls` and `updatefollowing--mixed-segments`
were byte-identical to the round-1 take, because the earlier re-take had been
bounded to the states that round needed. They are re-shot here at the head, both
themes:

- `long-version` now reads `Application update 2026.10.1-nightly.20261112
  available`;
- `drawing-both-controls` reads `Application update 0.30.1 available` and
  `Server update 0.55.10 available`;
- `mixed-segments` carries the re-worded sentence and the current row labels.

NEW: **`settings-updatefollowing--minors-only`** is the MIDDLE option — `Minor and
major only` / `Skips patch releases.` — which appeared in **no frame of either
take**, so one of the three strings this control forms had never been looked at as
rendered. It is a new story in `update-following.stories.tsx`, because there was no
state to retarget.

Two more folders came out of the same round:

- **`d5-focus/`** — design D5's `:focus-visible` pair, taken with real Tab key
events and the window's bottom edge in frame, both themes, after the
`outline-offset-0!` fix. Round 2's framing was "if it shows three sides, a recorded
cosmetic and a one-liner"; it now shows four, with the bottom stroke painted at the
window's own last row. The folder carries its own README, the profiles and the
geometry.
- **`u12-scroll/`** — review U12's measurement: the card scrolled to its end with
the close control's y read before and after (`24 -> 24`; it was `24 -> -20`, out of
view, on the old shape). Same README + `probe.json` convention.

**How the re-take was checked against the rest of the set, because a re-take that
silently redraws a different story is worse than no re-take.** The same rig was
pointed at a build of the PRE-remediation commit and at a build of this head: **26
of the 28 pre-existing frames came back byte-identical between the two builds**, so
this round's code is inert for them. Comparing the same rig's pre-remediation take
with the frames already in `after/` gives **20 identical, 8 different**, and the 8
are exactly the three stories D11 named plus `server-update-offered` twice.

`server-update-offered` is therefore the one frame in `after/` that is NOT from
this round's rig, deliberately: the two takes differ by **6 pixels**, every one of
them at the close control's glyph, and by a `:focus-visible` ring the earlier take
draws around the card that this rig does not draw at the same head — verified as
the rig's and not the code's on a build of the pre-remediation commit, which behaves
the same way. The card's box, radius, content and at-rest geometry are unchanged.

**Reproducibility of that frame (design D13).** The head's own take of
`server-update-offered` is published beside the set, in **`head-take/`**, with the
single-story rig that made it and a README stating what it can and cannot be compared
to (a different rig, so not pixel-comparable with `after/`). `after/` keeps the
round-2 take design accepted as the shipped frame.

### Frames still owed, and why

- **The band under a real transcript and a real sidebar, a `:hover` on the band,
  and the reload picker's own pair (#679)** — see "States that need the LIVE app"
  below. Unchanged from round 1.
- **`common-updatenotification--update-available`.** Not re-taken BY
  CONSTRUCTION: that story draws its own copy of the card rather than mounting the
  shipped component (the caveat in the table below), so it cannot show the close
  control the remediation added. Its bytes and its claim are unchanged.
- **The reload picker pair (#679)** and **the live shell** — see below.

### The deferred state

After the card's "Update later" the band is **byte-identical to `at-rest`**: the
deferral records the version and clears the surface, so the quiet state is the
absence of the row and there is no residue to photograph. The capture is the
suite's own case — "dismissing the card also takes the band away"
(`scripts/update-indicator-segments.test.mjs`) — which asserts that the band's
item is gone AND that the deferral store holds the version, rather than a second
frame that would be the same one-colour image under another name.

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
| `settings-updatefollowing--default` | — | the new control, shipped default (re-taken: heading step, sentence, `Application updates`, `Every release`) |
| `settings-app-updates-section--followed-control-visible` | — | NEW (design D1): the section at rest with no press, so both select triggers are readable instead of under the card |
| `settings-updatefollowing--mixed-segments` | — | app follows majors, server follows every release (re-taken at round 3: the sentence and the row labels) |
| `settings-updatefollowing--majors-only` | — | the quietest card the control forms |
| `settings-updatefollowing--minors-only` | — | NEW (design D11): the MIDDLE option's label, which no earlier frame carried |
| `d5-focus/` | — | NEW (design D5): the band's `:focus-visible` ring, shipped placement and the shell's own box, by real Tab keys |
| `u12-scroll/` | — | NEW (review U12): the card scrolled to its end, with the close control reachable |
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

Every frame in `after/` taken for the remediation was re-taken with the same
Storybook build and the same rig shape (headless Chromium, `--use-mock-keychain`,
a private profile, 1280x800 at dpr 1, reaped by pid), and each was checked by
reading its own pixels - `at-rest` is one colour, the band rows are the same 28 px,
the settings block is the copy the round asked for - rather than by trusting that
the story had rendered.

Nothing here is a contrast or spacing measurement. `pnpm check-themes` holds the
floors (`accent` ink on `surface`, the focus outline), and
`scripts/update-indicator-segments.test.mjs` holds the gate.
