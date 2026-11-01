# Opt-in Linux shard-1 timeout diagnostic

This is evidence tooling, **not a product fix or a replacement Desktop Tests
check**. The shared blocker owner is the PR1549 manager, session3c4d3aa33d29;
Bridge and clamp lanes consume one diagnostic rather than competing patches.

## Why a small paired control

Main baseline05af4b914015a6b60fbc311950718747d7713a6c (run41208304456,
job124562057434) and clamp candidate6a410bf752386b0dd7670c9432cece0f72c3718f
(run41242444625, job124669546010) both hit the **50-minute job ceiling**.
Both stop publishing ordered TAP after `ok616` in check-runtime-deps, then show
SSR stacks from child-reader-foot. That is not proof that SSR hung: ordered
reporter buffering can hide progress in other workers. The baseline predates the
clamp; neither gate is waived. Isolated Darwin/Node24 and Node22.18/two-worker
controls passed but did not match Ubuntu26.04/Node22.23.4/three workers.

The fixed cohort is child-reader-foot-react, ci-scope and code-review-model,
in that order. These are shard1 positions34–36 at both controls; the immediate
preceding check-runtime-deps file owns the last published assertion. Dispatch
order is known; the original simultaneous worker set is not. No automatic
expansion to the164-file shard is allowed.

## Authority, dispatch and cost

The existing `Focused flake check` workflow gains an explicit, mutually exclusive
`shard1-diagnostic` manual mode. Scheduled/default `rotate` behavior is unchanged.
There is no PR-triggered execution of diagnostic subjects, arbitrary test filter,
write token, privileged event or secret input. Manual inputs are full lowercase
40-character same-repository commit SHAs, passed through environment/positional
arguments, never interpolated into shell programs. Baseline must be an ancestor
of candidate and both lockfiles must match exactly before sharing dependencies.
The human/operator must approve the tooling ref and the two reviewed subject
commits; SHA validation is not a claim that arbitrary repository code is trusted.

**Do not trigger before independent code and tooling-QA review.** A workflow must
be present on the default branch for manual dispatch eligibility. This workflow
already exists there, but its new inputs and implementation need to be available
on the selected reviewed ref. After merge (or explicit verification that GitHub
accepts the reviewed diagnostic ref safely), the proposed invocation is:

```sh
gh workflow run flake-check.yml --repo damianvtran/local-operator-ui \
  --ref <reviewed-tooling-ref> -f mode=shard1-diagnostic \
  -f base_sha=05af4b914015a6b60fbc311950718747d7713a6c \
  -f candidate_sha=6a410bf752386b0dd7670c9432cece0f72c3718f
```

This command is documentation, **not an executed Linux result**. A normal
`ci.yml` dispatch is not an approximation: it would run normal classified CI.
No new version or release is required to use diagnostic tooling.

One fresh hosted job pins **ubuntu-26.04, Node22.23.4, pnpm10.29.2** and checks
actual OS/runtime before running. Both checkouts disable persisted Git credentials;
job permissions are contents:read. Tooling and candidate are separate checkouts;
base is a detached worktree under candidate. One public pnpm cache/frozen install
is shared by controls only while all source/installed lock hashes match.

Setup is separately bounded **600 seconds /3072MiB summed resident memory**,
including supervisor and descendants. `pnpm install --frozen-lockfile
--ignore-scripts` reuses the setup-node pnpm store; it neither runs repository
prepare/lifecycle scripts nor downloads Electron through its postinstall. This
non-native fixture needs the optional platform esbuild package, not Electron.
Network/setup cost is **not zero**: a cold cache downloads the frozen dependency
closure; a warm cache may still validate/fetch public metadata. No authenticated
registry token or inherited environment is passed. Exact downloaded byte count
is not claimed in advance; retain setup TAP/elapsed/result evidence. Installation
failure stops dispatch; never retry via another package manager or install locally.
The diagnostic job's14-minute ceiling leaves room for setup + bounded controls
and upload; production CI timeouts are not changed.

After setup, one **90-second aggregate /3072MiB** diagnostic contains synthetic
instrumentation controls and then **base → candidate, serial**, no retries. Each
real side has at most38 seconds. The remaining deadline wins; a side not started
is explicitly NOT_RUN and cannot pass. Runner memory enforcement and the outer
RSS supervisor are conservative resident-memory guards, not a promise about
virtual address size or shared-page physical allocation.

The fixed command uses the subject's existing dispatcher, keeper, hardlink guard,
notifications/telemetry suppression and explicit workers3:

```sh
node scripts/run-desktop-tests.mjs --test-concurrency=3 --test-reporter=tap \
  scripts/child-reader-foot-react.test.mjs \
  scripts/ci-scope.test.mjs scripts/code-review-model.test.mjs
```

It is executed through a real `2>&1 | tee` pipe with pipefail and positional argv.
No full shard, test-inventory change, source overlay, timer-clearing or forced
successful exit is hidden here. Each control gets isolated HOME/config/XDG/tmp;
CMUX/LOP/XPC variables, credentials and ambient NODE_TEST_CONTEXT are not inherited.
Original fixture cache semantics remain in the isolated subject worktree.

## Independent worker evidence and negative controls

The opt-in preload identifies the physical worker entry, not NODE_TEST_CONTEXT
alone (wrappers and keepers inherit it too). Per-PID JSONL records file load,
module body/evaluation, root test start/completion, unref resource-type samples,
beforeExit and exit. A root completion marker proves completed tests/hooks, not a
clean exit or that every assertion passed; the TAP summary and process status
remain separate requirements. No environment values, handle URLs or socket
payloads are logged. A sample timer is explicitly unref'ed; its Timeout resource
may appear in snapshots and is not by itself a product leak.

Before subjects, three actual subprocess controls prove distinctions:

- A natural passing test must complete and exit, with no owned survivors.
- A passing test retaining an interval must actually hit its bound, emit
  TESTS_COMPLETE but no natural beforeExit, and classify held-after-tests.
- A body stalled before completion retains an interval and never resolves its
  awaited work; it must hit the bound without TESTS_COMPLETE and classify
  incomplete-body-or-import. This deliberately injected stall is not a real
  renderer failure. An unresponsive CPU loop might provide no last resource
  sample; absence is unknown, never an empty-resource proof.

Raw negative-control nonzero/deadline evidence is retained; the verifier passes
only when the expected injected fault was observed and reaped correctly. A
missing marker, setup/accounting failure or surviving process stops subject
execution. Already-exited workers are distinguished from a shared pipeline
cutoff caused elsewhere; no blanket blame is assigned to every neighbor.

The supervisor samples PID/parent/group and Linux `/proc` start identity, checks
identity before every signal, and reaps detached groups/known escaped children.
Darwin identity support exists only for tiny local synthetic tooling tests; real
subject mode fails closed outside Linux parity. After cutoff the last private
resource sample and process table survive even if ordered TAP never flushes.
Artifacts describe unknown accounting honestly rather than assuming cleanup.

## Results and limits

`shard1-diagnostic-<run>-<attempt>` is uploaded with `if: always()`, including
partial setup/cutoff failures. It contains provenance and lock hashes, setup log,
negative-control log, both control TAP streams, per-PID phase/resources,
process samples, exit/signal/deadline/memory classifications and survivor checks.
A runner/service loss can still prevent upload; missing evidence is failure.
Nothing here guarantees artifact delivery after arbitrary host loss.

An unexpected assertion, deadline, missing summary/lifecycle, accounting/cleanup
failure or NOT_RUN keeps this job red. Both controls passing falsifies only the
fixed triple under those pins; it does not clear the original full-shard gate.
Both hanging reproduces a baseline path without waiving it. Only candidate
hanging directs analysis to the named worker phase and production delta. Further
cohort expansion needs another bounded allocation, not an automatic full rerun.
Native QA, rendered frames, interactions and the accepted clamp style-recalc
trade-off remain separate evidence requirements.
