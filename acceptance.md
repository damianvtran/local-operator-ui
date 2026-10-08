# Acceptance: Agents and Teams page polish (after frames)

Computed by script from the geometry JSON next to each frame (`after/<story>__<WxH>__<theme>.json`); before values come from `5d178414abd8/scratchpad/before/*.json`.
Rig: same one-Chrome CDP rig as the before frames, with `--hide-scrollbars` removed and the app's real `GlobalScrollbarStyles` (8 px) mounted in the story `Scene`, so the pane's 16 + 8 = 24 px edge is the product's, not the overlay's 16.
Stories x sizes x themes: 6 originals + About set, blocked-by-dirty-edit, running, settled, error+Retry, stop-refused, awkward team (x2 member, Not found manager and member, 66-char name), plus blurred (no-ring) team-selected and hero; 1024x725, 1440x900, 800x700; localOperatorDark and localOperatorLight.

**Totals: 185 PASS, 0 FAIL** (of 185 checks).

| Criterion | Target | Measured | Result |
|---|---|---|---|
| 1. dock height [1024x725 dark] | <= 170 px (target 166) | 166 px (23.0% of 725; before 287.39) | PASS |
| 1. nested frames [1024x725 dark] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [1024x725 dark] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [1024x725 dark] | +/- 0.5 px | min 599 max 599 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [1024x725 dark] | 0 +/- 0 | dL 0 dR 0 (box 312..1000) | PASS |
| 2. no max-w-3xl in pane chain [1024x725 dark] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [1024x725 dark] | <= 300 at 1024x725 | 263 (before 409); pane clientHeight 559 | PASS |
| 3. edge cue on pane + roster [1024x725 dark] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [1024x725 dark] | 0 | 0 | PASS |
| 4. read blocks border/bg [1024x725 dark] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [1024x725 dark] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [1024x725 dark] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [1024x725 dark] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [1024x725 dark] | +/- 1 | title 37 buttons [37, 37, 37] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [1024x725 dark] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [1024x725 dark] | +/- 1 | title 37 buttons [37, 37, 37, 37] | PASS |
| 6. table name/type/count x identical [1024x725 dark] | +/- 0 | name {312} type {848}; count right [1000] (manager row has no count) | PASS |
| 6. member row height [1024x725 dark] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [1024x725 dark] | 0 | 0 | PASS |
| 7. roster row heights, agents [1024x725 dark] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. roster row heights, teams [1024x725 dark] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. teams rows fully visible [1024x725 dark] | >= 10 at 1024x725 | 10 (before 8) | PASS |
| 7. tabs/search/scope right edges [1024x725 dark] | equal | 272/272/272 | PASS |
| 7. aria-current on selected [1024x725 dark] | 1 row | ['roster-row-content'] | PASS |
| 8. edit controls right == column right [1024x725 dark] | 0 | single-line fields [1000]; member rows [1000]; Remove [1000]; col 1000 | PASS |
| 8. footer L/R & Save left == column [1024x725 dark] | 0 | footer 312..1000 save 312 col 312..1000 | PASS |
| 8. no accent fill other than Save while editing [1024x725 dark] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 9. hero left edges [teams-empty-hero 1024x725 dark] | heading==box==chip text==hand-add +/- 1 | 312/312/{312}/312 | PASS |
| 9. hero box width == dock box width [teams-empty-hero 1024x725 dark] | equal | hero 688 dock 688 | PASS |
| 9. hero block midpoint [teams-empty-hero 1024x725 dark] | 45-50% | 47% | PASS |
| 9. never two composers [teams-empty-hero 1024x725 dark] | 1 | 1 | PASS |
| 9. hero left edges [agents-empty-hero 1024x725 dark] | heading==box==chip text==hand-add +/- 1 | 312/312/{312}/312 | PASS |
| 9. hero box width == dock box width [agents-empty-hero 1024x725 dark] | equal | hero 688 dock 688 | PASS |
| 9. hero block midpoint [agents-empty-hero 1024x725 dark] | 45-50% | 47% | PASS |
| 9. never two composers [agents-empty-hero 1024x725 dark] | 1 | 1 | PASS |
| 1. dock height [1440x900 dark] | <= 170 px (target 166) | 166 px (18.0% of 900; before 253.89) | PASS |
| 1. nested frames [1440x900 dark] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [1440x900 dark] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [1440x900 dark] | +/- 0.5 px | min 774 max 774 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [1440x900 dark] | 0 +/- 0 | dL 0 dR 0 (box 459..1269) | PASS |
| 2. no max-w-3xl in pane chain [1440x900 dark] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [1440x900 dark] | <= 300 at 1024x725 | 88 (before 201); pane clientHeight 734 | PASS |
| 3. edge cue on pane + roster [1440x900 dark] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [1440x900 dark] | 0 | 0 | PASS |
| 4. read blocks border/bg [1440x900 dark] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [1440x900 dark] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [1440x900 dark] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [1440x900 dark] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [1440x900 dark] | +/- 1 | title 37 buttons [37, 37, 37] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [1440x900 dark] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [1440x900 dark] | +/- 1 | title 37 buttons [37, 37, 37, 37] | PASS |
| 6. table name/type/count x identical [1440x900 dark] | +/- 0 | name {459} type {1117}; count right [1269] (manager row has no count) | PASS |
| 6. member row height [1440x900 dark] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [1440x900 dark] | 0 | 0 | PASS |
| 7. roster row heights, agents [1440x900 dark] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. roster row heights, teams [1440x900 dark] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. teams rows fully visible [1440x900 dark] | >= 10 at 1024x725 | 11 (before 11) | PASS |
| 7. tabs/search/scope right edges [1440x900 dark] | equal | 272/272/272 | PASS |
| 7. aria-current on selected [1440x900 dark] | 1 row | ['roster-row-content'] | PASS |
| 8. edit controls right == column right [1440x900 dark] | 0 | single-line fields [1269]; member rows [1269]; Remove [1269]; col 1269 | PASS |
| 8. footer L/R & Save left == column [1440x900 dark] | 0 | footer 459..1269 save 459 col 459..1269 | PASS |
| 8. no accent fill other than Save while editing [1440x900 dark] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 9. hero left edges [teams-empty-hero 1440x900 dark] | heading==box==chip text==hand-add +/- 1 | 459/459/{459}/459 | PASS |
| 9. hero box width == dock box width [teams-empty-hero 1440x900 dark] | equal | hero 810 dock 810 | PASS |
| 9. hero block midpoint [teams-empty-hero 1440x900 dark] | 45-50% | 47% | PASS |
| 9. never two composers [teams-empty-hero 1440x900 dark] | 1 | 1 | PASS |
| 9. hero left edges [agents-empty-hero 1440x900 dark] | heading==box==chip text==hand-add +/- 1 | 459/459/{459}/459 | PASS |
| 9. hero box width == dock box width [agents-empty-hero 1440x900 dark] | equal | hero 810 dock 810 | PASS |
| 9. hero block midpoint [agents-empty-hero 1440x900 dark] | 45-50% | 47% | PASS |
| 9. never two composers [agents-empty-hero 1440x900 dark] | 1 | 1 | PASS |
| 1. dock height [800x700 dark] | <= 170 px (target 166) | 166 px (24.0% of 700; before 287.39) | PASS |
| 1. nested frames [800x700 dark] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [800x700 dark] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [800x700 dark] | +/- 0.5 px | min 574 max 574 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [800x700 dark] | 0 +/- 0 | dL 0 dR 0 (box 24..776) | PASS |
| 2. no max-w-3xl in pane chain [800x700 dark] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [800x700 dark] | <= 300 at 1024x725 | 333 (before 479); pane clientHeight 489 | PASS |
| 3. edge cue on pane + roster [800x700 dark] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [800x700 dark] | 0 | 0 | PASS |
| 4. read blocks border/bg [800x700 dark] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [800x700 dark] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [800x700 dark] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [800x700 dark] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [800x700 dark] | +/- 1 | title 82 buttons [82, 82, 82] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [800x700 dark] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [800x700 dark] | +/- 1 | title 82 buttons [82, 82, 82, 82] | PASS |
| 6. table name/type/count x identical [800x700 dark] | +/- 0 | name {24} type {624}; count right [776] (manager row has no count) | PASS |
| 6. member row height [800x700 dark] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [800x700 dark] | 0 | 0 | PASS |
| 8. edit controls right == column right [800x700 dark] | 0 | single-line fields [776]; member rows [776]; Remove [776]; col 776 | PASS |
| 8. footer L/R & Save left == column [800x700 dark] | 0 | footer 24..776 save 24 col 24..776 | PASS |
| 8. no accent fill other than Save while editing [800x700 dark] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 1. dock height [1024x725 light] | <= 170 px (target 166) | 166 px (23.0% of 725; before 287.39) | PASS |
| 1. nested frames [1024x725 light] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [1024x725 light] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [1024x725 light] | +/- 0.5 px | min 599 max 599 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [1024x725 light] | 0 +/- 0 | dL 0 dR 0 (box 312..1000) | PASS |
| 2. no max-w-3xl in pane chain [1024x725 light] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [1024x725 light] | <= 300 at 1024x725 | 263 (before 409); pane clientHeight 559 | PASS |
| 3. edge cue on pane + roster [1024x725 light] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [1024x725 light] | 0 | 0 | PASS |
| 4. read blocks border/bg [1024x725 light] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [1024x725 light] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [1024x725 light] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [1024x725 light] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [1024x725 light] | +/- 1 | title 37 buttons [37, 37, 37] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [1024x725 light] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [1024x725 light] | +/- 1 | title 37 buttons [37, 37, 37, 37] | PASS |
| 6. table name/type/count x identical [1024x725 light] | +/- 0 | name {312} type {848}; count right [1000] (manager row has no count) | PASS |
| 6. member row height [1024x725 light] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [1024x725 light] | 0 | 0 | PASS |
| 7. roster row heights, agents [1024x725 light] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. roster row heights, teams [1024x725 light] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. teams rows fully visible [1024x725 light] | >= 10 at 1024x725 | 10 (before 8) | PASS |
| 7. tabs/search/scope right edges [1024x725 light] | equal | 272/272/272 | PASS |
| 7. aria-current on selected [1024x725 light] | 1 row | ['roster-row-content'] | PASS |
| 8. edit controls right == column right [1024x725 light] | 0 | single-line fields [1000]; member rows [1000]; Remove [1000]; col 1000 | PASS |
| 8. footer L/R & Save left == column [1024x725 light] | 0 | footer 312..1000 save 312 col 312..1000 | PASS |
| 8. no accent fill other than Save while editing [1024x725 light] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 9. hero left edges [teams-empty-hero 1024x725 light] | heading==box==chip text==hand-add +/- 1 | 312/312/{312}/312 | PASS |
| 9. hero box width == dock box width [teams-empty-hero 1024x725 light] | equal | hero 688 dock 688 | PASS |
| 9. hero block midpoint [teams-empty-hero 1024x725 light] | 45-50% | 47% | PASS |
| 9. never two composers [teams-empty-hero 1024x725 light] | 1 | 1 | PASS |
| 9. hero left edges [agents-empty-hero 1024x725 light] | heading==box==chip text==hand-add +/- 1 | 312/312/{312}/312 | PASS |
| 9. hero box width == dock box width [agents-empty-hero 1024x725 light] | equal | hero 688 dock 688 | PASS |
| 9. hero block midpoint [agents-empty-hero 1024x725 light] | 45-50% | 47% | PASS |
| 9. never two composers [agents-empty-hero 1024x725 light] | 1 | 1 | PASS |
| 1. dock height [1440x900 light] | <= 170 px (target 166) | 166 px (18.0% of 900; before 253.89) | PASS |
| 1. nested frames [1440x900 light] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [1440x900 light] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [1440x900 light] | +/- 0.5 px | min 774 max 774 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [1440x900 light] | 0 +/- 0 | dL 0 dR 0 (box 459..1269) | PASS |
| 2. no max-w-3xl in pane chain [1440x900 light] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [1440x900 light] | <= 300 at 1024x725 | 88 (before 201); pane clientHeight 734 | PASS |
| 3. edge cue on pane + roster [1440x900 light] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [1440x900 light] | 0 | 0 | PASS |
| 4. read blocks border/bg [1440x900 light] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [1440x900 light] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [1440x900 light] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [1440x900 light] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [1440x900 light] | +/- 1 | title 37 buttons [37, 37, 37] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [1440x900 light] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [1440x900 light] | +/- 1 | title 37 buttons [37, 37, 37, 37] | PASS |
| 6. table name/type/count x identical [1440x900 light] | +/- 0 | name {459} type {1117}; count right [1269] (manager row has no count) | PASS |
| 6. member row height [1440x900 light] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [1440x900 light] | 0 | 0 | PASS |
| 7. roster row heights, agents [1440x900 light] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. roster row heights, teams [1440x900 light] | 1 distinct, 48..52 | [50.89] | PASS |
| 7. teams rows fully visible [1440x900 light] | >= 10 at 1024x725 | 11 (before 11) | PASS |
| 7. tabs/search/scope right edges [1440x900 light] | equal | 272/272/272 | PASS |
| 7. aria-current on selected [1440x900 light] | 1 row | ['roster-row-content'] | PASS |
| 8. edit controls right == column right [1440x900 light] | 0 | single-line fields [1269]; member rows [1269]; Remove [1269]; col 1269 | PASS |
| 8. footer L/R & Save left == column [1440x900 light] | 0 | footer 459..1269 save 459 col 459..1269 | PASS |
| 8. no accent fill other than Save while editing [1440x900 light] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 9. hero left edges [teams-empty-hero 1440x900 light] | heading==box==chip text==hand-add +/- 1 | 459/459/{459}/459 | PASS |
| 9. hero box width == dock box width [teams-empty-hero 1440x900 light] | equal | hero 810 dock 810 | PASS |
| 9. hero block midpoint [teams-empty-hero 1440x900 light] | 45-50% | 47% | PASS |
| 9. never two composers [teams-empty-hero 1440x900 light] | 1 | 1 | PASS |
| 9. hero left edges [agents-empty-hero 1440x900 light] | heading==box==chip text==hand-add +/- 1 | 459/459/{459}/459 | PASS |
| 9. hero box width == dock box width [agents-empty-hero 1440x900 light] | equal | hero 810 dock 810 | PASS |
| 9. hero block midpoint [agents-empty-hero 1440x900 light] | 45-50% | 47% | PASS |
| 9. never two composers [agents-empty-hero 1440x900 light] | 1 | 1 | PASS |
| 1. dock height [800x700 light] | <= 170 px (target 166) | 166 px (24.0% of 700; before 287.39) | PASS |
| 1. nested frames [800x700 light] | <= 1 (box only) | 1 (div r16px bg elevated); before 3 | PASS |
| 1. status row height, 8 states [800x700 light] | 28 +/- 0.5 | min 28 max 28 | PASS |
| 1. box top stable, 8 states [800x700 light] | +/- 0.5 px | min 574 max 574 (idle,about,running,settled,error,stop-refused,blocked,blurred) | PASS |
| 2. box L/R == column L/R [800x700 light] | 0 +/- 0 | dL 0 dR 0 (box 24..776) | PASS |
| 2. no max-w-3xl in pane chain [800x700 light] | none | column class (the shared measure, not max-w-3xl): max-w-[var(--lo-chat-measure)] | PASS |
| 2. pane hidden px [800x700 light] | <= 300 at 1024x725 | 333 (before 479); pane clientHeight 489 | PASS |
| 3. edge cue on pane + roster [800x700 light] | attr present, mask bottom 24 -> 0 | pane True, roster True | PASS |
| 4. nested scrollers [800x700 light] | 0 | 0 | PASS |
| 4. read blocks border/bg [800x700 light] | border 0, bg transparent | [(0, 'rgba(0, 0, 0, 0)'), (0, 'rgba(0, 0, 0, 0)')] | PASS |
| 4. Show all iff clamped [800x700 light] | present when > 10 lines only | [(101, False, False), (2517, True, True)] | PASS |
| 4. section gap [800x700 light] | 32 +/- 1 | [32, 32, 32]; rules 0 | PASS |
| 5. team header action right == column right [800x700 light] | 0 px | 0 | PASS |
| 5. team button centre y == title centre y [800x700 light] | +/- 1 | title 82 buttons [82, 82, 82] | PASS |
| 5. agent header: <= 3 text buttons + 1 icon [800x700 light] | <=3 + 1 | 3 text + 1 icon; right edge delta 0 | PASS |
| 5. agent button centre y == title [800x700 light] | +/- 1 | title 82 buttons [82, 82, 82, 82] | PASS |
| 6. table name/type/count x identical [800x700 light] | +/- 0 | name {24} type {624}; count right [776] (manager row has no count) | PASS |
| 6. member row height [800x700 light] | 36 +/- 2 | [36, 36.5, 36.5, 36.5, 36] | PASS |
| 6. no Agent/Team Badge [800x700 light] | 0 | 0 | PASS |
| 8. edit controls right == column right [800x700 light] | 0 | single-line fields [776]; member rows [776]; Remove [776]; col 776 | PASS |
| 8. footer L/R & Save left == column [800x700 light] | 0 | footer 24..776 save 24 col 24..776 | PASS |
| 8. no accent fill other than Save while editing [800x700 light] | header buttons 0 | header buttons 0; pane cue True, mask none | PASS |
| 10. x2-member team reads the same number in roster and detail | equal | roster '4 members', detail '4 members' (coder x2 + reviewer + no-such-agent; rows=3, sum=4) | PASS |

## Not computed from geometry (read from the frames or the probe)
- Bottom edge fade 24 -> 0 at scroll end: probe on team-selected 1024x725 dark, mask at top `... calc(100% - 24px) ...`, at scroll end `... 24px, black 100% ...` (scrollTop 263 = max).
- Show all / Show less: expands in flow (`aria-expanded` true, 0 nested scrollers), Show less restores the clamp, label returns to Show all.
- Status-row a11y: box `aria-describedby` = `config-composer-note`; exactly one such id; it sits inside the 28 px row; while a run is live it is `sr-only`, not unmounted; one composer in the DOM in every frame; Stop is the only button in the running strip.
- Edit mode: 0 header buttons, Save changes is the only accent-filled button in the pane (computed background compared), pane mask `none` while the footer is mounted.
- Roster roving tab stop: 1 tabindex=0 row, aria-current on the selected row.
- Agent header menu: More actions opens and holds `Duplicate as new agent`.
- Create mode: no meta line (`headerMeta` null); name field right edge == column right edge.
- Count agreement (x2 member): roster `4 members`, detail `4 members` for coder x2 + reviewer + no-such-agent (3 rows).
- Light-theme legibility of roster meta on the selected row, and the box on canvas: looked at in `team-selected__1024x725__light.png`, `agent-selected__1440x900__light.png`, `team-blocked-by-edit__1024x725__light.png`; contrast numbers are the designer's (spec s1: 5.05/5.04 ink-dim on row-selected).
