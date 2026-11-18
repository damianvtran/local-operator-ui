# PR #1970 — QA round 3 (rows 1 and 3, Q1/Q2 retest at `c31ce6bb`)

Head under test: `c31ce6bb696122171a867fb5818607f406d04b41` (worktree `.worktrees/tb-org-defaults`, clean tree).
Build: `node_modules/.bin/electron-vite build` at that head (exit 0, 23 s) with the four inert `VITE_*`
placeholders (`evidence-build-only-not-a-credential`).

## What ran

QA round 2's `harness/flash.mjs`, byte-identical (`diff -q` clean). Same fixture: Pergamon Labs listed first,
Minerva `is_home`, unread Minerva 3 / Pergamon 2; after `cold0` the rig picks Pergamon Labs, so every
restart boots with durable = Pergamon and session = empty. Built app, `--window-mode=headless`, scratch
HOME/config/profile, `--use-mock-keychain`, telemetry off, backend manager off, stub daemon. One rig at a time.

    RIG_SCRATCH=<dir> MEMBERSHIP_DELAY_MS=1500 RESTARTS=10 COLDS=10 node harness/flash.mjs                 # memberships cached
    RELEASE_WINDOW=1 RIG_SCRATCH=<dir> MEMBERSHIP_DELAY_MS=6000 WINDOW_MS=9000 SAVE_MS=9000 RESTARTS=10 COLDS=10 node harness/flash.mjs   # held
    python3 harness/analyze.py run1500 1500; python3 harness/analyze.py run6000 9000

`analyze.py` (new) turns each run's `flash.json` into `timelines.json`. Per open it keeps the switcher-title
sequence (MutationObserver + rAF), any state whose rail rows contain a Pergamon channel, and every
`POST …/read` inside that open's window. `ok` means the only title ever painted is `Organization: Minerva`,
no Pergamon row ever painted, and no `c_qaperg…` read POST. The window is the open's `WINDOW_MS`. That keeps
the rig's deliberate seed pick of Pergamon after `cold0` (+1839 ms) out of `cold0`.

## Result — 42 opens, 42 ok

| run | opens | ok | first title painted (ms after nav) | read POSTs | non-default read POSTs | teardown |
| --- | --- | --- | --- | --- | --- | --- |
| 1500 (cached) | 21 (11 fresh + 10 restart) | 21 | 22–60, always Minerva | 21, all `c_qamine…01`, +82–118 | 0 | 21/21 clean, 0 escalated |
| 6000 (held) | 21 (11 fresh + 10 restart) | 21 | 3088–3288 (after the gate spinner), always Minerva | 21, all `c_qamine…01`, +3168–3350 | 0 | 21/21 clean, 2 escalated to SIGKILL, `kill -0` fails for all |

No read POST came before the first painted title in any open.

## Frames

| file | row | shows |
| --- | --- | --- |
| `R1-nohold-cold1-f1-+33ms…` → `f2-+116ms` | 1 | fresh profile, memberships cached: first painted frame is Minerva, then minerva-general |
| `R1-hold-cold1-f1-+3266ms-spinner` → `f2-+3286ms` → `f3-+3332ms` | 1 | memberships pending: gate spinner → Minerva at release → minerva-general |
| `R3-nohold-restart1-f1-+44ms…`, `f8-+186ms` | 3 | restart (durable = Pergamon): first painted frame is Minerva › minerva-general |
| `R3-hold-restart2-f1-+3288ms-spinner` → `f2-+3309ms` → `f3-+3397ms` | 3 | restart, hold running: spinner → Minerva › minerva-general, no Pergamon frame |

Frame timestamps come from CDP screencast metadata. They trail the DOM recorder by roughly 20–40 ms.
