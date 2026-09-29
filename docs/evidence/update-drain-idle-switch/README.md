# Update drain → idle switch: the press stops waiting on turns

The operator's directive (2026-09-29, verbatim): *"we don't need to wait for all
sessions to drain and turn over, once the daemon, relays, all the central
components roll over, then we just allow all sessions to idle and on idle they
should switch over (without emitting errors). Thus, we can just communicate in
the popup that N sessions are still running old versions but will get the updates
when they next stop or idle"*.

The press it follows was a dead end: the operator's own `update-service.log`
(`operator-press-excerpt.txt`) shows the app waiting out its full budget and then
refusing — `Refusing to restart: the fleet did not drain in 602562ms (busy, 21
mid-turn ...)` at 09:42:58 — on the busy machine the update was wanted on.

## What this pass changes

- **The two RESTART legs no longer wait on the fleet.** A daemon bounce cuts no
  turns — session runtimes are detached processes that converge onto the new
  build at their own next idle — so the fleet-drain call and its refusal
  plumbing came out of the global restart leg (`update-service.ts`) and the
  app-owned managed restart leg. The supersession is narrated in the comments
  where the old policy rationale lived, with the directive as the reason.
- **The REBUILD route's install leg keeps its drain** (the variant-B scope
  decision): that leg rewrites a tree a live runtime is reading, so a turn
  running while it works can still be interrupted; the fleet-drain module, its
  budget and its refusal sentence stay for it. The now-unreachable
  after-a-landed-install refusal arm (heading and sentence) was removed with its
  fixtures and story.
- **The completion now carries `sessionsOnOldBuild: number | null`** — sampled
  from the re-engage result's `stillResident` at the same moment the re-engage
  already ends. `null` means "not measured" and is never rendered as a zero.
- **The popup says the rest**: the success notice gains a second line — "N
  sessions are still running the old build; they will move onto the new build
  when they next stop or go idle" — with the numberless arm for an unmeasured
  count, and the toast holds 8 s on the arms that carry it (6 s at N = 0).
- **Copy**: the managed offer's cost sentence and the fallback sentence no
  longer price a wait and now name the idle switch; the restarting sentence
  states that the turns kept running; the restart-cost sentence (skew panel and
  restart phase) drops the drain bound. The draining sentence is unchanged (the
  rebuild route still reaches it) and stays bound to the gate's budget by
  `scripts/update-fleet-drain.test.mjs`.

## Evidence in this directory

| File | What it is |
| --- | --- |
| [operator-press-excerpt.txt](operator-press-excerpt.txt) | The operator's own log around the reported press: 602 s of waiting, then the refusal. |
| [repro-before-scoped.txt](repro-before-scoped.txt) | The fleet-gate cases at `origin/main` = `654c58f5f6`, before the change: 20/20 pass — including "a press that cannot drain does not restart the server, and says why" and the through-the-drain generation press, which this pass rewrites. |
| [repro-before-fleet-drain-unit.txt](repro-before-fleet-drain-unit.txt) | `node --test scripts/update-fleet-drain.test.mjs` at the same head: 30/30. |
| [after-robustness.txt](after-robustness.txt) | The full `scripts/update-robustness.test.mjs` after the change: 186 tests, 185 pass, 1 fail — the one failure is the machine-state case explained below, not this diff. |
| [after-fleet-drain-unit.txt](after-fleet-drain-unit.txt) | `scripts/update-fleet-drain.test.mjs` after the change: 30/30 (the refusal-copy and budget-copy couplings rewritten for the single remaining arm). |
| [after-supporting-suites.txt](after-supporting-suites.txt) | `update-install-copy`, `update-affirmation`, `preload-updater-surface`, `update-global-install`: 68/68. |
| [after-capture-evidence-unit.txt](after-capture-evidence-unit.txt) | `scripts/capture-evidence.test.mjs`: 13/13 (the new STORIES rows are declared with their claims). |
| [after-lint.txt](after-lint.txt) / [after-lint-scripts.txt](after-lint-scripts.txt) / [after-typecheck.txt](after-typecheck.txt) | The lint and type gates, run on the change. |
| [classification-test-environment.txt](classification-test-environment.txt) | The proof that the one robustness failure is environmental: the same test fails identically with this branch's `src/`+`scripts/` stashed at `origin/main` = `654c58f5f6`. `"/usr/bin/which local-operator"` on this machine now resolves through the `lop` generation layout (`~/.local/share/lop/generations/...`), so the test's hand-built identity no longer contains the `"/uv/tools/"` marker it classified by. Pre-existing machine state; a fix belongs to that test, not to this diff. |

What the changed journeys pin (all in `scripts/update-robustness.test.mjs`):

- "a press on a busy fleet proceeds, and the turns are never consulted" — the
  operator's own machine shape: no draining phase, no refusal, `servingWorkState`
  read zero times, the restart happens, the completion carries a count.
- "the completion counts the sessions still on the old build" (N = 2) and "an
  unreadable fleet is reported as unmeasured, never as a zero" (`null`).
- "the move re-engages the sessions it displaced, and only those" — now also
  asserts the count (1) matches `stillResident`.
- "the rebuild route still waits for the fleet, and refuses on a busy one" —
  drives the surviving gate end to end: a synthetic uv-tool source-build serving
  install, a shim `lop-update` on `PATH` for the duration, a busy fleet, and the
  refusal that names it with nothing run and nothing installed.
- "a press with nothing left to install still moves the daemon, and never
  waits" — a measured zero rides the completion (no second line).

## What the design round must capture (frames are owed)

No committed frame exists yet for the states this pass adds, and three existing
frames are stale against the new copy. The stories are declared in
`scripts/capture-evidence.mjs` with the claims they must carry:

1. `common-updatenotification--backend-update-completed` (new; N = 0) —
   claim "Server update completed successfully".
2. `common-updatenotification--backend-update-completed-one-session` (new;
   N = 1).
3. `common-updatenotification--backend-update-completed-sessions-behind` (new;
   N = 3).
4. `common-updatenotification--backend-update-completed-count-unreadable` (new;
   the numberless line).
5. `common-updatenotification--backend-update-restarting` (re-shoot) — the
   sentence now says the turns kept running.
6. `common-updatenotification--server-behind-app-owned` (re-shoot) — the cost
   sentence dropped the drain bound and now ends on the idle switch.
7. `common-updatenotification--backend-update-offer-source-build` (re-shoot,
   only if the rendered string moves; S3 is unchanged on this branch).

**The toast timer** (called out for the capturer): the completion toast
self-closes — 6 s, or 8 s on the three arms that carry the second line — so a
shutter that waits on the wrong cue lands on a frame with no toast in it.

The rendered-target gates (`dom_audit.mjs` on the Storybook build,
`contrast_pairs.py` on the theme pairs) and the before/after pairs for the
re-shot states are the design round's to run and attach, per the design-qa
skill; the committed frames land under
`docs/evidence/common-updatenotification/<story-id>/`.
