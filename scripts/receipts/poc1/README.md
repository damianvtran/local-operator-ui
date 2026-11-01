# POC1 — bounded synthetic transport-shape replay

**Measurement-only. No production change and no user-visible latency claim. Keep the PR unmerged.**

Coder: **openai/gpt-6.1-sol**, no fallback. Completed 2026-11-01.
Pinned production source: UI `05af4b914015a6b60fbc311950718747d7713a6c`, src tree
`d87e66111fe655ca0119b106ba22b3488e873a35`. `poc1.json` records worktree
commit `623e86e4ddccdbb7d8fc5e1e56094de27445e410` whose production tree is identical.
The scripts were uncommitted during measurement; exact measured script hashes are
in `setup.json`. That is not the installed app identity. No core source was loaded.

## Reproduce

From an isolated `.worktrees/` checkout with matching shared pnpm dependencies and
`LOCAL_OPERATOR_SCRATCHPAD` set:

```sh
python3 scripts/run-poc1.py --selftest
python3 scripts/run-poc1.py "$LOCAL_OPERATOR_SCRATCHPAD/poc1-reproduction"
```

Actual outputs: wrapper selftest `PASS timeout=124; exact live child identity checked
and reaped; no group signals`; matrix `tests 47; pass 47; fail 0; cancelled 0;
duration_ms 75873.30525`. One bundle, one Node process, serial cells; Node
`--experimental-test-isolation=none --test-timeout=60000`; each sample under 60s.
The resident cell's **setup** takes seconds because 20 real pager transitions are
rendered, not because the measured tail reapply takes that time.
No dependency install, browser, Electron, native/TUI or held `run_bounded.py`.
Full automated CI is a separate frozen-head gate; this is not independent QA.

## Actual samples

One cold + one warmup + five measured iterations **per cell**. Table is
min / median / max over the five measured iterations, milliseconds.
CPU is **process-wide user+system CPU**, not single-thread or substage CPU; it can
exceed wall due to concurrent engine work. Wall is source-rig processing/commit,
not visible paint or sendability. Raw user/system microseconds are retained.

| Cell | CPU ms min / median / max | Wall ms min / median / max | Frame bytes | Resident records | DOM record rows / nodes |
|---|---:|---:|---:|---:|---:|
| cold-short | 371.85 / 387.85 / 412.36 | 273.34 / 277.07 / 297.91 | 35,941 | 100 | 99 / 2,894 |
| warm-short | 330.05 / 341.74 / 355.68 | 252.47 / 253.99 / 274.16 | 35,941 | 100 | 99 / 2,894 |
| resident-reapply-2000 | 250.40 / 272.45 / 303.59 | 217.15 / 238.41 / 288.07 | 35,941 | 2,100 | 499 / 14,495 |
| user-512k | 418.20 / 448.96 / 1547.95 | 356.27 / 376.81 / 508.49 | 560,205 | 100 | 99 / 2,894 |
| tool-512k | 366.07 / 369.36 / 412.45 | 296.56 / 298.36 / 340.03 | 560,205 | 100 | 99 / 2,894 |
| manifest-16k | 351.55 / 366.87 / 400.53 | 285.98 / 299.08 / 333.66 | 35,941 | 100 | 99 / 2,989 |

## What can be concluded

- The 2,100-resident **still-mounted reapply** is a direct regression surface, not a
  switch retaining 2k cache rows. Its matched 100-resident reapply uses the identical
  frame/has_more/cursor/generation witness and holds valid follow-up pages in flight.
  Five paired CPU samples are in `paired100`: roughly 45–60ms versus the larger
  resident case's roughly 272ms median. **DOM rows also grow from 99 to 499**;
  this does NOT isolate buildRows CPU from DOM/React derivation. It motivates
  profiling the existing resident+window derivation, not a new paint-cache fix.
- Both giant cells have **560,205 identical total frame bytes**, one 512KiB body,
  the same 100-entry tail and the same short tool row already present in every
  cell. Only the location of the long body changes. Plain `x` text is deliberately
  not a complex Markdown workload. These samples do not prove byte cost absent,
  and do not establish a general Markdown performance conclusion.
- The 16k manifest is **16,000 actual checkpoint inputs**, 46 mounted checkpoint
  elements, and a `data-checkpoint-count=16000` witness. Total nodes remain 2,989
  versus 2,894 in the short case. DOM windowing is observed; O(checkpoint) model
  construction is a source finding, not a measured CPU substage attribution.
- No proposed production change, P5 cache, or <500ms visible target is validated.

## Transport contract and work counters

Every measured tail is 100 durable entries, `has_more=true`, `cursor_missing=false`;
front-end seed/epoch/sequence and live cursor are explicit (settled: no live events,
`live_cursor=null`). Open-frame and journal-order options are asserted on the actual
subscription. `runs_state=ready`, runs/head_cut, journal_generation, ready ordinals,
journal_seq and ts_source travel with the page. Earlier pages are bounded at 100
and delivered through the **shipped loadOlderDetailed**. Remaining follow-up pages
are held until after unmount, then resolved with valid earlier entries.

The tail uses ordinals 20001–20100; the resident case pages 18001–20000. The 16k
checkpoint manifest describes older entries, not imaginary IDs after the current
head. Local-source frames do not invent peer `source_*` partition fields: those
are optional, peer payload-purpose fields in the actual contract. No raw journal
is accepted/read and no transport fixture is assembled from real message bodies.
QA `active-cohort.md` (2026-11-01) supplied **shape motivation only**.

`inputEntries` is unique setup fixture entries (100 or 2100), **not instrumented
reducer work**. `measuredFrameInputEntries=100` is the measured input count. DOM
rows/nodes and per-layout-commit readiness/placeholder/condensation/working states
are observations. `parseCPU` is an isolated extra JSON.parse proxy; snapshot CPU
also includes fixture serialization, actual hook parse/apply, React, jsdom and the
observations. Actual applyHistoryPage/flush/buildRows CPU and processed-row visits
remain **unobserved**, as do browser layout, paint and sendability.

## Controls, limitations and preflight recovery

- +200ms snapshot: measured wall 261.96→466.01ms, process CPU 319.91→322.03ms;
  injected idle slice 201.95ms wall versus 0.30ms CPU. Delay is not CPU work.
- Late A snapshot after A→B: B's actual DOM/diagnostics unchanged; old subscription
  disposed. Cached-hold 16-cell invariant uses the shipped decision functions.
- Ready facts recognized; absent runs and building return no facts. They refine
  condensation and are **not** a reason to block hydration.
- Constant frame with metadata-count labels 1k/10k is a **structural boundary
  invariant only**. No contract field carries unrelated upstream journal counts.
  Backend metadata ingestion/CPU discrimination is **BLOCKED at this boundary**;
  the construction check is not evidence that backend work is constant.
- The 200-row reopen ceiling is a **limit, not a defect**:
  `paint-cache.ts:87` PAINT_CACHE_MAX_ROWS=200, `:173` slices that suffix. A switch
  retaining 2k cached records is BLOCKED by this contract; no cap was bypassed.
- Original same-code mid-cycle harness passed with seven inert 250ms callbacks.
  The hook calls window.setTimeout and global clearTimeout; Node globals do not
  alias jsdom window. Diagnostic-only pairing makes the same control pass with
  **[]** pending timers (`timer-pairing-control.json`). Numeric fixture timer IDs
  do not replace native Node Timeout objects. The old no-op cancelAnimationFrame
  was also made cancellable in diagnostic mode. This is harness fidelity, not a
  production fix. All stale 830d source and failed setup runs were discarded.
- Every final sample: zero pending stub window timers and zero live transport
  subscriptions. Synthetic queued RAFs are consistently 1 in nonresident cells,
  0 in resident cells, with no cross-sample growth. **Do not call that all callbacks
  or all DOM listeners reaped**: arbitrary DOM listener accounting is unobserved.
- No real fetch request escaped the guard. Native HTTP/socket interception is not
  an independent instrument; the shipped transport/health boundaries are scripted.
- Final wrapper signals only its own still-live recorded PID after checking start
  identity; it never signals groups or remembers a group after leader exit.
  Node test isolation is off; normal teardown calls esbuild.stop. Forced-timeout
  descendant cleanup remains explicitly unguaranteed and stops dispatch.
- During development an aggregate 60s test timeout and an older wrapper left an
  owned worker/service; exact PIDs were reaped and that runner was replaced.
  Final negative timeout preflight and same-code controls passed before dispatch.

## Architecture provenance, not measured conclusions

Architect `conversation-switch-architecture.md` lines 45–49, 77–85 (audit of the
same 05af source) established: sidebar start mark is absent (existing start mark
is native/notification entrance only); layout-effect completion is not paint or
sendability; buildRows precedes virtualization; giant user content still reaches
full Markdown; manifest derivation remains O(checkpoint) despite bounded DOM.
This POC does not override those boundaries or bless #1549 geometry. It uses no
installed renderer/backend identity and makes no claim about the operator's
actual conversations' delay.
