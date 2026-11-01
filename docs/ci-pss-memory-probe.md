# Branch-only CI RSS/PSS diagnostic arm

This is a passive Linux observer, not a memory-guard fix. The review branch is
`diag/ui-pss-memory-probe`, cut from `origin/main`. Its new workflow does **not**
run on review-branch pushes or pull requests. Existing ordinary PR CI remains
independent of this arm. Do not merge this diagnostic into main.

## Review, then activate once

After independent review is clean, the manager may run the following from the
reviewed checkout (substitute its reviewed commit SHA, not an unreviewed HEAD):

```sh
git push origin <reviewed-commit-sha>:refs/heads/diag/ui-pss-memory-probe-activate
```

This creates the separate activation ref and its push runs the workflow once.
Do not force-update an existing activation ref. No activation has been performed
as part of preparing this arm. The workflow accepts pushes only on that exact
activation branch. Manual dispatch is additionally job-gated to `main` or the
activation ref; the carrier independently enforces Linux, GitHub Actions and the
same ref allowlist. `workflow_dispatch` generally is not available until a
workflow exists on the default branch; **use the one-shot push above**, not a
merge to make dispatch available. There is one Ubuntu 24.04 job, Node 22, pnpm
10.29.2, a frozen-lockfile runner-only install and a hard 30-minute timeout.
Permissions are read-only and no secrets are referenced. Checkout does not retain
its token in Git configuration.

The workflow runs:

```sh
node scripts/ci-pss-memory-probe.mjs
```

The carrier's exact child command is:

```text
node scripts/run-desktop-tests.mjs --test-concurrency=3 <the 82 embedded paths, in order>
```

The literal path list is embedded in the carrier, newline-terminated, with SHA256
`24a25a997ec2b21294f76edda09af3d3d23c75a32143d441d5718f01b0753eb5`.
It is the sorted 654-file desktop inventory at UI #1562 head
`8bbb57055c78b545595cf4412d2cd2f680b3cbb4`, indices `i % 8 === 5`, not a new
partition of today's inventory. The carrier verifies the digest, 82-file count
and every path's existence **before spawning**. It refuses inherited
`NODE_OPTIONS`, `NODE_TEST_CONTEXT` and memory/concurrency/lane tuning variables,
rather than accepting a silently different experiment. It changes none of them.
The code under test is the reviewed branch based on current main; the historical
file composition is pinned, not the historical product source or runtime timing.
No local install or local suite execution is part of preparing this arm.

## Invariant: same tick, same tree, per pid

The carrier spawns the guarded runner as its own detached child/process-group
leader. The existing runner still spawns and guards its own test group. The
carrier neither imports nor changes the guard, sets a budget, changes its
signals, sets `NODE_OPTIONS`, nor signals/kills any process itself.

Every 1000 ms (non-overlapping targets; overruns skip targets), one sample:

1. Reads `ps -axo pid=,ppid=,pgid=` and verifies `/proc/<pid>/stat` parent,
   process-group and start-time identity before walking relationships.
2. Selects its runner leader, descendants and same-process-group members,
   retaining previously observed identities across reparenting. Reused pid
   numbers are not the same process. Out-of-group descendants are included.
3. Reads each member's `smaps_rollup` **Pss** and **SwapPss**, and `status`
   **VmRSS**, in kernel kB (KiB), plus a sanitized/truncated `comm` name.
   Additionally reads at most 4096 bytes of `/proc/<pid>/cmdline` only for pids
   whose PSS in this tick is strictly above the requested numeric cutoff of
   **524,288 kB**. The brief calls this “500 MiB”; in kernel KiB units that exact
   cutoff is 512 MiB (500 MiB would be 512,000 kB). NUL-separated
   arguments are joined with single spaces and truncated to 300 characters,
   appending `…` if truncated. The resulting `argv` is in the same per-pid tick
   row as RSS/PSS/SwapPss; below-threshold or failed reads record `argv: null`
   without failing the memory tick. This can name a heavy worker's script, but
   cannot by itself prove which assertion is holding memory.
   Rechecks pid/start-time and parent/group after those reads. A vanished,
   inaccessible or changed member makes the tick incomplete, never a zero.
4. Emits a JSONL row with begin/end epoch milliseconds, the per-pid table,
   pid count and sums of Pss, SwapPss and VmRSS from **that table only**.

`totals` covers the full owned observer tree, including the runner/keeper
wrappers. `inGuardTree` and `guardTotals` separately identify the guarded
`node --test` leader's same-pgid/descendant tree, discovered without persisting
argv; this avoids charging wrapper overhead when comparing with a guard breach.
A missing charged root means `guardTotals: null`, not a zero-memory suite.
No reading is an atomic kernel-wide snapshot: inspect the begin/end interval,
missing-pid list and completeness before drawing a conclusion.

## Reading the pair

Start with `summary.json`: child exit code/signal, last tick completed before
child exit, and the complete tick with maximum observed owned-tree ΣVmRSS,
including both totals and its full per-pid table. `maximaKb` reports each
metric's independent maximum across complete pre-exit ticks; **do not pair
independent maxima**. Use `peakRssTick.guardTotals` or an appropriate retained
complete JSONL tick for a same-tree RSS/PSS pair. Divide kB by 1,048,576 for GiB.
SwapPss is reported separately, not quietly added to resident PSS. Compare PSS
plus SwapPss as well if evaluating total pressure rather than resident sharing.

**A PSS total near ~2.2 GB with ΣRSS at 10.9 GB indicates a guard measurement
defect while the suite fits**, provided these are a complete same-tick,
same-guarded-tree pair near the breach (and SwapPss is not hiding pressure).
The per-pid rows show which shared mappings inflate RSS. High PSS too would
instead contradict that shared-page-only explanation. This arm tests the
hypothesis; it does not assume either result.

The observer is independent of the guard's own cadence. The numeric
`guard_breach` event gives its reported root, process count, RSS and budget;
the guard labels binary GiB as “GB”, normalized here as `*GiB`. It cannot give
us the guard's unexposed per-pid kill snapshot. The last pre-exit sample may be
up to a cadence interval (plus sample duration) older or contain different
membership. If the relevant spike or killed composition was not captured,
report **inconclusive**; do not call an earlier low-PSS sample the exact killed
composition. Getting a guaranteed identical guard tick would require a
separately reviewed guard instrumentation change, outside this arm.

**This does not investigate the 50-minute wedge.** The 30-minute job cap is a
safety bound, not evidence about whether that separate stall is fixed.

## Measured finding so far

The first activation's reported breach-tick measurements (recorded in the
follow-up investigation brief) were ΣPss **9,234,523 kB** versus ΣVmRSS
**9,503,172 kB**, with **SwapPss 0**, across nine pids. One worker grew from
approximately **0.08 to 7.33 GiB in ~30 seconds**. Group size is therefore not
the binding constraint: one worker dominates resident memory, rather than RSS
merely multiplying shared pages. Its script was not named by the original
`comm`-only rows; bounded `argv` capture is intended to identify it next.

## Bounded and sanitized artifacts

`pss-probe-artifacts/` is uploaded even after failure (three-day retention).
Each tick is appended and fsynced immediately. `ticks-0.jsonl` and
`ticks-1.jsonl` rotate at 384 KiB each: only the recent window is retained, while
the peak and last pre-exit tables survive separately in the final summary.
`summary.json` is below 384 KiB. Each detailed tick is capped at 128 KiB; a
capacity refusal is an unavailable sample, not a silently truncated table.
The sanitized `suite-output.jsonl` is below 33 KiB. The total is below 1.2 MiB,
uncompressed, independent of duration. An outer hard job termination may
prevent a final summary/upload, but completed tick writes have been fsynced.

Both suite stdout and stderr pipes are continuously drained without waiting for
artifact consumers. Arbitrary test payloads/TAP, environment, argv, paths and
stack traces from those pipes are not persisted: the suite-output file allowlists
only numeric memory-breach fields, and the summary counts total drained bytes. This is
intentionally not a raw suite log; ordinary Actions CI is a separate source for
normal test results. Process command names allow only ASCII alphanumerics,
underscore, dot and hyphen and are truncated to 24 characters. The sole additional
argv capture is the bounded heavy-pid field described above; it may contain
script paths or arguments and is not sanitized like `comm`. The carrier's
own console output contains only numeric status and the composition digest.

Local preparation is limited to source inspection/writing and dependency-free
syntax checks. Linux `/proc` sampling, guard parity, artifact rotation and a
real breach remain **unexecuted until approved activation**; a successful
`node --check` does not establish those behaviors.
