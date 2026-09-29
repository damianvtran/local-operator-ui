# The sessionless slash rows (issue #625) — five commands on a new chat

On a pane with **no conversation**, `/help`, `/theme`, `/login`, `/logout` and
`/resume` used to refuse with the dispatcher's own sentence ("…needs an open
conversation. Start one first.") — although none of the five reads the
conversation it was typed on. The head tree presents each row's own picker
instead. Five picker rows is the triage comment's scope, not the report's
headline; the design record is `docs/design/panels-without-session.md` § 15.

## The rig

    node scripts/renderer-driver.mjs --scene sessionless-slash \
      --slash-expect open --theme localOperatorDark \
      --backend http://127.0.0.1:8080 \
      --backend-records <daemon config>/run/serve \
      --seed-onboarding-complete --out <dir>

One theme per launch (the `--theme` doctrine), so the scene ran once per
palette. `--slash-expect open` names this half's claim; the base tree's half
runs the SAME scene bytes with `--slash-expect refused` — the pair is only
readable if the same code drove both. Each run stages a real new chat (`⌘N`,
the press `--scene new-chat` proves), types the command with
`Input.insertText`, and drives Enter through Chromium's own input pipeline,
against a scratch daemon this pass started on `127.0.0.1:8080` (its config
seeded with the hosting values before the daemon started; throwaway profile and
config, headless window mode, and the scene's own facts checks assert the
window was never shown or focused).

**`/theme` takes a short press sequence, and the run asserts each step.** Its
first Enter COMPLETES the value (`/theme localOperatorDark`) and leaves the
popup open — that is the row's inline-list behaviour, not a defect — so the
scene closes the popup with Escape (the box keeps the completed value) and
submits it with the next Enter; the checks record which press produced each
state, and every command's box is asserted EMPTY before the next gesture is
typed. This was measured the hard way: the first take of this scene typed
`/theme` + one Enter, read "no dialog" while the popup sat open, and every
later gesture in that run was one gesture late (3 checks failed; the re-take
after the fix is the one committed here).

The `.webp` files are `cwebp -q 90` conversions of the runs' `.png`s,
un-resized — 2760x1800, the 1380x900 CSS viewport at dpr 2 on Electron 44.3.0 —
and the raw logs sit beside the frames.

## What each frame is

| State | Gesture | What it shows |
| --- | --- | --- |
| `help/` | `/help` + Enter | the Commands palette — the catalogue IS the read |
| `theme/` | `/theme` + Enter (complete/close/submit) | the Theme picker (the row § 12.5 measured) |
| `login/` | `/login` + Enter | "Sign in to a provider", its provider list loaded |
| `logout/` | `/logout` + Enter | "Sign out" |
| `resume/` | `/resume` + Enter | "Resume a conversation" — on a fresh daemon the list is empty; the MOUNT is the claim |
| `theme-live/` | a message sent and answered first, then `/theme` + Enter | the same picker on a live conversation ("Hello from the mock provider") — the session-ful path the change must not move |

Each frame's partner is the same gesture on `origin/main` @ `ff34fb8ecc` under
`../sessionless-slash-baseline/` — the refusal sentence, no picker.

## The runs' own records

`after-dark-run.log` and `after-light-run.log` are the raw logs: **42 PASS /
0 FAIL each** (`ALL CHECKS PASSED`). Every command's checks record what the
gesture produced (the picker title it read, or the refusal sentence), that its
composer box was empty first, each picker closes on Escape and is asserted gone
before the next gesture, and the live half asserts the mock provider's answer
arrived and the pane addresses a real session before `/theme` re-opens the
picker. The palette is asserted on every frame — the run refuses a frame whose
pixels do not match the palette its filename claims.

## Isolation

The pass owned its daemon (scratch `LOCAL_OPERATOR_CONFIG_DIR`/`HOME` under the
session's own scratchpad, reaped by exact pid when the pass ended), its profile
(`--user-data-dir` under the driver's scratch tree, `--use-mock-keychain` on
the launch, removed by `--clean`), and its port (checked free, and only this
pass's daemon ever bound it). The driver's own probes assert the app held a
connection to THIS run's backend and none to the operator's own.
