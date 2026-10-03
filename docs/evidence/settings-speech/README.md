# Settings -> Speech voicing, in the five states the cascade can be in

`Settings/Speech` is the voicing group this branch adds to the settings page. It
answers three questions the registry cannot: WHICH rung of the text-to-speech
cascade would serve this machine, WHY the rungs above it did not, and WHAT to do
when none of them can. Each of those is a different picture, and two of them read
wrong if they are only ever photographed on a configured machine - a cascade that
serves through a STORED provider key with no Radient session at all, against one
that can speak through nothing.

## What produced these frames

Storybook on this branch's own tree (`feat/speech-settings-group`), driven by
`scripts/capture-evidence.mjs`, with the rig's own recipe: `reactDocgen: false`
in this disposable checkout (this set's frames are stories, never docs pages, so
the prop tables are pure build cost), one Storybook on the set's own port, and
`--only=settings-speech` so no other surface is swept.

```
node node_modules/storybook/bin/index.cjs dev -p 6017 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=settings-speech \
  --themes=localOperatorDark,localOperatorLight,highContrastLight \
  --allow-backend --theme-settle-ms=120000
```

The five states live on ONE story, so each names its own `dir` and each directory
below is one state. The story's transport is stubbed
(`window.api.desktop.request`, `window.api.backend`), it never contacts a
backend, and `--allow-backend` is stated because the operator's own daemon
answers on `:1111` and is not this run's subject. `--theme-settle-ms=120000`
because the fleet's load makes the shipped 10s theme budget a guess.

**Themes, named as the registry ids.** `localOperatorDark` and
`localOperatorLight` are the two brand modes and the spine of every swept set;
`highContrastLight` is the registry's one dedicated high-contrast palette, chosen
as the third so the check is not two flavours of the same ramp. The set is three
of the fifty-nine palettes by deliberate narrowing (a full sweep multiplies by
twelve); the other fifty-six are reachable with `--themes=<a,b>` under `--only`.

## The tree these frames describe

The frames were shot from `c20c74ff011` - `git rev-parse c20c74ff011:src` =
`fc6358c87df9844990cd47114896fb3cb4fba3f8` - and that is a **capture-tree**
citation rather than a head-tree one: two commits after it move `src/`, so
`git rev-parse HEAD:src` = `c2e8081d40433f1447f32d45f11620a2fdb13939` is a
different tree. `git diff --name-only c20c74ff011 <head> -- src` names the
**12** files, and the two facts that bound the gap are measured rather than
asserted:

1. **Two of them are this branch's own, and neither changes what these five
   states render.** `speech-section.tsx` carries a comment correction (its diff
   filtered to non-comment lines is empty) and `speech-section.stories.tsx`
   carries the shutter tooling - the settle sentences the story waits on are
   unchanged, which is why no frame moved: the fifteen WebP blobs are
   byte-identical across both commits (the sorted `git ls-tree -r <sha>
   docs/evidence/settings-speech | grep webp` hash set, at `8e36bad39a3` and at
   the head this set ships in).
2. **The other ten are `origin/main`'s 0.31.34 release**, folded in after the
   capture - the chat, projects and mini-view work plus
   `shared/desktop-contract.ts`. Re-runnable check that nothing else in this
   surface's graph moved:

```
git diff --name-only c20c74ff011 <head> -- src | \
  grep -E 'features/settings|shared/lib/speech-gate|shared/hooks/use-credentials|shared/components/common/error-boundary'
# the branch's own two files above, and nothing else
```

WHY THEY WERE RE-SHOT, and what the first set had wrong. `unreadable/`
photographed the panel's PENDING arm - a retrying read - rather than the failed
read the state is named for: the rig's shutter fires on a rendered-element count,
this panel's pending arm already carries the seven rows, and the story armed no
latch, so the frame landed inside the one retry `retryDesktopQuery` allows. The
story also mounted the section at `max-w-3xl`, a column the settings page never
renders. Both are fixed in the story - the latch is held until the sentence the
state settles on is on screen, and the column is the page's own `max-w-4xl` -
which moves the story file, which is why the WHOLE set was re-taken rather than
one directory: a set whose states come from two story revisions is worse than
either. The first set's tree gap (shot at `9aab9d7b265`, then folded onto
`051acc98d50`) is closed for the tree this set was captured at - the manifest's
`head` field names `c20c74ff011` - and the later gap each fold opens is bounded
above rather than argued away.

## What each frame shows

Every frame is `1024x<height>` and carries the section in its own ground: the
title `Speech voicing`, the one-line description, the `Speaks through` /
`Availability` pair, the daemon's own reason sentence, the three cascade rungs
with per-rung availability, and the seven registry rows (`Voice gender`, `Tone`,
`Expressiveness`, `Pace`, `Language`, `Accent`, `Delivery instructions`). In every
frame the rung that would SERVE takes the stronger ink and the others the muted
one - a **colour** step, not a weight one, and one with a stated limit: it is
visible in all three photographed palettes, but dE00(`ink`, `ink-muted`) falls to
2.01 in `catppuccinFrappe` and 8 of the 59 palettes sit at or under 2.3, where the
serving rung's name is not distinguishable by brightness (design review round 2,
D6). What carries the state in every palette is the text - `(available)` /
`(not available)` - and every ink clears its own floor everywhere; a weight or a
mark on the serving name is recorded as an enhancement rather than taken here,
because it would move the pixels of the two servable states and cost a re-shoot.

- **`radient-pass/`** (720 high) - signed in: `Speaks through: Radient Pass`,
  `Availability: Ready`, the rung line `Radient Pass (available)` carrying
  `Signed in to Radient.`, then ElevenLabs and OpenAI `(not available)`. The
  resolution's sentence appears ONCE, on that rung's own line - rendering it above
  the list as well printed one sentence twice (design review round 1, D2). No
  reminder.
- **`stored-provider-key/`** (720) - signed OUT and still servable:
  `Speaks through: ElevenLabs`, `Availability: Ready`, Radient Pass
  `(not available)` with `Not signed in to Radient.`, ElevenLabs `(available)`
  carrying `An ElevenLabs API key is stored.`, OpenAI `(not available)`. **No
  reminder is raised**, which is the claim this state exists for: the reminder
  follows AVAILABILITY, not the account.
- **`nothing-available/`** (821) - `Speaks through: Nothing yet`,
  `Availability: No provider`, the daemon's full reason sentence (the one line no
  rung carries, which is why D2's de-duplication keeps it), all three rungs
  `(not available)`, and the warning callout `Nothing can speak aloud yet: run
  /login radient to sign in, or store a provider key in the Model providers
  section`. The callout names BOTH remedies and prints the command bare - the
  backticks rendered as characters around it in the first set, and the key route
  was named nowhere (design review round 1, D5; UX review round 1, U3). This frame
  is the inert state AND its route pointer; there is no credential field anywhere
  in the group.
- **`backend-older/`** (640) - a daemon that does not advertise
  `features.tts`: title, description, and the version-gap callout `This backend
  does not serve the voicing surface. Update the backend to tune how the
  assistant sounds.` **No rows and no cascade**, because the group does not fire
  a read at a route that is not there. The ground below the callout is empty by
  construction; this is the one state with no rows to show.
- **`unreadable/`** (640) - the availability read FAILED, settled: the warning
  band `Speech availability could not be read. The resolver could not read the
  credential store.` with the `Retry` button (the same affordance the registry
  read's failure carries - the first set's frame photographed the pending arm
  here instead, and the arm had no way out at all: UX review round 1, U2), then
  the seven rows. It claims neither "ready" nor "no provider", and the retry
  window is not a state - which is the distinction this frame had to be re-shot
  to carry.

Each is committed in all three themes; the theme is the file name.

## The before half of the pair: NOT CAPTURED, and why

The design round asked for a base-side frame of the settings surface at
`origin/main`. **It cannot be produced by this rig on either tree, and the
committed page frame it would have to be compared against is itself empty.**
Two measurements, both taken in this pass:

1. `shell-app-shell--settings` does not render. Its story frame draws
   `<SidebarNavigation />` directly, and the sidebar now calls `useSidebarFrame`,
   which throws `useSidebarFrame: the sidebar must be rendered inside ChatLayout
   (app.tsx)` (`chat-layout.tsx:302`, added by `feat(chat): one sidebar` on
   2026-09-24). The rig refuses a frame over Storybook's error display, and that
   row is still in `STORIES` where it has always been, so a full sweep dies at
   that story - the row this pass would have added for the pair's after half was
   dropped rather than committed to fail.
2. Composing the page the way `app.tsx` does instead - `<ChatLayout
   sidebar={<SidebarNavigation />} content={<SettingsPage />} />`, a temporary
   patch in this pass's disposable worktrees, never committed - gets past the
   throw and then holds: `SettingsPage` never passes its own early return under
   the story's fixture, so the section marker
   (`[data-tour-tag="settings-general-section"]`) never appears and the rig's
   readiness probe times out at its 60s bound
   (`{"loading":false,"pending":true,"counted":122}`).

The consequence for the record: `docs/evidence/shell-app-shell/settings/` is a
rail and an empty ground with Storybook's spinner - it was captured on
2026-09-18, before the sidebar rework, and it photographs no settings content on
either tree. There is no honest before/after page pair until that story is
repaired; any frame filed today as "main's settings page" would be a caption the
pixels do not carry. That is a finding for the PR, not a gap in this set.

## Geometry

The viewport is grown by the rig to the rendered height (`scrollHeight`), so the
`640` in the `STORIES` row is a floor rather than a crop, and the frame height is
the content's: 720 for the two servable states, 821 for the one carrying the
callout, 640 for the two that stop at a height floor. The section column is
`max-w-4xl` (896px) centred in 1024 - the page's own content column, which is what
puts every row separator and control edge at x=63..960 in these frames; the first
set mounted `max-w-3xl` and measured x=128..896, a width the product never
renders. The empty band below `backend-older`'s callout is `min-h-screen` on the
story wrapper, not a clipped element. The `nothing-available` callout measures
898x56 at y320..375 (56 of it the wash fill) and the `unreadable` warning band
measures 898/899 wide and 64 tall at y88..151 (56 of that the wash fill, y93..148)
- the 8px its outer envelope gains over the callout's is the `Retry` row.
