# LOH-11 — sidebar tags: interaction contract

Design-phase UX specification, 2026-10-18. No tags implementation is asserted or approved here.
Reviewer: ux-reviewer, **openai/gpt-6.1-sol** (temporary fallback after the primary model's quota exhaustion).
Baseline inspected: `76dda0304bfa4b54ebd42cccd32bbd05841ca4a3` in `feat/sidebar-tags`.

## Alignment 2026-10-18

Minimal alignment to the designer's measured and viewed corrections, supplied by the manager; no new browser dispatch or screenshots:

1. Removed the chip preference: automatic neutral, noninteractive full-label chip only when exact width + 4px gap leaves ≥120px action-state title; absent at default width and no qualifying row at 220/260px; no truncated chips.
2. Suspend grouping outside `groupBy="section"` or during search; preserve the enabled Tags master and keep eligible row chips readable.
3. Picker and Manage tags are modal dialogs: 420px minimum where possible, viewport-minus-32px cap, identical width across sidebar widths; inline Group under radios among checked tags and Cancel/Apply footers.
4. Slice-one tag subheaders have no chevrons or collapse.
5. Compact Tags switch + Manage tags… row above unchanged Sections; designer reports 678px content / 638px interior = 40px overflow, with visible scroll affordance.

## 1. Evidence and boundaries

Sources: the operator's 2026-10-18 LOH-11 request (scope reproduced in the design brief), including the manager's correction that a row context menu already ships; `docs/branding.md` §§6/9; `docs/design/sidebar-row-space.md`; `docs/design/sidebar-sections.md`; `chat-sidebar.tsx`, `chat-sidebar-view-menu.tsx`, `chat-row-context-menu.stories.tsx`, and `shared/components/ui/context-menu.tsx`.

The historical geometry documents contain previous bases/clamps. They are context, not new measurements. The current brief's 220–320px panel range governs implementation. The manager reports a 47px pinned title clip at 220px; **that number was not independently measured in this UX run**. Chip eligibility must use the designer's current measured geometry, never the old tables' nominal widths.

### Current-flow walkthrough actually performed

One harness-browser tab, real Storybook at localhost:6006, reused until host instability ended the run. All screenshots below are this reviewer's captures under `../evidence/loh-11-ux/before/`.

1. Open `chat-sidebar-view-menu--popover-open`. Initial transient `No Preview` resolved on navigation to the same valid story, after verifying its ID in `/index.json`. The populated real sidebar and popover then appeared.
2. Snapshot: band controls in document order were Search chats and agents → View options → New agent or team → Open agent. Popover interactive refs were Time section (`e38`), Agent and team (`e39`), In one list (`e40`), Last active (`e41`), Created (`e42`), Active first (`e43`), Most recent (`e44`), then section checkboxes and applicable move-up/down buttons (`e45`–`e59`). **This is accessible document order, not a measured Tab traversal.** Viewed frame shows a visible ring on Time section.
3. Click `e42` Created. Readback changed `Stored view: section/active/active-first` to `section/created/active-first`; five chats formerly in Today/This week moved into Older. Popover stayed open. Feedback is the selected clock plus the immediately regrouped list, not a separate success toast.
4. `browser.styles('[role=dialog]', properties=['overflow-y','max-height'])` returned `rect 51,42 240x640.39`, `overflow:auto`, `max-height:662px`. This is the **popover**, not sidebar width. Frame: `view-options-dark.png`. The existing options panel already uses most available vertical space; adding long inline tag management is inappropriate.
5. Host stopped answering its bounded health check. `recover` reported no owned tab; one `open` restored the same surface. Open `chat-sidebar-sections--narrow-240` with `theme:localOperatorLight`. Snapshot shows Agents/Teams followed by Pinned, Running, Older. Readout: `Scroller: content 848, box 668`, `10 entity · 8 chats`, `First title clip: 67px`, `First row box: 32px`. These are fixture readouts, not estimates. Frame: `sidebar-240-light.png`. Several titles visibly truncate; do not reserve another permanent title slot for tags.
6. Open `chat-sidebar-row-context-menu--keyboard-open`. **The story**, not this reviewer, focuses the row and dispatches a synthetic `ContextMenu` keydown through the real row handler (`chat-row-context-menu.stories.tsx`, keyboard branch). Snapshot menu order: Archive conversation → Pin conversation → Fork conversation → Copy session ID → Rename conversation. Frame readout: panel `273x175 at 14,370`, row `240x32 at 12,340`, flyout absent, focus `menuitem Archive conversation`, first item highlighted. Frame: `context-keyboard-dark.png`. This proves the driven baseline's actual focus landing and absence of competing flyout; it does not prove a physical Context Menu key or Shift+F10.
7. Click menu Pin (`e7`). Menu closed. Snapshot showed `Could not pin “Migrate the deploy script”. Desktop controls could not reach the backend process.` and Retry; row stayed in Today. Readout focus returned to that conversation's button. Frame: `pin-backend-unavailable-dark.png`. **Not a product pin regression:** going one step further, the fixture bridge switch handles capabilities/list/search/profiles/teams but no pin mutation (`chat-row-context-menu.stories.tsx:136–200`). This establishes current error presentation and action focus return in this fixture, not a successful pin write.
8. Attempted default-width baseline navigation. Host again lost the surface; stopped dispatching. Final `close` returned `No browser surface open`. No independent wide frame, successful archive/pin, physical keyboard walk, or resize drag was obtained.

### Deterministic preflight

- `GET http://localhost:6006/index.json`: confirmed exact story IDs, including `chat-sidebar-sections--narrow-240` (not `--narrow240`).
- `rg -n 'href="#"|to="#"|onClick=\{\(\) => \{\}\}' src/renderer/src/features/chat/components/chat-sidebar*`: no matches. Exit was normalized only for this search; absence of these patterns does not prove absence of all dead ends.
- Canonical `skill://design-qa/scripts/copy_scan.py`, copied via the virtual resource to session scratch, run on `chat-sidebar.tsx` and `chat-sidebar-view-menu.tsx`: **2 files, 1414 candidate strings, 0 findings**, exit 0. Advisory string scan only.
- Repo harness discovery: `check-changed`, `check-types`, `check-themes`, Storybook and focused interaction stories exist. No production changes, no dependency install, no duplicate full automated suite or scripted browser engine.
- Negative controls: index lookup distinguished an invalid story spelling from actual render content; fixture bridge inspection explains the pin failure rather than mislabelling it a product defect. No additional costly flow dispatch after repeated host loss.

## 2. Decisions: keep the feature optional and the list predictable

1. Off by default, with **no tag-specific reserved pixels or extra tab stops in conversation rows**. Disabling restores existing membership, ordering, heights, scroll-container structure and title geometry. It does not delete tags.
2. One conversation appears once. Existing section membership/pin/running rules win. Tags subdivide a section; they never move a running chat into Today or duplicate it across tag groups. Section counts count conversations, not assignments.
3. Primary tag is explicit session data. First assignment supplies the initial primary; merely adding another tag or reordering categories never changes it. Removing the primary chooses the oldest surviving assigned tag (stable assignment sequence; deterministic ID tie-break for legacy data). No tags left means Untagged. Preview the replacement in the picker before Apply.
4. The row context menu gains **one `Tags…` item**, placed with conversation metadata actions, before conditional Move actions. Existing action order remains otherwise unchanged. Do not append N category items to a menu already containing five items, seven on pinned rows (source-derived pinned count, not newly driven here).
5. Picker and Manage tags are viewport-bounded **modal dialogs**, not sidebar-width popovers. Both use a 420px minimum where the viewport permits, capped at viewport width minus 32px (the cap wins on smaller viewports), with identical width at sidebar 220/260/320px. Search, selection, creation and failure recovery use this stable space; each has a Cancel/Apply footer.
6. **Draft then Apply**, not immediate network writes for every checkbox. The row must not move away after the first of several selections. Cancel/Escape is honest cancellation. One atomic assignment+primary write produces one success or recoverable failure.
7. No tag rail/dot fallback. Existing status/locality/pin marks retain their meaning. One automatic **neutral, noninteractive, full-label primary chip** is absent at the default width; appears only where there is room. There is no chip preference.
8. Paint the chip only when its exact full-label width plus a 4px gap leaves ≥120px of title in the action state, accounting for actual status/locality/pin/control/gutter/font widths. Per the designer's measured correction supplied 2026-10-18, no row passes at 220/260px. If the full label does not fit, no chip: never truncate its label or remove an existing mark to fit it.
9. Keep chip visibility stable for the complete hover/focus/menu-open interaction. Hide its paint while actions show; do not shift the title leading edge, row box, hit targets or list order, and do not re-fit on pointer movement. Suppress chip re-entry until all three interaction states end. No chip animation. Validate the proposed disappearance with consecutive frames; a still alone cannot settle flicker.
10. No tag filtering in LOH-11. Grouping is not filtering: all existing visible rows remain reachable.

### Existing Group by modes must not be silently overwritten

Current View options offers Time section / Agent and team / In one list. Tag grouping is suspended whenever `groupBy !== "section"` or sidebar search is active. The Tags master switch stays enabled and its value preserved; it never forces a group-mode change. Automatic chips are a **row affordance** and remain readable in those states wherever the same full-label fit gate passes. Assignment remains available. Clearing search or returning to Time section restores grouping when the master is on.

This does not invent nested Agent → Tag groups or subdivide flat/search results. Implementation must prove these transitions and preserve previous section settings; there is no forced restoration to Time section on restart.

## 3. Proposed flow map

The following steps are **specified, not observed tags interactions**.

### F1 — discover, enable, disable

1. Open View options. A compact `Tags` row (master switch + `Manage tags…`) sits **above Sections**; Sections remains unchanged. Per the designer's measured correction supplied 2026-10-18, content is 678px against a 638px interior: 40px overflow, with a visible scroll affordance. Keep the existing popover scroll area; no internal tag scroller or chip setting.
2. Enable grouping. If categories are absent, show a nonblocking `No tags yet` explanation and `Create tag…` / `Manage tags…`; ordinary chats remain drawn without empty subheaders. Do not seed suggested categories silently.
3. With tagged rows, the existing section headers/counts remain; occupied primary-tag subheaders appear in category order, Untagged last. Preserve order within each group according to existing sorting. Keep current session selected and reveal it if regrouping moves it out of view.
4. Help below the setting says `Right-click a conversation and choose Tags…` and includes the keyboard route. This is the mouse-first discovery path missing from a context-menu-only model. Row's existing actions hint gains Tags only when supported; no new permanent row icon.
5. Disable Tags explicitly. Tag groups and chips disappear, no tags are deleted, and list/geometry returns to the original view. Existing assignments survive a subsequent enable. This is distinct from temporarily suspended grouping during search or another group mode: there the master stays on and automatic chips remain eligible.

### F2 — assign several tags and choose the group

1. Right-click a row, or focus its conversation button and use Context Menu / Shift+F10 (Fn where needed on Mac). Select `Tags…`.
2. Dialog `Tags for “{conversation}”` opens; focus starts in Search tags, with conversation name available untruncated to assistive tech. It reads the persisted tags and primary. Loading has labelled feedback; no editable empty list until loading resolves.
3. Search narrows category choices, **not** the sidebar. Check multiple tags without dismissing the modal. An inline `Group under` radio group lists only checked tags; no separate primary-selection step or surface. Make the full checkbox-label area clickable; radios are separate sibling controls, never nested inside checkboxes. Cancel/Apply stays in the footer.
4. First assignment selects an initial primary. Adding a second preserves it. Selecting Project in the inline `Group under` radio group previews `This conversation will appear under Project.` Only one primary is possible.
5. Remove primary: preview the stable replacement by name, or `This conversation will be untagged.` Clear all is one draft action, recoverable before Apply. No hidden reorder-induced replacement.
6. Apply writes once. Show `Applying tags…`; prevent duplicate submissions. On success dismiss, announce `Tags updated. Grouped under Project.` and focus the moved row by stable session ID, scrolling that row into view, not an old coordinate. Never navigate/open a different conversation.
7. On failure retain draft and dialog; inline `Tags were not saved. Try again.` with Retry and Cancel. On concurrent edits refresh the server state and show `Tags changed elsewhere. Review the latest tags before applying.` Do not silently overwrite another actor's primary.
8. Cancel/Escape before submit discards draft, returns to the origin row, no write. A pending request is not cancelled by pretending it never happened: prevent dismissal while saving only for a bounded request, with visible feedback; timeout transitions to an actionable error. Reconcile ambiguous network results from the server before claiming failure/success.

### F3 — category management

1. `Manage tags…` from View options or picker opens a viewport-bounded modal dialog with the same 420px minimum / viewport-minus-32px cap and sidebar-independent width as the picker, plus a Cancel/Apply footer, not a stack of unrelated popovers. Save/restore the picker's draft if management is launched from it. Returning to the picker restores search/focus and includes newly created categories.
2. Create: labelled Name, optional constrained colour role; default neutral. Trim whitespace; reject blank names and case-insensitive duplicates (`Review` / ` review `). Preserve the user's input and focus on error. No silently renamed duplicate such as Review 2. Stable IDs ensure rename does not detach assignments.
3. Offer starter names as explicit add actions; existing names are marked already added. Unknown agent categories do not create these implicitly.
4. Rename uses an inline labelled edit or single edit state with Save/Cancel. Duplicate failure names the conflicting category and preserves text. Colour never communicates category identity alone.
5. Reorder with labelled Move up/Move down buttons. End buttons disabled with clear bounds; keep focus on moved category by ID and announce its new position. Reorder changes group order only, never explicit primary or row assignment.
6. Delete shows category name and **distinct affected conversation count**, not tag-assignment count. Confirmation explains `Remove this tag from {N} conversations? Conversations will not be deleted. Other tags stay.` Include replacement-primary rule. Cancel is the safe initial focus; destructive action is `Delete tag`.
7. Successful delete removes assignments and reconciles primaries atomically; restore focus to the next category control, previous if last, Add tag if empty. Failure leaves the category and assignments unchanged with Retry. No conversation archive/delete endpoint is involved.
8. Apply commits management changes; Cancel/Escape discards unapplied edits. Return to its trigger, or originating picker when launched there. Never focus a removed category.

### F4 — group scan and scroll

1. Existing section header is the primary hierarchy. Tag subheader is subordinate, sentence case, one line, labelled with the full category name via accessible name/tooltip and a conversation count. Colour is optional decoration, not the only distinction. Do not repeat section icons or add section-sized vertical gaps.
2. Only occupied groups are drawn. Untagged appears last only when a section mixes tagged and untagged rows. A wholly untagged section has no redundant Untagged subheader. No empty category drop targets in the first slice.
3. First slice: subheaders have **no chevrons and do not collapse**; they add no disclosure tab stops or hidden-row states. This limits hierarchy cost and avoids changing the established section disclosure model. Test scroll cost with many one-row groups before release.
4. Category order shared across sections; existing section count stays authoritative. Search follows current search membership, not a hidden tag filter. Existing Agents/Teams region is not retagged. Preserve independent region scrolling and current-row reachability.

### F5 — drag assignment (later slice; required for complete LOH-11)

1. Deferring drag is **acceptable for the first vertical slice**, because the picker fully supports the task without a precision gesture. It is not permission to call the full operator request complete: drag-to-group is explicitly requested.
2. Later use a deliberate row grip visible on hover/focus, not title text as the drag origin (title pan/text-selection must remain usable). Do not repurpose the pin glyph or status mark.
3. Drag ghost names the conversation and intended operation. All occupied tag headers expose a full-row drop target at least 32px high (proposed target, not measured here); highlight only the active target. Hit zones must not overlap section controls. Caption: `Add {tag} and group here`.
4. Hovering the top/bottom edge autoscrolls the **owning chat scroll region**, at a bounded rate; does not scroll agents or background content. Pause when the pointer leaves. Target geometry tracks scroll, not cached screen coordinates.
5. Drop adds the target tag and sets it primary; preserves other tags, pin state and existing section membership. Dropping on another section's same-tag header cannot transfer a chat's time/running membership. Untagged is not a remove-all drop target; use the picker for removal.
6. Escape, outside drop, lost pointer and window blur cancel without writes. Original row remains reachable. Successful drop announces the target plus Undo; Undo restores prior tags **and primary**, if no intervening edit; otherwise show the conflict instead of overwriting it. Save error restores position/assignments and provides Retry via picker.
7. Keyboard equivalent is Tags… → check category → Group under → Apply. No separate keyboard drag mode is needed; accessibility text names the equivalent.

### F6 — agent-created parallel sessions

1. Optional `tags` remains absent unless requested/guided. Unknown category is **refused with known categories returned**, not auto-created: one misspelling must not create a new group across every section. Resolve IDs or unambiguous names; do not leak a half-created session after validation fails.
2. Explicit category creation remains an intentional management operation. If no tags were requested, spawning works as today. A tags-incapable backend must not quietly discard a requested tag.
3. A spawned conversation's normal group/primary is identical to a human-tagged one. Existing `opened by {agent}` provenance stays distinct from its project tag. Picker details may say `Added by {agent}` when provenance is actually persisted; do not fabricate actor attribution from the current agent binding.
4. Human changes tags through the same picker. Agent refresh cannot revert a newer human edit. Disabling tag display never mutates session metadata or rewrites the conversation title; bracketed prefixes remain literal titles.

## 4. State / transition contract

| State | Event | Next state / visible feedback | Persistence / focus |
|---|---|---|---|
| Unsupported backend | Open options/menu | Explain tags unavailable; no editable fake-empty catalogue | Existing rows untouched |
| Supported, off | Enable | Grouped, or no-tags helper | Store view only; keep current row |
| Enabled, no categories | Create/Manage | Management dialog | Return to originating control |
| Enabled, other group mode or active search | Change mode / search | Grouping suspended; eligible row chips remain | Master stays enabled and preserved; restore groups when section mode returns and search clears |
| Grouped | Disable | Original untagged layout | Retain metadata and preferences |
| Row menu open | Tags… | Loading picker, then clean draft | Search focused; origin ID retained |
| Picker clean | Toggle / choose primary / clear | Dirty draft + primary preview | No server write or row jump |
| Picker dirty | Escape/Cancel | Closed | No write; row focus restored |
| Picker dirty | Apply | Saving | One atomic request, duplicate Apply blocked |
| Saving | Success | Close + announcement; row in new group | Server-confirmed tags/primary; focus same row |
| Saving | Failure/offline/timeout | Retain draft, actionable error | Retry or Cancel; reconcile ambiguous result |
| Dirty draft | Remote edit/delete | Conflict explanation + latest state | No silent last-writer overwrite |
| Manage | Reorder | Same category focused in new position | Explicit primaries unchanged |
| Manage | Delete | Confirm named count/consequences | Cancel focused; no write yet |
| Confirm delete | Success/error | Reconciled list / retained category + error | Never delete conversations |
| Grouped | New status/page/search result | Reconcile existing section rules | Stable identity, no duplicate rows |
| Dragging (later) | Escape/outside/blur | Original state | No mutation |
| Dragging (later) | Valid drop | Pending → confirmed target / rollback error | Add+primary only; Undo guarded |

## 5. Keyboard map and escape routes

This is the **required map**, not a claim that it was executed. Only the story-driven first-menu-item focus and the clicked pin action's return focus were observed (§1).

| Action | Required route / visible hint | Escape / return |
|---|---|---|
| Discover tags | Focus View options, Enter/Space; Tags heading/helper | Escape → View options |
| Toggle grouping | Tab to labelled Tags master switch, Space; checked state exposed | No forced mode change; chips have no toggle or tab stop |
| Navigate sidebar | Retain existing arrow/Home/End and Tab behaviour | Do not insert static chip tab stops |
| Open row actions | Context Menu or Shift+F10; hint includes Fn on Mac | Escape → same conversation button |
| Open Tags | Arrow navigation/typeahead to Tags…, Enter | Dialog Cancel/Escape → same row |
| Find category | Search tags input; Tab into results | Clearing search restores choices |
| Assign multiple | Space on labelled checkbox; arrows within result list if using roving focus | Selection does not close picker |
| Choose primary | Inline labelled Group under radio group among checked tags; arrows/Space, no second step | Selected primary announced by name |
| Clear all | Tab to Clear tags, Enter/Space | Draft only; Cancel restores original |
| Submit | Tab to Apply, Enter/Space; Applying tags… | Error focus stays in dialog; retry reachable |
| Create | New tag…, named input, Save/Cancel | Cancel returns to picker/management trigger |
| Manage/reorder | Manage tags…, Move {name} up/down buttons | Preserve category ID focus after move |
| Delete category | Delete {name}, confirmation, Tab to Delete tag | Escape/Cancel → category Delete control |
| Close management | Cancel/Escape discards draft; Apply commits, unless active bounded save | Return to picker or View options trigger |
| Drag equivalent | Tags… + Group under + Apply | No precision movement required |

Dialogs trap focus only while open, have accessible titles, visible focus outlines per branding §6, and scroll the focused control into view. Snapshot DOM order alone must not be reported as a verified physical-key traversal. Escape must not propagate from a picker through to closing the sidebar or deselecting its conversation.

## 6. Copy deck (proposed)

Use sentence case. Ellipsis means opening another surface, not a save action.

| Location | Copy |
|---|---|
| View row / master | `Tags` |
| View helper | `Keep your sections. Group conversations inside them by tag.` |
| Discovery helper | `Right-click a conversation and choose Tags…. Keyboard: Shift+F10 (Fn on most Mac keyboards).` |
| Suspended grouping | `Tag groups return in Time section when search is cleared.` |
| Automatic chip explanation | `Absent at the default width; appears only where there is room.` |
| Menu | `Tags…` |
| Picker | `Tags for “{conversation}”` / `Search tags` |
| Picker primary | `Group under` / `This conversation will appear under {tag}.` |
| Last tag removed | `This conversation will be untagged.` |
| Actions | `New tag…` / `Manage tags…` / `Clear tags` / `Cancel` / `Apply` |
| Empty categories | `No tags yet` / `Create tags to organise conversations without changing their titles.` |
| No matches | `No tags match “{query}”.` / `Create “{query}”…` |
| Group fallback | `Untagged` |
| Loading | `Loading tags…` |
| Load failure | `Tags could not be loaded. Try again.` / `Retry` |
| Save pending | `Applying tags…` |
| Save failure | `Tags were not saved. Try again.` / `Retry` |
| Offline | `You’re offline. You can review your changes; reconnect to save them.` |
| Conflict | `Tags changed elsewhere. Review the latest tags before applying.` |
| Assignment success | `Tags updated. Grouped under {tag}.` |
| Clear success | `Shown under Untagged.` |
| Management | `Manage tags` / `Tag name` / `Add tag` / `Rename` / `Delete` / `Done` |
| Duplicate / blank | `A tag named “{name}” already exists.` / `Enter a tag name.` |
| Delete title | `Delete “{tag}”?` |
| Delete body | `Remove this tag from {N} conversations? Conversations will not be deleted. Other tags stay.` |
| Delete primary consequence | `Conversations grouped here move to their oldest remaining tag, or Untagged.` |
| Zero-use delete | `No conversations use this tag. Conversations will not be deleted.` |
| Delete actions | `Cancel` / `Delete tag` |
| Delete failure | `Could not confirm deletion of “{tag}”. Check the current tags before trying again.` |
| Unsupported | `This backend does not support conversation tags.` |
| Unknown agent tag | `Tag “{name}” does not exist. Choose an existing tag or create it first.` |
| Later drop feedback | `Add {tag} and group here` / `Grouped under {tag}.` / `Undo` |

## 7. U-findings: critique of the initial proposal

These are **design risks at the named proposed step**, not fabricated bugs in unimplemented tags. The revised contract above resolves their design ambiguity; implementation evidence remains mandatory.

| ID / severity | Concrete point of friction | Required resolution / status |
|---|---|---|
| U1 MAJOR | Initial assignment model: opening a pinned row's already seven-item menu and appending one checkbox per category creates an unbounded menu. Baseline keyboard frame is already a five-item 273×175 menu; initial proposal cannot claim sidebar-contained height. | One Tags… item → bounded searchable dialog; accepted revision. Measure short-window scroll and 0/1/50 categories. |
| U2 MAJOR | Initial multi-select: first immediate checkbox write can move the conversation to another group before second selection; Cancel semantics undefined. | Draft + atomic Apply, no row movement until success, stable origin focus and error draft retention. Spec resolution; needs implementation. |
| U3 MAJOR | Initial primary rule: moving category Project before Fix could silently regroup every multi-tag conversation, despite no assignment action. | Explicit primary; reorder affects group order only. Stable first-assigned replacement when removed, previewed by name. Manager revision accepted. |
| U4 MAJOR | Enable from Agent and team / In one list: proposal says existing sections remain but these modes do not present the same time-section structure. An implicit forced mode switch would contradict the user's saved view. | No prerequisite switch or silent rewrite. Resolved by suspending only grouping outside Time section or during search, preserving an enabled master switch and row chips; implementation must prove the saved-mode/search transitions. |
| U5 MINOR | First encounter: Tags is invisible if the only teaching is a right-click menu; automatic chips may never fit. | Short View options helper + existing row action hint. No permanent tag button or dot. |
| U6 MINOR | Pointer enters a chip-bearing row: chip disappears while actions appear. Repeated refit or immediate reappearance across nested menu focus would read as flicker. | Interaction-latched paint removal, no geometry shift; consecutive hover→focus→menu→close frames and reduced-motion proof. Not settled by this before-only run. |
| U7 MINOR | Scan a 220px list with one conversation per tag: section-style subheaders consume attention and scrolling; empty categories make this worse. | Subordinate one-line occupied-only headers, no initial subheader collapse, no empty groups, Untagged only for mixed sections. Measure many-group scroll cost. |
| U8 MINOR | Drag onto a distant scrolled group without an explicit drag origin: title pan/text selection competes with assignment; user cannot tell if a section transfer occurred. | Deliberate grip, explicit add+primary feedback, owning-region autoscroll and Escape; picker equivalent. Accept deferred first slice, not complete LOH-11. |

No BLOCKER identified in the design scope. Four MAJOR ambiguities in the original proposal are resolved **in this specification**, not verified fixed in a running tags feature. No extra follow-up issues or MR comments created.

## 8. Testable implementation acceptance / proof matrix

Run independent real-path UX/QA in an isolated app profile with durable synthetic sessions; Storybook fixtures alone cannot prove persistence or concurrency. Capture actual requests/responses and source-to-installed-build identity. No heavyweight duplicate full suite.

- **Default and disable:** compare same fixture/scroll/selection before→on→off at 220/260/320; assert equal row counts/order/bounds, title leading edge, height, status/pin marks and scroll ownership against off control. Include classic scrollbar, narrow viewport and collapsed/overlay modes. Metadata remains after restart; Tags switched off leaves no tag rail/slot/chip. Separately test suspended grouping in search/other modes with master on: eligible chips remain. At 220/260px no chip passes; verify unchanged baseline geometry there.
- **Theme and scale:** light/dark frames plus one non-default theme; small/large display settings, larger text/zoom and reduced motion. Theme suite covers role pairs across supported themes; no arbitrary colour values or colour-only labels. Target size assertions use measured DOM, not screenshot estimates.
- **Mode transitions:** Time section ↔ Agent and team ↔ In one list, grouping on/off, reload; existing time/order/hidden-section settings survive. Explicit mode-switch copy/action is reachable; assignment never silently changes grouping mode.
- **Primary invariants:** assign A/B, choose B primary, reorder A/B, rename B, remove B, delete B, clear all; one conversation once, same section membership, stable deterministic fallback shown before save, counts correct. Test running/pinned/archived search and page boundaries; no tag-title prefix parsing.
- **Picker:** 0/1/32 categories (the cap is 32), long/unbroken/Unicode names, search with no matches, multi-select, create duplicate/blank, clear and cancel. No row movement before Apply; inline Create is a durable registry write. Click/touch label hits measured ≥24px; use ≥32px menu/picker rows as design target. Dialog and actions remain inside short viewport with scroll and no horizontal overflow.
- **Physical keyboard:** real Tab/Shift+Tab, arrows, Home/End, Context Menu and Shift+F10 on conversation and inner action controls. Enter Tags…, select multiple with Space, choose primary, Apply, Escape and cancel from every nested state. Capture active-element readback after each transition; moved/deleted origin has deterministic focus fallback. Focus outlines not clipped by scrollers.
- **Feedback:** deliberate slow load/save, offline, backend failure, timeout after possible server commit, concurrent agent/human edit and category deletion during draft. Persisted snapshot never falsely becomes empty; drafts survive retries; no misleading success before confirmation, duplicate writes or permanent blocked dialog.
- **Management:** rename preserves IDs/assignments; category order does not regroup explicit primaries; delete confirmation reports distinct conversation count and safe focus, never deletes conversations. Returning to picker preserves draft and focus. No silently seeded starter categories.
- **Chip motion:** capture consecutive settled frames on pointer entry, movement within row, keyboard focus, menu open/close, leave, resizing. Record title box/controls/chip rects and computed fit inputs. No chip if action-state title <120px; no crop, wrap, hit-area move, relayout under pointer or status removal. Verify tooltip/full tag name and accessible tags when chip absent.
- **Agent creation:** known tags accepted and persisted; unknown tag refused without partial session/category; capability mismatch explicit; omitted parameter unchanged; actor provenance factual and human override durable. Restart and second client show same assignments/primary.
- **Drag slice:** grip versus selection/pan, short and overflowing lists, owning-region autoscroll, first/last/offscreen targets, blur/Escape/outside cancellation, valid add+primary, untouched other tags and section, rollback, guarded `expected_revision` Undo (including add-then-clear), equivalent keyboard picker, visible-occupied-only targets, empty categories via picker, all-tagged section without Untagged header via menu, and bucket-scoped pinned reorder at ≥2 occupied buckets. Do not close LOH-11 until this is independently exercised.

### First vertical slice and verdict

Smallest usable slice: durable category/assignment/explicit-primary contract + agent known-tag validation; capability-gated optional grouping; View options discovery; Tags… draft picker; add/rename/reorder/delete management; stable focus/error handling. **Chips are not in this slice** — they are the separate, independently proven slice described in `sidebar-tags.md` §11(a). Likewise, **defer drag as a separate interaction proof**, rather than pretend title text is a safe drag handle.

**Design round verdict: TERMINAL for the flow specification with the recorded minor risks carried into implementation acceptance.** This is not implementation approval or a full LOH-11 completion verdict. Remaining unverified: physical keyboard/right-click targets, Escape/focus return beyond the observed pin action, successful archive/pin baseline mutation, complete wide/narrow resize sweep, tags screens themselves, chip flicker, durable/network/concurrent behaviour and drag. Repeated browser-host loss prevented further current-flow captures; no substitute browser was launched. Implementation PR must supply the discriminating live paths above, not relabel these before frames as after evidence.

## 9. V2 addendum — operator feedback, 2026-10-18

This section supersedes the v1 deferral of drag and adds the four other v2
surfaces. The detailed geometry, cache and API decisions are in
[`sidebar-tags-v2.md`](sidebar-tags-v2.md); the client contract is
[`sidebar-tags-api.md`](sidebar-tags-api.md).

### 9.1 Drag and drop

1. Press and hold any conversation row; the hold **reaches 180 ms with ≤5 px
   movement** and the row arms for drag. A press on an interactive descendant
   (pin grip, menu trigger, chip, link) keeps that control's own gesture. The
   exact outcomes are a state machine: a move >5 px before 180 ms is a
   scroll/selection (no click, no drag); a release before the hold reaches
   180 ms and ≤5 px is an ordinary click; a completed 180 ms hold at ≤5 px
   arms the drag and captures the pointer; once armed, the completing click is
   suppressed. A release after a drag never also opens the conversation.
2. Pinned rows keep the existing grip and its reorder gesture. Click-hold on
   the pinned row body also arms a row drag. When Pinned has tag headers, the
   grip/body reorder is scoped to the dragged row's **own bucket**, derived
   with `groupChatsByTag`'s rule (primary only if non-null, known and present
   in `tags`; else `untagged`): filter the measured row boxes to that bucket
   and pass the bucket ids as `shownIds` to `movePinnedOrderTo`; the write
   preserves every other row's relative order. A drop on a different tag header
   assigns; a drop on another bucket's rows is not a reorder target. The
   insertion indicator, Escape behaviour and one-row guard are unchanged. The
   shipped grouped-order bug (`pinDragRowBoxes` vs the flat stored order) is
   fixed and regression-tested at ≥2 occupied buckets.
3. The eligible targets are a **visible occupied** 28 px tag-group header and
   the visible Untagged header **in the row's own existing section**, only
   with tags enabled, `groupBy === "section"`, the section drawing tag
   headers, and no active search. Pinned is included: the shipped Pinned
   section groups by tags. Agent/team and Flat modes have no tag headers and
   no tag drag. Empty categories have no header and are not drag targets; use
   `Move to tag…` or the picker. An all-tagged section has no Untagged header;
   clear with `Remove all tags (N)` or `Move to tag… → Untagged`. Section
   membership (Pinned/Running/Today/This week/Older) never changes by drag.
4. Drop on a tag header: add that tag if absent and make it primary; keep the
   other assignments. A row is therefore drawn in exactly one bucket, its
   primary. Drop on the current primary is a no-op. Drop on Untagged: clear
   every assignment and primary in one write.
5. Preview: the target header gets accent-wash + accent outline; an armed row
   carries the established drag mark. The drop uses the shipped optimistic
   assignment path: the row may re-bucket immediately, the request settles it,
   and failure restores the prior tags/primary. There is no ghost bucket; the
   row is not frozen until the response. Pinned reorder keeps its insertion
   line. No arbitrary manual order inside a tag group in this slice; the
   existing sort re-applies.
6. Escape, pointercancel, window blur, or release outside an eligible target
   cancels with no write. Autoscroll the owning list in the existing 32 px
   edge zone at 12 px/frame.
7. Success: `Moved to “Review”` / `Removed all tags` with Undo. Undo is
   guarded by the optional `expected_revision` precondition: it sends the
   per-session revision its own write returned; a 409 `tags_conflict` means a
   later write changed the row, even if the values were returned to the same
   list, so the client refreshes instead of overwriting. Failure returns the
   row to its prior bucket/primary and shows the assignment error.
8. Keyboard equivalent: `Move to tag…` in the row menu opens the picker in
   move mode (the categories and Untagged); choosing one performs the same
   write and returns focus to the row. Drag is never the only route.
9. While a row drag is armed/settling, suppress any chip hover/focus/menu
   swap so a later chip slice cannot relayout under the pointer. Test the latch
   even though v2-1 draws no chips.
10. At 220 px: 32 px rows, 28 px header targets, no horizontal overflow; the
    optimistic re-bucket is allowed, and failure restores the prior position.
    Light/dark frames.

### 9.2 Remove all tags

- The row menu shows `Remove all tags (N)` only for a row with ≥1 tag, where N
  is the number of distinct assigned tags. It clears all N and primary in one
  request. A multi-tag row is the acceptance case.
- The action is disabled while a picker is open for that row. Success offers
  Undo; failure leaves the row unchanged and shows the assignment error.
- The shipped menu mounts up to eight rows on a pinned row and six on a
  non-pinned row; V2-1 adds two (`Remove all tags (N)` and `Move to tag…`),
  making the widest state a pinned tagged row at 10 rows (a non-pinned tagged
  row is 8; a pinned untagged row 9; a non-pinned untagged row 7). The eight-
  item design cap is deliberately exceeded by required actions; the plan raises
  the menu to a scrollable max-height with 32 px targets and tests reach at
  220 px and a short viewport. `Tags…` is already one of the eight.

### 9.3 Auto-tagging in the fork/naming call

- The fork naming call (`generate_title_acceptance`) returns title **and**
  tags in the existing call; tags add **no tag-specific provider request**.
  The title cascade may still make up to two samples and two fit checks (and
  its auth retry). Tags are parsed from the **accepted sample only**, before
  the title parser sees them; a rejected sample's tags are discarded. The tag
  block and the tag-bearing corrective addendum are selected only when the
  caller supplies `tag_contract`; `generate_retitle` passes none, so the
  title-only prompt/addendum stays byte-identical. The tag block is a stable
  prefix; `tag_set_hash` changes when a category is added/renamed/reordered.
  No provider `prompt_cache_key` is added or claimed; the hash is a prompt-byte
  identity, not a cache-hit promise.
- Output contract: known ids or exact case-insensitive names, deduped, ≤8;
  unknown/invalid output means no assignment. Tags never change the title
  acceptance and never create a category. Same-line and newline forms,
  truncated blocks and a `<tags>` string inside a title are parse tests.
- Only **desktop UI forks** with auto-tag enabled and a non-empty registry are
  tagged. `Fork` gains `auto_tag: bool = False`; the UI sends `tagsEnabled &&
  autoTagForks`; the desktop route writes `auto-tag.json` into the child
  session after the fork returns, only when true. The shared-slash payload
  stays entry_id-only; TUI and peer forks default false and do not acquire the
  sidecar. The View-options toggle is captured at fork time; changing it later
  does not change an existing fork's intent.
- **Manual edits win, including add-then-clear before the first turn:** the
  desktop route records the child's **fork-time `tags_revision`** in
  `auto-tag.json` (a new/empty child has the stable zero revision). The
  auto-tag write is conditional on that recorded revision, not a snapshot
  taken when naming starts; a human who tags and clears the fork before its
  first substantive turn changes the revision and skips auto-tag. A child that
  already has tags at fork time never runs auto-tag. A later manual clear does
  not trigger a re-run. Registry
  drift validates at write time; deleted categories are dropped, and no
  category is created from model output. `Tags…` is the visible correction
  route; auto-tag does not reassert afterwards.
- View options Tags group gains `Auto-tag forked sessions`, default **on**,
  visible only with tags enabled; it persists with the view and is measured in
  the View-options height budget. Agent-created sessions use their explicit
  `tags` argument, not this setting.
- Fork/naming acceptance: **delta 0 tag-specific calls** (not "one provider
  call"); prefix/hash tests, accepted-sample parse, manual-edit precedence,
  invalid-output test, no-tags/off no-op (title still runs), real fork result.

### 9.4 Tag creation UX

- Replace the checkbox-only picker with a combobox whose actual width is
  `min(420px, viewport - 32px)`: selected tags as removable chips in the
  input, filtered list, Arrow/Home/End navigation, Enter toggles, Space toggles
  only when an option is active (otherwise it types a space), Backspace on an
  empty query removes the last chip, Delete on a focused chip removes it and
  returns focus to the input, Escape closes the listbox first and a second
  Escape cancels. Selecting an existing tag never duplicates it.
- Inline `Create “query”` appears only when no exact case-insensitive match
  exists. **Activating Create writes the category immediately** (durable,
  shared with all conversations) and selects it; Cancel closes without
  assigning but does not undo the created category. The helper states
  `Create “X” — saved for all conversations` so this is explicit.
- The primary chip carries a leading dot and an accessible "Primary"
  description, not a colour. `Group under` remains a compact radio row among
  selected tags when ≥2; one selected tag is statically primary; zero previews
  Untagged.
- Footer Cancel / Apply; Apply commits one assignment. The dialog body scrolls
  at a short viewport and the footer stays pinned. Chips wrap inside the
  dialog; long names truncate inside the chip with the full name accessible,
  never the title column.
- Manage becomes a searchable ordered list with inline rename, duplicate
  validation, add, up/down, and delete with count and primary consequence.
- No colour/role in this slice. Keyboard-first proof and before/after frames at
  sidebar 220/260/320 light/dark, the dialog at 420px and a short/narrow
  viewport; density 0/1/32 categories (the cap is 32, not 50).

### 9.5 Agents and cross-surface

- Add the `tags` tool: `list`, `create(name)`, `rename(id, name)`,
  `assign(session_id, tags[], primary?)`; `assign` takes **names only**, the
  same validation as `sessions spawn tags`, is atomic and receipted. Creation
  is explicit; a misspelling is refused, never auto-created. Delegated/hidden
  sessions are assignable; mesh/remote writes are refused with 409
  `session_is_remote`. The tool is a V2-4 target, not shipped today.
- The store stays the only authority. Desktop, TUI and the mobile relay read
  the same catalogue/registry and write through their own transport over that
  store. Mobile uses the relay (`GET/PUT /api/...`), not `/v1/desktop/*`, and
  must not keep a second category database; the contract is
  `sidebar-tags-api.md`.
- TUI parity in this slice is read-only and opt-in: `/tags on|off` (default
  off) shows the primary tag as a compact `#Tag` suffix when it fits; no
  grouping, chips or assignment. Narrow widths shed the suffix before the
  title. `CatalogEntry` gains `tags`/`primary` in this slice; it does not carry
  them today.
- Acceptance: tool list/create/rename/assign tests (names-only, duplicate,
  unknown, remote 409) and a real agent call; TUI on/off/narrow frames; the
  mobile owner (session `4264c9a75553`) confirms the relay contract covers
  read and assign with no duplicated store.

### 9.6 Slice order

V2-1 drag + remove-all (core + UI: `tags_revision` and the optional
`expected_revision` precondition, plus the grouped pinned-drag fix), V2-2 picker
UX (UI), V2-3 auto-tagging (core + UI), V2-4 agent tool + TUI + contract (core +
TUI + docs). Each is gated by tests, i18n, rendered evidence, independent
review, QA, and design/UX where the surface changes; no version bump and no
release cut by the lane.

### 9.7 Copy additions

| State | Copy |
|---|---|
| Drag armed | `Move “{title}”` / `Escape cancels` (live region, once) |
| Drop target | `Group under “{tag}”` / `Remove all tags` for Untagged |
| Drag success | `Moved to “{tag}”.` / `Removed all tags.` |
| Undo | `Undo` (single action; restores the prior assignment only if its revision is unchanged, otherwise shows the conflict) |
| Drag failure | `Tags were not moved. Try again.` |
| Remove all menu | `Remove all tags ({N})` |
| Auto-tag setting | `Auto-tag forked sessions` |
| Auto-tag helper | `Uses your existing tags when naming a fork.` |
| Move to tag | `Move to tag…` / `Untagged` |
| Picker create | `Create “{query}”` |
| Picker primary | `Primary` / `Group under` |
| Manage duplicate | `A tag named “{name}” already exists.` |
