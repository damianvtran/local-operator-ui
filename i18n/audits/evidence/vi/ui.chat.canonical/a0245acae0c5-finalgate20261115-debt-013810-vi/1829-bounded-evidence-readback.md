# PR #1829 — terminal bounded i18n evidence readback

**This is an evidence delta, not a new translation audit or ledger receipt. Original reports, findings, dispositions and withholds are unchanged.**

## Identity and bounds

- Auditor `translation-auditor`, session `a0245acae0c5`, instance `a0245acae0c5-evidence-readback-20261112`. Actual model `openai/gpt-6.1-sol`; launch selection `parent`, no override or in-session fallback observed. No coordinator-only fallback authorization claimed.
- Exactly **23** `ui.chat.canonical.tool_row.diff.full.*` keys; seven available actual locale frame sets: es, fr, hi, ru, ur, vi, zh-CN (**161 key/locale instances**). English is the source, not an additional captured actual-locale set. No 490-key rereview.
- Read actual contacts for all seven locales plus synthetic pseudo and the late footer contact; targeted originals/crops for Urdu page, split, split-next and error, Chinese clipped row, pseudo split-next, and the unique late Russian clipped-footer. No designer report was consulted.

## Source and artifact binding

- Frozen index tree: `2d89bff82f58b84744ddc469e3532377df26d278`; all **13,433** index entries independently match it.
- Raw index SHA-256: `f51e7673dab7b96a8376cc2393a7505773827724fa9bbcf31bc2b5d37724020d`.
- All **19 sourceFiles** hashes match actual index bytes. Renderer subtree `7eb33bb8797f50e96c66e086ed2e255f5e8bdcfb`; i18n subtree `e8feb903b83f67c469133c8cfe43ad7d7137d828`. All three harness hashes match the identity.
- Initial manifest: **120** PNG entries, SHA-256 `3298ebe16b86c12cfbca1075327589a3944ef36d39dc8d44c789c70138f089aa`; all independently hash-valid.
- Late manifest: **134** entries, SHA-256 `2ff02dcbdbaa40ae230c378e1377e762e670ec0e12ba71dcd41e65fd6930aff4`; all independently hash-valid. The 14 added footer filenames contain **13 byte-identical duplicates**; the unique `ru-clipped-footer-360.png` also shows the top, not the aggregate footer. No coverage gap closes by filename.
- Source identity SHA-256 `011d373b047026492d9ca73f7ec6747df1a90daeb7cb2c805aa9b4dade46ca34`; coverage routing-plan SHA-256 `8e754d0655e7a0bc3494473e1dec22adbe67ab715e39ab56632db5ad79b73a1c`.
- `captures.jsonl`: **92 records**, SHA-256 `e9412edfebff603aa0a4b5f758b91b7175c3abc2001f6a41786b34ec28e1846d`, including 14 failed/old snapshots. This is not 134 snapshots or geometry evidence. The final nonblank PNGs were used, not historical failure filenames.

Artifact root: `/home/ec2-user/.local-operator/sessions/331ecd98c7fb/scratchpad/browser-preview/captured-from-manager/1829-browser-locale`. The JSON companion includes absolute per-key/per-locale paths and image hashes, contact hashes, successful snapshot states, source hashes and the late delta checks.

## Final focused addition within the same bounded readback

While sealing this report, the manifest added 16 genuinely new focused PNGs (**150 total entries**, SHA-256 `12babe07d87bb5d193d3fd909919e1645706e06984129055d4547ded21321db5`). I independently hash-checked **and opened all 16**: `L-offer-focused-360.png` and `L-clipped-focused-360.png` for seven actual locales plus pseudo. Unlike the 13 duplicate footer files, these actually show the offer button/count **598**, and the aggregate clipped notice/count **1** with bottom range. The two visual coverage gaps therefore close in this final evidence version, not by filename inference. No activation or action outcome is thereby proved. The 120/134 chronology above remains true of those earlier inspected versions. Original catalogue audit withholds and dispositions remain untouched.

**Final scoped count: 22 visible elements + 1 nonvisual navigation-name key = all 23 keys per actual locale.** No measured geometry, all-plural-count, interaction, full-app/native or shipped-pseudo-mode sign-off is implied.

## Exact key-to-frame mapping

For each actual locale **L**, frame names below mean `L-STATE-360.png` beneath the artifact root. All seven contacts were inspected. “Visible” is bounded pixel evidence, not native-language reapproval or a measured overflow test.

| Key suffix | Frames / state | Evidence and limits |
|---|---|---|
| `back` | page; error; notices; split / split-next | **visible** — Button label visible; click-to-preview outcome NOT recorded |
| `clipped` | clipped-focused | **visible_focused_final** — Newly read `L-clipped-focused-360.png` exposes count=1 aggregate and bottom range; legacy synthetic fixture, not current backend truncation |
| `clipped_row` | clipped | **visible_legacy_fixture** — Annotation visible on the first mixed-code row; synthetic clipped_rows=[3], not evidence current backend truncates |
| `continued` | split-next | **visible** — Continuation annotation near end of split-next body; not a new row |
| `continues` | split, split-next | **visible** — Continues annotation at split page end (also subsequent continuation page) |
| `empty` | empty | **visible** — Empty notice and Back label fit the captured box |
| `error` | error | **visible** — Error status visible; Retry label visible |
| `evicted` | evicted | **visible** — Notice wraps inside box; no observed clipping |
| `first` | page, split, split-next | **visible** — First disabled on initial page, enabled on split-next where visible; First click result NOT recorded |
| `inline` | inline | **visible** — Notice visible |
| `last` | page, split, split-next | **visible** — Last label visible; Last click/result NOT recorded |
| `loading` | loading | **visible** — Loading status visible |
| `nav` | page, split, split-next | **accessible_name_only** — Not a visible label; successful AX snapshots name navigation in all seven actual locales; no screen-reader speech claimed |
| `next` | page, split, split-next | **visible** — Next label visible, split-next changed cursor body/focus is evidence of next-state only; no full navigation suite |
| `not_found` | not_found | **visible** — 404 notice text visible |
| `not_recorded` | not_recorded | **visible** — Notice text visible |
| `oversized` | oversized | **visible** — Notice text wraps inside box |
| `prev` | page, split, split-next | **visible** — Previous disabled at beginning and enabled on split-next; Previous action/result NOT recorded |
| `range` | page, split, split-next | **visible_with_urdu_order_anomaly** — Initial logical arguments first=1 last=198 total=598; Urdu pixels show the 198–1 run, not a missing number; split pages show 1–1 of 2 |
| `retry` | error | **visible** — Retry label visible without observed cutoff; retry action/result NOT recorded |
| `unavailable` | unavailable | **visible** — Notice text visible |
| `view` | offer-focused | **visible_focused_final** — Newly read `L-offer-focused-360.png` exposes offer/control and count=598; click-result unobserved |
| `withheld` | withheld | **visible** — Notice visible; no wording re-audit or disposition change |

**Final coverage result:** 22/23 key elements visible in each actual-locale frame set after the focused150 addition; `.nav` is nonvisual and supported by successful accessible-name snapshots in all seven locales. `.view` and aggregate `.clipped` are now actually visible in their focused frames. Visibility does not prove completed control actions.

## Observed fit, not measured geometry

- Visible labels/notices wrap inside the shown wells; no obvious text cutoff was observed in those captured regions. Russian continuation text, Vietnamese Back/withheld text and Urdu Retry now have bounded pixel evidence rather than only a hypothetical width concern.
- Captures show **360px selected/declared fixture content width**, dark theme and 2560×1440 source PNG dimensions. The 620px scrolling transcript and flex-wrap are harness/production CSS declarations, not independently measured DOM sizes.
- No boundingClientRect/scrollWidth/clientWidth/geometry JSON exists in the supplied evidence. AX snapshots provide roles, labels, disabled states and InlineTextBox runs; they do not prove no horizontal overflow or exact painted dimensions.
- The split-next frame changes the body and enables First/Previous, with Next focused. First, Last, Previous, Back and Retry click outcomes were not recorded. The 1–1 range persists because the next chunk is the same split logical row.

## Urdu: observed pixels and source attribution

- The page range paints the physical left-to-right numeric run **198–1** with total **598**; source arguments still name first=1 and last=198. That physical ordering alone is not a finding that natural RTL range reading is wrong. The split pages paint 1–1 of 2. The snapshot InlineTextBox order is also visual-run-oriented; it is not proof the logical catalogue placeholders changed.
- In the approved direct fixture, `+` and `-` markers move to the right/trailing side of code lines; `@@` signs and surrounding punctuation reorder, and the mixed Urdu filename is split/rearranged among Latin runs. These are observed preview pixels, not a proven full-app regression.
- The visible code literal **`$0`** retains dollar-before-zero in the focused first-line crop; ASCII **12345.67** remains intact. This does NOT establish how the unrelated `sound.cost.estimated_zero` sentence paints; that key is outside the 23-key delta.
- Concrete fixture mechanism: `main.tsx:48–53` sets actual Urdu and calls production `applyDocumentDirection` on `<html>`; `:75–77` mounts DiffHistoryPager directly in a font-mono/pre-wrap wrapper without an LTR code island. `preview.css` adds no direction fix.
- Concrete component/source mechanism: `diff-history.tsx:666–700` emits ordinary block spans for code and inline annotations; `diff-block.tsx:232–271` does not set direction. The immediate actual integration was traced through `canonical-transcript.tsx:2850`, `:2913`, `:2965–3030` → ToolLedgerRow → `tool-row.tsx:1192–1207` Disclosure → `disclosure.tsx:624–633`; MessageContainer’s non-user wrapper (`:64–65`) also does not isolate direction. The `bdi` at tool-row:1146 isolates only the summary, not this body. No relevant global stylesheet direction override was found.
- This supports a **component-level inherited-direction weakness** and identifies the fixture cause; it does not replace an integrated canonical/full-app DOM observation or prove when the behavior was introduced. No catalogue text reordering, manual bidi control insertion or translation change is proposed.

## Pseudo evidence: synthetic only

- **15 original synthetic pseudo PNGs** (14 states plus split-next), plus **2 focused supplemental PNGs**, not 15 actual pseudo-locale translations. Contacts and targeted continuation pixels show expanded literal text wrapping.
- `server.mjs:25–33` expands/accents literal ICU AST nodes of the 23 English messages (~35%), leaving structural fields intact; `main.tsx:48–49` registers those messages under **en** through the existing registration seam. Actual locale strings are untouched.
- No production pseudo/qps/en-XA mode was found in targeted `src/i18n` search. These frames prove the synthetic harness can stress production components, not shipped/activated full-app pseudo support, and not RTL pseudo behavior. Two later focused synthetic frames now expose the offer and clipped aggregate, but do not supply action outcomes or a shipped pseudo mode.

## Terminal scoped verdict

| Locale / namespace | Evidence-readback verdict |
|---|---|
| es / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |
| fr / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |
| hi / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |
| ru / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |
| ur / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed; Urdu fixture numeric/code bidi anomaly observed, full-app runtime unproven |
| vi / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |
| zh-CN / `ui.chat.canonical` | 22 visible key elements + `.nav` AX evidence; focused `.view` / aggregate `.clipped` now actually observed |

**Overall: bounded evidence readback complete, partial coverage—not a blanket fit pass and not zero evidence.** No new translation findings, catalogue review, receipt issuance, verdict rewrite or policy waiver. All original per-locale blocked-report hashes remain unchanged. No repository/index/catalogue/ledger writes, tests, builds, browser/native/app operations or installations were performed.

## Deliverables

- `/home/ec2-user/.local-operator/sessions/a0245acae0c5/scratchpad/1829-bounded-evidence-readback.json`
- `/home/ec2-user/.local-operator/sessions/a0245acae0c5/scratchpad/1829-bounded-evidence-readback.md`

