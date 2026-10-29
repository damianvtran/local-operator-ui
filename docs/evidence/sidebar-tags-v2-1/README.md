# Sidebar tags V2-1 — UI implementation evidence

Captured 2026-10-18 from this branch's source-backed Storybook, using the harness browser tool. A unified remediation replaced the invalid cross-section acceptance/preview with a negative case and eligible same-section captures. The fixture renders the real `ChatSidebar`, session-tags store, assignment path, and contract-shaped isolated desktop bridge; it never connects to an operator backend. No native Electron build or native touch/capture claim is made here.

## Executed paths

Start from the worktree with the shared dependency tree (no dependency install):

```sh
node node_modules/storybook/bin/index.cjs dev -p 6020 --ci --no-open --exact-port
```

The remediation run isolated HOME, capped the Node heap at 1024MB, and disabled telemetry/notifications. Port 6019 belonged to another lane; the owned preview used 6020. An initial 2GB process-group cap terminated dependency optimization; the heap-bounded retry succeeded without installing dependencies. The initial `pnpm exec` launcher bootstrapped Corepack's package-manager binary under that scratch HOME before running the already-installed Storybook dependencies; use the direct Node command above to avoid that unnecessary bootstrap.

Open `http://localhost:6020/iframe.html?id=chat-sidebar-tags--<story>&viewMode=story` with the harness browser. The interaction stories assert behavior in their Storybook play functions, then publish the result in `[data-tags-geometry]`.

| Story | Actual result |
|---|---|
| `drag-assign-round-trip` | PASS: quick click opens; pre-hold >5px motion consumes its click. An occupied header in Pinned is NOT eligible for a Today source: no highlight, 0 assignment writes, no Undo toast, unchanged Project bucket. |
| `same-section-drag-round-trip` | PASS: 180ms hold highlights Today → Review, promotes while retaining Project, and Undo restores Project. Two writes total, section membership unchanged. |
| `same-section-untagged-drop` | PASS: eligible own-section Untagged highlights and clears tags/primary in one write without moving the conversation between sections. |
| `held-pinned-tag-drop` | PASS: a rendered held pin absent from the canonical catalogue assigns to its own Pinned → Review in one write; no insertion line while the header is targeted. |
| `pinned-header-preview` | PASS: same-section Pinned header highlights; the held row remains marked; pinned insertion line absent; zero writes before release. |
| `move-menu-round-trip` | PASS: compact picker preserves assignments, returns focus to the remounted row; Remove all tags (3) clears once; tagged pinned menu has 9 rows, untagged has 8 (archive capability absent), Remove is conditional and Move to tag remains present. |
| `tag-actions-menu` | All ten actions render in order with archive capability present. |
| `tag-actions-menu-600` | PASS in an actual nested 600px browsing context, 220px sidebar: 10 rows, max-height 300px, clientHeight 298/scrollHeight 340, all targets ≥32px, End/Home/End focus and scroll through the entire menu. 600px is the app floor, not an unsupported 500px test viewport. |
| `move-conflict` | PASS: core-shaped `detail.code/detail.result` 409 refreshes Project/revision 2, displays Tags changed elsewhere, one attempted write, no retry/overwrite/Undo. Fixture evidence only, not a real-core 409 claim. |
| `move-failure` | PASS: a 503 restores Review and displays Tags were not moved. Try again.; one attempted write, no automatic retry. |
| `drag-preview` / `move-picker` | Eligible same-section header preview and compact category/Untagged picker; no write during preview; focus gutter remains intact. |

**Pointer limitation:** play functions dispatch synthetic DOM mouse pointer events (`pointerType: mouse`, avoiding Radix’s separate synthetic touch-hold menu timer). They prove the component state/optimistic path, not native pointer capture, touchscreen pan arbitration, or OS-delivered blur/cancel. Independent native QA remains required. Core revision support lands separately; the node store/helper tests exercise revision-bearing responses and 409 refusals with the shipped `detail.code` envelope.

## Measured geometry and viewed frames

The browser readout measured five 32px rows and five 28px occupied tag subheaders at a 260px sidebar. The move dialog measured 420px wide. Browser computed styles measured the ten-action menu at 296.22 × 342 CSS px, `overflow-y:auto`, `max-height:360px` at the 720px host viewport (responsive half-viewport cap); sampled menu targets were 32–35px high with `min-height:32px`.

- `before.png`: initial-head resting list before interaction; retained as the pre-remediation baseline, not a historical pre-implementation capture.
- `armed-preview.png`: recaptured held Today row and eligible Today → Review header (the former cross-section preview is replaced).
- `drag-undo-after.png`: recaptured successful same-section move/Undo readout.
- `ten-row-menu.png`: aligned ten-action menu at the host viewport.
- `cross-section-cancelled.png`: occupied foreign-section header rejected; zero writes and no re-bucket.
- `menu-220-floor600.png`: real 600px viewport cap/scroll/keyboard proof, with the last menu row reached.
- `pinned-header-preview.png`: eligible pinned assignment header without the reorder insertion line.
- `move-conflict.png` / `move-failure.png`: visible conflict refresh and action-specific rollback guidance. After viewing the first error frames, competing background row flyouts were suppressed while the tag modal owns the overlay plane, then both frames were recaptured.
- `move-picker.png`: compact picker after fixing an observed clipped focus outline by adding a scroll gutter; recaptured and viewed.

## Automated checks

- `node --test scripts/sidebar-tag-drag.test.mjs scripts/chat-sidebar-tags.test.mjs scripts/chat-sidebar-row-menu.test.mjs scripts/sidebar-pin-order.test.mjs scripts/chat-sidebar-pins.test.mjs scripts/chat-sidebar-selection.test.mjs scripts/chat-sidebar-sections.test.mjs`: 116 passed, 0 failed, including the old grouped-DOM/flat-order no-op reproduction and fixed bucket-scoped result.
- Earlier unchanged-neighbor run also included `scripts/chat-sidebar-pins.test.mjs scripts/desktop-contract.test.mjs`: 122 passed, 0 failed before two additional focused regressions were added. Those neighboring lanes were not duplicated after changes confined to new helpers/stories.
- `pnpm check-types:main` and `pnpm check-types:renderer`: exit 0.
- Changed-source Biome check: exit 0 (three pre-existing regex performance warnings in desktop-contract).
- `pnpm lint:scripts`: four changed script files lint-clean.
- `pnpm check-i18n`: exit 0; 224 ledger entries fresh and independently audited. Fresh Russian delta receipt: `i18n/receipts/b6e2d9f04c17.json` (anthropic/claude-sonnet-5-5), zero findings. ES/FR independent receipts `c3e8a1f72b95.json` / `8d2f6a4c91e7.json` are clean-with-findings; minor million-count wording, terminology, quote/spacing consistency accepted rather than churning translations. Baseline translator metadata is retained by the assembler; receipt/ledger audit notes identify coder/openai/gpt-6.1-sol as this delta’s translator. RU exact `=1` singular was fixed after the changes-requested `5b7d1c9e2a46.json` audit, then independently re-audited; 21/101 use the plural action. The unreferenced duplicate of the original Russian receipt was removed.
- `git diff --check`: exit 0.
- `node scripts/evidence-fold.mjs --no-amend` mechanically re-derived outside-set frame counts for the twelve retained/recaptured/new screenshots; `node --test scripts/evidence-manifest.test.mjs`: 52 passed, 0 failed, 1 skipped (citation ancestry unavailable in the shallow clone).

Full desktop automated coverage is left to CI rather than duplicating the full suite locally. No version, release, mobile, core, or frozen design-plan changes are included.

## Rebase/convergence provenance

`rebase-provenance.json` records the original head, current-base replay, `git range-diff` equality (excluding the mechanically rederived manifest), and byte-identical +/- line multisets. Eighteen source/script blobs were byte-identical before remediation; generated keys retained exactly the upstream-only delta. The only rebase conflict was `unjudgedFrames`, resolved by preserving upstream evidence and mechanically recounting actual files. This is compatibility evidence for the replay, not a substitute for convergence review of the remediation/new base.

## CI follow-up: palette contract and detached overlay chrome

The first replacement head `b54da3c98e` completed CI with ten passing checks and two failures inside Desktop Tests: the existing selection guard rejects any `bg-accent-wash` literal in the sidebar, and the existing region guard’s earlier selector-to-region slice included the new detached menu’s overflow literal. Both failures were reproduced directly before the source fix; neither guard was weakened or edited.

The detached menu’s identical responsive/scroll/target classes now live in `chat-row-menu.ts`. The active header now shares `TAG_DROP_PREVIEW_CLASSES` between grip/body paths: contracted `bg-row-selected`, strong `text-ink!`, and accent outline. The plan’s faint wash wording is superseded by the repo’s palette floor, not implemented as a bypass. Eligible and pinned previews were recaptured/viewed in both localOperatorDark and localOperatorLight; `armed-preview-light.png` and `pinned-header-preview-light.png` are the two added frames.

Actual harness-browser computed colors are recorded in `header-contrast.json`. WCAG relative-luminance ratios from those measurements: dark foreground/header **11.36:1**, accent outline/header **6.10:1**; light foreground/header **13.42:1**, outline/header **4.53:1**. These are two measured themes, not a claimed 59-theme sweep. Independent design was asked to re-check D1 on the corrected role/frames. The original full-suite failure is not presented as green; CI must rerun on the fast-forward source-fix head.

## Current-main convergence after the green CI head

After all 11 checks passed on `ddd75b5996`, main advanced and GitHub reported a conflict. Per the no-force/no-replacement instruction, current main `ab1ab8e65e9aee0835d72672a90cd12a082d4ecc` was merged normally. The only textual conflicts were `package.json` and `i18n/ledger.json`; the evidence merge driver resolved its own fields. Auto-merged overlaps were the sidebar, desktop contract, generated keys and pin-order tests; no tag behavior was discarded.

Three-way checks proved this branch’s package delta was only the new desktop test lane: current-main version **0.36.1**, dependency declarations and all unrelated fields were retained, with our lane registered once. Ledger row edits were disjoint: all upstream rows retained; only the audited ES/FR/RU tag rows overlaid, then the newly shipping zh-CN tag namespace gained the 12 translated keys while preserving its 42-key baseline. Chinese receipt `7c1a5e9b3d42` is clean-with-findings (0 blocker/major/minor, one accepted ellipsis-style nit). `check-i18n`/ledger-check now pass **224 entries** across the current shipping locale set; no fallback or row deletion.

The new upstream Library exposed a pre-existing strict-ground-registry gap. An untouched `git archive origin/main` control reproduced exactly 9 painter files versus 7 registered grounds; the test and both Library painter sources were byte-identical to main. The separate test-only convergence commit registers the real card/filter-rail surface expressions plus the list-row neighbor, preserving the completeness check and runtime Library code. `upstream-library-ground-control.json` records the inherited failure; this is not tag behavior.

The private merged lockfile could not safely share the primary checkout’s dependencies. `dependency-convergence.json` records the frozen private install, approved APFS clone/delta repair, exact cleanup `df` observations and unchanged primary package/lock/status fingerprints. Only the newly-created duplicate backups were deleted after local gates; no primary install/move/prune and no global prune. The shared-volume `df` samples became less free despite deletion, then partially recovered, so no positive reclaimed-byte attribution is invented. Tests and type checks run against the private worktree tree, not a scratch install. Final local convergence matrix: **116 passed, 0 failed**; both tscs, script lint, i18n224 and evidence52/1skip pass. Full CI must run on the final merge-plus-registry head; the earlier green head is not re-pinned as proof of this merge.

Compatibility check: the merge brought no changes to shared themes, renderer styles, Storybook configuration, the tag-drag decision module or the row-drag lifecycle module relative to `ddd75b5996`; the retained two-theme header frames/contrast therefore still describe the same preview state. The sidebar’s incoming runtime delta is the upstream append-new-pin ordering, which is covered by the merged pin-order lane and remains for independent convergence QA.
