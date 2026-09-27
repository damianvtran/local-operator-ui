# The chat sidebar's controls and states — the popover, the ladder, the caps, the group bound and the section gap

This set is `chat-sidebar-view-menu.stories.tsx`. It began as the surfaces design
round 3 (D28) found with no rendered frame: the view popover, the page ladder,
the section caps' `Show N more` feet, an expanded entity group, the band's hover
tooltips, and the sidebar's own voice on a route with no status strip. Three
groups were added on 2026-09-27 for the operator's two reports below.

## What produced the frames

Storybook from this branch, through the repo's own capturer:

```
pnpm exec storybook dev -p <free port> --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=chat-sidebar-view-menu --dirs=<dir> \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` because another session's `local-operator serve` was answering
on 1111 for the whole pass, which the rig refuses by default. No surface here
talks to it: `window.api.desktop.request` is stubbed by the story (`capabilities`,
`sessions.list`, `profiles.list`, `teams.list`, `sessions.search`) and anything
else is refused by name, so no frame can be a picture of that backend's replies.

The frames were re-captured on a clean tree, which is what the manifest's
`dirtyWorkingTree` and the `srcTree`/`scriptsTree` stamps record. **Twenty
frames** — ten states in both palettes: four in `group-bound/`, three in
`section-gap/` and the same three in `section-gap-before/`.

## The two reports, and what each group of frames is

### `group-bound/` — an expanded team, bounded to the ladder

Operator, 2026-09-27: *"there's far too many team/agent messages shown on screen
at once when expanded, can you have max 10 at first sorted by most recent/active
then click to load more."* His screenshot has `minervadev` expanded with 41
sessions running past the pane. Every frame here is that team: 41 conversations
bound to it, one bound elsewhere, the rest of the sidebar as it ships.

| frame | what it shows |
| --- | --- |
| `group-bound/ten/` | The report answered: **ten rows** drawn under `minervadev`, the badge still `41`, and the foot reading **`Show 15 more chats · 10 of 41`**. Before this change the same state drew all forty-one. |
| `group-bound/after-one/` | After **one real press** on that foot: twenty-five rows, the foot reading `Show 16 more chats · 25 of 41`. The press is a click on the control the first frame draws, not a seeded state. |
| `group-bound/after-two/` | After **two presses**: the third rung is fifty against forty-one held, so the group is fully drawn and **the foot is gone** — the other half of the count agreeing with the disclosure, since a reader seeing no control is seeing all of it. |
| `group-bound/current-lifted/` | The reader is IN `team-0034` — the group's 35th row, which the bound withholds. It is **lifted to the head of the group** under the panel's own `CURRENT CHAT` label rather than admitted in place (admitting it would draw the thirty-four rows between: the complaint this change answers). Eleven rows are drawn and the foot says `11 of 41`, because eleven is what is on screen. |

**Withdrawn: `group-bound/search-finds-unloaded` has NO frame, deliberately.** The
claim it existed for — a query reaches a row the bound has not loaded, which is
the operator's "search should still be able to search and find" — is asserted in
`scripts/chat-sidebar-view.test.mjs` ("a query is never bounded: the bound cannot
hide a hit"), over a 41-row group. Its frame could not be made reproducible: six
captures of that story on one clean tree produced **two distinct end states**,
the pixel diff spanning the whole panel rather than one label, and neither a
settle-wait on the layout nor an assertion on the story's own facts removed it.
A frame that photographs one of two states under a caption claiming one is worse
than no frame. The story stays in Storybook, documented, for a human to look at;
it is not in `STORIES`.

### `section-gap-before/` and `section-gap/` — the collapsed section's gap

Operator, 2026-09-27: *"shrink the gap between agents and teams headers when
agents is collapsed, there's an extra gap wasting space there."*

| pair | what it shows |
| --- | --- |
| `section-gap-before/agents-collapsed-teams-expanded/` vs `section-gap/…` | His exact case: `Agents` collapsed above `Teams` expanded. **16.0px → 8.0px.** |
| `section-gap-before/both-collapsed/` vs `section-gap/…` | Both collapsed — the "collapsed with zero items vs collapsed with items" case. **16.0px → 8.0px**, and identical to the pair above, because the condition is "the section above draws no rows" and not a row count. |
| `section-gap-before/both-expanded/` vs `section-gap/…` | Both expanded, the case a shortened constant would tighten unasked. **16.0px → 16.0px**, unchanged. |

The `-before` arm is this branch with the spacing line reverted, not a frame
taken at `origin/main` — the stories are new, so there is no `origin/main` frame
of them to pair against. The gap change is layout-only and does not touch the
bound, so the two groups are independent.

## The measurements, as the frames' own readout prints them

Panel 360px + 380px readout = 741px wide.

| term | value |
| --- | --- |
| entity row (`minervadev`, `content`) | **32px** |
| chat row inside a group | **36px** |
| `Agents` section heading | 28px |
| gap between the two section headings, `Agents` collapsed | **16.0px before → 8.0px after** |
| gap between the two section headings, `Agents` expanded | **16.0px before → 16.0px after** (shared, hence the conditional value) |
| heading-to-first-entry distance, inside a section | 0.0px |
| `minervadev` section height at 10 / 25 / 41 rows drawn | 525px / 949px / 1436px |
| scroller content/box, `Agents` collapsed + `Teams` expanded | **628/568 before → 620/568 after** |
| scroll layers (of which overflowing) | **6 (1)** — one real layer, the entity region; the other five are Storybook's own 0/0 decorators. The count is 6 (0) in `search-finds-unloaded`, where the query narrows the list until it fits. |

**The bound does not introduce a second scroller.** The overflow count is 1 in
every frame, and the one scroller is the entity region #534 established; the
group's own rows are a flow of it. The gap fix moves the content height by
exactly the 8px it removes (628 → 620) and the region still overflows (52px), so
nothing traded a header gap for a phantom scroll region.

## What these frames do NOT prove

- **They are not a gesture** except where the play drives one. `after-one` and
  `after-two` press the real control; the rest are resolved states seeded through
  the panel's own disclosure record.
- **They are not focus-dependent rendering.** A headless window has no focus, so
  no `:focus-visible` ring is photographed here. The foot's keyboard path
  (`data-chat-row`) is asserted in `scripts/chat-sidebar-view.test.mjs` and
  `scripts/chat-sidebar-scope-paging.test.mjs`, not shown.
- **The search claim has no frame at all**, for the reproducibility reason stated
  above; it is a test claim only.
- **They are not the paged path.** Every story here runs against a stub with no
  `session_catalogue_page` in its capabilities — which is what the shipped daemon
  advertises (`local_operator/server/routes/capabilities.py` has
  `session_catalogue: 3` and no paging key). So these frames are the WITHDRAWN
  path: the group's rows are a filter of the one page the client holds, which is
  what the operator's own app does. The paged path's own behaviour is unchanged
  and its scenes are in `scripts/renderer-driver.mjs`.

## Note on `node scripts/check-evidence.mjs`

On this branch it reports **7 pre-existing failures** — `supplementary[7]`
(`browser-approval-badges`, "claims 49 frames; 0 are on disk") and
`supplementary[24]` (`chat-header-identity/before-main`, no `source`/`why`/
`capturedAt`). Both manifest entries are **byte-identical to `origin/main`**, and
neither set is touched by this change, so they are not this branch's to answer
for. Stated rather than left to a reader who would otherwise assume the new
frames broke them.
