# Answer-local graphics disclosure

Captured 2026-10-19 through the harness **browser tool**, in one owned background tab on the existing desktop browser host; the tab was closed afterwards. No native app, operator session, standalone browser engine, or scratch dependency installation was used. The isolated Storybook server was reaped by its exact process group (95520). Coder model: `openai/gpt-6.1-sol`, temporary fallback after Anthropic quota exhaustion.

## Reach the states

From this worktree run `pnpm storybook -- --ci --no-open` (or `pnpm exec storybook dev -p 6017 --ci --no-open`), then open:

`http://localhost:6017/iframe.html?id=chat-turn-supplements--local-graphics-closed&args=theme:localOperatorDark&viewMode=story`

Use `theme:localOperatorLight` for light. Story IDs use `local-graphic-closed`, `local-graphic-open`, `local-graphics-closed`, `local-graphics-open`, `local-graphics-narrow`, `local-graphic-refused`, and `local-graphic-loading`. The open fixtures click the inner `[data-supplement-graphics-reveal]` span after mount; its click bubbles to the real shared Disclosure trigger. They do not use an initial-open override. The narrow fixture is a **360 CSS px story container**, not a narrow browser viewport.

The new fixtures deliberately use the answer's real ID as `supplement.anchor`. At the original capture, older `FoldedCondensed*` fixtures used `m1` for the answer and a different supplement anchor, so they did not prove the closed state. Round-1 remediation fixes `FoldedCondensedComponents` specifically to use the actual anchor; its newly reachable condensed form is captured below. The other old fixtures were not broadened into this fix. The collapse model remains unchanged.

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
| `r1-dark-open.png`, `r1-dark-open-settled.png`, `r1-light-open.png` | Press local reveal: **Hide 2 graphics**, one head frame, unchanged nested overflow. Consecutive dark frames are byte-identical (SHA-256 `aa300e939f6bcdb84a06815de64a09914407789294f6da71b6dde88f3b07a2d5`); no settling reflow observed between them. |
| `r1-dark-mixed-closed.png`, `r1-light-mixed-closed.png` | New `local-graphics-mixed`: actionable existing file rows, followed by the same budget-aware local control; work remains folded. |
| `r1-dark-mixed-open.png`, `r1-light-mixed-open.png` | Press mixed local control: chart mounts below the files. Wide screenshots emphasize the file/control seam; the lower chart extends below the capture viewport. |
| `r1-dark-narrow-closed.png`, `r1-light-narrow-closed.png` | `local-graphics-narrow`, then Hide: longer closed wording fits a 360px story container; measured label width 134.02px inside the 280px block. |
| `r1-dark-folded-fixture.png` | Repaired `folded-condensed-components`: actual answer/anchor identity now reaches the folded form with a local reveal and no iframe. |
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
