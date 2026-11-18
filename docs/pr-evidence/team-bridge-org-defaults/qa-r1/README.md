# PR #1970 — QA round 1 live-app frames

Head under test: `69f4fa0d541a39fc83fbc5f85fe04c2d6c3a2c33` (worktree `.worktrees/tb-org-defaults`, clean tree).
Build: `node_modules/.bin/electron-vite build` with the four inert `VITE_*` placeholders from
`scripts/team-bridge-instant-load.mjs`'s recipe; compiled renderer contains `lo.teamBridge.sessionScope.v1`.

## What ran

The **built app** (`out/main/index.js`, absolute path) under Electron, `--window-mode=headless`
named, scratch `HOME` / `LOCAL_OPERATOR_CONFIG_DIR` / `--user-data-dir`, `--use-mock-keychain`,
`LOCAL_OPERATOR_UI_TELEMETRY=off`, `VITE_DISABLE_BACKEND_MANAGER=true`, `CMUX_*` stripped.
It dials a **stub daemon** (`harness/rig.mjs`, modelled on `scripts/team-bridge-bench.mjs`:
record discovery + claim + desktop routes). Every launch was reaped with
`scripts/app-tree-teardown.mjs` `stopAppTree` (group signal + profile reap) and `kill -0 <pid>` failing
— all 28 launches `clean=true`, none escalated, none re-parented.

**Not the operator's real account.** The documented rigs refuse the operator's daemon (port 1111)
and there is no read-only real-account session; every row below is FIXTURE, none LIVE.

Fixture: one account in two private orgs, **Pergamon Labs listed first**, **Minerva `is_home`**;
unread Minerva 3 / Pergamon 2; `memberships.list` answered after 1.5 s (`flash*`, `run2`) or
6–9 s (`hold*`). Frames: in-app capture only (CDP `Page.captureScreenshot` for settled frames,
`Page.startScreencast` everyNthFrame=1 for consecutive paint frames; file names carry ms from the
hash change to `#/team-bridge`). `timelines.json` = DOM scope sequence (MutationObserver + rAF),
painted-frame times and stub-observed `POST …/read` per open.

## Frames

| file | row | what it shows |
| --- | --- | --- |
| `R1-cold-nohold-f1-+28ms-all-organizations.png` → `f2-+68ms-minerva` | 1 | fresh profile, memberships already cached by the shell: merged **All organizations** painted, then Minerva |
| `R1-cold-hold-f1…f3` | 1 | fresh profile, memberships pending: spinner → **All organizations** painted at hold release → Minerva |
| `R3-restart-nohold-f1-+60ms-pergamon.png` → `f2-+76ms` → `f3-+93ms-stale-thread` | 3 | restart, durable pick Pergamon: **Pergamon Labs + pergamon-research** painted, then Minerva over "This conversation is not open to you" for ~50 ms |
| `R3-restart-hold-f1…f3` | 3 | restart, memberships pending: spinner → **Pergamon Labs** painted at hold release → Minerva |
| `R3-restart-settled-minerva.png` | 3 | settled state after restart |
| `R2-1…R2-3` | 2 | pick Pergamon → leave to Chat → back: Pergamon kept |
| `R4-menu-open.png`, `R4-all-organizations.png` | 4 | All 5 = Pergamon 2 + Minerva 3; merged list = the two private orgs only |
| `R5-ineligible-plan-panel.png`, `R5-ineligible-memberships-pending-plan-panel.png` | 5 | two-org surface-A account: plan panel, not the gate spinner |

`harness/rig.mjs` (rows 2–5) and `harness/flash.mjs` (paint-level repeats) are the scratch rigs,
kept for re-running: `RIG_SCRATCH=<dir> [MEMBERSHIP_DELAY_MS=…] node harness/flash.mjs`
(they import the repo's `scripts/app-tree-teardown.mjs` / `chrome-keychain.mjs` by absolute path; edit `ROOT`).
