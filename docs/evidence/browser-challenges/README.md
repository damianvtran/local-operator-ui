# Browser challenges — rig frames

Frames from `scripts/browser-challenge-proof.mjs`, the committed rig for this
branch's browser fixes. The write-up, the measurements and the honest limits are
in [`docs/design/browser-challenges-and-passkeys.md`](../../design/browser-challenges-and-passkeys.md).

Commands (each arm ×3; the BEFORE arm is a second worktree at `origin/main` =
`548f8dfed` with this rig copied into it, so the rig never needs this branch's
source):

```sh
node scripts/browser-challenge-proof.mjs --app-tree <tree> --arm local --attempts 3
node scripts/browser-challenge-proof.mjs --app-tree <tree> --arm ua --attempts 3
```

## The frames

| file | what it is |
| --- | --- |
| `before-local-attempt1.png` | BEFORE, local arm: the challenge page stuck at `PENDING` and an EMPTY frame where the widget should be — the cross-origin widget document was refused with `BlockedByClient` by the per-hop origin gate. |
| `after-local-attempt1.png` | AFTER, same page: `COMPLETE`, the widget running and its token delivered. |
| `before-ua-attempt1.png` | BEFORE, user-agent arm (`--arm ua`, the real site with the app's `LocalOperator/<version>` product token): the Cloudflare interstitial from the operator's own report, inside the app's browser tab. |
| `after-ua-attempt1.png` | AFTER, same URL with Chrome's own string and no product token. Identical to the eye, and that is the honest reading measured below: in the app's driven-view shape both UAs stall, so this pair shows the STRING changed rather than the outcome. |

Each frame is a composite: the app's own renderer captured over CDP (the chrome
and everything the app paints) plus the host's `screenshot` action for the driven
page, placed at the rectangle the renderer reports — the same two-layer
composite `scripts/browser-chrome-proof.mjs` uses, because a native view is not
in the DOM and the page's own capture cannot see the chrome.

## The numbers, as printed by the runs

```
# BEFORE (origin/main 548f8dfed)
RESULT arm=local attempt=1 outcome=FAIL status=PENDING widget=none raf=2651 vis=visible refusals=1 cookies=[]
RESULT arm=local attempt=2 outcome=FAIL status=PENDING widget=none raf=2666 vis=visible refusals=1 cookies=[]
RESULT arm=local attempt=3 outcome=FAIL status=PENDING widget=none raf=2652 vis=visible refusals=1 cookies=[]
RATE arm=local 0/3 NOT all passed
RESULT arm=ua attempt=1 outcome=FAIL cookies=[] title="Just a moment..." ua="… Safari/537.36 LocalOperator/0.28.4" vis=visible refusals=0 refused=[]
RESULT arm=ua attempt=2 outcome=FAIL cookies=[] title="Just a moment..." ua="… Safari/537.36 LocalOperator/0.28.4" vis=visible refusals=0 refused=[]
RESULT arm=ua attempt=3 outcome=FAIL cookies=[] title="Just a moment..." ua="… Safari/537.36 LocalOperator/0.28.4" vis=visible refusals=0 refused=[]
RATE arm=ua 0/3 NOT all passed

# AFTER (fix/cloudflare-challenge-and-passkeys)
RESULT arm=local attempt=1 outcome=PASS status=COMPLETE widget=token raf=2656 vis=visible refusals=0 cookies=[]
RESULT arm=local attempt=2 outcome=PASS status=COMPLETE widget=token raf=2655 vis=visible refusals=0 cookies=[]
RESULT arm=local attempt=3 outcome=PASS status=COMPLETE widget=token raf=2648 vis=visible refusals=0 cookies=[]
RATE arm=local 3/3 all passed
RESULT arm=ua attempt=1 outcome=FAIL cookies=[] title="Just a moment..." ua="… Chrome/152.0.7977.78 Safari/537.36" vis=visible refusals=0 refused=[]
RESULT arm=ua attempt=2 outcome=FAIL cookies=[] title="Just a moment..." ua="… Chrome/152.0.7977.78 Safari/537.36" vis=visible refusals=0 refused=[]
RESULT arm=ua attempt=3 outcome=FAIL cookies=[] title="Just a moment..." ua="… Chrome/152.0.7977.78 Safari/537.36" vis=visible refusals=0 refused=[]
RATE arm=ua 0/3 NOT all passed
```

`refusals` is the count of the gate's own `refused a navigation hop` lines in the
run's app log — the direct evidence for the subframe refusal, and the reason the
deterministic arm is the one that carries the claim.

The `ua` arm is the user-agent change (the UA is compiled into the host, so the two
trees ARE the two arms) and it asserts the UA each sample actually presented. It
shows the string changed on this branch and does NOT reproduce the pass/fail
discrimination — both trees stall in the app's driven-view shape. The
discriminating measurement was taken in the window-webContents shape and is
recorded in `docs/design/browser-challenges-and-passkeys.md` §2.

Two things these runs also record, both stated in the doc rather than inferred
from the frames: the real-site arm runs `--window-mode=inactive` because a
captcha cannot be solved in a page whose window is not on screen (the frozen-tab
limit), and the passkey half cannot be photographed here at all — this machine has
no signing identity, so the gate stays inert and logs `unpackaged`.
