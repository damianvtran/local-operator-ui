# The provider chip's login verdict, photographed in the built app

The report (UX round 1, U1, on the chat session-issue PR): at one second, the chat
composer said the Radient sign-in "needs re-authentication" while Settings →
Radient account rendered BOTH "You are not currently signed in to Radient" AND a
green "Signed in" chip under it. The chip was keyed on the credential ROW
(`has_credential || configured`), and a revoked grant keeps its row.

Round 1's reviews found the two ways this change could still lie, and this set is
the proof of both:

- **the refused state was drawn in the never-signed-in vocabulary** (design D1:
  the two cards were pixel-identical, 0 of 4,791,360 pixels apart, with the only
  difference an attribute a screenshot cannot contain), so `after/` and
  `never-signed-in/` are the pair that has to pull apart;
- **the fallback was silent** (design D3, code M1, QA Q-1: with `radient_login`
  absent -- any runtime below `v0.61.2` -- or answered `unknown`, the chip
  returned to the pre-fix claim), so `no-verdict/` and `unknown-verdict/` are the
  two runtime states the fallback arm now answers.

## What produced these frames

**EVERY FRAME HERE WAS RE-SHOT A SECOND TIME**, on the round-2 head and against a
NEWER BACKEND than the first set used. Both halves of that matter:

- the round-1 frames ran backend `bd53de08`, which predates backend `28ad4dae3`.
  That commit is the one that answers a dead grant with the typed refusal
  (`401 radient_credential_refused`, `_credential_refusal`/`REASON_GRANT_INVALID`)
  that the account section has its own sentence for -- so on the old rig a dead
  grant classified as `signed-out`, the section rendered its ordinary
  signed-out sentence, and the frames could not show the state this PR is about.
  These ran backend **`v0.62.18`** (`a628f1464`), the release the code review
  reproduced M2 against.
- the round-1 `healthy/` frames were byte-identical to `before/` (design D9),
  which is what the account section does on a head that never settles: it shows
  the spinner, and a spinner hides the state. The round-2 head settles there.

```
pnpm build            # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
                      # and VITE_DISABLE_BACKEND_MANAGER=true; the rest of the
                      # variables are sourced from the primary checkout's own
                      # .env (gitignored) by the shell, minus the PostHog key
python3 make-driver-r2.py <tree> <tree>/scripts/_chip-driver-r2.mjs
bash state.sh <state>                       # sets the rig state, prints the backend's answers
CHIP_STATE=<state> CHIP_WT=<tree> CHIP_OUT=<tree>/docs/evidence/provider-chip-verdict/<state> \
  CHIP_EXPECT=<verdict> CHIP_CENSUS=<counted|absent> \
  CHIP_WANT_CHIP=<0|1> CHIP_WANT_CONTROL=<0|1> bash run-state.sh
```

`_chip-driver-r2.mjs` is written into the tree under test for one run and deleted
after it: it is that tree's OWN `scripts/renderer-driver.mjs` plus one scene
(`chipverdict`), so it carries the current driver's window-mode, telemetry-off and
mock-keychain guards rather than a stale copy's. It lives in the tree rather than
in the rig because it imports four sibling modules from `scripts/`, and the
round-1 copy papered over that by keeping stale copies of all four on disk beside
it (`ERR_MODULE_NOT_FOUND .../chrome-keychain.mjs` is what a fresh copy in the rig
root does).

The scene reads the section TWICE, four seconds apart, and asserts the two
readings are identical. That is the half of Q-5 a still image cannot carry: the
loop rendered the content for about half a second per iteration, so a single
reading can catch it mid-cycle and look settled. `run-state.sh` prints the other
half from the rig's proxy log -- **how many times the app asked for the account
across one boot**:

| boot | account reads | verdict reads |
| --- | --- | --- |
| `after/`, `healthy/`, `no-verdict/`, `unknown-verdict/` (this head) | **6** | 2 |
| `never-signed-in/` (this head) | **4** | 3 |
| `before/` (main `d1402bbaa`) | 6 | 1 |
| the round-1 head `fe24f1377`, same class of state (QA round 2's own rig, `~/workspace/.../logs/A-head.proxy-routes.txt`) | **54** | 9 |

The rig is the UX round's own (`~/workspace/chipverdict-rig`, runbook in its
README): a fake IdP whose refresh is refused, an isolated backend on 11319, a
blanking proxy on 8080 (the one port besides the operator's 1111 that the
renderer's CSP admits), `HOME`/`LOCAL_OPERATOR_CONFIG_DIR` inside the rig's own
`iso/`, every `CMUX_*`/`LOP_*` variable unset, a scratch `--user-data-dir`, and a
`headless` launch asserted in every run. Every run also asserted that the app held
a connection to the rig's backend and NONE to the operator's own on 1111, and that
no process outlived its boot.

Each state is one `flip.py` write through the product's own `AuthStore` -- plus
`seed.py` first for the four tunnel-enrolled states, because the never-enrolled
states DELETE `tunnel/config.json` and a later state has nothing to restore it
from (measured: `after` reported the no-tunnel answer `{'credential_id': None,
'state': 'unknown'}` until the re-seed was added) -- one flag file where the state
needs one, and one driver run. The state, the backend's own verdict and the
account read it answers are printed by `state.sh` before every boot, and the
scene re-reads the verdict and the census from inside the run and asserts them:

| directory | rig state | `/v1/auth/status` | account read | census row |
| --- | --- | --- | --- | --- |
| `before/` | dead grant, **`origin/main` = `d1402bbaa`** | `login_required`, id 4 | `401 radient_credential_refused` (`grant_invalid`) | `has_credential: true, configured: true` |
| `after/` | dead grant (same state, this head) | `login_required`, id 4 | same | `has_credential: true, configured: true` |
| `healthy/` | fresh grant | `ok`, id 4 | `401 radient_upstream_failed` (`credential_unavailable`) | `has_credential: true, configured: true` |
| `no-verdict/` | dead grant, route stripped | key absent | `401 radient_credential_refused` | `has_credential: true, configured: true` |
| `unknown-verdict/` | dead grant, route forced to `unknown` (QA F2) | `unknown`, id 4 | `401 radient_credential_refused` | `has_credential: true, configured: true` |
| `never-signed-in/` | no row, no tunnel | `unknown`, **`credential_id: null`** | `409 radient_no_credential` | `has_credential: false, configured: false` |

`after/` is the same rig state as `before/`, which is what makes the pair
comparable -- nothing about the command changes between them. Every directory
carries BOTH frames (the Radient account section and the grid card).

**THE FIRST-RUN WIZARD IS ASSERTED ABSENT** (QA round 2, Q-7, and this is the one
line the README owed it). `never-signed-in/` is the state with no connected
provider, so `decideFirstTimeUser` would return `first_time` on a profile whose
onboarding flags are missing and the wizard would cover the grid -- which is what
QA saw. Every round-2 run asserts `[data-onboarding-modal]` is not in the DOM, and
on all six it is not: the flag `--seed-onboarding-complete` writes
(`onboarding-storage`, `isModalComplete: true`) is what makes the app an existing
user, and the frame below is the grid, not a modal over it. The reading is in each
run's log as `the first-run wizard {"up":false}`.

## What the frames show

- `before/` (base): the section says **"Radient refused the sign-in this app is
  holding, so your account details could not be read. Signing in again below
  replaces it."** and the chip beside its own sign-in control is green **"Signed
  in"** -- the contradiction, on the newer backend, in one viewport. The grid's
  Radient card says **"Signed in"** in the success tone.
- `after/` (this head, same state): the chip is **"Needs re-authentication"** in
  the attention tone on the card, in the section beside the control, and the
  section is SETTLED -- the spinner Q-5 measured is gone, and the reading is the
  same four seconds later. This is the frame D7 asked for.
- `healthy/`: the section says **"Your Radient account could not be read, so this
  app cannot show your account details."** (this rig's account read fails upstream
  -- a real Radient API is not reachable from here) and the chip is green
  **"Signed in"**, which is the claim that must survive the new arms: the verdict
  says `ok`, so the chip keeps the credential row's answer. It is also the second
  failure class Q-5 covers -- a read that fails for a reason other than the
  refusal -- settling instead of spinning.
- `no-verdict/`: **"Needs re-authentication"**, attention. A runtime below
  `v0.61.2` sends no `radient_login`, and this app's own account read says Radient
  refused the credential it holds, so the chip may not render the claim the row
  makes. This frame changed meaning in round 2: with the fallback's `refused` arm
  added (QA Q-6) it is no longer the `Needs sign-in` picture it was, and its card
  is now byte-identical to `after/`'s -- one runtime, one answer.
- `unknown-verdict/`: **"Needs sign-in"**, neutral (QA round 1's F2: the row is
  there and the token endpoint cannot be reached, so the app asked and declined to
  confirm). The verdict here NAMES a credential (`id 4`), which is the distinction
  the new null case turns on.
- `never-signed-in/`: **"Needs sign-in"**, neutral, on the grid card (which #436
  pins first under its "Recommended" cue, because the row needs a sign-in), and NO
  chip at all in the account section, which paints one only for a row its own
  census counts -- and the pair with `after/` is the point: the refused machine is
  no longer the same picture as the machine that never signed in. Its verdict is
  the backend's own `{credential_id: null, state: "unknown"}` (no tunnel
  configured), i.e. the null-credential `unknown` shape code round 2's M2 is
  about.

**Two pairs of frames are byte-identical, and both are the finding rather than a
defect** (design D9 was about a pair that was identical and should not have been):

- `healthy/settings-providers-radient-card.png` and
  `before/settings-providers-radient-card.png` are both `900ede61705373f6`: both
  cards say `Signed in` in the success tone, which is the correct reading on a
  fresh grant and the INCORRECT one on the dead grant. The pair differs where it
  must: the account sections are `fb208fc86dc5ec9c` against `c728bad667aecd5b`,
  one sentence apart.
- `no-verdict/settings-providers-radient-card.png` and
  `after/settings-providers-radient-card.png` are both `a43d12339d686159`: the
  fallback arm now reaches the same answer as the verdict's own refusal, because
  the app's account read is the same refusal in both runtimes. That identity is
  Q-6's remedy, not a re-shoot that failed.

Every frame's hash in one table, so the next round can tell which moved:
`after/` `096ee131ae009c1f` (section) / `a43d12339d686159` (card); `healthy/`
`fb208fc86dc5ec9c` / `900ede61705373f6`; `no-verdict/` `a1a054d08bdedf34` /
`a43d12339d686159`; `unknown-verdict/` `664cad9d12d7f052` / `8d44dadc605e8b84`;
`never-signed-in/` `e2f7c1449d685a2b` / `c5542203b40b8702`; `before/`
`c728bad667aecd5b` / `900ede61705373f6`.

## The floor this set does NOT claim

- **The `unknown`-with-no-credential state is asserted, not photographed.** Code
  round 2's M2 is a machine that is signed IN with a working account read and has
  never made a tunnel (`{credential_id: null, state: "unknown"}` +
  `accountRead: ready`), which this rig cannot produce: its "account" is a fake
  IdP, so the account read fails upstream in every state above. That case is
  asserted in `scripts/provider-chip-verdict.test.mjs` (both the unit reading and
  the rendered grid), and the rig's own null-credential `unknown` is photographed
  in `never-signed-in/` and is reachable in any shape by `flip.py healthy` plus
  deleting `tunnel/config.json`.
- **The loop itself is not in these frames.** They are pictures of the FIXED head,
  so the once-a-second account read that Q-5 measured is absent by construction.
  The defect is measured where it can be: QA's rig on the round-1 head (54 account
  reads in one boot, above), design's rig (39 in 30 s against 4 on `main`), and
  the composition case in `scripts/provider-chip-verdict.test.mjs`, which fails on
  the pre-fix `provider-detail.tsx` with `the section re-read the account 3 times
  while idle`.
- On a runtime below `v0.61.2` whose account read cannot be taken either
  (`unavailable`), the chip still renders the credential row's own answer -- there
  is no fact left on that machine that contradicts it. The PR body states that
  floor in its Impact section; the release notes must not imply more than ships.
- The `title` tooltip is not in these frames by construction: a native `title` is
  drawn by the OS outside the web contents, so `capturePage()` cannot contain it.
  The DOM readings that carry it are recorded beside each frame in the run logs and
  asserted in `scripts/provider-chip-verdict.test.mjs` (`Needs re-authentication`
  with the refused long form on a counted row, and no long form on a row the census
  does not count).

## The heads this set sits on

`before/` is `origin/main` = `d1402bbaa` (0.30.23), built in its own worktree. The
round-2 head was folded onto that main with a merge commit (`ca009d677`) BEFORE
these frames were taken, so every other directory is the same tree the round's
fixes ship in. The branch was folded a second time afterwards (`babf80e3c`, onto
`origin/main` = `65c325afe`: 0.30.24 plus #448's sidebar agent-opened marker),
because a head that is DIRTY against a moved main gets no CI at all here.

NEITHER FOLD CHANGES WHAT THESE FRAMES RENDER, which is the check that matters
once a frame's `before/` base and its head are a merge apart. Both folds' only
conflict was `docs/evidence/manifest.json`; no `src/` or `scripts/` file
conflicted in either, and the second fold's window moves `chat-search.ts`,
`chat-sidebar.tsx`, `palette-search.ts`, `canonical-sessions-store.ts` and
`desktop-session-contract.ts` -- none of them the providers feature, the Radient
hooks or the settings sections photographed here.
