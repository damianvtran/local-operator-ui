# Sidebar tags V2-1 — UI implementation evidence

Captured 2026-10-18 from this branch's source-backed Storybook, using the harness browser tool. The fixture renders the real `ChatSidebar`, session-tags store, assignment path, and contract-shaped isolated desktop bridge; it never connects to an operator backend. No native Electron build or native touch/capture claim is made here.

## Executed paths

Start from the worktree with the shared dependency tree (no dependency install):

```sh
node node_modules/storybook/bin/index.cjs dev -p 6019 --ci --no-open
```

The actual run isolated HOME and disabled telemetry/notifications. The initial `pnpm exec` launcher bootstrapped Corepack's package-manager binary under that scratch HOME before running the already-installed Storybook dependencies; use the direct Node command above to avoid that unnecessary bootstrap.

Open `http://localhost:6019/iframe.html?id=chat-sidebar-tags--<story>&viewMode=story` with the harness browser. The two round trips assert behavior in their Storybook play functions, then publish the result in `[data-tags-geometry]`.

| Story | Actual result |
|---|---|
| `drag-assign-round-trip` | PASS: quick click opens the conversation; movement >5px before the hold consumes the click and writes nothing; 180ms hold paints the occupied header; dropping on a header in another section adds/promotes while retaining previous tags and section membership; Undo restores the original bucket. Assignment writes: 2 total (move + Undo). |
| `move-menu-round-trip` | PASS: Move to tag opens the compact picker; choosing Concept preserves Review/Project and makes Concept primary; focus returns to the remounted source row; Remove all tags (3) clears tags/primary in one write. Assignment writes: 2 total. |
| `drag-preview` | PASS: armed row mark plus accent-wash/outline header preview; no assignment before drop. |
| `tag-actions-menu` | All ten actions rendered in order: Archive, Pin, Fork, Copy, Rename, Tags, Remove all tags, Move to tag, Move up, Move down. |
| `move-picker` | Category list plus Untagged, Cancel, focus outline fully inside the scroll gutter. |

**Pointer limitation:** play functions dispatch synthetic DOM pointer events. They prove the component state/optimistic path, not native pointer capture, touchscreen pan arbitration, or OS-delivered blur/cancel. Independent native QA remains required. Core revision support lands separately; the node store/helper tests exercise revision-bearing responses and 409 refusals with the shipped `detail.code` envelope.

## Measured geometry and viewed frames

The browser readout measured five 32px rows and five 28px occupied tag subheaders at a 260px sidebar. The move dialog measured 420px wide. Browser computed styles measured the ten-action menu at 296.22 × 342 CSS px, `overflow-y:auto`, `max-height:720px`; sampled menu targets were 32–35px high with `min-height:32px`.

- `before.png`: current-source resting list before interaction, not a historical pre-implementation capture.
- `armed-preview.png`: held row and occupied header preview.
- `drag-undo-after.png`: settled move/Undo state and successful round-trip readout.
- `ten-row-menu.png`: final aligned ten-action menu.
- `move-picker.png`: compact picker after fixing an observed clipped focus outline by adding a scroll gutter; recaptured and viewed.

## Automated checks

- `node --test scripts/sidebar-tag-drag.test.mjs scripts/chat-sidebar-tags.test.mjs scripts/chat-sidebar-row-menu.test.mjs scripts/sidebar-pin-order.test.mjs`: 54 passed, 0 failed, including the old grouped-DOM/flat-order no-op reproduction and fixed bucket-scoped result.
- Earlier unchanged-neighbor run also included `scripts/chat-sidebar-pins.test.mjs scripts/desktop-contract.test.mjs`: 122 passed, 0 failed before two additional focused regressions were added. Those neighboring lanes were not duplicated after changes confined to new helpers/stories.
- `pnpm check-types:main` and `pnpm check-types:renderer`: exit 0.
- Changed-source Biome check: exit 0 (three pre-existing regex performance warnings in desktop-contract).
- `pnpm lint:scripts`: four changed script files lint-clean.
- `pnpm check-i18n`: exit 0; 170 ledger entries fresh and independently audited. Independent Russian delta receipt: `i18n/receipts/9f4c2a71b3d8.json`, actual auditor model `openai/gpt-6.1-sol`.
- `git diff --check`: exit 0.
- `node scripts/evidence-fold.mjs --no-amend` mechanically re-derived outside-set frame count 1061 → 1066 for these five screenshots; `node --test scripts/evidence-manifest.test.mjs`: 52 passed, 0 failed, 1 skipped (citation ancestry unavailable in the shallow clone).

Full desktop automated coverage is left to CI rather than duplicating the full suite locally. No version, release, mobile, core, or frozen design-plan changes are included.
