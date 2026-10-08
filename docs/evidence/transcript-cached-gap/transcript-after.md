# transcript-after - raw output of `node scripts/transcript-gap-live.mjs --label=head --frames=<scratch>/frames`

Tree: `src/` at the branch head (the `0fbca40d410` + `fb35bca4114` fix; the test commits on top change no source); `scripts/` as of the harness commit. Backend: the `lop` on PATH, v0.68.5, started by the harness against `<scratch>/config`. One run, unedited. The `source` hashes in the first line are `git hash-object` of the two files the fix changes, so the tree under test is identifiable from the output alone (the `head` field is the checkout's HEAD, which is the same on both runs because only `src/` is swapped).

```text
label head · source {"head":"fa4ef97adfd","use-canonical-session.ts":"ab3339fd626a","transcript-reducer.ts":"fbedd7a0ae7a"}
backend: v0.68.5 · journal 400 entries, N appended while away
N     first-visit  painted  contiguous  painted-rows   cursor  hole  unreachable  reopen-history          affordance
300   100          400/700  true        301..700       301     0     0            4: 100t 100b 100b 100b  Earlier history above
600   100          500/1000 true        501..1000      501     0     0            5: 100t 100b 100b 100b 100b Earlier history above
1400  100          500/1800 true        1301..1800     1301    0     0            5: 100t 100b 100b 100b 100b Earlier history above

columns: painted = journal rows held at settle; contiguous = one journal suffix ending at the tail;
painted-rows = first painted journal position..tail; cursor = journal position the pane's `load earlier` resumes from;
hole = journal rows between the painted blocks that are not painted at settle; unreachable = journal rows neither painted
nor reached after `Load earlier messages` / wheel-up is driven until the pane says `Start of conversation`.

per cell (json):
{"label":"head","n":300,"journal":700,"firstVisitPainted":100,"painted":400,"contiguous":true,"firstPaintedRow":301,"hole":0,"hasMore":true,"cursorAt":301,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":["100t","100b","100b","100b"],"historyCursors":["tail",601,501,401],"historyRequests":4,"historyBytes":90808,"loadEarlierClicks":1,"finalPainted":700,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":3,"pagingCursors":[301,201,101],"finalContiguous":true,"finalRecords":700}
{"label":"head","n":600,"journal":1000,"firstVisitPainted":100,"painted":500,"contiguous":true,"firstPaintedRow":501,"hole":0,"hasMore":true,"cursorAt":501,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":["100t","100b","100b","100b","100b"],"historyCursors":["tail",901,801,701,601],"historyRequests":5,"historyBytes":113631,"frame":"head-600-away.webp","frameAt":{"hole":false,"row":501},"loadEarlierClicks":3,"finalPainted":1000,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":5,"pagingCursors":[501,401,301,201,101],"finalContiguous":true,"finalRecords":1000}
{"label":"head","n":1400,"journal":1800,"firstVisitPainted":100,"painted":500,"contiguous":true,"firstPaintedRow":1301,"hole":0,"hasMore":true,"cursorAt":1301,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":["100t","100b","100b","100b","100b"],"historyCursors":["tail",1701,1601,1501,1401],"historyRequests":5,"historyBytes":114005,"loadEarlierClicks":2,"finalPainted":1800,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":13,"pagingCursors":[1301,1201,1101,1001,901,801,701,601,501,401,301,201,101],"finalContiguous":true,"finalRecords":1800}
```
