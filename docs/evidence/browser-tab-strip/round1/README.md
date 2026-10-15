# PR1102 — one batched remediation of round 1

Source commit **`c7d766d92dabf63b39ca1607a4ccba958fe161c5`**, src tree **`4ce1f33a53a55b6d9a3202ae6d3be03681fd1158`**. Delta base: `39fd08f1edc2072ff55a361db5b7f3214f97e93f`. Evidence addendum does not change product source. Host-reported implementer: anthropic/claude-sonnet-5-5; no manual model/role/tool setting change.

## Four bounded product changes

1. **D-B1:** the existing 28px actions trigger is also the leading fixed identity slot (Globe/Bot/Hand plus contained status badge), rather than spending glyph + text chip + two actions separately. Title gets its own flexible width; trailing close remains 28px. Full ownership/error/request/restored names stay in the tab's accessible name, not colour alone. No new action or permission.
2. **D-B2/D-B3:** hide the platform scrollbar, not scrolling/arrows/keyboard reach; add the keyed, shared top/end-aligned **“Approvals and site access”** tooltip/name to the quiet shield.
3. **U1:** main-strip heading leads/counts now consume the same contiguous ordered runs as overflow, so A/B/A does not visually assign the last A tab to B. No regrouping of human display order.
4. **R1/U2:** retain the complete typed outcome through the hook. A scoped surface reveals **any actual created duplicate destination**, including a retained failed copy. A refusal with tabId:null changes no scope; no association or authority is copied.

## Reproduction and affected automated checks

[Old source discriminator](b-r1-old-fail.log.json): **4 FAIL /0 PASS** against39fd08f1 (A/B/A rendered headings and all typed destination outcomes). Prepared source bytes were restored exactly in a finally block.

[Corrected source run](b-r1-source-cell.log.json): **97 PASS /0 FAIL**, Node test time13.1607s, leased/bounded cell18.2s. Real chrome hook + literal shipped Surface callback separately exercise scoped success, failed retained destination, and refusal creating no destination. Existing actual-DOM close/menu-focus, management-order and browser-chord renderer neighbours are included. Node/app types passed. Actual scripts ratchet passed; key generator byte-identical; i18n scanner passed with existing report-only advisories. Full automated coverage stays with CI, not a second local full run.

No new fixed chord or saved-binding change. One new EN key: `ui.browser.chrome.approvals` = `Approvals and site access`; matching translator context and generated key. Larger existing browser strings remain with the i18n lane.

## One compile, stopped cell, explicitly authorized same-artifact continuation

- **ONE product compile**,13.33s,170 artifact hashes; installed dependency lock unchanged. [Build identity](build-identity.json), [build output](b-r1-build.log.json).
- [Exact emitted binding execution](binding-proof.json): schema/env/loader/API-fallback winner is port1; manager disabled. Null discovery stays port1; synthetic discovery can override to port2; removed-binding negative selects default localhost1111. No live backend was used.
- First native cell **3.1s/rc1**,10 saved rows,0 captures: [raw stopped results](stopped-cell-results.json). It asserted page y110==y144 after adding consent/agent fixture state, despite strip band staying36px. That was an unisolated comparison of different chrome states. The exact intervening DOM text was not captured, so we do NOT invent its identity. [Historical stop receipt](stopped-cell.md) records the failure, not a disguised pass.
- Manager explicitly authorized **ONE SAME-ARTIFACT continuation**, **NO rebuild/source edits**. All170 restored artifacts rehashed with zero mismatches. Real consent completed **before** the BrowserSurface mounted; the continuation records text + rects for every visible chrome/consent/find/toolbar/strip band and both registered/actual native bounds. No consent bypass, backend/session interception, preload injection or focus guard override.
- Continuation **rc0/wall18.6s**, **144 saved rows**, **93 explicit PASS /0 FAIL rows**, final expectation-failure list **[]**, **28 fresh light/dark captures**. [Raw continuation](continuation-results.json), [actual output](b-r1-continuation-cell.log.json). Product/cosmetic mismatches were accumulated as FAIL and would force finalrc1 **after** captures; only safety/setup failures stop early. The empty list is an observed result, not suppressed errors.

## Measured native results

| Case | Actual title / band / native page |
|---|---|
| One tab,1380px viewport | tab240px, title166px; band36px; registered=actual y110 |
| Three ordinary tabs,1380px | tab239.66..239.67px, title165.66..165.67px; band36px; native y110 |
| Twelve at floor | **every tab144px, every title70px**; menu+close28px; identity20px with all glyph boxes contained; band36px; native y110 |
| Three mixed at actual800px narrow viewport | ordinary/agent/handed tabs **144px/title70px**, targets28px, no clipped glyph; band36px; native y110 |
| Three consecutive overflow readings/frames | same other chrome text/rects, band36px, registered/actual native y110; no7.5px scrollbar reflow |
| A/B/A | actual heading IDs start proof-a / proof-b / proof-a; each count describes its contiguous run |
| Failed duplicate on real route | `status:failed`, `error.code:navigation_failed`, destination14 retained active, owner:user, sessionId:null, handedOver:false, failed:true; visible in route |
| Zero approvals | actual accessible name and tooltip “Approvals and site access” in both brands; tooltip x1207/y41.5/w165.039/h27.398, bottom68.898 < native page top110; **actual+registered intersections false**, closes on leave |

## Pixels inspected

[Native-pixel closeup sheet](crops/contact-sheet.png) shows legible agent/handed/failed titles in both brands. Crops are derived from actual saved PNG pixels and measured CSS row boxes, not a separate render: [crop geometry](derived-crops.json).

| Affected state | Light | Dark |
|---|---|---|
| Historical missing-title before (different fixture; original capture identity retained) | [before](../captures/agent-owned-localoperatorlight.png) | [before](../captures/agent-owned-localoperatordark.png) |
| One | [after](captures/one-localoperatorlight.png) | [after](captures/one-localoperatordark.png) |
| Three | [after](captures/three-localoperatorlight.png) | [after](captures/three-localoperatordark.png) |
| Twelve ordinary | [after](captures/twelve-ordinary-localoperatorlight.png) | [after](captures/twelve-ordinary-localoperatordark.png) |
| Floor agent | [after](captures/twelve-agent-localoperatorlight.png) | [after](captures/twelve-agent-localoperatordark.png) |
| Floor handed | [after](captures/twelve-handed-localoperatorlight.png) | [after](captures/twelve-handed-localoperatordark.png) |
| Floor failed | [after](captures/twelve-failed-localoperatorlight.png) | [after](captures/twelve-failed-localoperatordark.png) |
| Typed failure feedback | [after](captures/failed-copy-feedback-localoperatorlight.png) | [after](captures/failed-copy-feedback-localoperatordark.png) |
| Three mixed narrow | [after](captures/three-mixed-narrow-localoperatorlight.png) | [after](captures/three-mixed-narrow-localoperatordark.png) |
| Narrow hover | [after](captures/three-narrow-hover-localoperatorlight.png) | [after](captures/three-narrow-hover-localoperatordark.png) |
| Forced focus/reduced motion | [after](captures/three-narrow-focus-reduced-localoperatorlight.png) | [after](captures/three-narrow-focus-reduced-localoperatordark.png) |
| Approvals tooltip | [after](captures/tooltip-approvals-localoperatorlight.png) | [after](captures/tooltip-approvals-localoperatordark.png) |

Consecutive overflow0/1/2 frames are in `captures/` and linked by raw result rows. Total new images: **28 actual captures +6 measured crops +1 derived contact sheet**, not35 independent app captures.

## Retention and remaining limits

- Browser main/registry/order/ownership, both preload files and shared typed outcome are byte-identical to39fd08f1: existing author agent creation-order, duplicate URL-only/session-null/nonce-null, agent refusal and IPC proofs remain attributed context, not repeated as this continuation's security execution. Independent QA must complete its own boundary matrix.
- **Mounted conversation-pane native recovery NOT EXERCISED.** Port-one/offline chat has no session_catalogue/header. Manager explicitly declined backend fixture interception; real hook + literal scoped Surface callback functional/source tests cover reveal independently. Do not call this a full scoped native pass.
- QA round1 is **BLOCKED**, not clean, after two scratch setup mistakes. Its missing matrix remains in the QA owner's `pr1102-qa-unexecuted-round1.md` for independent round2; this author evidence does not replace it. No product accommodation for obsolete zoom-in was made.
- Physical OS keys/drag/clipboard/focus, fused native page+chrome captures, all-locale coverage and actual restored/loading fixture frames are not newly proved here. Forced focus is labelled CSS pseudo-state; capturePage excludes the native page. No new browser capability or dependency install.
- [Final cleanup](cleanup.json): PIDs22556/36840 dead, exact group/profile survivors0; canonical out/, frozen artifact clone and both run directories reaped. Lease FREE. No further author native retry.
