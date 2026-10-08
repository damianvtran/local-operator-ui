# Acceptance, round 2: Agents and Teams page remediation

Computed by `rig/accept-r2.mjs` (one headless Chrome, CDP; real `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`; `Accessibility.getFullAXTree`; `Emulation.setDeviceMetricsOverride`) against the Storybook of the worktree head; raw output is `accept-r2.json` next to this file. The N-row (U5/U6/U9) reproductions are in `n-main.json` / `n-branch.json` / `n-branch-fixed.json` (scratchpad).

**40 PASS, 0 FAIL of 40 checks.**

| Finding | Criterion | Measured | Result |
|---|---|---|---|
| A | team-settled-long@1024x725: dock<=300, pane>=240, box on screen, last heading above dock | dock 246.5 (34%), pane 478.5, box top 599, last heading bottom 229 <= 478; region tab=0 | PASS |
| A | team-error-long@1024x725: dock<=300, pane>=240, box on screen, last heading above dock | dock 278.5 (38%), pane 446.5, box top 599, last heading bottom 197 <= 446; region tab=0 | PASS |
| A | team-stop-refused@1024x725: dock<=300, pane>=240, box on screen, last heading above dock | dock 229.9 (32%), pane 495.1, box top 599, last heading bottom 245 <= 495; region tab=- | PASS |
| A | team-settled-long@800x600: dock<=45% vh, pane>=200, box on screen | dock 234.0 (39.0%), pane 321.0, box top 474, last heading bottom 116 <= 366 | PASS |
| A | team-error-long@800x600: dock<=45% vh, pane>=200, box on screen | dock 266.0 (44.3%), pane 289.0, box top 474, last heading bottom 84 <= 334 | PASS |
| A | team-stop-refused@800x600: dock<=45% vh, pane>=200, box on screen | dock 229.9 (38.3%), pane 325.1, box top 474, last heading bottom 120 <= 370 | PASS |
| A | idle dock stays 166 (team-selected@1024x725) | dock 166 | PASS |
| A | idle dock stays 166 (team-running@1024x725) | dock 166 | PASS |
| A | error/answer region is a named keyboard stop while it overflows | settled-long & error-long: role=region, tabIndex=0, aria-label "Run details"; short states: none (region null) | PASS |
| B (Q1) | 1440->420->1440->420->1440, no remount: Show all iff clamped | start1440: w810 sh174/ch174 btn=None ; 1_to420: w372 sh369/ch217 btn=Show all ; 2_to1440: w810 sh174/ch174 btn=None ; 3_to420: w372 sh369/ch217 btn=Show all ; 4_to1440: w810 sh174/ch174 btn=None | PASS |
| B | expanded block keeps Show less across a resize | ['Show less'] | PASS |
| C | AX table named, with column headers | name='Manager: the agent that leads the chat' headers=['Member', 'Type', 'Count'] | PASS |
| C | AX table named, with column headers | name='Members' headers=['Member', 'Type', 'Count'] | PASS |
| D | member lacking count renders x1; header agrees | cells ['×1', '×2']; header 3 members (1+2); roster row ends 'iptive-name3 membersNo description' | PASS |
| E | team header cluster == title line height (derived from tokens), buttons centred | cluster 26 vs line 26; centres [37, 37, 37] vs title 37 | PASS |
| E | agent header cluster == title line height (derived from tokens), buttons centred | cluster 26 vs line 26; centres [37, 37, 37, 37] vs title 37 | PASS |
| F (Q2) | full sentence visible in the real 476 px pane, row 28 | main 476px, 2 lines, truncated=False, fully visible=True, row 28, dock 208.78125 | PASS |
| G (U1) | team edit@1024x725: rest hit='Save changes'; Tab scrolls clear; real mouse adds a member, no save | rest top 509 footer 502 (hit Save changes, onScreen True); scroll-padding-bottom 61px (footer 57+4); after Tab: bottom 265 <= 502; mouse hit 'Add member', members 5->6, editing True | PASS |
| G (U1) | team edit@800x560: rest hit=None; Tab scrolls clear; real mouse adds a member, no save | rest top 554 footer 337 (hit None, onScreen False); scroll-padding-bottom 61px (footer 57+4); after Tab: bottom 205 <= 337; mouse hit 'Add member', members 5->6, editing True | PASS |
| G (U1) | team create@1024x725: rest hit=None; Tab scrolls clear; real mouse adds a member, no save | rest top 789 footer 502 (hit None, onScreen False); scroll-padding-bottom 61px (footer 57+4); after Tab: bottom 265 <= 502; mouse hit 'Add member', members 5->6, editing True | PASS |
| G (U1) | team create@800x560: rest hit=None; Tab scrolls clear; real mouse adds a member, no save | rest top 834 footer 337 (hit None, onScreen False); scroll-padding-bottom 61px (footer 57+4); after Tab: bottom 205 <= 337; mouse hit 'Add member', members 5->6, editing True | PASS |
| G | agent edit@1024x725: last control clear of footer at scroll end | last bottom 449 <= footer top 502 | PASS |
| G | agent edit@800x560: last control clear of footer at scroll end | last bottom 284 <= footer top 337 | PASS |
| G | team create end@1024x725: last control clear of footer at scroll end | last bottom 465 <= footer top 502 | PASS |
| G | team create end@800x560: last control clear of footer at scroll end | last bottom 300 <= footer top 337 | PASS |
| H (U2) | docked placeholder fits the box un-truncated; hero unchanged | 'Ask for a change to this definition, or describe a new agent or team…': 444px in 656px (1024), 720px (800); hero 'Describe what you want…'/'Describe what you want…' | PASS |
| I (U3) | team-selected: dock identical empty vs 20-char draft; box top steady; no duplicate sentence | dock 166 vs 166; box top 599/599; draft text: Ask for an agent or team change / Runs in the background. This does not appear in your conversation. | PASS |
| I (U3) | team-running: dock identical empty vs 20-char draft; box top steady; no duplicate sentence | dock 166 vs 166; box top 599/599; draft text: Ask for an agent or team change / Working on your request / 43s / Configured / 1 definition / Runs in the background. This does not appear in your conversation. / Stop | PASS |
| I (U3) | team-blocked-by-edit: dock identical empty vs 20-char draft; box top steady; no duplicate sentence | dock 166 vs 166; box top 599/599; draft text: Ask for an agent or team change / Finish or cancel your edit first. | PASS |
| J (D4/U4) | one row height; every row has a title; Radient Net says No description | heights [50.89]; rows without title 0; no-description rows [{'n': 'roster-row-radient-net', 'h': 50.890625}]; Local Operator Development ellipsized=True title='Local Operator Development - Builds and ships changes to the...' | PASS |
| K (D5) | manager row == members row: height 36+/-0.5, heading gap equal, same columns | Manager rows [36], gap 8, cols [312, 840, 936]; Members rows [36, 36.5, 36.5, 36.5, 36], gap 8, cols [312, 840, 936] | PASS |
| L (D2/U7) | Show all / Manager link >=24 px high; section pitch 32+/-1 | manager 54x24; Show all 48x24; pitch [None, 32, 32, 32] | PASS |
| M (D1) | 800px: trailing glyph == column right edge | column 776, Ask glyph 776, Dismiss glyph 776, header 776 (boxes at 788/784) | PASS |
| M (D1) | 1024px: trailing glyph == column right edge | column 1000, Ask glyph 1000, Dismiss glyph 1000, header 1000 (boxes at 1012/1008) | PASS |
| M (D1) | 1440px: trailing glyph == column right edge | column 1269, Ask glyph 1269, Dismiss glyph 1269, header 1269 (boxes at 1281/1277) | PASS |
| M | agent header glyph == column right (1024) | {'columnRight': 1000, 'glyphRight': 1000, 'boxRight': 1008} | PASS |
| M | dismissFocus: focus-visible outline inside the viewport/pane (frame: dismiss-focus-ring__1024x725.png) | {'outline': 'solid 2px offset 1px', 'boxRight': 1008, 'outlineRight': 1011, 'viewport': 1024, 'focusVisible': True} | PASS |
| M | askFocus: focus-visible outline inside the viewport/pane (frame: ask-focus-ring__1024x725.png) | {'text': 'Ask for a change', 'outline': 'solid 2px offset 2px', 'boxRight': 1012, 'viewport': 1024, 'focusVisible': True, 'pane': 1024} | PASS |
| P (U8) | long About name has a title with the full words | title='About team on-call-rotation-with-an-unreasonably-long-and-descriptive-name'; truncated=True | PASS |
| P (U10) | settled live title speaks the count with its noun; the visible count is aria-hidden | live text 'Finished. Configured 1 definition'; hidden visible count ['', 'Configured 1 definition'] | PASS |
