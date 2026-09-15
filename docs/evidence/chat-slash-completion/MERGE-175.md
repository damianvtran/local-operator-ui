# Composer-tabs #175 integration — normal merge

Integrated `origin/main` at `8d019993eb8b54913d89fa5288aafbaf88f293d3` into
slash head `4cf1ec477286356a09f3f97ddf042b957b52f380`, after the forge reported
DIRTY. This is a normal two-parent merge, not a rebase or a forced update.
No version change: package.json remains 0.22.3. No further main chase.

## Overlap and seam resolutions

| Overlap | Resolution / verification |
| --- | --- |
| `package.json` | Union of desktop suites: all five slash suites plus upstream composer-tabs and existing browser/vendoring suites remain. |
| `message-input.tsx` | Preserve slash invocation/note props AND upstream `runDetails`; destructure all three. Upstream `ComposerStatusRow`, reading chips and plan-row placement remain. Slash planning/applyPlan/dispatch are unchanged. |
| `chat-content.tsx` | Pass `onSlashCommand`, `onSlashNote` AND the same derived `runDetails` into the composer. No second plan tally or submit decision. |
| `session-status-strip.tsx` | Auto-merge preserves upstream exported `READING_BUTTON` (shared with status row) and branch price-pair/model formatting. |
| `capture-evidence.mjs` | Auto-merge retains 15 slash stories AND four upstream status-row stories. The capture script was not executed. |
| `manifest.json` | Keep both artifact inventories: 1689 WebPs total, 337 supplementary, 1352 sweep frames; 180 registered stories. Preserve slash capture attribution and link upstream status-row/run-panel capture provenance to the upstream manifest/READMEs. Integrated source stamps do not assert recapture. |

The U10/U11 popup, U13 store and caller handling, planner, and `chat-page.tsx`
are byte-identical to the first parent. The merge introduces no alternative
submit decision. Upstream changes outside the six overlaps were accepted as
upstream, not reimplemented or re-audited.

## Artifact reuse boundary

Regenerated the slash story's esbuild import closure without launching a browser
engine. There are **51 unique paths**, including the served stylesheet (the
previous report's 52 counted that stylesheet twice). Compared with `4cf1ec477`,
only `ui-preferences-store.ts` changes: upstream run-panel reveal state and
right-slot handling. The popup component, fixtures, theme/palette/style inputs
are unchanged. This is not a claim that the whole closure is byte-identical.
`merge175-proof.json` records the compared paths and hashes. Retained slash
WebPs and PNGs remain historical evidence with their existing citations; no
new whole-set capture or silent all-frame freshness claim is made. Upstream
status-row/run-panel WebPs are imported unchanged with their own provenance.

One targeted browser-tool check exercised the real integrated composer:
`/usage\nmerge175 U13 seam probe` went to the messages endpoint, returned 422,
and the form retained both draft lines with the authored guidance:

> A message can't start with / — that is a command. Move it below your text,
> or send it on its own.

No generic retry hint. `merge175-live-refusal.png` was captured using the browser
tool and actually viewed. The inherited QA session still shows the conversation
loading placeholder, as it did before this merge; this does not validate healthy
transcript loading, status-row/tabs interaction, or a model turn. Independent
integration QA/design should exercise those upstream surfaces with populated
canonical run state, while existing upstream frames supply their prior proof.
The owned browser tab was closed after verification.

## Sequential fast gates

- `pnpm check-types`: exit 0, main and renderer.
- Ten targeted suites through the repository runner with concurrency 1:
  `slash-token`, `slash-rank`, `slash-submit`, `slash-contract`, `slash-row-format`,
  `canonical-chat`, `composer-tabs`, `composer-readings`, `run-detail-model`,
  `session-status`: **243 passed, 0 failed/skipped**, 2.58 seconds.
- `pnpm lint`: exit 0, 508 files checked, 33 warnings, no fixes applied.
- `git diff --check --cached`: clean.

Exact logs: `/tmp/pr143-merge175/{types,tests,lint}.log`. No full desktop suite,
new build, or whole-tree image histogram sweep. No PR merge performed.

Live review URL: `http://localhost:5317/#/chat/03f67bc884bc`.
Renderer restarted for this review; run
`bash /tmp/pr143-recovery-gates/start-vite.sh` if needed. Its isolated backend,
proxy, home and run directory are unchanged from `RECOVERY.md`. The :5317 origin
was accepted by the browser tool; existing :5311 listener was not touched.
Storybook remains on :6070. Review convergence scope is the normal merge's
six overlap files and the composer seam, not previously approved unchanged work.
