# Team Bridge avatars at retina density

Operator report (2026-11-03): "The avatar images show up blurry in team bridge,
can you make sure they're sharp at their sizes on retina displays".

## Cause

The hub stores two square derivatives per picture, 64 px and 256 px. Plates
picked one by CSS size alone (`size <= 64 ? 64 : 256`), so at 2x a 36 CSS px
message row drew the 64 px file across 72 device px, and the 64 CSS px profile
card drew it across 128. The browser upscaled the file, which is the blur.
`pickAvatarVariant(cssPx, dpr)` now picks the smallest variant covering
`ceil(cssPx * dpr)`.

## Measured (headless Chrome, deviceScaleFactor 2, Storybook)

`coverage = naturalWidth / (clientWidth x DPR)`. Below 1 means the file is
upscaled. Source: `probe-before.json` (origin/main `2ff3187db64`) and
`probe-after.json` (this branch), written by `harness/shoot.mjs`.

| Surface (story) | CSS px | Before: file / device px / coverage | After: file / device px / coverage |
|---|---|---|---|
| Message row avatar, person + agent (`team-bridge-page--agent-own-picture-messages`) | 36 | 64 / 72 / **0.889** | 256 / 72 / 3.556 |
| Profile hover card, agent (`…--agent-own-picture-profile-card`) | 64 | 64 / 128 / **0.5** | 256 / 128 / 2.0 |
| Rail rows (same story) | 20 | 64 / 40 / 1.6 | 64 / 40 / 1.6 (unchanged; 64 already covers it) |
| Sidebar account row (`navigation-user-profile--account-photo`) | 28 | 64 / 56 / 1.143 | 64 / 56 / 1.143 (unchanged) |
| Chat header agent picture (`features-agents-agent-avatar--header-geometry`) | 18 (story scale; `size-5` = 20 in the app) | 512 / 36 / 14.2 | 64 / 36 / 1.778 |
| Chat sidebar row mark (`…--chat-row-statuses`) | 14 (story frame; `size-4`) | 512 / 28 / 18.3 | 64 / 28 / 2.286 |
| Agents sidebar row (`…--roster-states`) | 30 (story frame; `size-8`) | 512 / 60 / 8.53 | 64 / 60 / 1.067 |
| Agents page summary portrait (`…--summary-portrait-populated`) | 80 | 512 / 160 / 3.2 | 256 / 160 / 1.6 |

Agent mark (the corner dog-ear, outer / inner CSS px):

| Plate | Before | After |
|---|---|---|
| 20 | 8 / 7 | 8 / 7 |
| 36 | **11.516 / 10.516** | 12 / 11 |
| 64 | **20.469 / 19.469** | 20 / 19 |

Relay reads recorded by the rig's media wrapper:

- Before, every Team Bridge surface asked only `:64`.
- After, the 36 and 64 plates ask `:256`. The 20 px rail plates still ask `:64`,
  so right-sizing holds. The variant is the cache key, so plates on the same
  variant share one read.

Local agent pictures (the last four rows) come from core's
`GET /v1/agents/{id}/avatar`. With core's `agent_avatar_sizes` feature
(local-operator #3381), the renderer asks for `?size=` = the smallest of
64/128/256 covering `ceil(css x DPR)`. Without the feature it sends no size and
core serves the 512 px original, exactly as before.

- After, with the feature (`probe-after.json`, stories opened with
  `agentAvatarSizes=1`): reads were `agent.avatar:64` for the header, chat row
  and agents sidebar, and `agent.avatar:256` for the portrait. Every one still
  has coverage >= 1.
- The flag-off control (`probe-after-noflag.json`, same head, no capability)
  reads `agent.avatar:512` everywhere, the same as before.
- The editor's crop preview passes no CSS size, so it always reads the
  original.

The first four rows' "CSS px" are the image boxes as the stories draw them. The
story frames' borders and scales make some of them differ from the app's
`size-*` class by 1-2 px; `scripts/avatar-retina.test.mjs` pins the app's real
sizes (16, 20, 32, 80) at 1x, 2x and 3x.

## Fixture

There are no real pictures in this evidence. `harness/shoot.mjs` renders a
synthetic 512 px test pattern (1 px line pairs, rings, text) and answers each
sized relay read with that pattern resized to the hub's real derivative size
(64 or 256, JPEG q85). The pattern is a detailed image, so an upscale shows. The
shipped stories answer every size with one asset, and that would hide the
variant choice.

## Frames

Frames are rig output. This repository refuses committed frames
(`scripts/check-evidence-structure.mjs`), so they are hosted on the
`evidence/team-bridge-avatar-retina` branch under
`docs/pr-evidence/team-bridge-avatar-retina/`:

- `before/` and `after/`: full 2x frames, plus a 4x nearest-neighbour crop of
  the plate each surface is named for.
- `after-noflag/`: the flag-off control frames.
- `profile-card-before-after-zoom4x.png`,
  `message-row-before-after-zoom4x.png` and
  `agents-page-portrait-before-after-zoom4x.png`: the side-by-side pairs. The
  portrait pair is equally sharp: 256 still covers 160 device px, at about
  half the decoded pixels.

## Reproduce

```
# BEFORE: run from a detached worktree at the merge base (2ff3187db64), with this harness copied in
node scripts/with-storybook.mjs -- sh -c \
  'node docs/evidence/team-bridge-avatar-retina/harness/shoot.mjs "$STORYBOOK_ORIGIN" docs/evidence-frames/team-bridge-avatar-retina/before before --agent-sizes'
```

One command boots Storybook, uses a private `--headless=new` Chrome
(`withMockKeychain`), captures, and reaps both by exact pid and process group.

## Not covered here

- OS notification banners. The composite size moved 64 → 256. Unit tests cover
  the request size, and core's own `compose` was measured, but no banner frame
  was captured: that needs a real notification centre.
- Mobile web and the mobile app. They right-size against the same core
  feature in their own repositories (#3381 carries the mobile web half).
