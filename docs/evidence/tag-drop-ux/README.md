# Sidebar tag-drop UX follow-up (LOH-11 V2-1)

## Operator report and scope

On 2026-10-19 the operator reported that an Untagged conversation could not be dropped into the occupied tagged group under TODAY, and draggable rows did not advertise dragging with the cursor. This follows UI #1197; it does not implement V2-2.

Grouped rows now use `grab` and `grabbing`. Header and occupied body are targets for another bucket; **only an Untagged source** may cross section boundaries into a tagged group. Tagged-source cross-section drops remain rejected (the round-trip story tries both the occupied header and occupied body). Own-bucket bodies remain reorder/no-op space; empty section space is not a target. The whole destination group receives the existing selected-ground/accent-outline preview. Pinned reorder retains its header-only resolver; assignment/409/rollback/Undo and keyboard paths are unchanged.

No new production strings or i18n keys. No version bump, native build, install, merge, or release is part of this PR.

## Automated execution

- RED: `node --test scripts/sidebar-tag-drag.test.mjs`: 11 passed, 1 failed, expected cross-section Untagged body object but received `null` before the fix.
- GREEN: `node --test scripts/sidebar-tag-drag.test.mjs scripts/chat-sidebar-tags.test.mjs scripts/chat-sidebar-pins.test.mjs`: **54 passed, 0 failed**. Covers body/header eligibility, own-group/no-group negatives, assignment revision/conflict/rollback/Undo and pinned neighbors.
- `pnpm run check-types`: **exit 0**, runs `tsc --noEmit -p tsconfig.node.json` and `tsc --noEmit -p tsconfig.app.json` (the repository/CI commands).
- `pnpm run lint`: **exit 0**, existing warnings; touched files checked separately with Biome, zero errors/warnings.
- An initial invocation of the unused legacy `tsconfig.web.json` reported five errors. That was the wrong command, not a branch failure; do not treat it as CI evidence or as established pre-existing defects.

## Rendered source-backed Storybook

Started `node node_modules/storybook/bin/index.cjs dev --ci --no-open --port 6017 --host 127.0.0.1` with isolated HOME, stripped CMUX variables, telemetry disabled. Requested 6017 was already occupied; **actual server selected 6019**, verified from its log and story index before accepting evidence. The server loads this worktree's source; no packaged/stale application build is used.

Open `/iframe.html?id=chat-sidebar-tags--drag-assign-round-trip&viewMode=story&args=width:220;theme:localOperatorDark` on that server. Repeat width 640 and theme `localOperatorLight`. `cursor-and-body-target` retains the held preview for screenshots/computed styles.

| Sidebar width | Theme | Header/body target IDs | Body area | Pointer-path result |
| --- | --- | --- | --- | --- |
| 220 | Dark | review / review | 195 × 32 CSS px | grab → grabbing; tagged cross-section 0 writes; Untagged body 1 write; Undo restores Untagged, 2 total |
| 220 | Light | review / review | 195 × 32 CSS px | same PASS |
| 640 | Dark | review / review | 615 × 32 CSS px | same PASS |
| 640 | Light | review / review | 615 × 32 CSS px | same PASS |

Actual story output: `PASS: cursor grab → grabbing; header/body ID review; body 615×32px; tagged cross-section 0 writes; synthetic pointer preview (not native delivery proof); Untagged→tagged body 1 write; Undo restored Untagged (2 total)`.

`measurements.json` contains the actual per-case story output and browser computed-style reads. At 640/light, browser hit-test (72,300) resolves the title → row button → row wrapper → body → group, not a header. Browser styles show header rect `(12,256,615,28)`, body `(12,284,615,32)`: contiguous group area 615×60. Console error read on final case: none.

## Before/after and limitations

`before-220-dark.png` and `before-640-light.png` used the exact `bf24fa9e` sidebar/hook production files with the new fixture temporarily retained; those production files were restored afterward. Baseline computed cursor: **pointer**, not grab; the cursor assertion stops the story before its held gesture. Before frames therefore show resting target area; after frames show the held whole-group preview, not an identical native drag capture. Four after frames cover both widths and themes. The screenshots were inspected; the preview is one enclosing outline, with selected ground including the occupied row.

**Screenshots do not capture the native cursor.** Cursor claims come from computed styles/assertions. The harness browser exposes click/type/scroll/styles/screenshot but no pointer-down/move/up action. The rendered stories dispatch synthetic DOM PointerEvents through the actual sidebar handlers; this proves component hit-testing/state/writes, **not native pointer delivery/capture, touch delivery, or native cursor rendering**. Independent native QA remains required before merging.

Dependency setup cost: **zero dependency-tree copies/installations**. A resource hold superseded the original APFS-clone plan before copying began; the worktree uses a symlink to the lockfile-compatible existing V2-1 `node_modules`. No scratch dependency/build trees were created. The owned Storybook process is stopped after capture; no standalone build output was produced. Shared dependency caches are not deleted because other sessions may own/use them.

Implementation ran with actual fallback model **openai/gpt-6.1-sol** after Anthropic quota exhaustion. Independent review/design/UX/QA rounds are not claimed here.
