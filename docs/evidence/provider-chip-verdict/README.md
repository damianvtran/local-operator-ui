# The provider chip's login verdict, photographed in the built app

The report (UX round 1, U1, on the chat session-issue PR): at one second, the chat
composer said the Radient sign-in "needs re-authentication" while Settings →
Radient account rendered BOTH "You are not currently signed in to Radient" AND a
green "Signed in" chip under it. The chip was keyed on the credential ROW
(`has_credential || configured`), and a revoked grant keeps its row.

The pair here is that screen, on the same isolated machine state in both halves,
before and after the chip's input became the login verdict.

## What produced these frames

```
# the rig: a copy of the UX round's own (fake IdP + isolated backend + proxy on
# the one extra port the renderer's CSP admits). Its README is the runbook; the
# backend worktree it needs is one command:
git -C ~/local-operator worktree add --detach <rig>/backend bd53de08
bash <rig>/run.sh                       # IdP + backend 11319 + proxy 8080

# both trees built against that proxy - the renderer's backend address is
# inlined at BUILD time, and the driver refuses a tree built for another one:
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build

# one boot per tree, same command, same rig state:
CHIP_WT=<tree> CHIP_OUT=<frames> bash <rig>/run-mine.sh
```

`before/` is `origin/main` = `8d758d238` (the rebase base this branch sits on);
`after/` is this branch's commit. The scene is one addition to a **copy** of
`scripts/renderer-driver.mjs` — the repository's own file is untouched — and it
navigates to `/settings`, presses the `Radient account` nav row, reads that
section, then scrolls the Providers grid to the Radient card. `scene-before.log`
and `scene-after.log` are its raw output, and they carry the two readings that
make the frames falsifiable:

| reading | before | after |
| --- | --- | --- |
| rig's `GET /v1/auth/status` → `radient_login` | `{"credential_id":1,"state":"login_required"}` | same |
| census row for `radient` | `has_credential: true, configured: true` | same |
| the account section's own badge | `Signed in`, tone `success` | `Needs sign-in`, tone `neutral` |
| the grid card's badge | `Signed in`, tone `success`, no title | `Needs sign-in`, tone `neutral`, `title="Radient no longer accepts the sign-in stored on this machine"` |

Both halves ran the same command against the same rig: the census still counts a
Radient credential (so the old predicate has everything it needs to claim a
sign-in), and the verdict refuses it. A frame taken against a healthy verdict
would photograph the unchanged chip and say nothing, which is why the scene
asserts the verdict it found rather than assuming it.

## What these frames do not show

- **The composer.** PR #416 owns that surface; this change deliberately does not
  touch it, and the two agree by keying on the same verdict rather than by
  rendering the same sentence.
- **The section's sentence.** It is unchanged here (it is `origin/main`'s copy),
  and it agrees with the new chip in both halves. The vocabulary question D6/U1
  raised rides #416's remediation, whose copy is still moving.
- **Reachability, layout and colour.** These are PNGs of the window at
  1380x900 (`1380x868` CSS viewport on this runtime), captured by the app's own
  `capturePage()` from a `headless` launch — the run's own stdout carries
  `[window-mode] … visible=false focused=false focusable=false`, and the driver
  asserts the window was never shown. No `screencapture`, no browser engine, no
  window on the operator's screen.
- **The three other surfaces that read the same predicate.** The hosting picker's
  filter and the model picker's sub-line still read the credential row, on
  purpose (`loginRefused`'s callers are named in the PR body): removing a
  provider from a control is a different act from correcting the badge on its
  row.
