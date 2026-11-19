# Sidebar tags v3 — implementation and evidence

Implements [the v3 design](sidebar-tags-v3.md) (operator defaults: no row hover act, no header drag handle, management only while tag grouping is on).

## Surfaces and subtraction

- A row's `Tags…` item or focused-row `⌘⇧L` / `Ctrl+Shift+L` opens an anchored, non-modal combobox popover. Toggle immediately; type a new unmatched name + Enter to create and assign. Shift+Enter adds/promotes in one assignment write. `Show under` is the pointer alternative.
- Group headers retain their 28px height and row-drop meaning. Their menu manages rename, visible-neighbour reorder and delete. F2, Alt+arrows, Shift+F10 and double-click work in place. Used-tag deletion is an anchored alertdialog with Cancel focused; unused-tag deletion is immediate.
- The footer creates tags in place and lists unused-tag drop slots. Armed row drag auto-expands those slots below all rows; all-Untagged sections retain a bucket wrapper so even the first assignment can be a drag.
- View options is a label/switch only, with matching visible/accessibility naming. No new hover button or drag handle.
- Deleted the 920 lines of `chat-session-tags-dialog.tsx` and `manage-tags-dialog.tsx`, the modal move mode, dialog-only Escape helper/test, stale Apply/Manage/Move strings and old staged-dialog stories. Composer `/tag` retains the shared immediate-write hook.

No dependency, backend wire-contract, version or theme-role change. A create-and-assign is one user interaction but two existing requests (`tags.replace`, then `sessions.tags`), not a new atomic server operation.

## Steps

T = typing once. Counts are derived from the actual control paths and the design's before paths, not stopwatch timings. Storybook play functions execute the new keyboard/mutation paths against the real components and a synthetic DesktopRequest bridge.

| Task | Before | After |
|---|---:|---:|
| Assign an existing tag, mouse | 4 | 3 |
| Create + assign, mouse | 4 + T | 3 + T |
| Create + assign, focused-row keyboard | modal path | 2 + T (chord, Enter) |
| Rename, mouse | 5 + T | 2 + T (double-click, Enter) |
| Delete a used tag | 5 | 3 |
| Reorder by k places, mouse | 3 + k | 2k (deliberate design trade-off) |
| Remove all tags | 2 | 2 |
| Show under another tag without drag, mouse | 3 | 4 (deliberate design trade-off) |
| Show under another tag, keyboard | move dialog | 2 (chord, Shift+Enter) |
| First-ever create + assign, grouping initially off | 9 + T | 5 + T |

## Rendered evidence

Instrument: Local Operator's `browser` tool, existing desktop browser host, one reused tab. Storybook 8.6.12 served this worktree on localhost:6137 with no app window launched. This is rendered renderer proof, **not live-core, native pointer capture, native IME or screen-reader proof**.

- [Actual receipts](assets/sidebar-tags-v3/rendered-receipts.json): measured DOM geometry, visible page text and console output. Headers remain **28px**, widths **195 / 235 / 295px** at sidebar 220 / 260 / 320. Populated picker: **224 × 174px**, no horizontal overflow; longer conflict copy widens up to the **280px** maximum.
- Before frames remain in [the design's assets](assets/sidebar-tags-v3/). After header/popover pairs: `after-{groups,popover}-{220,260,320}-{dark,light}.png`.
- `after-state-*.png`: loading, load failure, empty, unmatched/create, registry/selection caps, Unicode, assignment/create failure, conflict, remote refusal, header menu, rename valid/invalid/pending/failed, used-delete confirm, footer edit/at-cap, unused expanded/armed-drop, first use, and actual 600×600 nested browsing context.
- Rendered flow assertions passed: chord → type → Enter creates/assigns; Escape returns row focus; header→row→header→row arrow ring; rename/footer creation; used deletion; unused-slot drop preserves source position and adds/makes-primary. Synthetic bridge writes are recorded, not claimed as backend side effects.

The rendered pass caught a real Radix interaction mismatch: ArrowDown on a DropdownMenu trigger normally opens its menu. Header navigation now prevents that primitive default while bubbling to the sidebar's arrow ring. The before-fix story failed; its corrected run records the row/header walk passing.

## Automated verification

- `pnpm check-types`: PASS (main and renderer tsc).
- Affected runner over `chat-tag-dialogs-immediate`, `sidebar-tag-picker`, `sidebar-tag-drag`, `chat-sidebar-tags`, `chat-sidebar-row-menu`, `keymap-registry`, `keymap-chords`, `chat-keyboard-regions`, `test-inventory`: **99 tests PASS, 0 FAIL**. No full desktop suite locally; CI owns it.
- Changed renderer/shared Biome: PASS (three existing warning-level diagnostics); new surface files separately lint-clean. `pnpm lint:scripts`: PASS (7 changed script files).
- `pnpm check-i18n`: PASS; 411 ledger rows fresh/independent, coverage shrink-only. Two independent semantic audits: receipts `0ae714016b24` and `ce76a99d4b27` (actual reviewer models recorded there). They do not claim rendered/RTL coverage.
- `pnpm check-themes`: PASS, 186,211 contrast assertions across 59 themes.
- `node scripts/check-evidence-structure.mjs`: PASS, 1,468 tracked evidence files / 235 declared sets / 0 committed frames / 4 named proof artefacts.
- `node scripts/check-evidence.mjs`: **BLOCKED**, exit 1: `docs/evidence-frames` is absent in this worktree. Those ignored release-rig frames are not fabricated or copied from another tree. The new review frames live in the design-doc asset path already used by the spec; they do not replace the release pixel sweep.
- `node scripts/ci-scope.mjs --since origin/main --verbose`: selected the broad code CI matrix; unknown i18n receipt paths fail open. No full `check-changed --run` duplicated locally, because its selected full desktop suite belongs to CI.

## Explicit limits and dispositions

- Independent reviewer, designer, UX and real isolated-core QA rounds remain merge gates. Live create/assign/rename/reorder/delete, unauthorized and old-backend negatives, two-client 409, and durable rollback must be exercised independently; this file does not imply those were run.
- Loading/saving input is read-only rather than HTML-disabled: the input must retain focus and the typed filter while unavailable. All mutating paths still refuse until ready. This intentionally resolves the spec's contradictory “disabled but focused” wording.
- Minor second-audit I2-1: English first-use `or create one here` has an ambiguous referent. Target translations explicitly name the tag. Deferred in the PR thread rather than changing audited English bytes without refreshing both receipts.
- Actual implementation model began as anthropic/claude-opus-5-5; provider quota forced a transient fallback through sonnet to openai/gpt-6.1-sol. No role/default model or tool configuration was changed.

## Published-head convergence

GitHub reported the initially opened PR conflicting after main advanced from
`3a5477b` to `1c9910f` (the alias-conflict predicate fix). The sole conflict was
adjacent package scripts: preserve upstream's `hub-skill-alias.test.mjs`
registration while removing the deleted dialog Escape test from `test:tag-dialogs`.

The rebased implementation is `5307a81e23`; `fa3d103452` also retains the
already-published `096cedac1b` ancestry so publishing needs a normal fast-forward
push, **not a force-push**. Derived after resolution: **87 feature paths
byte-identical**, and **all feature added/removed lines byte-identical** to the
original patch (each compared against its own base). No implementation or frame
changed. The convergence-neighbour runner exercised `test-inventory` plus
upstream's `hub-skill-alias`: **7 PASS, 0 FAIL**. The initial inventory attempt
while package.json still held merge markers failed JSON parsing; it is not
counted as a pass. The resolved-file run above passed.

## Unified round-1 remediation

C1 (major): registry ownership now lives in the shared store. `replaceCategories`
accepts a **mutation intent**, not a precomputed full-registry snapshot. It
acquires a queue position synchronously, then derives and validates against the
preceding writer's acknowledged categories. All header/footer mutations and
picker creation use that path. A failed intent releases ownership in `finally`.
A generation check also prevents an older in-flight list response from replacing
an acknowledged edit before the next intent derives its state.

C2 (major): blur validation may still revert an invalid/unchanged rename, but a
failed blur **save** no longer cancels the editor or clears its failure state.
The typed draft, alert, Retry and editor focus remain recoverable, just as for
Enter failure. The regression also retries successfully after HTTP500.

Q1 (minor): the keyboard story waits for settled originating-row focus, not only
popover unmount. Three rendered navigations passed. The auto-tag regression now
queries the grouping switch's stable ID (its accessible name comes from the real
label), retaining the assertion that neither switch changes saved `groupBy`.

[Execution receipts](assets/sidebar-tags-v3/remediation-test-receipts.json): the
three new discriminating C1/C2 cases all FAIL against the frozen `fde244` control
(two headers, picker-vs-header, failed blur), then PASS with the fixes. The final
bounded affected union is **133 PASS / 0 FAIL / 0 skipped** across 13 files,
including composer `/tag` neighbours; main/renderer typechecks, i18n, changed
script/source lint and evidence structure pass. No duplicate full CI suite ran.
[Rendered receipts](assets/sidebar-tags-v3/remediation-rendered-receipts.json)
record the delayed two-header success, preserved failed-blur state, and the
three settled keyboard-focus runs. These use the synthetic Storybook bridge,
not a claim of new live-core coverage.

D1 (minor): seven individual error/limit/Unicode companion crops and an
error/limit sheet now accompany the original full-window placement frames;
[integer crop receipts](assets/sidebar-tags-v3/detail-crop-receipts.json) name the
original bytes and crop rectangles. No original content was repainted or
re-rendered. Dense/empty/Unicode full-frame names now correctly say **220**, not
260. The new failed-blur discriminator has its own full frame and companion.

Normal visual sign-off is compatible: `chat-sidebar`, `chat-sidebar-view-menu`,
`chat-tag-popover`, `tag-picker-combobox` source bytes are unchanged against
`fde244`; all header `className` expressions are unchanged. No theme/CSS,
normal-flow geometry, wire response shape, catalogue or audit receipt changed.
Only failure handling/shared write ownership and test/evidence changed; the
normal UX/design acceptance is retained, while code and QA must review this
delta. I2-1 remains explicitly deferred (non-gating English referent ambiguity);
no semantic receipts were invalidated for it. No version bump.
