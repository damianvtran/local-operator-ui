# PR #1970 — QA round 2 (rows 1 and 3, Q1/Q2 retest) + code round 4 StrictMode repro

Head under test: `faf462107662168d06a825566af7fce8cdc9c835` (worktree `.worktrees/tb-org-defaults`, clean tree).
Build: `node_modules/.bin/electron-vite build` at that head (exit 0, 22 s) with the four inert `VITE_*`
placeholders (`evidence-build-only-not-a-credential`).

## What ran

QA round 1's `harness/flash.mjs` (from `701dde9a`), unchanged except one filter: with `RELEASE_WINDOW=1`
it keeps only the opening frames (≤ +300 ms) and the frames from −200 to +500 ms around the hold release,
instead of 9 s of spinner. Built app, `--window-mode=headless`, scratch HOME/config/profile,
`--use-mock-keychain`, telemetry off, backend manager off, stub daemon. Same fixture as round 1:
Pergamon Labs listed first, Minerva `is_home`, unread Minerva 3 / Pergamon 2. Seed step: after `cold0` the
rig picks Pergamon Labs, so every restart boots with durable = Pergamon and session = empty.

    RIG_SCRATCH=<dir> MEMBERSHIP_DELAY_MS=1500 RESTARTS=10 COLDS=10 node harness/flash.mjs
    RELEASE_WINDOW=1 RIG_SCRATCH=<dir> MEMBERSHIP_DELAY_MS=6000 WINDOW_MS=9000 SAVE_MS=9000 RESTARTS=10 COLDS=10 node harness/flash.mjs

42 opens (11 fresh-profile + 10 restart per run). 42 launches, every one reaped by
`scripts/app-tree-teardown.mjs` `stopAppTree`: `clean=true`, 0 escalated, 0 reaped stragglers,
`kill -0` fails for every pid, `allClean=true` in both runs. An earlier 6000 ms attempt was aborted
(scratch volume cap) after 1 launch; its rig and app group were killed by pid and confirmed gone, and the
CSP widening it left in `out/renderer/index.html` was restored by the next run (verified: shipped list).

`timelines.json` = per open: boot storage, DOM scope sequence (MutationObserver + rAF), and every
`POST …/read` the stub received inside that open's window.

## Frames

| file | row | shows |
| --- | --- | --- |
| `R1-nohold-cold1-f1-+33ms…` → `f2-+84ms` | 1 | fresh profile, memberships cached: first painted frame is Minerva (rail: minerva-general, minerva-eng) |
| `R1-hold-cold1-f1-+3230ms-spinner` → `f2-+3240ms` → `f3-+3272ms` | 1 | memberships pending: gate spinner → Minerva at release → minerva-general |
| `R3-nohold-restart1-f1-+38ms…`, `f7-+189ms` | 3 | restart (durable = Pergamon): first painted frame is Minerva › minerva-general |
| `R3-hold-restart2-f1-+3298ms-spinner` → `f2-+3306ms` → `f3-+3339ms` | 3 | restart, hold running: spinner → Minerva › minerva-general, no Pergamon frame |

## strictmode-repro/ (code review round 4, R4-1)

`restore.test.mjs` + `fixture-strictmode.patch` (wraps the fixture's root in `React.StrictMode` when
`STRICT=1`, as `src/renderer/src/main.tsx` does). Run from the worktree root with the test beside a
patched copy of `scripts/fixtures/team-bridge-auth-owner-page.mjs` in `./fixtures/`. `run-output.txt`
holds both runs: without StrictMode everything passes; with it, the hold-lift path commits the seed scope
and loses the decided scope's remembered conversation.
