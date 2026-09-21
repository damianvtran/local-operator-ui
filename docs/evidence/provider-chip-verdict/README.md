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

```
pnpm build            # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18080
                      # and VITE_DISABLE_BACKEND_MANAGER=true; the rest of the
                      # variables come from a copy of the repository's own .env
                      # (gitignored), minus the PostHog key, with the client
                      # secret left exactly where check-build-env allows it
node ~/workspace/chipverdict-rig/chip-driver.mjs --scene chipverdict \
  --backend http://127.0.0.1:18080 --backend-records <rig>/records \
  --seed-onboarding-complete --window-size 1380x900 --clean --out <dir>
```

The rig itself (`~/workspace/chipverdict-rig`, runbook in its README) is the UX
round's own: a fake IdP whose refresh is refused, an isolated backend on 11319, a
blanking proxy in front of it, `HOME`/`LOCAL_OPERATOR_CONFIG_DIR` inside the
rig's own `iso/`, a scratch `--user-data-dir`, and a `headless` launch asserted in
every run that produced a frame. **Its proxy moved to 18080 for this round**: a
foreign `lop serve` on 8080 made the first attempt drive an app against somebody
else's service, which the run's own "the app holds a connection to this run's
backend" check caught.

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
| `before/` | dead grant, **`origin/main` = `8d758d238`** | `login_required` | `has_credential: true, configured: true` |

`before/` is the base tree and is unchanged from the first round; everything else
is this head. `after/` is the same rig state as `before/`, which is what makes
the pair comparable -- nothing about the command changes between them.

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
- `never-signed-in/`: **"Needs sign-in"**, neutral -- and the pair with `after/`
  is the point: the refused machine is no longer the same picture as the machine
  that never signed in.

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

The branch was folded onto `origin/main` = `03ef5f480` after the reviews, and the
frames above were taken on the pre-fold head. That is stated rather than implied:
`git range-diff 8d758d238..3c91c7b5f 03ef5f480..HEAD` shows this branch's three
commits unchanged (`=`, `!`, `=`), the `!` being the manifest restamp itself, and
`git diff 3c91c7b5f HEAD -- src/renderer/src/features/providers
src/shared/api/local-operator/desktop-hooks.ts src/shared/api/local-operator/desktop-api.ts
src/shared/desktop-contract.ts src/renderer/src/shared/hooks/use-radient-user-query.ts
docs/evidence/provider-chip-verdict` is EMPTY -- every input the frames render is
byte-identical, and upstream's two moved files are main-process daemon attach
(`src/main/backend/backend-service.ts`, `daemon-status.ts`). The stamps in
`docs/evidence/manifest.json` are re-derived for this head, as its guard requires.

**One later commit inside this round** moved the verdict's pending gate BELOW the
census's error branch (`provider-grid.tsx`), because a verdict read that never
answers must not be able to hide the census's diagnosis and its Retry -- the
neighbour suite `scripts/backend-error-surfaces.test.mjs` caught exactly that.
That changes only the pending and error frames; every frame here is a settled
state, so none of them is affected, and the ordering is asserted by that suite.
