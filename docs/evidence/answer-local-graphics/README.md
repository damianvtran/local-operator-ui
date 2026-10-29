# Answer-local graphics disclosure

> **Default superseded (2026-10-19, PR #1247):** the operator asked for the
> graphic to be visible by default in a condensed turn. The row now starts open
> and `Hide` reaches the closed state; the closed frames below remain the
> pre-change default evidence. The `*Closed` story fixtures now press Hide after
> mount, and the visible fixtures are the default.

Captured 2026-10-19 through the harness **browser tool**, in one owned background tab on the existing desktop browser host; the tab was closed afterwards. No native app, operator session, standalone browser engine, or scratch dependency installation was used. The isolated Storybook server was reaped by its exact process group (95520). Coder model: `openai/gpt-6.1-sol`, temporary fallback after Anthropic quota exhaustion.

## Reach the states

From this worktree run `pnpm storybook -- --ci --no-open` (or `pnpm exec storybook dev -p 6017 --ci --no-open`), then open:

`http://localhost:6017/iframe.html?id=chat-turn-supplements--local-graphics-closed&args=theme:localOperatorDark&viewMode=story`

Use `theme:localOperatorLight` for light. Story IDs use `local-graphic-closed`, `local-graphic-open`, `local-graphics-closed`, `local-graphics-open`, `local-graphics-narrow`, `local-graphics-mixed`, `local-graphics-mixed-hidden`, `local-graphic-refused`, and `local-graphic-loading`. The visible fixtures are the DEFAULT; the `*Closed`/`*Hidden` fixtures click the inner `[data-supplement-graphics-reveal]` span after mount to press Hide, and its click bubbles to the real shared Disclosure trigger. They do not use an initial-open override or an initial-closed override. The narrow fixture is a **360 CSS px story container**, not a narrow browser viewport.

The new fixtures deliberately use the answer's real ID as `supplement.anchor`. At the original capture, older `FoldedCondensed*` fixtures used `m1` for the answer and a different supplement anchor, so they did not prove the closed state. Round-1 remediation fixes `FoldedCondensedComponents` specifically to use the actual anchor; its newly reachable condensed form was verified by browser snapshot; the duplicate still was withdrawn in round2 below. The other old fixtures were not broadened into this fix. The collapse model remains unchanged.

## Original frames (pre-remediation; all opened and visually inspected)

All captures: 1280×720 CSS viewport, 2560×1440 PNG (2× scale). Wide content: 810 CSS px; narrow block: 280 CSS px inside the 360px container. Light/dark use the actual localOperatorLight/localOperatorDark palettes, not recolored images.

| Frame | State and interpretation |
| --- | --- |
| `before-dark-closed.png` | Base `cd184a49d3` SupplementRow, dark: inert `2 graphics` below answer, closed work bar, no graphic. |
| `before-light-closed.png` | Same baseline in light. |
| `after-dark-closed.png` | Dark: leading shared chevron and `Show 2 graphics`, no graphic slots. |
| `after-light-closed.png` | Light counterpart, paired with the light baseline. |
| `after-dark-open.png` | Dark: locally opened `Hide 2 graphics` with one budgeted chart while work stays folded. |
| `after-light-open.png` | Light counterpart; chart mounted locally, work remains folded. |
| `after-dark-overflow.png` | Explicit `Show all 1 graphic` pressed: `Show fewer` and the second chart, scrolled into view by the browser click. Exactly two iframes measured. |
| `after-dark-narrow.png` | Dark, 360px container: wrapped answer and one local chart; no horizontal escape. |
| `after-light-narrow.png` | Light counterpart. |
| `after-dark-refused.png` | Open local singular control (`Hide 1 graphic`), ordinary `Couldn't render this graphic · Retry` fallback. |
| `after-light-loading.png` | Open local singular control and the retained reserved/shimmer box while the document promise remains pending. |

The baseline is an executable same-gallery control: only SupplementRow was temporarily supplied from `origin/main` at `cd184a49d3`, while the new owner-correct fixture and gallery plumbing remained identical. The modified row was saved in session scratch and restored before after-capture or final testing. A first mistakenly expanded baseline screenshot was discarded/overwritten after inspecting it; its owner mismatch prompted the fixture correction above. No frame from that incorrect state is presented as closed evidence.

## Execution observations

- Mounted shipped-row tests: closed has zero slots, zero iframes and zero media calls; local open mounts the budgeted head without changing `condensed`; explicit overflow mounts only its tail; identity replacement is closed before commit and does not fetch; returning to an old identity does not resurrect permission.
- Browser flow: clicked `Show 2 graphics`, then opened and reclosed the actual work bar. Expanded work had exactly one iframe and no local trigger; reclosed work again had `Hide 2 graphics` and exactly one iframe. The explicit local permission survived. The 790px-wide local iframe measured 370px high, within the unchanged host clamp. Expanded work's frame measured 810×379px. At narrow width the local frame measured 260×131px.
- Overflow browser flow: exactly two frames after explicit expansion, measured 790×370 and 770×361px; `Show fewer` remained the overflow control. The top-level Show copy is not a promise to auto-mount the off-budget tail.
- Shared Disclosure supplies a native button, leading chevron, `aria-expanded`/`aria-controls`, Enter/Space activation and the existing focus outline; no tooltip, new key binding, focus move or turn-expansion handler was added. Mounted tests check that focus stays on the trigger while opening and that `aria-expanded` changes false→true. Physical keyboard activation was not independently driven by this browser-tool pass.
- Document-loading and document-error states were observed through the real frame/slot path with the synthetic Storybook media bridge. This proves component mounting and chrome, not native protocol security or a live harness-generated chart. Existing chart fixtures were reused unchanged; the parallel harness chart fix is outside this PR.

Targeted command: `node --test scripts/supplement-disclosure.test.mjs scripts/supplement-row.test.mjs scripts/supplement-model.test.mjs` → **33 tests, 33 pass, 0 fail, 0 skipped**. Biome touched-file check exits 0, with the pre-existing unused `blockRecord` warning in supplement-model.test.mjs. Full automated coverage is delegated to CI, not duplicated locally; independent review/design/QA/UX rounds remain separate gates.


## Round-1 remediation — source delta from a09ef11bf6

All thirteen `r1-*.png` files were newly captured through one owned browser-tool tab and individually opened before committing. They are current-source evidence; the eleven original PNGs above are retained as historical before/remediation controls, not relabelled as current copy. Capture viewport remains 1280×720 CSS px / 2560×1440 PNG.

| New frame(s) | What changed / how to reach it |
| --- | --- |
| `r1-dark-closed.png`, `r1-light-closed.png` | `local-graphics-closed`: precise **Show 1 of 2 graphics** names the budgeted head, not the whole set. |
| `r1-dark-open.png`, `r1-dark-open-settled.png`, `r1-light-open.png` | Press local reveal: **Hide 2 graphics**, one head frame, unchanged nested overflow. Consecutive dark frames are byte-identical (SHA-256 `cc7ed7957a196a9276e225191d9df917dde598bde8196dc955883b3cc9da21e9`); no settling reflow observed between them. |
| `r1-dark-mixed-closed.png`, `r1-light-mixed-closed.png` | New `local-graphics-mixed`: actionable existing file rows, followed by the same budget-aware local control; work remains folded. |
| `r1-dark-mixed-open.png`, `r1-light-mixed-open.png` | Press mixed local control: chart mounts below the files. Wide screenshots emphasize the file/control seam; the lower chart extends below the capture viewport. |
| `r1-dark-narrow-closed.png`, `r1-light-narrow-closed.png` | `local-graphics-narrow`, then Hide: longer closed wording fits a 360px story container; measured label width 134.02px inside the 280px block. |
| `r1-light-loading.png` | `local-graphic-loading`: unchanged visible shimmer/Source treatment. Browser accessibility snapshot now includes **Loading graphic…** from the nonvisual semantic output/status. |

Copy rule: `Show H of N graphics` when only H of N belongs to the budgeted head; equal counts keep `Show 1 graphic` / `Show N graphics`. Open copy remains `Hide N graphics` because that control hides the group, including any explicitly granted tail. The tail's `Show all M graphics` / `Show fewer` copy is unchanged. Both graphics-only and mixed file/graphics finishes use this control, positioned after files.

Browser remediation execution: local Show → 1 iframe; nested Show all → 2; local Hide → no iframe in accessibility tree; local Show again → **1 iframe**, with **Show all 1 graphic** (not Show fewer). The revoked overflow permission is not resurrected. Head geometry after reopening: 790×370 CSS px, unchanged. Closed ordinary and animated shared controls are additionally exercised by mounted tests: no aria-controls while closed; open controls resolve to a mounted target; contentless headers have no target.

Regression command:
```sh
node --test scripts/supplement-disclosure.test.mjs scripts/supplement-row.test.mjs scripts/supplement-model.test.mjs scripts/trace-fold-behaviour.test.mjs scripts/turn-collapse-behaviour.test.mjs
```
Actual result: **130 tests, 130 pass, 0 fail, 0 skipped**. The shared Disclosure's existing trace-fold behavior suite and the direct turn-collapse neighbor are included. Red controls reproduced F1/F2/F3/U1 and the F4 copy mismatch before the fixes.

Gallery preflight found the shared dependency tree missing `baseline-browser-mapping`, which prevents documentation-only react-docgen extraction. No dependency installation or shared-tree edit was performed. For this run only, `.storybook/main.ts` disabled `reactDocgen` (prop tables, not runtime rendering); the original file was restored before commit. Owned browser tab closed, exact Storybook process group **92944** reaped, both scratch gallery HOME directories removed. No config/tool/default/model settings changed.

### Coverage limits retained, not claimed fixed

- No driver verb/fixture emits a graphics supplement through the app's own daemon driver. This is production transcript/row/frame behavior in Storybook plus mounted media-boundary tests, **not** a live native daemon-generated graphics turn.
- The browser tool cannot dispatch physical Enter/Space. Native button semantics, focus and aria-expanded were measured; physical keyboard activation and actual screen-reader speech remain unverified.
- Zero-fetch evidence is **zero slots, zero iframes, zero media-boundary requests**, not a network waterfall (the browser tool exposes no network log).


## Current-base convergence

The thirteen r1 frames were re-captured after merging main `787f8c6e7e` into author head `ae39cfe48d`: upstream moved the user copy row out of flow, lifting the surrounding block by32px. Authored product source remained byte-identical. See [CONVERGENCE.md](CONVERGENCE.md) for conflict unions, exact byte checks, upstream semantic-neighbor review, fresh execution, capture lifecycle and the optional inherited neighbor-test timeout. The updated consecutive-pair hash above describes these re-captures, not the superseded pre-merge PNG bytes.


## Round-2 review remediation

B1 updates the registered composer consumer's closed-state assertion: no aria-controls while its body is unmounted. A new mounted test of the real ComposerStatusRow verifies closed/no target → open/existing target → closed/no target. That new fixture owns its QueryClientProvider/cache and clears it after unmount; no production timer change or force-exit is used.

N1 removes `r1-dark-folded-fixture.png`: it was byte-identical to `r1-dark-closed.png`, so its second filename supplied no independent visual signal. The repaired story remains, and its previously observed browser snapshot is described above; the retained closed PNG is not claimed to independently identify that story. Twelve r1 frames (23 total PNGs in this set) remain. Earlier capture counts in this README/CONVERGENCE.md describe those historical runs, before this explicit duplicate removal. No new capture was necessary: production/stories/retained image bytes are unchanged.

Round2 validation: the corrected composer consumer plus the five-file own targeted set and manifest suite ran serially to natural completion: **285 tests,284 pass,0 fail,1 existing shallow-history skip**,344.6s. The legacy composer harness retains its inert fallback QueryClients until their existing five-minute GC expiry; it was not force-exited or modified to shorten production/cache timing. The new goal-consumer fixture independently exits6/6 in about5s because it owns and clears its provider cache. The repository-wide test/story assertion sweep found no other stale always-present shared-Disclosure relationship: browser-chrome's hit is a tab contract, org-teams tests resolve targets only after opening, and the remaining composer match normalizes snapshots rather than asserting presence.


## Prelude-v5 main convergence after round2

Merged main bbea8a3db9 (including #1235's authoritative generated files) after the independent B1/N1 commit2f9830b3b2. Both generated files remain exact main bytes; neither was regenerated or edited by this branch. Main also carries its authorized0.36.6 release and unrelated spend/mesh/review-label/CI work. Authored product/test files remain byte-identical to2f9830b3b2.

Only the five HTML-backed current open frames changed and were re-captured/opened: r1-dark-open.png, r1-dark-open-settled.png, r1-light-open.png, r1-dark-mixed-open.png, r1-light-mixed-open.png. The closed dark control was independently captured to scratch and proved byte-identical; the other18 retained PNGs were left unchanged. The current settled frame is790×364px (previous prelude370px), top297.19px; visible chart bars and the prelude's right-edge scrollbar track are retained as main renders them. The two dark open captures remain byte-identical; the hash above is updated to this generation. One too-early light capture still showed the loading reserve, so it was rejected/replaced only after the accessible loading status disappeared and the iframe measured its settled364px. No rejected still is committed.

Owned browser tabs closed; server groups88835 and14681 reaped; local docgen-only fallback restored; isolated HOME removed. No unaffected frame was re-shot. The prior coverage limits remain unchanged.

## Round-1 remediation of the default-open follow-up — alignment (head `956a24b7b1`)

The reviewer measured the disclosed body indented by the shared Disclosure's one
chevron column: frame 790px at x=247.5 against the paragraph's 810px at x=227.5,
so the chart sat 20px right of the answer text and reflowed 20px left when the
work bar expanded. `SupplementRow` now opts its own graphics body back out of
that indent with the SAME spacing token (`-ml-5 w-[calc(100%+1.25rem)]`), local
to this call site; every other disclosure consumer keeps the shared indent.

Measured in the browser on the shipped `folded-condensed-components` /
`local-graphics-mixed` / `local-graphics-narrow` stories (CSS px):

| State | Paragraph | Frame | Delta |
| --- | --- | --- | --- |
| condensed default, 900px story | 810 at x=227.5 | 810 at x=227.5 | 0px |
| work bar expanded | 810 at x=227.5 | 810 at x=227.5 | 0px |
| condensed mixed | 810 at x=227.5 | 810 at x=227.5 | 0px |
| condensed narrow, 360px container | 250 at x=55 | 250 at x=55 | 0px |

The frame's height (390.4px) is the chart document's own; only the horizontal
alignment changed. This supersedes the "790x364px at top 297.19px" note above,
which described the pre-alignment indent.

### New frames (browser tool, 1280x720 CSS / 2560x1440 PNG, opened before commit)

| Frame | State |
| --- | --- |
| `after-dark-default-open.png` | Condensed default, dark: `Hide 2 graphics` and the chart, aligned to the answer column; work bar still folded. |
| `after-light-default-open.png` | Light counterpart. |
| `after-dark-work-expanded-top.png` | Work bar expanded: the trace appears and the chart keeps the same left edge and width (the focus ring on the bar is the synthetic click). |
| `after-dark-local-mixed-default-open.png` | Condensed mixed finish: actionable file rows then the aligned chart. |
| `after-dark-narrow-default-open.png` | 360px story container: frame and paragraph both 250px at x=55, no horizontal escape. |

`after-dark-hidden.png` is deliberately NOT committed: with the body hidden the
frame draws nothing, so it is byte-identical to the retained `r1-dark-closed.png`
(SHA-256 `faecc64f...`). The `before-*` frames referenced in the PR body are
those same retained `r1-*-closed.png` files; copying them under new names would
be a duplicate still.

### Sweep recapture

`docs/evidence/chat-turn-supplements/folded-condensed-components/{localOperatorDark,localOperatorLight}.webp`
were re-captured at `956a24b7b1` through the repository rig
(`--only=chat-turn-supplements--folded-condensed-components --themes=localOperatorDark,localOperatorLight --allow-backend`)
at 900x760, replacing the stale 900x400 frames of the old closed default. The
`folded-condensed-mixed` and `folded-condensed-narrow` sweeps remain stale: that
story has a pre-existing answer/supplement anchor mismatch (it renders the
expanded form) and this change does not touch it.
