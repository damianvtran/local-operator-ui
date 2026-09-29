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

## What the design round captured (frames committed)

The owed frames are committed under `docs/evidence/common-updatenotification/`, one
directory per state, twelve sweep themes each; every file is gated at the shutter by the
`expectSentence` claims its entry declares — a claim that stops matching fails the capture,
so no frame here can stand as evidence for another state:

1. `common-updatenotification/backend-update-completed/` (N = 0) — claim "Server update
   completed successfully".
2. `common-updatenotification/backend-update-completed-one-session/` (N = 1).
3. `common-updatenotification/backend-update-completed-sessions-behind/` (N = 3).
4. `common-updatenotification/backend-update-completed-count-unreadable/` (the numberless
   line).
5. `common-updatenotification/backend-update-restarting/` (re-shoot) — the sentence now
   says the turns kept running.
6. `common-updatenotification/server-behind-app-owned/` (re-shoot) — the cost sentence
   dropped the drain bound and now ends on the idle switch.
7. `common-updatenotification/backend-update-offer-source-build/` — NOT re-shot: S3 is
   unchanged on this branch.
8. `common-updatenotification/backend-update-offer-app-owned/` (new) — the app-owned
   managed offer's cost sentence (S1), declared after the round-1 review found neither
   frame nor declaration anywhere for it (UX U2).

**The refusal pair** (UX U1): `common-updatenotification/backend-update-refused-busy-fleet/`
and `common-updatenotification/backend-update-refused-unreadable-fleet/` — the two arms the
rebuild install leg still reaches, shot with both entries' claims pinning `lop-update`, so
neither frame can show a command the producer cannot emit. The long-standing debt for these
two states is paid here; the **draining** state's frames remain owed (its state is
unchanged by this pass and no frame was shot for it here).

**Before halves, at the base commit** (design review round 1, D2): both re-shoots ship
their before half as a declared supplementary set —
`common-updatenotification/backend-update-restarting-before/` and
`common-updatenotification/server-behind-app-owned-before/` — the same story, fixture and
digits on the merge-base `a0cdaa759f`, twelve themes each, so each pair differs in the
sentence alone (measured; each set carries its own README with its capture recipe).

**The rendered-target gates at the capture head** (design review round 2):
`dom_audit.mjs` on the local Storybook build, four runs — the offer (1280 and 800) and both
re-shoots — finds only the documented page-level `text-clipped` (scroll 1280x916 vs client
1280x900; this story file's own declared+16 convention, identical at 800) and the shared
28px-tall button `target-size` advisory (touch-only advice); no finding touches the card.
`contrast_pairs.py`: ink on success-wash, ink on elevated and ink-muted on elevated for the
twelve sweep themes — 36 pairs, 0 below AA 4.5 (tightest 5.98:1, dracula
ink-muted/elevated).
