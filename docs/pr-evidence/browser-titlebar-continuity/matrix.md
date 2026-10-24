| Row | Claim | Status | Actual evidence |
| --- | --- | --- | --- |
| B0 | built artifacts exist and the product logs the darwin chrome arm | PASS | {"armed":true,"identity":{"main":"9a0e2c5478d7c4b8188f0f9e27b5776453db3b6748d7a3ef735ee37132205046","renderer":"c1faf8bd273e39a188aea6940bad08f2a91ab20aa80846431900e9a65fea8b1c","listDocument":"4f8775c2d53bb3fc9d7770df7a4e97a72c691e3bd38bcf752bb27698a1cc2c0c"}} |
| R1 | rest: no bar, no dock, no popout; page starts at the strip's bottom | PASS | {"rest":{"content":{"x":260,"y":69,"width":1120,"height":831},"strip":{"x":260,"y":32,"width":1120,"height":37},"popout":null,"barCount":0,"dockCount":0,"popoutPresent":false,"addressTrigger":true,"triggerText":"127.0.0.1:56871","triggerWidth":121,"hash":"#/browser"},"restPage":{"scrollY":1200,"innerHeight":831,"markerY":300}} |
| R2 | rest: the strip→page band is 0px with nothing in it, and the #1263 dock is absent from the DOM | PASS | {"stripBottom":69,"pageTop":69,"stripHeight":37,"bandPx":0,"intruders":[],"dockPresentAtRest":false,"dockSelector":"[data-address-dock-height]"} |
| P1 | Cmd+L raises the popout over the strip at the strip's width | PASS | {"raised":true,"open":{"content":{"x":260,"y":69,"width":1120,"height":831},"strip":{"x":260,"y":32,"width":1120,"height":37},"popout":{"x":260,"y":32,"width":1120,"height":37},"barCount":1,"dockCount":0,"popoutPresent":true,"addressTrigger":true,"triggerText":"127.0.0.1:56871","triggerWidth":121,"hash":"#/browser"}} |
| P2 | page content rect and scroll are identical before/open/after | PASS | {"restContent":{"x":260,"y":69,"width":1120,"height":831},"openContent":{"x":260,"y":69,"width":1120,"height":831},"restPage":{"scrollY":1200,"innerHeight":831,"markerY":300},"openPage":{"scrollY":1200,"innerHeight":831,"markerY":300}} |
| P3 | the native list child exists and its viewport width is the strip width | PASS | {"childTarget":{"type":"page","url":"file:///Users/damian/local-operator-ui/.worktrees/browser-titlebar-continuity/out/renderer/browser-address-overlay-list.html"},"childViewport":{"innerWidth":1120,"innerHeight":69},"stripWidth":1120,"note":"child viewport read, not WebContentsView.getBounds(); innerHeight is the content-sized list, not a dock"} |
| D1 | Escape lowers the popout and restores the page geometry | PASS | {"escaped":true,"after":{"content":{"x":260,"y":69,"width":1120,"height":831},"strip":{"x":260,"y":32,"width":1120,"height":37},"popout":null,"barCount":0,"dockCount":0,"popoutPresent":false,"addressTrigger":true,"triggerText":"127.0.0.1:56871","triggerWidth":121,"hash":"#/browser"},"afterPage":{"scrollY":1200,"innerHeight":831,"markerY":300}} |
| D2 | a native page-focus event lowers the popout (headless focus helper refuses) | BLOCKED | {"clickDismissed":false,"reason":"headless/unfocused window: focusBrowserChordTarget refuses the page focus, so main's `focus` event never fires. Needs a focused window (QA/operator)."} |
| D3 | a main-frame navigation lowers the popout | PASS | {"navDismissed":true} |
| T1 | the strip address trigger raises the same popout as Cmd+L | PASS | {"triggerRaised":true,"triggerState":{"value":"127.0.0.1:56871/second","active":"browser-address"}} |
| T2 | a printable key on the chrome root raises the popout seeded with it | PASS | {"seeded":true,"seededValue":"s","seedFocus":{"tag":"browser-tab","role":"tab"},"synthetic":{"popout":true,"value":"s"},"note":"CDP key event"} |
| T3 | opening another tab lowers the popout (layout dismissal) | PASS | {"tabDismissed":true} |
| E1 | typing an address and pressing Enter navigates and lowers the popout | PASS | {"enteredGone":true,"enteredUrl":"http://127.0.0.1:56871/entered"} |
| V1 | the page menu opens at rest and suppresses the native page | PASS | {"opened":true,"menu":{"x":1128.5,"y":70,"width":207.390625,"height":289,"top":70,"right":1335.890625,"bottom":359,"left":1128.5},"portal":true,"popout":false,"activeElement":"DIV","value":null} |
| V2 | the page menu opened from the popout keeps the field row raised | PASS | {"opened":true,"menu":{"x":1164.5,"y":68,"width":207.390625,"height":289,"top":68,"right":1371.890625,"bottom":357,"left":1164.5},"portal":true,"popout":true,"activeElement":"DIV","value":"127.0.0.1:56871/fixture"} |
| V3 | the Address item raises/keeps the field and focus lands in it | PASS | {"menu":null,"portal":false,"popout":true,"activeElement":"browser-address","value":"127.0.0.1:56871/fixture"} |
| V4 | list with several rows, one selected | PASS | {"candidates":3,"active":":r5t:-option-1","options":3} |
| V5 | list with a query that matches nothing | PASS | {"candidates":0,"notice":":r5t:-notice","body":null} |
| V6 | loading: the strip/popout while a slow page is in flight | PASS | {"loading":true,"url":"http://127.0.0.1:56871/alto","activeTabId":3} |
| V7 | error: a refused navigation paints the load-failure panel | PASS | {"navFailure":{"code":-102,"description":"ERR_CONNECTION_REFUSED","url":"http://127.0.0.1:56949/"},"panel":true,"body":null} |
| V8 | narrow pane: the trigger collapses to its icon | PASS | {"strip":480,"trigger":28,"text":"","label":"Address — 127.0.0.1:56871"} |
| V9 | approvals with a live waiting request | BLOCKED | a live pending approval cannot be injected from the renderer; the dock-open half is documented in docs/evidence/browser-address-overlay and the queue model is unit-tested. Needs a main-side fixture or a real agent request. |
| V10 | zero tabs | BLOCKED | closing the last tab creates a fresh blank tab by design (browser-chord-renderer.test.mjs), so the zero-tab state has no reachable door; measured tabs=3. |
| V11 | light theme at rest and popout | PASS | {"theme":"localOperatorLight","dark":false,"themedReady":true,"themedPopout":true} |
| V12 | the at-rest trigger's hover state | PASS | {"hover":true,"width":121} |
| V13 | the at-rest trigger's keyboard focus state | PASS | {"focused":true,"focusVisible":true,"tag":"browser-address-trigger"} |
| V14 | a tab-filled strip at rest | PASS | {"tabs":9,"tabsOffScreen":"3","triggerRight":1308,"stripRight":1380} |
| V15 | the overflow chip clears the trailing rule in the narrow and filled strips | PASS | {"narrow":{"present":true,"chipRight":438,"ruleLeft":447,"gapPx":9,"buttonRight":431,"chipOverflowPx":7},"filled":{"present":true,"chipRight":1258,"ruleLeft":1267,"gapPx":9,"buttonRight":1251,"chipOverflowPx":7}} |
| H1 | a visit recorded in an earlier app run is suggested from history with no tab open on it | PASS | {"stoppedOne":{"code":0,"signal":null},"openOnFixture":false,"query":"127.0.0.1:56871","owner":{"value":"127.0.0.1:56871","active":null,"rows":[{"id":":r29:-option-0","text":"127.0.0.1:56871/history-target-b","url":"http://127.0.0.1:56871/history-target-b","source":"history","search":false,"selected":false},{"id":":r29:-option-1","text":"127.0.0.1:56871/history-other","url":"http://127.0.0.1:56871/history-other","source":"history","search":false,"selected":false},{"id":":r29:-option-2","text":"127.0.0.1:56871/history-target","url":"http://127.0.0.1:56871/history-target","source":"history","search":false,"selected":false}]},"child":{"updated":true,"header":"From your history","rows":["127.0.0 |
| H2 | typing "github" shows the Search DuckDuckGo row first and selected | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H3 | typing "what is a vpn" shows the same search row first and selected | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H4 | Enter commits the highlighted search row's DuckDuckGo URL on the active tab | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H5 | an open tab with no stored history row is suggested with its source mark | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H8 | at narrow width the open-tab title/marker keeps a floor and does not collapse | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H9 | Cmd+L, ArrowDown, Enter commits the highlighted history row | PASS | {"selected":{"id":":r2p:-option-0","text":"www.example.com.evil.test/","url":"https://www.example.com.evil.test/","source":"history","search":false,"selected":true},"rows":{"value":"127.0.0.1:56871/history-other","active":":r2p:-option-0","rows":[{"id":":r2p:-option-0","text":"www.example.com.evil.test/","url":"https://www.example.com.evil.test/","source":"history","search":false,"selected":true},{"id":":r2p:-option-1","text":"www.example.com/","url":"https://www.example.com/","source":"history","search":false,"selected":false},{"id":":r2p:-option-2","text":"www.example.com/page","url":"https://www.example.com/page","source":"history","search":false,"selected":false},{"id":":r2p:-option-3"," |
| H10 | Enter on an untouched field with no row lowers the popout and navigates nothing | PASS | {"untouchedClosed":true,"untouchedUrl":"http://127.0.0.1:56871/history-other","afterUntouchedUrl":"http://127.0.0.1:56871/history-other"} |
| H11 | a complete host query does not match the lookalike domain | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H12 | the prefix www recalls a stored www page | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| R2-notices | error, empty and no_match notices each paint at 104px with no rows | pending |  |
| H6 | a query with no match shows the no-match notice and no rows | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| H7 | an RTL owner chrome paints an RTL child and the row text is dir=auto | BLOCKED | history scene rig error: Error: evaluate failed: Error: no address input
    at <anonymous>:3:22
    at <anonymous>:12:5 |
| F1 | Tier 1/2 fallbacks are source-only here; native failure injection is BLOCKED | BLOCKED | Tier 1 (child unavailable) and Tier 2 (two focus failures) need fault injection in a debug build; source paths are browser-surface.tsx (addressFallback, overlayMode) and address-overlay.ts (mode). No user env var exists by design. |
| BL1 | native composite pixels/hit routing/AX and other platforms | BLOCKED | Composite pixels, native hit routing, real macOS IME, VoiceOver, Windows and Linux are unmeasured. The child viewport width is a renderer read, not native bounds. |

At least one driven row passed; read FAIL rows before claiming the slice.

Limitation: no native composite, hit routing, IME, AX or non-darwin measurement.