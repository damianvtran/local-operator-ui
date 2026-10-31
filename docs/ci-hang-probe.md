# Bounded CI hang probe — plan and provenance

Diagnostic only. No production behavior, suite budget, concurrency setting, dependency lock or version changes. Do not activate or dispatch before independent review of this workflow's trigger delta. Activation is a bounded diagnostic, not a release or permission to merge this PR. No full-suite retry.

## Source evidence (task brief, not independently reproduced here)

- Avatar ref `2c0f276d0ead12e6b8664f550468b8217bbe506d` reportedly has the same tree as `4584412effd`; timed-out shard 3 job `124598293293` stopped emitting at about 80 seconds / 2.11 MB around check-runtime-deps and child-reader-foot SSR warnings, under its existing 50-minute cap.
- Telemetry control `47cf454be2efe3a0c30e27063d57845ae5ba7171` reportedly has the fixture graph of `fad920964c`; shard 1 job `124602544089` reached the same boundary and was superseded after 15 minutes. Inventory shift 654→656 places the same ordered 129-file tail in another shard.
- Subsequent manager brief: telemetry control shard 1 job `124623152974` also cancelled at 55 minutes, with logs ending around 73 seconds at child-reader SSR warnings, reportedly the same boundary as avatar. This additional CI evidence is attributed to that brief, not independently fetched here; it strengthens the priority of the bounded comparison, not an avatar-only causal claim.
- The static import path through canonical-transcript, flag-line, notifications-api and use-desktop-feed reaches avatar. That does NOT prove causation. The child fixture already sets QueryClient gcTime=0; this probe does not alter timers.

## Test plan, before dispatch

1. GitHub-hosted Ubuntu, Node 22. Check out each immutable SHA separately; use pnpm 10.29.2 (verified in both refs' `.github/workflows/ci.yml`; neither declares `packageManager`) and each ref's own v9 frozen lock with the pnpm cache. No npm/yarn or copied node_modules. The diagnostic script comes from the reviewed workflow revision; its SHA and each target SHA are written to artifacts.
2. A built-in-only synthetic slow/noisy child and grandchild must time out, preserve bounded markers/resource snapshots and reap their owned processes. A natural-completion control must return its real status. Additionally, copy the byte-identical built-in runtime closure of EACH frozen coordinator into disposable scratch, run a synthetic passing assertion that retains an interval through that real coordinator, and require actual test-worker CPU/RSS samples and a pre-reap report. Both detached test and keeper groups must be owned and have no live survivors. Synthetic ancestry/PID-reuse negatives must refuse signals to a recycled identity. Failure stops dispatch.
3. Each ref FIRST runs only `scripts/child-reader-foot-react.test.mjs`, with the existing desktop coordinator, concurrency=1, 300-second process-group cap. If and ONLY if BOTH singles finish successfully, run `run-child-reader`, `ci-scope`, `code-review-model` together at concurrency=3 on each ref, same cap. No full suite.
4. In each disposable checkout, insert build/import/render checkpoints into the selected tests, plus Node preload resource/report hooks. The original repo stays untouched. Node test reporter events provide file/test start and assertion-end markers without stdout buffering. Record checkpoint coverage, not merely intent; a missing checkpoint is unknown.
5. Sample PID/PPID/PGID/CPU/RSS; before teardown request active-resource and sanitized Node diagnostic-report snapshots from every Node PID in the exact group. Never publish environment/headers, command arguments, raw reports or unbounded test output. Never force-exit Node or mask retained handles. Supervisor tracks descendant identities across detached groups and parent exits, then sends TERM/KILL only through identity-rechecked Linux pidfds. Linux subreaper adoption retains even orphaned detached descendants; pre-existing direct children are excluded. No process-name or blind group kill is used. The whole-call clock starts before setup/baseline census. Observation/signaling costs are measured. Cleanup reserve is `min(0.75 × cap, max(6 seconds, 12 × baseline census cost))`: reports begin at deadline minus reserve, TERM at deadline minus 0.8 × reserve, and KILL at deadline minus 0.55 × reserve. Native Linux's cheap census normally reserves six seconds of the unchanged 300-second envelope. A new census follows TERM before escalation; already-KILLed or confirmed-dead historical identities are not serially re-signaled. A fresh final all-owned-group census remains mandatory. There is no extra wait allowance; an observed deadline overrun fails with exit 127. This is a timeout, not a pass.
6. Local validation uses only Python/Node built-ins, syntax checks and available targeted lint, no dependency install. Hosted real-path execution remains UNVERIFIED until the reviewed trigger is explicitly activated. The exact diagnostic push branch below avoids the new `workflow_dispatch` default-branch prerequisite: no merge to main or full-suite retry is needed to run this bounded diagnostic. Implementation stops before activation; the manager must first obtain independent approval of the trigger delta.

## Implementation validation and next gate

Built-in-only checks on Darwin / Node 24.22.1 exercised the actual supervisor, real child/grandchild processes, signal-triggered resource/report hook, and custom reporter with a **test-only injected `ps` process census** instead of Linux procfs. The noisy retained child timed out and its group had no survivors; natural exit returned 0; explicit failure returned 7. A reporter control initially exposed a separate Node reporter realm with no preload globals; explicitly loading the hook inside the reporter fixed it, and the final controls include this regression path. These are NOT hosted Linux/Node22 execution evidence.

All four selected files from EACH immutable Git ref were extracted into scratch, instrumented, and passed `node --check`; no target dependencies or production sources were installed/changed locally. Hosted self-test repeats noisy/grandchild, natural/failure exit and reporter controls BEFORE installing target dependencies. The collector limits evidence per invocation to 128 PID files, each at most 256 KiB, plus bounded numeric process samples; stdout/stderr are drained and discarded, not uploaded. Node reports include only runtime version and bounded libuv type/active/referenced fields, never raw environment or argv.

**Next executable gate:** independent code/QA review of the exact trigger delta, then the manager's explicitly authorized tree-identical push activation described below. Do not merge this PR to enable the diagnostic. This implementation session only pushes the ordinary PR branch, never the activation branch and never a manual dispatch. Existing automatic PR gates may still run; no CI gate or release policy is bypassed or relaxed for shipping.

## Round 1 remediation — detached coordinator topology

R1 was reproduced here against the original observer at `da205e1e804`, not merely accepted from review. A built-in-only copy of each actual frozen coordinator (nine byte-exact runtime modules, including the URL-loaded hardlink guard and keeper) ran on Darwin / Node 22.18.0 with the disclosed test-only process-census adapter. Each synthetic test passed one assertion and retained an interval. Old avatar: worker 74202, outer-only report 74181; old telemetry: worker 74460, outer-only report 74450. Neither actual worker was sampled or reported. Both cases timed out; the production keeper cleaned them, so this is observation/ownership failure, not a demonstrated historical leak.

The observer now retains PID/start-tick identities and ancestry across setsid/reparenting, observes all owned groups, and uses pidfd-pinned signals with a post-open identity reread. An unrelated reused PID is rejected; a matching identity receives the pinned signal (both tested with synthetic kernel-interface mocks). Adopted zombies are reaped only with matching identity and direct-parent proof. Timeout cleanup no longer adds a five-second wait after the original cap. The manual workflow passes both immutable checkouts to built-in preflight before installing dependencies; the regression never runs the full target suites.

Final built-in regression results on Darwin / Node 22.18.0 (real coordinator and test process topology, test-only `ps` census/identity-signal adapter; **not Linux pidfd/subreaper proof**): avatar timeout 124 in 6.444 s, worker 88104 sampled/reported, one passed assertion, three owned groups, no live survivors; telemetry timeout 124 in 6.677 s, worker 88407 sampled/reported, one passed assertion, three owned groups, no live survivors. Both fit their eight-second control envelopes. CPU seconds and RSS were measured from the actual test workers, not synthetic zeros. Standalone noisy/natural/nonzero/reporter controls also passed. One intermediate Darwin-adapter run exceeded its eight-second envelope at 8.466 s despite complete worker evidence/no survivors; it is a failed control, not a pass. Non-adopting hosts now skip adopted-child wait probes they cannot use; the terminal bounded controls above passed without increasing any cap. Native Linux procfs, pidfd and subreaper behavior remains unverified until the reviewed hosted workflow can run; source-parser and PID-reuse mocks do not substitute for that gate.

Repro/control evidence: `~/.local-operator/sessions/fbe888935752/scratchpad/retained-coordinator-control.py`, `r1-old-ready/`, `r1-fixed-ready/`, `r1-final-builtin-controls/`, and terminal `r1-terminal/`. No production coordinator source, suite concurrency, memory/time budget, dependencies or versions changed. This is one batched R1 remediation; independent delta code/QA review remains required.

## Round 2 remediation — whole-call deadline orchestration

Independent round-2 QA/review proved ownership/reporting clean but the Darwin adapter exceeded its deadlines. Q1 is accepted, not rewritten as a pass; Q2 native Linux remains blocked. The supervisor previously started its clock after baseline census, used elapsed time captured before slow observation, then serially revalidated dead historical PIDs and repeated KILL in cleanup. These costs were outside or crowded the final second of the nominal envelope.

The new clock includes setup and the final census/serialization. Census/signal count, total and maximum durations are numeric artifact fields. Cleanup starts with measured reserve rather than in the final second, and phase checks use fresh monotonic readings. TERM is followed by observation before KILL, which both avoids signaling already-dead cached rows and discovers children created by TERM handlers. Already-KILLed identities are not redundantly signaled in final cleanup. PIDfd/start-identity checks and subreaper ownership implementations are preserved byte-for-byte, and the fresh final census is retained; no watchdog/service or production change was added. Both frozen-coordinator and late-detached-child controls now assert the supervisor's whole call from its caller, not an internal timestamp. The old noisy-control `<6s` assertion is tightened to its actual four-second cap.

Fresh unchanged-adapter comparison: old head `62d7fb956ca` failed the late-child whole-call limit at **8.476 s**; the new matrix passed that same control at **5.142 s**, with retained avatar/telemetry at **3.680/3.555 s**. Old retained controls happened to fit eight seconds in that fresh run, unlike the independently reported round-2 failures; load sensitivity is not hidden.

A matched cost-floor negative control reproduces both retained-coordinator failures: the SAME real Darwin `ps` adapter, matrix, frozen sources and caps on old/new, with a disclosed 0.25-second minimum per census/identity read. This floor represents the independent QA's measured full-census range 0.238–0.347 s; it is simulated overhead, not a native Linux measurement. Old avatar **9.965 s**, telemetry **9.876 s**, noisy **4.560 s**, late child **9.006 s**: FAIL. New permanent built-in controls using that same floor: avatar **5.368 s**, telemetry **5.179 s**, late child **6.087 s** (all cap 8 s), noisy **3.282 s** (cap 4 s), natural **1.309 s**, explicit failure **1.344 s**, reporter **1.912 s**: PASS. Actual frozen workers were sampled/reported with passing assertions; the late child was owned/reported; independent post-call census found no live known PID/group survivors. The eight-second minimum measured margin is **1.913 s**; noisy margin is **0.718 s**. These are observed margins, not a guarantee under arbitrary OS stalls.

An intermediate overly-early short-control teardown failed the permanent noisy assertion and exposed an unobserved orphan on the non-subreaper Darwin adapter; its exact identified synthetic PID was cleaned up. It was not counted as a pass. Restoring the short control's initial observation window, plus avoiding stale TERM→KILL work, produced the final passing controls above without widening any cap. Native Linux subreaper behavior remains unverified, not inferred from this Darwin adapter.

Unpadded measured new census maxima were 0.156–0.292 s and per-signal maxima 0.014–0.108 s in selected initial arms. Final permanent controls with the matched floor measured retained-coordinator census maxima 0.322–0.325 s and per-signal maxima 0.320–0.323 s; late-child maxima were 0.324/0.325 s. These costs are inside the reported whole-call totals. The terminal matched-floor matrix also passed: retained avatar **5.344 s**, telemetry **5.387 s**, late child **6.587 s**, noisy **2.863 s**, with worker/late-child reports and no external survivors. Its artifacts preserve actual per-operation maxima/totals so reviewers can inspect the reserve instead of trusting a timing adjective.

Reproducible same-matrix rig: `~/.local-operator/sessions/fbe888935752/scratchpad/r2-deadline-rig.py`. Evidence: `r2-old-deadline.log`, `r2-new-deadline.log`, `r2-old-cost-floor.log`, `r2-terminal-cost-floor.log`, `r2-builtin-checked/`. Native Linux procfs/pidfd/subreaper and the hosted 300-second experiment remain **UNVERIFIED**. No dispatch, merge, dependency install or full-suite retry was performed. Independent delta review/QA is still the next gate.

## Reviewed push activation without a main merge

The manager authorized this exact diagnostic-only activation path because a newly added `workflow_dispatch` cannot be invoked before it exists on the default branch. An ordinary `push` workflow is loaded from the pushed ref, so a tree-identical post-review activation commit can run the reviewed probe without merging PR #1551, releasing anything, or retrying broad CI. The sibling core PR #3254 uses the same exact-branch mechanism (source/precedent, not evidence that this UI workflow has run).

Only `push` to **`diag/ui-avatar-native-activate`** can activate this workflow; there is no wildcard, PR, schedule or repository-dispatch trigger. Defense-in-depth job guard requires repository `damianvtran/local-operator-ui` plus that exact push ref. Manual dispatch remains available only from `main` or the same activation ref once GitHub makes that dispatch surface reachable; inputs/untrusted refs/forks are refused. Read-only permissions, fixed immutable avatar/telemetry refs, existing pnpm cache policy and the complete job steps are unchanged.

The native Linux/Node22 built-in self-test is fail-closed BEFORE frozen dependency installs and target experiments. It verifies ownership/reports/reap, whole-call bounds, natural/nonzero exits and negative identity/deadline controls; failure prevents the target stages. Target singles remain serial at 300 seconds each; only both clean singles unlock the serial concurrency-three comparisons. The existing 35-minute outer job cap and one-run concurrency group are unchanged. No native result is claimed by these trigger tests.

**STOP until independent trigger-delta code/QA review approves the exact PR head.** Then the manager may execute this procedure from this PR worktree. Do not use it for shipping, merge PR #1551, push main, force an existing activation ref, request a broad workflow, or change the tree after approval:

```sh
set -euo pipefail
REVIEWED='<full SHA independently approved on PR #1551>'
BRANCH='diag/ui-avatar-native-activate'
test "$(gh repo view --json nameWithOwner --jq .nameWithOwner)" = 'damianvtran/local-operator-ui'
test "$(git rev-parse HEAD)" = "$REVIEWED"
test -z "$(git status --porcelain)"
REMOTE=$(git ls-remote --heads origin "refs/heads/$BRANCH")
test -z "$REMOTE" || { printf '%s\n' 'STOP: activation ref already exists; do not overwrite it'; exit 1; }
TREE=$(git rev-parse "${REVIEWED}^{tree}")
ACTIVATION=$(printf '%s\n' 'chore(ci): activate reviewed bounded avatar probe' | git commit-tree "$TREE" -p "$REVIEWED")
test "$(git rev-parse "${ACTIVATION}^{tree}")" = "$TREE"
git diff --exit-code "$REVIEWED" "$ACTIVATION"
printf 'Reviewed=%s\nActivation=%s\nIdenticalTree=%s\n' "$REVIEWED" "$ACTIVATION" "$TREE"
# This documented hook bypass skips local broad gates ONLY for this authorized,
# reviewed diagnostic activation. It does not waive any CI/release/merge gate.
PREPUSH_BYPASS='Reviewed tree-identical bounded diagnostic only; not shipping; no full local suite; native self-test is fail-closed' \
  git push origin "$ACTIVATION:refs/heads/$BRANCH"
gh run list --repo damianvtran/local-operator-ui --workflow ci-hang-probe.yml --branch "$BRANCH" --json databaseId,headSha,event,status,conclusion
```

Match the returned run's `headSha` to `ACTIVATION` and event to `push`; record both SHA and identical tree receipt before reading results. This is one bounded diagnostic job, not release approval. Other checked-in workflows' push filters are `main` or `dev-*` (or have no push event), so this branch does not request their full suite/release jobs. No activation PR is opened. After the job, preserve its sanitized artifact and distinguish native self-test failure from target reproduction/inconclusive outcome; do not retry the full suite. This implementation session prepares/pushes only the ordinary PR delta and stops before creating/pushing an activation commit.

### Executable activation-contract checks

Trigger-only validation: before editing, two checks failed for the intended missing exact push trigger/job guard; afterwards all three contract methods passed (16 allowed/denied guard contexts). Four disposable mutations were rejected: wildcard push filter, removed repository guard, broadened manual-dispatch ref and `continue-on-error` on native preflight. `actionlint` passed. The reviewed Python driver is byte-identical to `a5bb9444091` (SHA256 `69a248e0be616ebbc7629f6afd4787865d0a38f9730b17bd75b708bbc126bf50`), as is the workflow from `runs-on` through all existing job steps. No native run, activation commit or activation push occurred during this validation.

The tests live here to preserve the already independently reviewed Python driver byte-for-byte and keep this diagnostic within three files. They inspect the ACTUAL trigger and compile the restricted actual job-guard expression (only boolean comparisons/context names; no unrestricted expression execution). `actionlint` supplies full YAML/GitHub syntax validation. Run locally with built-ins, no installs:

```sh
python3 - <<'PY'
from pathlib import Path
import sys
doc = Path('docs/ci-hang-probe.md').read_text()
code = doc.split('<!-- activation-contract-tests -->\n```python\n', 1)[1].split('\n```', 1)[0]
sys.argv = ['activation-contract-test', '.github/workflows/ci-hang-probe.yml']
exec(compile(code, '<documented-activation-contract>', 'exec'), globals())
PY
actionlint .github/workflows/ci-hang-probe.yml
```

<!-- activation-contract-tests -->
```python
"""Built-in-only contract tests of the actual GitHub trigger and guard.
Run: python3 activation-guard-test.py PATH/ci-hang-probe.yml
"""
import ast
from pathlib import Path
import re
import sys
import unittest

workflow = Path(sys.argv.pop()).read_text()
ACTIVATION = 'diag/ui-avatar-native-activate'
REPO = 'damianvtran/local-operator-ui'


def guard():
    match = re.search(r'^    if: >-\n((?:      [^\n]+\n)+)', workflow, re.M)
    if not match:
        raise AssertionError('missing explicit job-level activation guard')
    expression = ' '.join(line.strip() for line in match[1].splitlines())
    expression = expression.replace('&&', ' and ').replace('||', ' or ')
    for name in ('repository', 'event_name', 'ref'):
        expression = expression.replace('github.' + name, name)
    tree = ast.parse(expression, mode='eval')
    allowed = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.Compare,
               ast.Eq, ast.Constant, ast.Name, ast.Load)
    if any(not isinstance(node, allowed) for node in ast.walk(tree)):
        raise AssertionError('unsupported guard syntax: fail closed')
    if any(node.id not in ('repository', 'event_name', 'ref')
           for node in ast.walk(tree) if isinstance(node, ast.Name)):
        raise AssertionError('unsupported context: fail closed')
    return compile(tree, '<actual-workflow-guard>', 'eval')


class ActivationContract(unittest.TestCase):
    def test_exact_push_trigger(self):
        events = re.search(r'^on:\n(.*?)(?=^\S)', workflow, re.M | re.S)[1]
        names = re.findall(r'^  ([a-z_]+):', events, re.M)
        self.assertEqual(names, ['push', 'workflow_dispatch'])
        self.assertEqual(re.findall(r'^      - (.+)$', events, re.M), [ACTIVATION])
        self.assertNotIn('inputs:', events)

    def test_guard_positive_and_negative_matrix(self):
        expression = guard()
        cases = [
            ('push', ACTIVATION, REPO, True),
            ('workflow_dispatch', ACTIVATION, REPO, True),
            ('workflow_dispatch', 'main', REPO, True),
            ('push', 'main', REPO, False),
            ('push', 'diag/ci-hang-probe-fbe888', REPO, False),
            ('push', ACTIVATION + '-other', REPO, False),
            ('push', 'diag/other', REPO, False),
            ('workflow_dispatch', 'feature/unreviewed', REPO, False),
            ('pull_request', ACTIVATION, REPO, False),
            ('pull_request_target', ACTIVATION, REPO, False),
            ('schedule', ACTIVATION, REPO, False),
            ('repository_dispatch', ACTIVATION, REPO, False),
            ('push', ACTIVATION, 'outside/fork', False),
            ('workflow_dispatch', ACTIVATION, 'outside/fork', False),
        ]
        for event, branch, repository, expected in cases:
            with self.subTest(event=event, branch=branch, repository=repository):
                result = eval(expression, {'__builtins__': {}},
                              dict(repository=repository, event_name=event,
                                   ref='refs/heads/' + branch))
                self.assertEqual(result, expected)
        for event in ('push', 'workflow_dispatch'):
            self.assertFalse(eval(expression, {'__builtins__': {}},
                                 dict(repository=REPO, event_name=event,
                                      ref='refs/tags/' + ACTIVATION)))

    def test_fixed_fail_closed_native_plan(self):
        self.assertIn('permissions:\n  contents: read\n', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertNotIn('continue-on-error:', workflow)
        self.assertIn('runs-on: ubuntu-latest', workflow)
        self.assertIn("node-version: '22'", workflow)
        self.assertIn('2c0f276d0ead12e6b8664f550468b8217bbe506d', workflow)
        self.assertIn('47cf454be2efe3a0c30e27063d57845ae5ba7171', workflow)
        self.assertLess(workflow.index('ci-hang-probe.py self-test'), workflow.index('pnpm install'))
        self.assertLess(workflow.index('pnpm install'), workflow.index('--phase single'))
        self.assertLess(workflow.index('--phase single'), workflow.index('--phase trio'))
        self.assertIn('cancel-in-progress: false', workflow)


unittest.main(verbosity=2)
```

## Interpretation

Avatar-only single retention supports an avatar-correlated effect, not yet a mechanism. Both singles retaining refutes an avatar-only explanation. Singles pass / concurrency arm retains supports concurrency/order. Per-file assertion completion followed by coordinator retention points at coordination/retained handles; build/import/render checkpoints narrow earlier stalls. If none reproduces, result is **inconclusive**; do not expand to a full suite or retry it. Read the generated summary together with PID/resource/checkpoint evidence before assigning cause.
