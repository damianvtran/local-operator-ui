# Merge convergence onto main 787f8c6e7e

This is a **merge**, not a rebase: author head `ae39cfe48d00ce935cd1842ee91c4a2b110c5fc4` plus main `787f8c6e7e67e8aa63bd6309201226f2b06cf382`. All three original author commits retain their SHAs and contents. No authored product line was changed by conflict resolution.

## Conflicts and preservation

Only two paths intersect the author diff and main's 89 changed paths since `cd184a49d3`:
- `package.json`: exact main bytes plus insertion of `scripts/supplement-disclosure.test.mjs` next to the existing row test. The merged test command contains **both** parents' test token sets. Main's version **0.36.5** retained; all dependency fields equal both parents.
- `docs/evidence/manifest.json`: union resolved by the repository's tracked merge driver, then `node scripts/evidence-fold.mjs --no-amend` successfully re-derived/validated it during the merge. All **225** supplementary paths equal the union of the parents; the own set still contains all **24 PNGs**, including the thirteen r1 frames. No side was selected wholesale.

The byte-level product/test check compared every authored `src/` or `scripts/` path with ae39cfe48d. All eight are identical. Independently, the complete +/- payload (excluding file headers) for each path from `cd184a49d3..ae39cfe48d` equals that path's `787f8c6e7e..merged tree` payload byte-for-byte. This is stronger than a whitespace-only comparison.

| Authored path | SHA-256 of preserved bytes | Before/after merge |
| --- | --- | --- |
| `scripts/supplement-disclosure.test.mjs` | `d57a20b850a098227c3eaf4674cfe7007e70a0102bd728f1b612dc95673f7cb2` | identical |
| `scripts/supplement-model.test.mjs` | `978d073779fe7c2a1748306754b41150acf36bc99dfba6098d7aafc0c087073b` | identical |
| `scripts/supplement-row.test.mjs` | `5b30f8c6e0d8827396ae4fd5f7a6c49a71d1e9059ad83f0a13eb5238b69255ee` | identical |
| `src/renderer/src/features/chat/canonical/supplement-frame.tsx` | `0e9f05b4ed24f40b5170c740a78fb65b380cfa5c110f6809806f2c0e5e3bc352` | identical |
| `src/renderer/src/features/chat/canonical/supplement-model.ts` | `1cc9dfa886c6bca0cba60535af2ea29fd26269a4cb824c79ada6ebc5fd9988b7` | identical |
| `src/renderer/src/features/chat/canonical/supplement-row.tsx` | `abb1984ba07c4cab8e1fc4a073bf932e68e3c72d794809ada1da195c7c9fa762` | identical |
| `src/renderer/src/features/chat/canonical/supplement.stories.tsx` | `fcb235343f4d959d38bc17fc671037e07f20a03f2b4339232b271dbb5bc922b0` | identical |
| `src/renderer/src/shared/components/ui/disclosure.tsx` | `b519604eabce2744d535f2fee786ca8fc4c5e2f8a3a39e4c118d3ed74986f5bb` | identical |

Own history comparison after the merge:
```sh
git range-diff cd184a49d3..ae39cfe48d 787f8c6e7e..HEAD
```
The expected/reported result is three `=` rows: implementation 1206718a73, evidence a09ef11bf6, remediation ae39cfe48d. The merge is not a rewritten/replayed author commit.

## Upstream semantic-neighbor review

Main's full changed-path inventory was checked against every authored path. Outside the two conflicts, the upstream groups are hub source-confirmation controls/API/catalogues; remote peer-presence/session catalogue state; transcript copy/quote helpers, action-row overlays, context menus and selection controls; corresponding tests, translations and evidence. Hub/peer work does not alter SupplementRecord, its document route, its budget, the shared Disclosure or the loading frame.

The overlapping **feature**, though not overlapping source file, is upstream canonical-transcript.tsx:
- It still passes the exact record/session/cwd/condensed props to SupplementRow and still computes condensed through runIsCondensed.
- TranscriptCopyMenu uses ContextMenuTrigger `asChild`, so it adds context-menu behavior without a layout wrapper; ordinary disclosure clicks remain functional.
- New row key handling is only on message rows, not the supplement row. Selection toolbar CSS targets selection/gutter controls, not SupplementRow or its frames.
- User/response copy controls moved out of flow. This **does change surrounding rendering**: the local chart top moved from **329.19px to 297.19px**, exactly 32px upward. Therefore all thirteen current r1 screenshots were re-captured and inspected, not silently retained. No old author product source was edited to accommodate this main change.

## Fresh rendered and behavior proof

All thirteen `r1-*.png` files were re-captured using the browser tool from the merged source. All thirteen image hashes changed versus ae39cfe48d. Every PNG was opened; a contact sheet was also inspected. The original eleven non-r1 images remain historical controls, not claims about main's new chrome. Consecutive dark open captures remain byte-identical; their new SHA-256 is `7739f2c7c34d4a420172004b4f246363eb0b691b4ad9a6b770f24fe593aeae19`.

Browser path after merging: Show→one iframe; work expand→one iframe/no local trigger; work reclose→one iframe/Hide; Show all→two iframes; local Hide→no iframe; Show→one iframe and Show all restored. Settled local geometry remains 790×370px; expanded work is 810×379px. The existing reserved initial height was also observed at 320px before settling to 370px; the unchanged frame pipeline owns that behavior. Loading status remains visible to the accessibility snapshot and visually hidden. Mixed files and narrow copy remain contained.

The same docgen-only fallback was required for the missing shared baseline-browser-mapping package; .storybook/main.ts was restored, no installation occurred. Owned browser tab closed; exact server group **55635** reaped; isolated HOME removed. No live app/session used.

## Gates and explicit limits

Serial requested behavior/shared/collapse/manifest command: **183 tests, 182 pass, 0 fail, 1 existing shallow-history skip** (130 behavior tests plus 53 manifest tests). Upstream `transcript-copy-affordances.test.mjs`: **16/16 pass**, checking the new menu/selection interaction neighbor.

An additional optional four-file upstream-neighbor run reached 77 passing assertions but hit its 120s process bound after response-copy.test.mjs's three assertions, without a terminal summary. An exact-main source control reproduced the same non-termination (three assertions pass, still alive at 18s); its exact process group was reaped, all five authored source files restored byte-for-byte. No `--test-force-exit` or suppression was used. This optional run is **not a passing suite claim**; CI owns full-tree coverage.

The original coverage limits remain: no daemon driver graphics verb, no physical Enter/Space dispatch, no actual screen-reader speech, and media-boundary zero requests rather than a network waterfall. No CI workflow was manually rerun. No reviewer, handle tag, version bump or PR merge.


Round-2 evidence maintenance: the redundant r1-dark-folded-fixture.png was subsequently removed because it equalled r1-dark-closed.png byte-for-byte. The 13/24 capture counts above are historical; the set now retains 12 r1 /23 total PNGs. No product source or surviving image changed in that remediation.


## Subsequent main convergence: bbea8a3db9 after B1/N1

Parents: own remediation2f9830b3b2 plus main bbea8a3db9. Main since787f8c6e7e contains six first-parent changes (#1234release,#1229spend,#1225mesh,#1238CI,#1232review-label,#1235prelude fixtures),273 paths. Actual authored-path overlap remains only package.json/manifest.json; all nine owned src/scripts files are byte-identical before/after the merge. Canonical transcript and styles did not move in this interval. Generated supplement-document-fixtures.ts and supplement-closeout.generated.html are exact authoritative main bytes, not an author regeneration.

package.json is main's exact byte stream plus our supplement-disclosure registration; dependencies equal both parents; version0.36.6 is inherited from main's release PR. The repo evidence-fold generator unioned and re-derived the manifest. Before committing, its count test correctly rejected old HEAD1755 stories against the staged merged1760; both counts were derived with declaredStoryRows against HEAD/index/MERGE_HEAD. The committed-head test is the terminal count check, not a hand adjustment back to1755.

Only five current open HTML-backed images moved (prelude-v5), all recaptured and opened. Closed control and all18 other retained images are byte-identical; no broad recapture. Browser proved real bars, local Hide and nested Show all with settled790×364 frame. One not-yet-painted light shutter was rejected and replaced after Loading graphic… disappeared. Source/example chart changes are inherited from #1235, not modifications to its files. See README for the precise image list and teardown.

The corrected consumer's101 cases and all targeted tests passed on reviewed remediation2f9830b3b2 (285tests/284pass/1shallow skip). The new convergence re-ran only the131 affected behavior/shared/collapse cases plus the manifest check; it does not re-audit unrelated spend/mesh/review work or repeat the five-minute unchanged composer suite. No production change, force-exit, manual CI rerun or version edit was introduced for convergence.
