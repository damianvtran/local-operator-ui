# transcript-echo - the pending-send case (#876, review round 1), raw output

`node scripts/transcript-gap-live.mjs --echo --n=300,600`, one run per tree, unedited apart from dropping the per-cell JSON tail. Backend: the `lop` on PATH, v0.68.5.

What `--echo` adds to the scenario in `README.md`: between the rows being appended while away and the reopen, the harness retains an unconfirmed send for the conversation through the app's own `paintPendingSend` (what the composer's press does), and that send's id is the id of one more journal row appended LAST, so the owner has already journaled it as the newest row when the tail page arrives. The reopen then seeds the echo into the first frame beside the cached block. The journal is 400 + N + 1 rows.

A held set that counts the echo reads the tail page as "reaching what the pane held" (the page carries the echo's id), so the gate defers and the walk never runs: the base-equivalent hole is painted with 0 reads. The reconcile now counts only rows the journal owns (`isDurableOwnerRow`) as held.

## before - `src/` at 353243b9d62 (the first push of the PR)

```text
label pre-fix-echo · source {"head":"e4ac6a24018","use-canonical-session.ts":"ab3339fd626a","transcript-reducer.ts":"fbedd7a0ae7a"}
backend: v0.68.5 · journal 400 entries, N appended while away
N     first-visit  painted  contiguous  painted-rows   cursor  hole  unreachable  reopen-history          affordance
300   100          200/701  false       301..701       602     201   0            0:                      Earlier history above
600   100          200/1001 false       301..1001      902     501   0            0:                      Earlier history above

columns: painted = journal rows held at settle; contiguous = one journal suffix ending at the tail;
painted-rows = first painted journal position..tail; cursor = journal position the pane's `load earlier` resumes from;
hole = journal rows between the painted blocks that are not painted at settle; unreachable = journal rows neither painted
nor reached after `Load earlier messages` / wheel-up is driven until the pane says `Start of conversation`.
```

## after - `src/` at the round-1 fix

```text
label head-echo · source {"head":"e4ac6a24018","use-canonical-session.ts":"e6591b0f72aa","transcript-reducer.ts":"e0913e9b51ba"}
backend: v0.68.5 · journal 400 entries, N appended while away
N     first-visit  painted  contiguous  painted-rows   cursor  hole  unreachable  reopen-history          affordance
300   100          401/701  true        301..701       302     0     0            4: 100t 100b 100b 100b  Earlier history above
600   100          500/1001 true        502..1001      502     0     0            5: 100t 100b 100b 100b 100b Earlier history above

columns: painted = journal rows held at settle; contiguous = one journal suffix ending at the tail;
painted-rows = first painted journal position..tail; cursor = journal position the pane's `load earlier` resumes from;
hole = journal rows between the painted blocks that are not painted at settle; unreachable = journal rows neither painted
nor reached after `Load earlier messages` / wheel-up is driven until the pane says `Start of conversation`.
```
