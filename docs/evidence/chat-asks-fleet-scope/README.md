# The fleet ask scope: the rail's count and the panel over another conversation

> **SUPERSEDED ENTRY POINT (2026-10-05, PR #835).** The rail's `All asks` row these
> frames photograph is gone: the entry point moved into the conversation header's own
> action cluster, opening this same fleet pane at the top level (and a session's own
> queue inside one), and the door is now marked with
> `ASK_HEADER_ITEM_SELECTOR` (`[data-tour-tag="ask-pane-trigger"]`) rather than the
> deleted `ASK_FLEET_ITEM_SELECTOR`. The frames below still show the row they were
> taken from - a caption they do not carry would be worse than a stale one - so read
> them as the record of that state, and the current pair on the pull request as the
> record of this one.

Two frames of the shipped renderer, from the story that draws the real
`ChatLayout`, the real `SidebarNavigation` (its real `Asks` row and badge) and the
real `FleetAskDrawer`, at the app's own 1280x720. They exist because the round-1
reviews found the fleet scope's own frames nowhere on the pull request (agent
review F3) — a claim about a surface with no picture of it.

Captured with the repository's own rig, narrowed to this surface, on one theme:

```
NODE_OPTIONS=--max-old-space-size=2048 timeout 420 \
  node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-asks-fleet-scope --themes=localOperatorDark --allow-backend
```

Storybook for that origin, bounded and reaped by hand afterwards:

```
NODE_OPTIONS=--max-old-space-size=1536 timeout 600 \
  npx storybook dev -p 6017 --ci --quiet
```

## `fleet-scope-open/localOperatorDark.webp`

The entry point and the panel in one frame, which is the operator's own
requirement (a count at the top level beside a session's count must say which set
it counts):

- the rail row reads **`All asks`** with a silent badge **`11`** and the pane
  family's glyph — the scope word is on screen, not only in the accessible name
  (design D2, UX U3), and the glyph plus `aria-expanded` is what marks the row as
  a door to a pane rather than a route destination (design D3);
- the panel's chrome bar states **`All conversations · 10 waiting, 1 moved on`** —
  the same population as the rail's 11, finally spelled out (design D4);
- every card names its conversation **by the name the sessions list uses**: the
  catalogue's title (`Migrate the billing schema`, `Enrichment backfill`,
  `Phone portal deploy`), never the `cwd` basename the first cut printed
  (design D1, UX U2).

## `untitled-pair-in-one-repo/localOperatorDark.webp`

The collision the first fixture could not show, which is why the finding was
"source-only": **two conversations in one repository, neither with a title.** The
list shows its own placeholder (`Untitled chat`) twice; the fleet's cards are told
apart as `pergamon-labs · 3456` and `pergamon-labs · 5a5a`, because the names are
resolved over the visible set and a name shared by two conversations gains the
session id's tail. Several asks from ONE conversation are not a collision and keep
their name (the first capture of this set shipped that bug; it is now pinned by a
cell in `scripts/fleet-asks.test.mjs`).

## What is NOT here, deliberately

`chat-asks-fleet-scope--scope-comparison` is a FIGURE — it draws both right-slot
panes at once, which `claimRightSlot` makes unreachable in the product — so no
frame is taken from it and the story's own name says so. A frame of a state the
product cannot reach is what agent review F3 objected to.

## What these frames do not prove

That a live backend answers the aggregate route, and above all that an answer
LANDS in the row's own conversation: the story's bridge answers `asks.list` from a
fixture and refuses every other op, so Browser/Mesh rows are absent here by the
app's own fail-closed rendering. The live parked-ask round trip is QA's matrix.

The key-driving behaviour is measured instead, by
`scripts/fleet-ask-escape-evidence.mjs` (a bounded one-shot, ~150 MB):

```
NODE_OPTIONS=--max-old-space-size=1024 timeout 120 \
  node scripts/fleet-ask-escape-evidence.mjs
```

It mounts the pane over a fixture read, moves focus in from the rail door, and
presses Escape from the body: the pane closes, the press is `preventDefault`ed, and
`interruptEscapeApplies` — the real predicate — answers `true` for the same state
before the claim and `false` after it. That pair is the difference between "the
pane closed" and "the pane closed and the running turn was stopped", which is the
state the first cut shipped (UX round 1, U1; agent review round 1, F1).
