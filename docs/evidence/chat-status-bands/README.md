# `chat-status-bands` — one notice family, before and after

Two still sets over ONE component family: the chat pane's status strip and the
backend compatibility banner, whose shared band grammar, severity doctrine and
co-render rule are the change these frames are about. Shot through the
repository's own Storybook rig (`scripts/capture-evidence.mjs`) against the
worktree on `fix/banner-warn-error-consistency-7e4c`, both brand palettes
(`localOperatorDark`, `localOperatorLight`), with the frame sizes the states
need rather than one size for all (860x260 for the strip's band states,
640x340 for `narrow`, 860x320 for the composed stacks, 860x240 for the banner's
own states — tight viewports for the uniformity ceiling's sake).
Neither set is a sweep capture: the sweep's own frames for the new story ids
live under `chat-chat-status-strip/` and `chat-backend-compatibility-banner/`
at all twelve themes, and `docs/evidence/manifest.json` declares both sets here
as `supplementary`.

## What this pair is for

The operator's report, quoted in the PR, is a screenshot with TWO bands over one
incident: a red strip saying *"The running server refused this app's credential"*
and, three pixels above it, an amber banner saying *"The local operator server
was replaced while this app was running"* — one refusal, two sentences, two
severities, because the strip's row 1 was gated on `pairing.available === false`
(which is five causes) while the banner stated the actual one. The after set is
the same states with the same facts, one voice each; the composed stacks are the
direct measurement of the fix.

## `before/` — the pre-change head

Shot from the worktree at base **`44c7f8fd76`** (2026-09-26), BEFORE any `src/`
edit landed, so these frames are of the code `main` carries. One qualification,
stated because a reader of the diff will notice it: the two pill states
(`dismissed`, and the `before` half of the warning pill) render their transcript
context — two seeded lines under the pill — and that scaffolding was added to
`chat-status-strip.stories.tsx` before this first shot. The capture rig's
element floor (`storyDrew`) rejects a story that draws only a 24px pill
(measured: five own elements against a floor of seven, and a sixty-second fail),
and adding the scaffolding first keeps the before/after pair differing by the
component change ALONE. The component under the pill is the pre-change one in
both sets.

| file | answers |
| --- | --- |
| `operator-report.png` | **THE REPORT'S OWN BEFORE**: the operator's crop exactly as it reached the design lane (`.../scratchpad/main-recon/operator-screenshot.png`), carried here so the incident's original frame sits beside the pair it is about. Two full-bleed bands over one incident, the strip red and the banner amber. |
| `unreachable/`, `refused-credential/`, `degraded/`, `internet-offline/`, `retrying/`, `retry-outcome/` | the strip's six band states as shipped: wash-only inset band, `AlertTriangle` for danger and `WifiOff` for warning, a `secondary` bordered Retry |
| `dismissed/` | the danger pill (the ONLY state whose pixels the change keeps: the pill is unchanged by design, and this frame is the control that proves it) |

## `after/` — the branch head that ships this commit

Same states, plus the new ones, at both brand palettes. The `src`/`scripts`
delta these frames depict is the fix commit **`81fc6aac8`** PLUS review round 1's
remediation (**`85dbd0c839`**, this directory's shipping commit): the `after/`
frames were RE-SHOT on the remediated tree with the same rig, and the states the
remediation's pixels did not move (`dismissed`, the pill - byte-identical, which
is the control that says the pill is untouched by design) were left as first
shot. The action column moved to the band's trailing edge in this
round (agent review MINOR-2): on the 860px `composed-refused` frame the
primary's fill bbox moved from x709-755 to x744-790, its action group's ink now
ending at x814. `refreshedStories`/`partialCapture` in the manifest carry the
same record.

| file | answers |
| --- | --- |
| the same seven states | the band now `Alert` + `NOTICE_BAND`: inset rounded band with a `-border` edge, `CircleAlert` for danger and `TriangleAlert` for warning (one glyph per severity, both surfaces), a filled `primary` Retry, at most one primary per band |
| `narrow/` | the refused band at 640px, where the cause-gated sentence wraps to two lines — the geometry floor the wide states cannot show |
| `dismissed-warning/` | the warning pill (amber dot), the severity's last legible carrier once the wash is gone |
| `composed-refused/` | **one incident, one band**: the strip's refusal, with the banner YIELDING (D29's arm, `bannerYieldsToStrip`) — the banner's contribution is absent, which is the fix |
| `composed-successor/` | the strip silent for a successor (row-1 cause gate; the unreachable row retires with it), the banner the one voice |
| `composed-degraded-successor/` | the BLESSED two-band pair: a degraded connection beside a pairing cause is two facts, so two warning bands; this frame is what keeps a later change from collapsing it silently |
| `composed-server-gone/` | the server gone with no pairing cause and no payload: ONE band, the strip's, and the banner yields its "did not answer" sentence to it (§ 2.3's `!answered` arm) |
| `successor/`, `governed-elsewhere/`, `pre-handshake/`, `credential-refused/`, `unpaired/`, `unanswered-probe/`, `update-failed/`, `double-control/` | the banner's own states, one per cause plus the probe, update-failure and double-control shapes — the first frames this surface has had at all |

## Mount sites, verified rather than assumed

`git grep` at this branch's head: **`BackendCompatibilityBanner` mounts in
`chat-content.tsx` only** (`:145`, plus the import at `:41`); the strip mounts
from the same file (`:1418`). The design note's QA row that speaks of a
`/settings` banner state is conditional on a mount that does not exist on this
head: the banner is drawn inside the conversation pane beside the strip, so a
`/settings` route shows NEITHER surface, and the state a `/settings` reader
gets is no banner at all — the same rule the sidebar's stand-down (R11) already
reads. No mount was added for it; this paragraph is the record that the row was
checked rather than skipped.

## Numbers, and the caveat that goes with them

Every contrast figure this change asserts — the band borders' 3:1 floors, the
ink and `inkMuted` readings on both washes, the remedy's fill against them — is
re-derived from the PALETTES by `scripts/contrast-contract.mjs`, not read off
these stills. At this head the contract holds at **28,998 assertions across 59
palettes, 0 exceptions consulted**. The stills are pixels of one app build in
one browser at one device pixel ratio; a number read off them would be a
measurement of WebP compression, and this repository's evidence rule is the
other direction: the frames show the symptom, the palette space shows the
cause. The PR's figures name their palettes (worst cases), and the contract
rows are cited by name (`status band (warning)`, `status band (danger)`, the
two detail-line rows, `primary remedy on the warning wash`).

## How the frames were taken

```sh
cd <worktree>
node node_modules/storybook/bin/index.cjs dev -p 6141 --ci --disable-telemetry
# before (at 44c7f8fd76, before any src edit):
node scripts/capture-evidence.mjs http://localhost:6141 \
  --only=chat-chat-status-strip --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=30000
# after (this branch's head):
node scripts/capture-evidence.mjs http://localhost:6141 \
  --only=chat-chat-status-strip --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=30000
node scripts/capture-evidence.mjs http://localhost:6141 \
  --only=chat-backend-compatibility-banner \
  --themes=localOperatorDark,localOperatorLight --allow-backend --theme-settle-ms=30000
```

The twelve-theme frames for the fourteen newly registered story ids were taken
by the same rig (the same two `--only` selectors, default theme list), which is
also what moves `docs/evidence/manifest.json`'s `frames`/`surfaces` in the
commit that carries this set. `--allow-backend` is not optional in this
checkout: the operator's own daemon answers on `:1111` and the rig refuses to
shoot while one is up unless the run says it owns its backend story (none of
these states reads a backend: they are prop states).

The rail states this set does NOT claim keep their own records: the live,
daemon-driven re-shoot of `docs/evidence/chat-connection-live/` ran as part of
this change rather than being deferred - see `band-pass/` in that directory for
the four states and the run's `ALL CHECKS PASSED` record - and QA drives live
states independently on the PR.
