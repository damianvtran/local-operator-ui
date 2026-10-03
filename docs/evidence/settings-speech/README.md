# Settings -> Speech voicing, in the five states the cascade can be in

`Settings/Speech` is the voicing group this branch adds to the settings page. It
answers three questions the registry cannot: WHICH rung of the text-to-speech
cascade would serve this machine, WHY the rungs above it did not, and WHAT to do
when none of them can. Each of those is a different picture, and two of them read
wrong if they are only ever photographed on a configured machine - a cascade that
serves through a STORED provider key with no Radient session at all, against one
that can speak through nothing.

## What produced these frames

Storybook on this branch's own tree (`feat/speech-settings-group`, captured at
`9aab9d7b265`), driven by `scripts/capture-evidence.mjs`:

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

## The tree these frames describe, and what moved under them

The capture above is a **capture-tree citation, not a head citation**, and the
difference is stated here rather than left for a reader to discover:

- the frames were shot from `9aab9d7b265` - `git rev-parse 9aab9d7b265:src` =
  `7c0c609a5314b6c4b9241ccf779cc629c39ca082`;
- `origin/main` moved to `051acc98d50` (#800, the draft slash/composer work) while
  this set was being captured, and this branch folded it. The code side of the
  head this set is reviewed on is therefore the merge commit whose `src` tree is
  `ad1d2304ceaf7b9772fbd34aa41bf4803dd70780`, which is NOT the capture tree.

That is a real gap in the discipline, and the two facts that bound it are the
ones to weigh:

1. what moved between the two trees is 16 files under `src/`, all of them the
   chat/composer work this fold brought in (`features/chat/**`,
   `shared/components/composer/message-input.tsx`,
   `shared/store/canonical-sessions-store.ts`) plus one theme file;
2. **none of them is a file this surface renders**, and the surface's own files
   are byte-identical across the two trees. Re-runnable check:

```
git diff --name-only 9aab9d7b265 <head> -- src | \
  grep -E 'features/settings|shared/lib/speech-gate|shared/desktop-contract|shared/hooks/use-credentials|shared/components/common/error-boundary'
# prints nothing
```

The one file in that list a theme reader would care about,
`shared/themes/palettes/local-operator.ts`, changed **comments only** (36
insertions, 0 deletions, measured with `git diff --numstat`), so the three
palettes photographed here are unchanged in value and no frame's colour moved
with it. The manifest's `head` field names the same capture tree, for the same
reason.

What this set therefore claims: the five states render as these pixels show on
the tree they were captured from, and nothing this surface renders has changed
since. What it does not claim, and cannot: that a re-capture on the reviewed head
would be pixel-identical. That re-capture is a rig decision for the design and UX
rounds, which are dispatched on the reviewed head.

## What each frame shows

Every frame is `1024x<height>` and carries the section in its own ground: the
title `Speech voicing`, the one-line description, the `Speaks through` /
`Availability` pair, the daemon's own reason sentence, the three cascade rungs
with per-rung availability, and the seven registry rows (`Voice gender`, `Tone`,
`Expressiveness`, `Pace`, `Language`, `Accent`, `Delivery instructions`).

- **`radient-pass/`** (752 high) - signed in: `Speaks through: Radient Pass`,
  `Availability: Ready`, reason `Signed in to Radient.`, the Radient rung
  `(available)`, ElevenLabs and OpenAI `(not available)`. No reminder.
- **`stored-provider-key/`** (752) - signed OUT and still servable:
  `Speaks through: ElevenLabs`, `Availability: Ready`, reason `An ElevenLabs API
  key is stored.`, Radient Pass `(not available)` with `Not signed in to
  Radient.`, ElevenLabs `(available)`, OpenAI `(not available)`. **No reminder is
  raised**, which is the claim this state exists for: the reminder follows
  AVAILABILITY, not the account.
- **`nothing-available/`** (821) - `Speaks through: Nothing yet`,
  `Availability: No provider`, the daemon's full reason sentence, all three rungs
  `(not available)`, and the warning callout `Nothing can speak aloud yet: run
  `/login radient` to sign in`. This frame is the inert state AND its route
  pointer; there is no credential field anywhere in the group.
- **`backend-older/`** (640) - a daemon that does not advertise
  `features.tts`: title, description, and the version-gap callout `This backend
  does not serve the voicing surface. Update the backend to tune how the
  assistant sounds.` **No rows and no cascade**, because the group does not fire
  a read at a route that is not there. The ground below the callout is empty by
  construction; this is the one state with no rows to show.
- **`unreadable/`** (640) - the availability read failed: `Checking whether this
  machine can speak aloud...` beside the seven rows. It claims neither "ready"
  nor "no provider", which is the arm a spinner-plus-rows has to be distinguished
  from the two above.

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
the content's: 752 for the two servable states, 821 for the one carrying the
callout, 640 for the two that stop at a height floor. The section column is
`max-w-3xl` (768px) centred in 1024, which is what holds the row controls at
x=128..896 in every frame; the empty band below `backend-older`'s callout is
`min-h-screen` on the story wrapper, not a clipped element.
