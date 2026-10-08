# transcript-before - raw output of `node scripts/transcript-gap-live.mjs --label=base --frames=<scratch>/frames`

Tree: `src/` checked out from `c14e07d95b0` (main, before the fix); `scripts/` as of the harness commit. Backend: the `lop` on PATH, v0.68.5, started by the harness against `<scratch>/config`. One run, unedited. The `source` hashes in the first line are `git hash-object` of the two files the fix changes, so the tree under test is identifiable from the output alone (the `head` field is the checkout's HEAD, which is the same on both runs because only `src/` is swapped).

```text
label base · source {"head":"fa4ef97adfd","use-canonical-session.ts":"045899b2b0a8","transcript-reducer.ts":"3dbb988dfb06"}
backend: v0.68.5 · journal 400 entries, N appended while away
N     first-visit  painted  contiguous  painted-rows   cursor  hole  unreachable  reopen-history          affordance
300   100          200/700  false       301..700       601     200   0            0:                      Earlier history above
600   100          200/1000 false       301..1000      901     500   0            0:                      Earlier history above
1400  100          200/1800 false       301..1800      1701    1300  0            0:                      Earlier history above

columns: painted = journal rows held at settle; contiguous = one journal suffix ending at the tail;
painted-rows = first painted journal position..tail; cursor = journal position the pane's `load earlier` resumes from;
hole = journal rows between the painted blocks that are not painted at settle; unreachable = journal rows neither painted
nor reached after `Load earlier messages` / wheel-up is driven until the pane says `Start of conversation`.

per cell (json):
{"label":"base","n":300,"journal":700,"firstVisitPainted":100,"painted":200,"contiguous":false,"firstPaintedRow":301,"hole":200,"hasMore":true,"cursorAt":601,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":[],"historyCursors":[],"historyRequests":0,"historyBytes":0,"loadEarlierClicks":1,"finalPainted":700,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":6,"pagingCursors":[601,501,401,301,201,101],"finalContiguous":true,"finalRecords":700}
{"label":"base","n":600,"journal":1000,"firstVisitPainted":100,"painted":200,"contiguous":false,"firstPaintedRow":301,"hole":500,"hasMore":true,"cursorAt":901,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":[],"historyCursors":[],"historyRequests":0,"historyBytes":0,"frame":"base-600-away.webp","frameAt":{"hole":true,"row":901},"loadEarlierClicks":2,"finalPainted":1000,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":9,"pagingCursors":[901,801,701,601,501,401,301,201,101],"finalContiguous":true,"finalRecords":1000}
{"label":"base","n":1400,"journal":1800,"firstVisitPainted":100,"painted":200,"contiguous":false,"firstPaintedRow":301,"hole":1300,"hasMore":true,"cursorAt":1701,"affordance":["Earlier history above"],"dom":60,"extra":0,"history":[],"historyCursors":[],"historyRequests":0,"historyBytes":0,"loadEarlierClicks":2,"finalPainted":1800,"lost":0,"finalAffordance":["Start of conversation"],"pagingRequests":17,"pagingCursors":[1701,1601,1501,1401,1301,1201,1101,1001,901,801,701,601,501,401,301,201,101],"finalContiguous":true,"finalRecords":1800}
```
