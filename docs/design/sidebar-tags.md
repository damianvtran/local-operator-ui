# LOH-11 — optional conversation tags

Design brief · 2026-10-18 · **first slice implemented** (UI #1177 / core #2600).

> **V2:** the operator's 2026-10-18 feedback (drag/click-hold, remove-all,
> auto-tagging, a modern tag picker, agent operations and cross-surface tags)
> is planned in [sidebar-tags-v2.md](sidebar-tags-v2.md); the client contract
> is [sidebar-tags-api.md](sidebar-tags-api.md). This v1 brief remains the
> measured baseline for the shipped off/grouped view.

Designer: designer / **openai/gpt-6.1-sol**, temporary fallback after Anthropic quota exhaustion. Baseline inspected: `76dda0304bfa4b54ebd42cccd32bbd05841ca4a3`; worktree HEAD and origin/main both resolved to that SHA when this brief was written. Independent interaction contract: [sidebar-tags-flows.md](sidebar-tags-flows.md). This PR (#1176) is the docs-only design phase; no implementation PR exists yet.

## 1. Problem, scope and references

The operator wants optional structured conversation tags, enabled in sidebar **View options**, grouping *inside* existing Pinned / Running / Today / This week / Older sections. The panel is resizable: **220–320px, default 260px**, collapsed strip 56px. Tags must not consume the title merely because a sidebar has a nominal width. Assignment must support multiple tags, categories must be manageable, and a later slice must allow dropping a conversation onto a tag group. Agent-created sessions should accept optional tags. LOH-1 may consume the same metadata for tabs later; there are no tabs here.

Source of operator scope and reference: the operator's 2026-10-18 LOH-11 request (reproduced in §1) and its corrected current-context-menu facts. Sherman's 2026-10-14 Slack reference, as transcribed there, shows a Codex sidebar with `[Review]`, `[Fix]`, `[Project]`, `[Concept]` title prefixes, not coloured chips. That establishes a recognition pattern, not a requirement to copy the encoding. **Never parse, prepend, strip or rewrite titles.** Structured IDs support persistence, grouping and later tabs without damaging user-authored bracketed text.

Sources inspected: `docs/branding.md` §§0/3/5/6/9; `docs/design/sidebar-row-space.md`; `docs/design/sidebar-sections.md`; `chat-sidebar-layout.ts`, `chat-sidebar-view.ts`, `chat-list-sections.ts`; `chat-sidebar.tsx`, `chat-sidebar-view-menu.tsx`, sections stories; `shared/components/ui/{badge,context-menu,popover}.tsx`; generated theme CSS; `ui-preferences-store.ts`.

**Two important corrections to the initial brief:**

- A row context menu already ships. It contains five ordinary actions and a conditional Move pair. Reuse its primitive; add **one `Tags…` item**, not one item per category. A new context-menu primitive is not needed.
- The preference storage key is **`ui-preferences-storage`**, with existing field **`chatSidebarView`**. `chat-sidebar-view` is not the verified persisted key. Additive tag display preferences belong alongside the existing view contract; shared categories/assignments belong in durable backend data, not this local view preference.

## 2. Final visual and information model

### Off means absent

Off by default. Enabling is explicit. Off means no tag subheaders, no chips, no reserved tag pixels, no new row control and no reordering from tag metadata. Turning off does **not** delete assignments. Existing section order, membership, pagination, title pan, status/locality cells, pin state, row height and scroll containers remain authoritative.

The `off-{light,dark}.html/png` sheets use exact crops of the real before images, not a reimplementation. This is a baseline reference, **not proof that an implemented toggle restores layout**. The implementation must compare its own off path against that baseline.

### Group only within Time sections

`tags.enabled` is independent of `groupBy`. Subdivide conversations only when `groupBy === "section"` and search is empty. Do not silently overwrite Agent and team or In one list. Preserve the switch when a mode change suspends grouping. Show `Tag groups use Time section grouping.` with an explicit **Use Time section** action; only that press changes the existing mode. Assignment remains available.

Search temporarily suspends tag grouping: retain flat search results, their existing membership explanations and marks. Clear search to restore groups. A future chip implementation may identify tags in search only when the same measured fit rule passes; it must not replace the search explanation slot. First slice has no chips anywhere.

Within each existing conversation section, draw nonempty primary-tag groups in category order, then **Untagged**. Preserve the existing order within each bucket. One conversation appears once. Pinned/running membership wins over tags; tags never move a running row into Today. Section counts remain conversation counts, not assignment counts. Subheader counts describe the visible bucket, not an invented total beyond pagination.

A section with no tagged rows draws no tag subheaders. A section with one occupied category may draw its one labelled subheader: its label is useful even without a sibling category. No empty category buckets. Category management remains the route to create an initial category; there is no empty-section scaffolding.

**Subheaders are 28px static labels, not controls. No chevrons and no collapse in slice 1.** They add vertical height but **zero horizontal indentation or row-width cost**. Rows remain at their existing x coordinate. For the proposed Today example, two buckets cost 56px; two This week buckets cost another 56px, independent of sidebar width. The shared scroller absorbs this height; no nested list scroller.

### Multi-tag semantics and explicit primary

Store category identity independently from its display name. The primary tag is explicit session data. The picker preserves an existing checked primary; initial assignment supplies one. With two or more selections, show an inline **Group under** radio group containing the checked tags. With one selected tag, show a static **Primary** note; with zero, show Untagged. No `Choose primary…` second step.

Adding a secondary tag, renaming a category or changing category display order must not silently regroup a conversation. Removing/deleting the primary chooses the **oldest surviving assigned tag**, with deterministic ID tie-break for legacy ties; preview this replacement before Apply. No assigned tags means Untagged. This follows the independent UX contract, not the earlier category-order fallback proposal.

### Neutral, not colour-coded

Slice 1 has **names and order only**: no colour picker, no arbitrary colour, no `role` field reserved without a use case. The reference has no colours and the app has 59 themes. Neutral group labels and badge treatment use existing role tokens. Accent remains selection/focus/drop feedback, success remains running status, and danger remains destructive feedback; those are not tag-category colours.

No 3px rail/dot fallback. Existing status, unread, locality, pin and team marks already have meanings. A new rail would spend scarce space and create another colour legend. The group label is the reliable primary-tag identifier; the picker/accessibility description exposes secondary tags.

## 3. View options: discoverable without enlarging the feature

Insert **one compact 40px Tags row after Order by and before Sections**, containing the master switch and **Manage tags…**. Keep Sections intact: same controls/order/semantics, moved down by the insertion. No in-popover category editor and no second nested scroller. Accessible switch label: `Group chats by tag`; visible group label: `Tags`. Associate the mode-suspension explanation when necessary.

No Show chips checkbox in this slice. Future chips are an automatic full-label fit decision, not a second default-on view control. An additional user preference is deferred unless a later need justifies it.

**Measured base, not a misread caption:** real `view-options-light.png` reports `box 240x640 · bottom 682/720 · content 638`. The `682/720` is *rectangle bottom / viewport height*, not content height; the story's `panelGeometry()` source confirms this. Base interior is 638px, with no content overflow at this viewport. The proposed 40px insertion yields **678px content / 638px interior = 40px scroll**. The corrected proposed View sheets actually measure **240×640, scrollHeight 678, clientHeight 638**, at all three comparison widths.

Keep the existing available-height clamp (`overflow-y:auto`, no horizontal scroll); do not hard-code 640 for other viewport heights. Show a visible scrollbar/scroll affordance when content exceeds the viewport; a decorative bottom fade may supplement it, never cover or disable the final controls and never serve as the only indication. All Sections controls remain keyboard reachable and scroll into view. `view-scrolled-{light,dark}.png` demonstrates reaching the bottom. The 240px popover may extend over the content pane at a 220px sidebar; sidebar width is not the popover's width constraint.

Discovery helper on first enable or in the Tags setting description: `Right-click a conversation and choose Tags…` plus `Shift+F10` in its accessible description. Do not add a permanent row icon to teach an action already available in the context menu.

## 4. Assignment and management surfaces

**Tags… opens a viewport-bounded modal dialog**, not another sidebar popover. Preferred width **420px**, maximum **app viewport minus 32px**; 420 is not a hard minimum on a smaller window. Centre over the app, not over the sidebar. Interior scrolls in a short viewport; title/actions remain reachable. Reuse the dialog family: elevated ground, hairline frame, 14px radius, overlay shadow, scrim.

Picker: checkbox list with generous whole-label targets; search when the category list needs it; **buffer checks and primary locally, then Apply one atomic change**. Cancel/Escape leaves durable tags untouched. No regrouping after the first checkbox. Two or more checked tags reveal the inline Group under radio list; the footer is Cancel / Apply. Pending/error states keep the draft visible. An explicit Clear tags operation is also buffered until Apply.

Management uses the same modal family: ordered name list, up/down controls, Rename, Delete, full-width New tag name field and Add, Done. No chip preference or colour editor. First/last reorder controls are disabled as appropriate, with disabled role colour rather than opacity. Long names may truncate in the list only with their full value reachable in rename/details; never allow action controls to wrap.

Deletion confirmation: `Delete “Review”?` / `Remove this tag from conversations. Conversations will not be deleted.` Cancel / Delete tag. Announce affected distinct-conversation count when known. Rename preserves IDs/assignments; delete cannot mean delete chats. Starter categories may be offered explicitly as an add action, never silently seeded.

**Corrected modal measurements:** picker **420×436**, management **420×420**, in both themes and at all sidebar widths 220/260/320. Picker scroll/client **434/434**; management **418/418**. These corrected frames replace the rejected sidebar-width popover mockups. Native interaction/focus trapping is still unimplemented and unverified.

## 5. Measured row geometry — current head, not historical arithmetic

Readings came from harness `browser.styles` on the live Storybook fixtures at **1280×720 CSS px, DPR 2**. PNGs are 2560×1440. Body/title font is `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; title **13px / 20px**. Row button gap **4px**, horizontal padding **4px**. Locality cell **14px**; status slot **16×16px**. Status and locality are never removed to fit a tag.

`sidebar-row-space.md` describes older fixtures and widths. Its older title totals do **not** describe this head: current entities, locality, team statement, timestamp, scrollbar/gutter and pin controls leave substantially less space. Do not reuse its nominal 180px default title claim.

### Live before and seeded action state

| CSS px | panel 220 | panel 260 | panel 320 |
|---|---:|---:|---:|
| Actual nav width, border excluded | 219 | 259 | 319 |
| Row wrapper width × height | 180×32 | 220×32 | 280×32 |
| Title leading x | 54 | 54 | 54 |
| First pinned title, rest | 46.98 | 86.98 | 146.98 |
| Running title, rest | 101.39 | 141.39 | 201.39 |
| First ordinary team/title+time row, rest (dark) | 75.30 | 115.30 | 175.30 |
| First pinned title, seeded action state | 17.39 | 57.39 | 117.39 |
| Running title, full action pair | 45.39 | 85.39 | 145.39 |
| Unpinned action pair box | 52×24 | 52×24 | 52×24 |
| Pinned cluster with grip box | 80×24 | 80×24 | 80×24 |

Unpinned pair: **24 + 4 + 24 = 52**, plus outer row gap **4 = 56px**. Pinned cluster: **24 archive + 4 + 24 grip + 4 + 24 pin = 80**, plus outer gap **4 = 84px**. Resting pin already costs **24 + 4 = 28px**. The pinned row's timestamp withdraws on action reveal, so its measured title loss is **29.59px**, not blindly 56px. Running has no timestamp withdrawal: its measured title loss is **56px exactly**.

The original section fixture omits archive capability and does not publish `pinned:false` on unpinned rows. For action measurements only, the evidence story patch archived at `docs/evidence/loh-11-design/harness/` enables archive and supplies explicit false pin values, then seeds the real hover-intent layout attribute. Without that payload correction an unpinned row has only a 24px archive control, **not** a measured 52px pair. Final readings in `before/action-measurements.json` use the complete payload. These are rendered layout-state measurements, not an executed pointer-dwell gesture or mutation test.

Dark/light row geometry is compatible; base light pinned glyph metrics differ by a few hundredths on some rows, so raw per-theme readings are retained. Do not claim byte-identical theme text rasterisation. Groups-only proposals reproduce the above first pinned/running title widths and row widths in both themes.

### Chip sizing and adaptive rules — proposed later slice

**Full label or no chip. Never ellipsise a chip label.** One noninteractive neutral primary badge, no secondary `+N` counter. No badge at the collapsed strip; no rail fallback.

Badge font measured **12px system-ui / 16px line-height**, side padding **6px each**, border **1px each**, height **20px**. Define:

- `T`: measured full label glyph width in the active font/theme/scale, not character count multiplied by an average.
- `B = T + 12 + 2`: intrinsic badge width.
- `C = max(B + 4, 56)`: row allocation, including the 4px gap, with a transparent minimum action-replacement budget. The badge itself is content-sized, not stretched.
- Conservative narrow-mode veto: **panel width ≤260px draws no chips**. Above260px, fit only if **both** `restTitle - C >= 120px` and the actual action-state title without a chip is **>=120px**. This cutoff is a proposed policy, not a measurement that every possible narrow row fails. Measure the real row after all mandatory marks/qualifiers; nominal wide sidebar width alone never qualifies a chip.

| Measured label | T | B | B + gap | Final C |
|---|---:|---:|---:|---:|
| Fix | 16.125 | 30.125 | 34.125 | 56.000 |
| Review | 40.023 | 54.023 | 58.023 | 58.023 |
| Project | 40.117 | 54.117 | 58.117 | 58.117 |
| Concept | 47.938 | 61.938 | 65.938 | 65.938 |
| `1234567890` (ten glyphs, not an average) | 72.633 | 86.633 | 90.633 | 90.633 |

| Title budget, running fixture | 220 | 260 | 320 |
|---|---:|---:|---:|
| Tags off / groups only | 101.391 | 141.391 | 201.391 |
| Candidate Review residual (`rest − 58.023`) | 43.367 | 83.367 | **143.367** |
| Final chip drawn | no | no | yes |
| Final title with chips rule | 101.391 | 141.391 | **143.367** |
| Actions replace chip, title | 45.391 | 85.391 | **145.391** |
| Change on eligible chip→actions | n/a | n/a | **+2.023** |

At 320 the ordinary team/time row has **175.30 − 58.023 = 117.28px**: no Review chip. First pinned row has **146.98 − 58.023 = 88.96px**: no chip. A long category label fails the same gate and is absent, not clipped. At 220/260 these measured fixtures admit no chip, consistent with the conservative narrow-mode veto. A universal measurement claim for all possible rows at those widths has **not** been swept. Above260px the two per-row floors remain mandatory; chips are deferred from the first slice.

The transparent minimum is important: Fix's intrinsic cost is only 34.125px; simply swapping it for 56px actions would shrink the title by 21.875px. Reserve at least 56px in a chip-bearing resting row. Review releases 58.023px for 56px actions, giving the measured **+2.023px**. Additional timestamp/statement withdrawal may free more space; never depend on it without measuring.

Hide the chip for the entire pointer-hover / keyboard-focus / row-menu-open interaction; replace its allocation with the existing actions, do not overlay controls on text. Restore only when all three states end. Fit is stable for that interaction, recomputed on actual layout/font/zoom changes, not on every pointer move. No tag entrance/width animation. Actual pan/resize/focus flicker remains a later live-app gate.

The chips sheets are explicitly **illustrative**: only the Running example is assigned for this fit demonstration. Other rows illustrate geometry, not a final visibility algorithm. A production implementation must evaluate every tagged row, never select showcase rows by title/index.

## 6. State and copy contract

| State | Visual treatment / copy |
|---|---|
| Off | Existing sidebar only; assignments persist. |
| On, no categories | No empty subheaders; `No tags yet` in management/discovery, `Create tag…` or Add. No silent seeding. |
| On, categories but no tagged rows | Existing rows/order; no subheaders in unaffected sections. |
| No conversations | Existing empty-conversation treatment; do not replace it with a tags empty screen. |
| One category | One neutral subheader where occupied; one checked item is statically Primary. |
| Multiple assignments | One row under explicit primary; checks + inline Group under radios in picker. |
| Untagged | Last nonempty bucket, label `Untagged`, not an editable/deletable category. |
| Running / pinned | Existing section, marks, controls and priority preserved; tags subdivide, never migrate. |
| Search | Existing flat results and explanation slot; grouping suspended until clear. |
| Agent / In one list | Assignment works; grouping suspended; explanation + explicit `Use Time section`. |
| Collapsed 56px strip | No subheaders/chips/extra tag glyph; expanded view preference retained. |
| Loading categories | `Loading tags…`; do not present an editable empty list before the read resolves. |
| Loading failed | `Tags could not be loaded. Try again.` Retry; preserve known sidebar data, never untag on failure. |
| Applying | `Applying tags…`; prevent duplicate submission, keep draft and focus context. |
| Apply failed | `Tags were not saved. Try again.` Keep selected checks/primary; Cancel remains safe. |
| Clear | Zero draft checks → Apply; `Shown under Untagged.` No immediate network clear. |
| Concurrent category deletion | Explain missing category and refresh/reconcile draft before an atomic retry. |
| Delete tag | Explicit confirmation; only category/assignments removed, never conversations. |

Loading/error/empty/degraded/concurrency rows above are **specified, not rendered or exercised in this phase**. Implemented PR evidence must include them; populated static sheets are not coverage for these states.

## 7. Keyboard, focus and motion

Context Menu key / Shift+F10 opens the existing row menu (Fn where required on Mac); Tags… opens the dialog. Restore focus to the originating conversation/menu trigger after Cancel/Apply, or the nearest stable row if it disappeared. Existing roving row navigation remains one row stop; no new per-row badge stop. Secondary tag data belongs in the accessible description/picker, not repeated in the title string.

Checkbox Space toggles only the draft; radio arrows choose Group under; Enter activates Apply only deliberately; Escape cancels. Use existing modal focus trapping, clear labels and DOM order. Category management provides keyboard up/down buttons; drag must never be the sole assignment/reorder route. Targets should be at least 24px, with 32px picker label rows. Use outline-based focus with 2px clearance and ensure the scroller/dialog does not clip it. Disabled uses role colour, not opacity.

No new animation. Consecutive static `chips-dark-first.png` / `chips-dark-settled.png` were pixel-identical (PIL ImageChops bounding box None, 2560×1440); this proves only the static proposal does not animate. Physical keyboard routing, native modal behaviour, first-frame layout in the real app and hover-entry/exit motion are **unverified**.

## 8. Drag/drop — designed direction, separate implementation slice

A row may eventually be dropped onto the **whole 28px tag header**, highlighting with accent-wash plus an accent outline and the textual category label. Drop adds that tag and makes it primary without removing secondary tags, changing title, pin/running state or section membership. No arbitrary row reorder is implied. Escape, blur or drop outside a valid target cancels.

Do not turn selectable/panning title text into a drag handle. Use an explicit, separately reviewed non-text drag affordance and preserve the existing pinned-reorder grip's meaning. Autoscroll belongs to the owning list scroller, never the page; edge-zone size, velocity and threshold must be settled and measured in that slice. No invented numeric drag thresholds are approved here. Keyboard equivalent is Tags… → checked tag → Group under → Apply. Drop/save failure restores the prior grouping and exposes retry; announce success accessibly. The drag sheet is **a proposed target state**, not drag/autoscroll proof.

## 9. Contrast, tokens and deterministic gate

Role values came from `styles/themes.generated.css` for the active themes; live `browser.styles` sampled surface/ink/font and the proposed chip. Neutral badge uses `ink-muted` on `row-hover` with decorative `hairline-strong`; meaningful control boundaries use `border-control`. Existing focus/drop uses accent and accent-wash. The badge border is not a standalone control boundary and is not assigned a false 3:1 obligation.

`contrast_pairs.py` measured **531 pairs across all 59 themes** from the generated source. The script applies a text threshold to every input; its `FAIL ... large-only` on 3.x control borders is **not** a control-boundary failure. Reclassify borders against 3:1, text against 4.5:1. No theme colour mapping was changed.

| Pair | localOperatorLight | localOperatorDark | Minimum across 59 |
|---|---:|---:|---:|
| ink / surface | 15.23 | 12.80 | 8.15 |
| ink-muted / surface | 8.19 | 7.85 | 6.56 |
| ink-muted / row-hover (badge) | 7.55 | 7.24 | 5.91 |
| ink / elevated | 16.34 | 11.81 | 7.36 |
| accent / surface | 5.14 | 6.88 | 4.98 |
| accent / accent-wash | 4.85 | 7.18 | 4.51 |
| on-accent / accent (primary actions) | 5.33 | 8.58 | 4.97 |
| border-control / elevated | 3.92 | 3.30 | 3.01 |
| border-control / surface | 3.65 | 3.58 | 3.26 |

These are source-role pair checks, not rendered evidence for all 59 themes. Only the two brand themes were captured. Actual user-generated long labels, zoom, font scaling, community-theme pixels and interaction states remain implementation acceptance.

Commands/raw outputs live under `docs/evidence/loh-11-design/after/`: `contrast-{pairs,results}.txt`, `token-audit.txt`, `copy-audit.txt`. Final token audit: 30 HTML files, 69 literal colours, 6 font sizes, 15 spacings, 4 radii. Final copy scan: 33 files, 6678 candidate strings, 42 findings (prototype ballot/check glyphs); literals are self-contained **copied theme-role snapshots**, not proposed production hard-coded colours. Its 1px border/grid advisories are intentional. Copy scan's ballot/check/radio glyph detections are prototype control representations; they do not authorize emoji or text-glyph controls in production. Use the existing UI primitives/icons.

`dom_audit.mjs` was **not run** because it launches a separate scripted browser, prohibited by this task's browser-only rule. It is not recorded as a pass. Substitute measurements here are harness `browser.styles` plus prototype DOM self-readouts (`geometry-records.json`, `modal-geometry.json`), not a complete accessibility/overlap audit. Narrow evidence is sidebar-width variation within a 1280×720 viewport, not a swept full-app narrow-window/zoom test. Evidence fixture passes scoped Biome check; no full app test suite was run for documentation-only design.

## 10. Risks and review disposition

- **D1 — MAJOR, corrected in this phase:** picker was incorrectly drawn as a sidebar-width popover, with wrapping controls and a second primary-selection step. Replaced by 420×436 modal, invariant at all three sidebar widths/both themes; inline Group under radios, Cancel/Apply. `picker-{220,260,320}-{light,dark}.png` and `modal-geometry.json`. Implementation must preserve the modal/focus contract; the static dialog is not proof of that behaviour.
- **D2 — MAJOR, corrected in this phase:** management inherited the same narrow-popover error and an unapproved chips preference. Replaced by 420×420 modal, full-width name field, up/down/Rename/Delete rows; chip preference removed. Same theme/width coverage in management frames.
- **D3 — MAJOR if chips enter slice 1; resolved for slice 1 by deferral:** allocating a tag without the measured action budget can consume title space or move hit targets. Current unpinned pair costs 56px; 320 Review residual is 143.367px, swap title 145.391px. Chip/hover behaviour is not implemented; keep chips out of the first slice until real-path proof exists.
- **D4 — MINOR baseline constraint, not introduced here:** the existing 220px pinned row title is only 46.98px at rest and 17.39px in the seeded full cluster. LOH-11 must not spend another pixel there. The 120px floor is the admission rule for **new tag decoration**, not a false claim that today's sidebar already guarantees it. No unrelated row-layout redesign is included.
- **D5 — MINOR implementation acceptance risk:** adding Tags moves the last Sections controls below the viewport: measured proposed content678/client638, 40px overflow. Keep visible scroll affordance and keyboard reachability; no hiding Tags below Sections or replacing that list.

**Verdict: TERMINAL for this design specification and corrected static artifacts; not implementation approval and not LOH-11 completion.** D1/D2's visual proposals are corrected. No active MAJOR remains in the groups/dialog first-slice specification. D3 is a later-slice live-proof gate, not approval to ship chips without that proof. D4/D5 are carried into implementation acceptance. No production code was changed, no PR created, no issues filed.

## 11. First shippable slice and deliberate exclusions

Recommend one usable vertical slice: durable category/assignment/explicit-primary contract (capability-gated, idempotent, shared with terminal/catalogue), known-tag validation on optional agent session creation, View options master+Manage, section-only subgroups, one Tags… menu item, buffered picker and management with error/focus handling. No tag decoration in rows. Existing no-tags path unchanged.

The store is **entity-typed now**: a shared category registry plus assignment records keyed by `entity_type` (`session` | `project`) and `entity_id`, each with an explicit primary. Slice 1 exposes and writes **sessions only**; the catalogue and routes key session assignments as `("session", id)`. The project-tags follow-up uses the same registry and shape with `("project", id)` — no schema migration and no second vocabulary. Do not hard-code a session-only field in the store API or the wire.

Agent creation with omitted tags behaves exactly as today. **Unknown tag IDs/names are refused atomically**, with an actionable list/lookup route; no silent category creation or partial session. This prevents spelling variants from multiplying categories. Agents may use known categories, must not rewrite human titles or force the local display preference on. Prompt guidance may suggest known tags; no new memory subsystem or automatic taxonomy inference.

**Separate later slices:** (a) automatic full-label chips with measured fit/action-swap/motion proof, (b) drag target/handle/autoscroll/undo proof, (c) **project tags** — the shared category registry and `(entity_type="project", entity_id)` assignments applied to project rows/detail and the project catalogue wire, with no schema rework. These are not silently dropped from the complete LOH-11 request. Category collapse, colour roles/picker, tag filters, duplicate rows, user-visible title prefixes, tabs/LOH-1 implementation, bulk tagging and automatic classification are excluded. No arbitrary colour field or unused preference is pre-provisioned.

## 12. Visual acceptance checklist for implementation

- [ ] At 220/260/320, both themes: off is geometry/order/pixel compatible with baseline; no tag-reserved slot, no row height change, no title/status/locality/pin displacement.
- [ ] Existing section membership and counts survive enable/disable; one conversation once; groups preserve current sort, category order and visible-bucket counts; no added row indentation.
- [ ] First slice has no chips, rail, disclosure chevrons, tag filter or new title prefixes.
- [ ] View options Tags is above unchanged Sections; 40px insertion at this viewport has an observable scroll affordance; last controls remain reachable by physical keyboard.
- [ ] Agent/In one list does not silently become Time section; saved enable state is retained; explicit Use Time section works; search clear restores grouping without rewriting view state.
- [ ] Picker and management use viewport-bounded modal family: preferred420px independent of sidebar width, maxviewport−32; no wrapping action rows or horizontally clipped dialog; test a genuinely short/small app viewport too.
- [ ] Buffered checks, inline primary radios, stable one-primary rule; Cancel/Escape writes nothing; Apply commits assignment+primary atomically; rename/reorder does not rewrite an explicit primary.
- [ ] Loading, empty, long/Unicode names, many categories, error/retry, offline/concurrent deletion and management delete confirmation are rendered and exercised, not inferred from these populated sheets.
- [ ] Focus visible/unclipped, physical Context Menu/Shift+F10 and Tab/Space/radio arrows tested; dialog focus returns deterministically; whole-label targets meet24px floor (32px target rows).
- [ ] Restart/second client/agent-created known tags agree; unknown tags fail without category/session side effects; no title prefix parsing.
- [ ] Later chips: evaluate every eligible row; full label or absent; exact active-font B/C/action measurements, both120px gates, no preference checkbox; consecutive real-app hover/focus/menu/resize frames show no hit-target motion or flicker.
- [ ] Later drag: explicit non-text affordance, whole-header target, owning-scroller autoscroll, Escape/blur/outside cancellation, additive primary change, failure rollback/undo and keyboard equivalent independently exercised.
- [ ] Role pairs clear contrast floors in all59 mappings; brand light/dark frames and relevant community-theme/scale regression evidence attached to the actual PR.

## Evidence index

Root: `docs/evidence/loh-11-design/`.

- `before/{220,260,320}-{light,dark}.png`: real unchanged sidebar, exact-width evidence stories.
- `before/{220,260,320}-dark-acts.png`: real seeded action layout, complete feature/pin payload; no gesture claim.
- `before/view-options-{light,dark}.png`: real open View options.
- `before/{measurements,action-measurements}.json`: harness style responses.
- `harness/`: the evidence-only `chat-sidebar-sections.stories.tsx` patch and reproduction instructions. The patch is archived, not applied in this docs-only PR; it lands with the UI implementation PR.
- `after/{off,groups,chips,chips-acts,context,drag,view}-{light,dark}.{html,png}`: proposed comparisons, three widths per sheet; chip placements illustrative, actions/drag static.
- `after/{picker,manage}-{220,260,320}-{light,dark}.{html,png}`: corrected420px modal proposals. Short aliases `picker-light`, `picker-dark`, `manage-light`, `manage-dark` point to the220 scenario content, not the rejected narrow modal.
- `after/view-scrolled-{light,dark}.png`: proposed popover's last controls reachable by scroll.
- `after/{geometry-records,modal-geometry}.json`, contrast/audit outputs: measured self-readouts and commands' actual output.
- `after/chips-dark-{first,settled}.png`, `stability.txt`: earlier static proposal consecutive frames only; these are **not the final modal/chevron correction state** and carry no current-head interaction sign-off.

All frames were obtained through the harness browser, never an installed/scripted browser engine. The owned browser tab was closed after corrected modal capture. Only documentation, evidence and the evidence-only story patch archived at `docs/evidence/loh-11-design/harness/` were involved; the story patch lands with the UI implementation PR, not here.
