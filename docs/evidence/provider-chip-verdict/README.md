# The provider chip's login verdict, photographed in the built app

The report (UX round 1, U1, on the chat session-issue PR): at one second, the chat
composer said the Radient sign-in "needs re-authentication" while Settings →
Radient account rendered BOTH "You are not currently signed in to Radient" AND a
green "Signed in" chip under it. The chip was keyed on the credential ROW
(`has_credential || configured`), and a revoked grant keeps its row.

Round 1 of the reviews then found the two ways this change could still lie, and
this set is the proof of both:

- **the refused state was drawn in the never-signed-in vocabulary** (design D1:
  the two cards were pixel-identical, 0 of 4,791,360 pixels apart, with the only
  difference an attribute a screenshot cannot contain), so `after/` and
  `never-signed-in/` are the pair that has to pull apart;
- **the fallback was silent** (design D3, code M1, QA Q-1: with `radient_login`
  absent -- any runtime below `v0.61.2` -- or answered `unknown`, the chip
  returned to the pre-fix claim), so `no-verdict/` and `unknown-verdict/` are the
  two runtime states the fallback arm now answers.

## What produced these frames

Every frame here was RE-SHOT on the fold onto `origin/main` (the merge commit `33ee9d68b`, onto
`0cd1202e1`): #436 reworked the provider grid, so every earlier
frame was a picture of a grid that no longer ships.

```
pnpm build            # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
                      # and VITE_DISABLE_BACKEND_MANAGER=true; the rest of the
                      # variables are sourced from the primary checkout's own
                      # .env (gitignored) by the shell, minus the PostHog key
node scripts/_chip-driver.mjs --scene chipverdict \
  --backend http://127.0.0.1:8080 --backend-records <rig>/records \
  --seed-onboarding-complete --window-size 1380x900 --clean --out <dir>
```

`_chip-driver.mjs` is written into the tree under test for one run and deleted
after it: it is that tree's OWN `scripts/renderer-driver.mjs` plus one scene
(`chipverdict`: navigate to `/settings`, press the `Radient account` nav row,
read that section, then scroll the grid to the Radient card), so it carries the
current driver's window-mode, telemetry-off and mock-keychain guards rather than
a stale copy's. The scene's badge reading knows the `attention` tone and the
`Needs re-authentication` label.

The rig is the UX round's own (`~/workspace/chipverdict-rig`, runbook in its
README): a fake IdP whose refresh is refused, an isolated backend on 11319 at the
backend's `bd53de08`, a blanking proxy on 8080 (the one port besides the
operator's 1111 that the renderer's CSP admits), `HOME`/`LOCAL_OPERATOR_CONFIG_DIR`
inside the rig's own `iso/`, every `CMUX_*`/`LOP_*` variable unset, a scratch
`--user-data-dir`, and a `headless` launch asserted in every run. Every run also
asserted that the app held a connection to the rig's backend and NONE to the
operator's own on 1111, and that no process outlived its boot.

Each state is one `flip.py` write through the product's own `AuthStore`, plus one
proxy flag file (`strip.flag` answers `/v1/auth/status` with no `radient_login` at
all; `unknown.flag` answers `state: "unknown"`), then one driver run:

| directory | rig state | `/v1/auth/status` | census row |
| --- | --- | --- | --- |
| `after/` | dead grant (expired access, refused refresh) | `login_required` | `has_credential: true, configured: true` |
| `healthy/` | fresh grant | `ok` | `has_credential: true, configured: true` |
| `no-verdict/` | dead grant, route stripped | key absent | `has_credential: true, configured: true` |
| `unknown-verdict/` | dead grant, route forced to `unknown` (QA F2) | `unknown` | `has_credential: true, configured: true` |
| `never-signed-in/` | no row, no tunnel | `unknown` | `has_credential: false, configured: false` |
| `before/` | dead grant, **`origin/main` = `74c7daea6`** (0.30.22) | `login_required` | `has_credential: true, configured: true` |

`after/` is the same rig state as `before/`, which is what makes the pair
comparable -- nothing about the command changes between them. Every directory now
carries BOTH frames (the Radient account section and the grid card).

The frames were taken while `origin/main` was `74c7daea6`; it moved to `0cd1202e1`
(0.30.23 and #484's chat read receipts) before the push, and the fold was redone
onto that. `git diff 74c7daea6 0cd1202e1` touches none of the providers feature,
`use-radient-session-issue.ts`, `use-radient-user-query.ts` or the settings
sections these frames render, so every frame is still a picture of this head.

## What the frames show

- `before/` (base): the section says "You are not currently signed in to Radient"
  and the chip under it is green **"Signed in"**; the grid's Radient card says
  **"Signed in"** in the success tone.
- `after/` (this head, same state): the chip is **"Needs re-authentication"** in
  the attention tone on the card, and the section's chip says the same words --
  one vocabulary for one condition, and the green claim is gone.
- `healthy/`: **"Signed in"**, success -- unchanged, because the verdict says
  `ok`. This is the control that keeps the new arms from misdirecting a machine
  whose login is fine.
- `no-verdict/`: **"Needs sign-in"**, neutral. A runtime below `v0.61.2` sends no
  `radient_login`, and the chip may not read the credential row as a working
  sign-in when this app's own account read says none is stored.
- `unknown-verdict/`: **"Needs sign-in"**, neutral (QA round 1's F2: the row is
  there and the token endpoint cannot be reached).
- `never-signed-in/`: **"Needs sign-in"**, neutral, on the grid card (which #436
  now pins first under its "Recommended" cue, because the row needs a sign-in),
  and NO chip at all in the account section, which renders one only for a stored
  row -- and the pair with `after/` is the point: the refused machine is no longer
  the same picture as the machine that never signed in.

## The floor this set does NOT claim

On a runtime below `v0.61.2` whose account read cannot be taken either
(`unavailable`), the chip still renders the credential row's own answer -- there
is no fact left on that machine that contradicts it. The PR body states that
floor in its Impact section; the release notes must not imply more than ships.

The `title` tooltip is not in these frames by construction: a native `title` is
drawn by the OS outside the web contents, so `capturePage()` cannot contain it.
The DOM readings that carry it (`Needs re-authentication`, and the long form on
the contradicted row only) are asserted in `scripts/provider-chip-verdict.test.mjs`.

## The fold this head sits on

The branch was folded onto `origin/main` = `0cd1202e1` by a merge commit
(`33ee9d68b`), and that fold changed where the verdict comes from: #416 had
landed its own read of `GET /v1/auth/status` for the composer's callout, so this
branch's duplicate type, query key and hook were removed and the chip now reads
`useRadientLoginVerdict()` from `use-radient-session-issue.ts` -- the callout's
own cache entry, behind #416's `tunnel` capability gate. The rig's backend
advertises `tunnel`, so every frame here went through that shared read; the
no-capability floor is asserted in `scripts/provider-chip-verdict.test.mjs`.

The verdict's pending gate sits BELOW the census's error branch
(`provider-grid.tsx`), because a verdict read that never answers must not be able
to hide the census's diagnosis and its Retry. That changes only pending and
error frames; every frame here is a settled state, and the ordering is asserted
by `scripts/backend-error-surfaces.test.mjs`.
