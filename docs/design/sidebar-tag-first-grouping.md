# Sidebar — tag-first grouping (`groupBy: "tag"`)

Design brief · 2026-11-07 · **IMPLEMENTED** by the UI #1733 PR (stacked on #1745),
which carries this brief and its code together. Built on #1639 (collapsible tag
groups, PR #1745). Open questions are settled in §8; per-tag paging is
**deferred** (§2.6).

Designer: designer (lopdev team) / anthropic/claude-opus-5-5.
Baseline inspected: branch `feat/collapsible-tag-groups` @ `2209af7`
(merge-base with `main` `553fa13`), which carries #1745's fold. Line references
below are from that worktree. They are pointers, not contracts; re-resolve them
on the code PR's base.

Sources: issue #1733 and its triage comment; #1745 design round 1
(TERMINAL, `#issuecomment-6712171356`); `docs/design/sidebar-tags.md`,
`sidebar-tags-flows.md`, `sidebar-tags-v2.md` §3.2, `sidebar-tags-api.md`;
`chat-sidebar-view.ts`, `chat-tag-groups.ts`, `chat-tag-drag.ts`,
`chat-auto-tag.ts`, `chat-sidebar.tsx`, `chat-sidebar-view-menu.tsx`,
`chat-tag-header.tsx`; the committed #1745 evidence frames
(`docs/pr-evidence/collapsible-tag-groups/after-{mixed,many-220}-dark.png`);
core `GET /v1/desktop/sessions` (`desktop_sessions.py`) and `CatalogueScope`
(`session/catalog.py`).

## 1. Request and scope

Requester (sherman-tsui, #1733), the essentials verbatim:

> Offer **Tag / Category** as a sorting or grouping option alongside the existing
> time/recency-oriented choices. In a tag-first view, collect conversations for a
> tag across all dates rather than repeating or dividing that tag under Today,
> This week, and Older. Keep older retained conversations discoverable within the
> selected tag-based view, even when they are outside the initial
> recent-conversation page. Lazy loading or pagination is fine […] Keep recency
> available as an optional ordering within a tag group […] Remember the selected
> sorting/grouping option across navigation and app restarts. Preserve pinning as
> an optional shortcut […] Other stable ordering options, such as conversation
> title A–Z, could also be useful, but tag-based organization independent of date
> is the primary request.

Chief of staff (Aida): one design covering tag grouping (#1639) and tag sorting
(#1733) together.

**Intent.** Let a reader browse conversations by how they organise their work
(tags), not only by when they last spoke. #1745's folds then make a tag-first
list compact.

**This is a new mode. The shipped mode does not change.** `Time section` with
tag subheaders keeps its contract exactly. This brief adds a fourth `Group by`
value and amends the contract only to say where the new mode differs.

## 2. Decisions

### 2.1 The option: `Group by › Tag`

- `SidebarGroupBy` becomes `"section" | "tag" | "agent" | "flat"`
  (`chat-sidebar-view.ts:478`). `parseSidebarView` accepts `"tag"` (the
  `GROUP_BY` list at `:1335`). Persistence is free: the choice already lives in
  `ui-preferences-storage › chatSidebarView`, re-validated on read. This meets
  "remember across navigation and restarts" with no new storage.
- **View options placement** (`chat-sidebar-view-menu.tsx`, the `groupBy` array
  at about `:204`): the second radio, **Time section · Tag · Agent and team · In
  one list**. It sits next to Time section because the two are the structured
  ways to organise conversations; In one list stays last as the unstructured end.
- **Label `Tag`**, new key `ui.chat.sidebar_view.tag`, with the lucide `Tag`
  glyph (already imported by `chat-sidebar.tsx:103`). One noun, parallel to
  "Time section". Not "Tag / Category": the product calls them tags everywhere
  else. Same `choice()` row: `menuitemradio`, `aria-checked`, tick.
- **Shown only when the backend advertises `session_tags`** (`tagsAvailable`).
  If a stored `"tag"` meets a backend without tags (an older daemon), draw
  `Time section` for that render and **do not rewrite the stored value**. This
  follows the existing rule that a mode change is never silent.
- **No new `orderBy`.** Inside every group, the existing `Order by` (Active first
  / Most recent) and `Time basis` (Last active / Created) apply unchanged. That
  is the issue's "recency available as an optional ordering within a tag group".
  It already works: `groupRows` and `groupChatsByTag` preserve the order
  `pageOrder` hands them.

### 2.2 The Tags switch survives, scoped to Time section

The triage asked whether the switch survives or the new option subsumes it. **It
survives, renamed and scoped:**

- `tagsEnabled` keeps its meaning (tag subheaders *inside* Time sections) and its
  persisted value. Choosing `Tag` neither reads nor writes it. Writing it would
  make a later return to Time section show subheaders the reader had turned off.
- **Visible label:** `Group chats by tag` → **`Split time sections by tag`**
  (`ui.chat.tags.group`, copy change in every locale). Next to a `Tag` radio, the
  old label claims the same job as the radio, so the panel would carry two tag
  concepts. The new label names the axis it subdivides. The `<label>` is still
  the accessible name (WCAG 2.5.3).
- **Under `Group by › Tag` the switch row is not drawn** (absent, not disabled).
  Tag mode is tags-on by definition, and a dead switch invites a press that does
  nothing. Its stored value waits for Time section.
- **Under Agent and team / In one list:** unchanged. The switch shows, with
  `Tag groups use Time section grouping.` and the `Use Time section` action.
- **Auto-tag forks** follows the tag surface, not the switch. Introduce one pure
  predicate, `tagSurfaceOn(view) = view.tagsEnabled || view.groupBy === "tag"`,
  and use it in `chat-auto-tag.ts:76` (`forkAutoTag`) and for the
  auto-tag row's visibility in the menu (`:378`). It must also feed the
  `tagsGrouped` gate (`chat-sidebar.tsx:3192`), so that the Unused-tags footer
  and the `Shown under` line work in tag mode.

### 2.3 What tag mode draws

```
[lifted viewed row, if any — unchanged, head of list]
⌄ Review            12      ← ChatTagHeader, top level (no section above it)
   ◯ pinned row     📌      ← pins first, in the reader's manual pin order
   ● running row    now     ← with Active first: live rows next
   ◯ …newest → oldest by the chosen basis
› Project            7      ← folded (#1745): header + whole loaded count
⌄ Concept            3
   …
⌄ Untagged          28      ← always last
   …
Show 50 more chats          ← the one existing page foot
──────────────
Unused tags (2)  · + New tag ← existing v3 footer
```

- **Groups:** one per *occupied* primary tag, across all dates. Category
  registry `order` first, **Untagged** last. Use the existing
  `groupChatsByTag(rows, categories, true)` over `[...orderedPinned,
  ...pagedRows]`. It already buckets by `chatTagBucket` (primary only; an unknown
  or deleted primary counts as Untagged), orders by registry, puts Untagged last,
  and draws no empty buckets. No second bucketing implementation.
- **Primary only, one row once.** A conversation with several tags appears only
  under its primary tag ("Group under" in the picker). The header count is
  `bucket.rows.length`, so it never double-counts.
- **No time headings.** No Pinned, Running, Today, This week or Older sections.
  The row's trailing time label still reads the chosen basis, so recency stays
  visible on every row.
- **Header component:** `ChatTagHeader`, reused unchanged: 28px row, #1745
  chevron, name, count, double-click rename, Move up/down, drop target. **Do not**
  restyle it as an uppercase section label. Keeping one header in both modes
  means a reader who switches modes sees the same thing they fold, rename and
  drop onto. The `after-many-220-dark` frame already shows a stack of these
  headers reading cleanly on a 28px rhythm at 220px. Headers sit flush with no
  extra gap token; the first header starts where the first section label sits
  today.
- **Agents / Teams roster sections** are independent of `groupBy` today
  (`chat-sidebar.tsx:8744`, `:9090`) and stay so.
- **The `Sections` checklist** behaves as it does under Agent and team today.
  Reworking it per mode is a non-goal.
- **Search** suspends grouping exactly as in Time section: flat, relevance
  ordered results. Clearing the query restores the groups and their folds.
- **Header management in tag mode** is the v3 header surface as it stands. Move
  up/down passes the visible neighbour (`moveTagPast`). In tag mode every
  occupied tag is visible in one sequence, so "the header I pressed moves past
  the header I see" holds trivially.

### 2.4 Pinned and running membership in tag mode (explicit reversal)

In Time section mode, Pinned/running membership wins over tags. **In Tag mode,
tags win:**

- **Pinned rows join their tag group** and lead it, in the reader's manual pin
  order (`orderedPinned`, `chat-sidebar.tsx:3244`, `orderPinnedRows(pinned,
  view.pins)`). This is the Agent-and-team precedent (pins ride at the head of
  their group, `:9741`) applied to tags. It is also the issue's "pinning as an
  optional shortcut": a pin keeps a conversation at the top of *its tag*. The
  row's existing pin glyph identifies it.
  - Implementation note: the Agent-and-team branch passes `pinned`, the
    catalogue order, while its comment promises the manual order. Tag mode must
    pass `orderedPinned`. Verify the agent branch separately; it does not gate
    this PR.
  - **Pin reordering stays a Time-section affordance.** `offersPinnedMove`
    requires `groupBy === "section"` and is not widened. In tag mode a pinned
    row's drag is a tag move only.
- **Running has no section in tag mode.** With `Active first`, live rows (a turn
  in flight, stopped on the reader, wedged) lead their group after the pins,
  through `pageOrder`'s lift lane. With `Most recent` they sit by clock. The A1
  page guarantee holds: a live row past the cut is still drawn, inside its group.
  The reader who wants a global "what's running" view uses Time section; that is
  what it is for.
- **Unpinning or a turn ending never moves a row out of its tag group.** Only a
  primary change does.

### 2.5 Folds compose: one state for both modes

- The fold key is #1745's `tag:<id>` in the `chat-sidebar-disclosures` map
  (`tagDisclosureKey`, `chat-sidebar-view.ts:289`). Tag mode reads and writes
  **the same key**. Folding Review in Tag mode leaves Review folded when the
  reader returns to Time section, in every section that draws a Review header,
  and the reverse. #1745 design round 1 confirmed this ("Review is folded" is
  the reader's model). The mode switch is one more place the same tag draws.
- `Untagged` folds under `tag:untagged`, as it does today.
- Everything #1745 settled carries over unchanged:
  - the chevron is the only hit area;
  - the count stays visible and does not move when folded;
  - a drop onto a folded header lands and leaves it folded;
  - a row re-tagged into a folded group hands focus to that group's chevron
    (`foldedRowFallback`, `chat-sidebar.tsx:1468`);
  - under search, folds hide nothing.
- **No "collapse all / expand all"** in this PR (non-goal). The fold map makes
  it a cheap follow-up if a reader asks.

### 2.6 Discoverability of older conversations

What exists: one page ladder over the unpinned arrangement (10 → 25 → 50, then
+50 per press; `pageLimit`, `chat-sidebar-view.ts:611`). The client holds a
50-row catalogue head (`CATALOGUE_HEAD_PAGE`), and past that the foot follows the
tail cursor (`pressPageMore`, `fetchCatalogueTail`). Core's catalogue scope is
`kind ∈ {team, agent}` only (`CatalogueScope`, `session/catalog.py:846`). **No
backend tag filter exists**, so a true per-tag lazy load is a cross-repo change.

The tag registry's `conversations` number **cannot** stand in for a per-group
total. It counts archived and hidden sessions, and any session *carrying* the
tag, not having it as primary (`sidebar-tags-api.md:59`). "12 of 30" built from
it would be an invented total, which the contract forbids.

Decision for this PR, minimal and honest:

1. **Tag mode starts on the held head, not on 10.** The effective rung is
   `max(view.loads, 2)`, i.e. 50 rows, the rows the client already holds, so no
   extra fetch. Ten rows spread across six tags would leave most groups with
   one row and defeat the mode; folds (#1745) are the vertical-space answer.
   Implement as a pure `effectiveLoads(view)` beside `pageLimit`, used by the
   page cut, the foot label (`pageMoreLabel`/`pageReveal`) and `pressPageMore`
   (`next = effectiveLoads(view) + 1`). **A mode switch never rewrites
   `view.loads`**, so switching to Tag and back without pressing restores the
   reader's own rung. (As built: a foot press in Tag mode writes the next rung
   from the drawn one, 50 → 100, and Time section then keeps that larger page;
   PR #1747 round 1, R2.)
2. **One foot, the existing one.** `Show N more chats` stays at the list's foot
   and follows the catalogue cursor. Newly loaded rows land in whatever groups
   they belong to. **No per-group "Show more"** while no per-tag source exists:
   a "Show more in Review" that fetched the global tail would grow other groups
   as a side effect and might not add a single Review row.
3. **No jumping.** When a press grows groups above the viewport, the visible
   rows must not move. Chromium's default `overflow-anchor: auto` should anchor
   the shared scroller. The code PR must **prove** this with consecutive frames
   (before press, first frame after, settled), not assume it. If anchoring
   fails, pin the anchor explicitly to the foot button or the first visible row
   by id.
4. **Search remains the exact finder.** It answers over the whole index,
   including rows never loaded (invariant 2).

Follow-up, **not this PR — deferred**: per-tag paging. Core would add `scope_kind=tag`
(primary match) to `/v1/desktop/sessions`. The UI would then give each tag group
the Agents/Teams per-group ladder (`entityRows`/`entityMore`): a `Show N more`
at each group's foot, honest per-group counts, and older conversations reached
inside their tag without loading everything else. That is the full form of the
issue's third bullet. Record it on #1733 as the next step. Do not file an issue
unless asked.

### 2.7 Title A–Z: out of scope

Not in this PR. `orderBy` is defined as a lift plus a clock, and `basis` bins
time sections, so A–Z fits neither. More decisively, **A–Z over a paged catalogue
is wrong**: the client would alphabetise only the rows it holds, so "Aardvark"
from March would sit below loaded "Zebra" until the reader paged far enough.
Honest A–Z needs a server-side title sort on the paged route plus a fourth view
axis, and it should be offered only in modes without time bins. Track it as a
separate request; it is not needed for the primary ask.

### 2.8 Drag to re-tag works in tag mode

`useChatTagDrag` is gated on `groupBy === "section"` (`chat-sidebar.tsx:3725`).
Widen that gate to `section && tagsEnabled || tag`, still suspended under search.
A drop onto a header or body changes the primary (`movedTagAssignment`). A drop
onto Untagged clears the tags. This is the most direct gesture in a tag-first
list, and it reuses the shipped drag, toast and announcement. `sidebar-tags-v2.md`
§3.2 "Eligible contexts" is amended (§4).

## 3. Keyboard and screen reader

- **Popover:** the new radio joins the `Group by` fieldset (sr-only legend
  "Group by") as a fourth `menuitemradio`, reached by the popover's existing keyboard model (no new keys). Pressing a
  radio keeps the panel open, as the other groups do.
- **List ring (Tag mode):** chevron of group 1 → its header actions → its rows →
  chevron of group 2 … → page foot → tag footer. This is #1745's ring order with
  the section labels removed. Folded groups' rows are not ring stops. Home/End
  and type-ahead are unchanged.
- **Mode switch keeps place.** The selected conversation stays selected. If
  regrouping moves it out of view, scroll it into view (flows F1.3). If it lands
  in a folded group, do not unfold: the selected marker is hidden with the body,
  the header's chevron is the focus fallback, and the count shows it is there.
  Focus stays in the popover while it is open.
- **Landmarks and headings:** each top-level tag group is a
  `<section data-chat-tag-section="<id>" aria-labelledby="…">`, inside one
  `data-chat-section="tag"` wrapper. (As built: the brief first named
  `data-chat-section="tag:<id>"`, but the re-tag drag keeps a tagged row's drop
  targets inside its own `[data-chat-section]`, so per-group sections would
  forbid exactly the cross-tag move Tag mode exists for.) In Tag mode the
  header's **name is wrapped in `<h3>`**, the level of today's section labels
  (`chat-sidebar.tsx:7909`). That keeps heading navigation (VoiceOver rotor,
  NVDA `H`) jumping group to group. The chevron button stays outside the
  heading, and its accessible name stays `Collapse {name}` / `Expand {name}`
  with `aria-expanded` and `aria-controls`. A `level` prop on `ChatTagHeader`
  carries this. In Time section mode the header does not change (non-goal).
- **Count:** readable as text after the heading ("Review, heading level 3" then
  "12"). No new aria-label.
- **Retag announcements** reuse the shipped ones (`Tags updated. Grouped under
  Project.` and the drag toast). The page foot keeps its existing tail live
  region.
- **RTL:** the chevron mirrors with `rtl:-scale-x-100` (#1745 D1). The tag mode
  draws the same component, so it inherits the fix. Confirm in the frame.

## 4. Contract amendments (apply in this docs PR)

**`sidebar-tags.md` §2 "Group only within Time sections" (`:34-36`)** becomes:

> ### Two tag arrangements
>
> Tags arrange the list in exactly two places. **(a) Time section + `Split time
> sections by tag`:** tag subheaders inside each time section (below). **(b)
> `Group by › Tag`:** tags are the top-level groups across all dates
> ([sidebar-tag-first-grouping.md](sidebar-tag-first-grouping.md)).
> `tags.enabled` governs (a) only. It is independent of `groupBy`, is never
> written by choosing (b), and its row is not drawn under (b). Under Agent and
> team or In one list, neither arrangement draws. Show `Tag groups use Time
> section grouping.` with **Use Time section**. Only that press changes the
> mode. Search suspends both arrangements. Assignment remains available
> everywhere.

**`:40`** becomes:

> In arrangement (a), within each existing conversation section, draw nonempty
> primary-tag groups in category order, then **Untagged**. Preserve the existing
> order within each bucket. One conversation appears once. Pinned/running
> membership wins over tags; tags never move a running row into Today. In
> arrangement (b), **tags win**: pinned rows lead their primary tag's group in
> manual pin order, live rows follow under Active first, and there are no time
> sections. In both, section counts remain conversation counts, not assignment
> counts, and subheader counts describe the loaded bucket, not an invented total
> beyond pagination.

**`:44`** ("No chevrons and no collapse in slice 1"): add
`Superseded by #1639 / PR #1745: a chevron folds a tag group, keyed by tag id, in both arrangements.`

**`sidebar-tags-flows.md:59`** becomes:

> Current View options offers Time section / Tag / Agent and team / In one list.
> Tag *subheaders* are suspended whenever `groupBy !== "section"` or search is
> active. `Group by › Tag` draws tags as top-level groups instead (see
> sidebar-tag-first-grouping.md). The `Split time sections by tag` switch keeps
> its value in every mode and never forces a group-mode change.

**`:71`**: prefix `In Time section mode with the switch on, …`, and add step 3b:
`In Tag mode, occupied primary tags are the top-level groups in category order, Untagged last, each ordered by the chosen Order by and Time basis.`

**`sidebar-tags-v2.md:96`** "Eligible contexts": `tags enabled and groupBy === "section", or groupBy === "tag"; no search…`. Agent and team and In one list remain ineligible.

## 5. States the code PR must render (before/after, real Storybook)

Stories go in `chat-sidebar-tags.stories.tsx` (real stylesheet). Frames go in
`docs/pr-evidence/sidebar-tag-first-grouping/`, at 260px unless noted, in dark
**and** light:

| # | State | What it proves |
|---|---|---|
| S1 | **Populated:** 3 tags + Untagged; a pinned row in Review; a running row in Project; Active first | top-level groups, registry order, Untagged last, pin then live lead |
| S2 | **Empty tag:** a category with 0 loaded rows | no header; listed in `Unused tags`; no chevron without a body |
| S3 | **Untagged-only:** categories exist, no loaded row tagged | one `Untagged` header (it states the mode and is a drop target), footer offers the rest |
| S3b | **No categories at all** | no headers, flat rows, the existing no-tags footer (`tagFooter`, create path) |
| S4 | **220-row density @220px:** 8 tags, 220 loaded rows, mixed folds; top and bottom of scroll; foot visible | 28px header rhythm, truncation of long tag names (count never truncates), single scroller |
| S5 | **RTL (`ur`)** of S1 | mirrored chevron, inline-start alignment, count at inline-end |
| S6 | **View options** with Tag selected, and with Time section selected | radio order and label; switch absent in Tag mode; new label in section mode; popover `scrollHeight`/`clientHeight` (expected +30px in section mode over the 678/638 baseline, so the scroll affordance must show) |
| S7 | **Search in Tag mode** | flat results, no headers; clearing restores folds |
| S8 | **Fold parity:** fold Review in Tag mode, then switch to Time section | Review folded in Pinned and Today |
| S9 | **Foot press** at the 50-row rung, 3 consecutive frames | no visible row moves (anchoring), new rows land in groups |
| S10 | **Loading** (catalogue head pending) and **tail error** (Retry at foot) | existing skeleton/refusal unchanged in Tag mode; no flat-then-grouped reflow when the registry settles after the rows (consecutive frames) |
| S11 | **Regression:** Time section mode, tags on and off | pixel-compatible with base `main` frames |

Also measure and cite:
- header/row rects;
- chevron and focus-ring contrast in both themes (the #1745 numbers should hold);
- the radio row height;
- popover geometry.

## 6. Acceptance criteria

1. `Group by` offers `Tag` (when `session_tags`). It persists and survives a relaunch.
2. In Tag mode, every loaded conversation appears exactly once, under its primary
   tag or Untagged. Groups follow registry order, with Untagged last. No time
   headings.
3. Inside a group: pins first (manual order), then the `pageOrder` arrangement
   for the chosen Order by and Time basis.
4. Folds are shared with Time section mode through `tag:<id>`.
5. The first page is the held 50-row head. The existing foot loads more without
   moving visible rows. Search finds any conversation.
6. Drag/drop re-tagging and header management work in Tag mode.
7. Time section mode is unchanged apart from the switch's label.
8. A stored `"tag"` on a tag-less backend draws Time section and is not
   rewritten.
9. Unit tests in `scripts/chat-sidebar-view.test.mjs` cover:
   - parse round-trip of `"tag"`;
   - `effectiveLoads`;
   - `tagSurfaceOn`;
   - Tag-mode grouping order (pins, then lift, then clock; Untagged last;
     deleted primary goes to Untagged);
   - `forkAutoTag` under Tag mode.
10. The new and changed copy is translated in every supported locale through the
    repo's i18n audit/receipt flow.

## 7. Non-goals

- Per-tag backend paging and per-group `Show more` (follow-up, §2.6).
- Title A–Z or any new `orderBy` (§2.7).
- Listing a conversation under every tag it carries (primary only).
- Tag filtering. Grouping is still not filtering.
- Nested modes (Agent → Tag, Tag → Time).
- Collapse-all / expand-all.
- Reworking the `Sections` checklist per mode.
- Heading semantics for Time-section subheaders.
- Any change to Time section mode's layout, membership or pin reordering.
- Chips, colour or icons per tag.
- Retention policy (the issue says so too).

## 8. Open questions — resolved

Settled for the code PR with the defaults below (2026-11-07):

1. **Copy:** relabelled. `Tag` (new `ui.chat.sidebar_view.tag`) and `Split time
   sections by tag` (`ui.chat.tags.group`), in every supported locale.
2. **Running in Tag mode:** no section. Live rows lead their group under Active first.
3. **Initial rung:** 50 (`effectiveLoads`, `TAG_MODE_MIN_LOADS = 2`).
4. **Per-tag paging:** **deferred** to a follow-up (core `scope_kind=tag` plus a UI
   PR), recorded on #1733 and in the PR thread. Not filed as an issue.
5. **Agent-and-team pinned order:** it was the one-line swap, so it is fixed in
   this PR: `groupRows([...orderedPinned, ...pagedRows], groupBy)`.

The questions as originally posed:

1. **Copy:** `Tag` for the radio, `Split time sections by tag` for the switch.
   The relabel costs a re-translation. The alternative is to keep `Group chats
   by tag`, at the price of two tag concepts in one panel. Default: relabel.
2. **Running in Tag mode:** live rows are lifted within their group, with no
   global Running section. If the operator wants Running kept above the tag
   groups even in Tag mode, it is a small addition, but it reintroduces the
   "membership wins" split the request argues against. Default: no section.
3. **Initial rung 50 in Tag mode** (held head, no fetch). Default: 50.
4. **Per-tag paging follow-up** needs a core change (`scope_kind=tag`) plus a UI
   PR. Should it be scheduled now as the second half of #1733, or wait for user
   feedback on this mode?
5. **Pinned order in Agent and team** appears to use catalogue order, not manual
   order (§2.4 note). Fix it in this PR as a direct neighbour, or record it?
   Default: verify; fix only if it is a one-line `orderedPinned` swap.
