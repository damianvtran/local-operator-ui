# Bounded CI hang probe — plan and provenance

Diagnostic only. No production behavior, suite budget, concurrency setting, dependency lock or version changes. Do not dispatch before independent review of this workflow. No full-suite retry.

## Source evidence (task brief, not independently reproduced here)

- Avatar ref `2c0f276d0ead12e6b8664f550468b8217bbe506d` reportedly has the same tree as `4584412effd`; timed-out shard 3 job `124598293293` stopped emitting at about 80 seconds / 2.11 MB around check-runtime-deps and child-reader-foot SSR warnings, under its existing 50-minute cap.
- Telemetry control `47cf454be2efe3a0c30e27063d57845ae5ba7171` reportedly has the fixture graph of `fad920964c`; shard 1 job `124602544089` reached the same boundary and was superseded after 15 minutes. Inventory shift 654→656 places the same ordered 129-file tail in another shard.
- The static import path through canonical-transcript, flag-line, notifications-api and use-desktop-feed reaches avatar. That does NOT prove causation. The child fixture already sets QueryClient gcTime=0; this probe does not alter timers.

## Test plan, before dispatch

1. GitHub-hosted Ubuntu, Node 22. Check out each immutable SHA separately; use pnpm 10.29.2 (verified in both refs' `.github/workflows/ci.yml`; neither declares `packageManager`) and each ref's own v9 frozen lock with the pnpm cache. No npm/yarn or copied node_modules. The diagnostic script comes from the reviewed workflow revision; its SHA and each target SHA are written to artifacts.
2. A built-in-only synthetic slow/noisy child and grandchild must time out, preserve bounded markers/resource snapshots and reap their exact process group. A natural-completion control must return its real status. Failure stops dispatch.
3. Each ref FIRST runs only `scripts/child-reader-foot-react.test.mjs`, with the existing desktop coordinator, concurrency=1, 300-second process-group cap. If and ONLY if BOTH singles finish successfully, run `run-child-reader`, `ci-scope`, `code-review-model` together at concurrency=3 on each ref, same cap. No full suite.
4. In each disposable checkout, insert build/import/render checkpoints into the selected tests, plus Node preload resource/report hooks. The original repo stays untouched. Node test reporter events provide file/test start and assertion-end markers without stdout buffering. Record checkpoint coverage, not merely intent; a missing checkpoint is unknown.
5. Sample PID/PPID/PGID/CPU/RSS; before teardown request active-resource and sanitized Node diagnostic-report snapshots from every Node PID in the exact group. Never publish environment/headers, command arguments, raw reports or unbounded test output. Never force-exit Node or mask retained handles. Supervisor sends TERM then KILL only to its own process group at the deadline and records that as a timeout, not a pass.
6. Local validation uses only Python/Node built-ins, syntax checks and available targeted lint, no dependency install. Hosted real-path execution is UNVERIFIED until a reviewed workflow can be dispatched from the default branch. A workflow-only dispatch surface must merge before use: open PR, stop, hand off review/merge and the exact next command.

## Implementation validation and next gate

Built-in-only checks on Darwin / Node 24.22.1 exercised the actual supervisor, real child/grandchild processes, signal-triggered resource/report hook, and custom reporter with a **test-only injected `ps` process census** instead of Linux procfs. The noisy retained child timed out and its group had no survivors; natural exit returned 0; explicit failure returned 7. A reporter control initially exposed a separate Node reporter realm with no preload globals; explicitly loading the hook inside the reporter fixed it, and the final controls include this regression path. These are NOT hosted Linux/Node22 execution evidence.

All four selected files from EACH immutable Git ref were extracted into scratch, instrumented, and passed `node --check`; no target dependencies or production sources were installed/changed locally. Hosted self-test repeats noisy/grandchild, natural/failure exit and reporter controls BEFORE installing target dependencies. The collector limits evidence to 128 PID files, each at most 256 KiB, plus bounded numeric process samples; stdout/stderr are drained and discarded, not uploaded. Node reports include only runtime version and bounded libuv type/active/referenced fields, never raw environment or argv.

**Next executable gate:** independent code/QA review of this PR, then an authorized merge to make the manual-only workflow reachable on the default branch. Only after that: `gh workflow run ci-hang-probe.yml --repo damianvtran/local-operator-ui --ref main`. This implementation session does not merge or dispatch. Opening the PR may cause the repository's existing scope classifier to schedule its ordinary gates; this change does not relax or alter that policy and does not manually request a full-suite run.

## Interpretation

Avatar-only single retention supports an avatar-correlated effect, not yet a mechanism. Both singles retaining refutes an avatar-only explanation. Singles pass / concurrency arm retains supports concurrency/order. Per-file assertion completion followed by coordinator retention points at coordination/retained handles; build/import/render checkpoints narrow earlier stalls. If none reproduces, result is **inconclusive**; do not expand to a full suite or retry it. Read the generated summary together with PID/resource/checkpoint evidence before assigning cause.
