# Browser OAuth popups for driven pages — the before/after pair and the parity proof

The operator's report: in the app's browser tab, `console.radienthq.com/login` →
**Continue with Microsoft** immediately rendered *"Microsoft sign-in could not be
completed. Please try again."* — no navigation, no popup — while **Continue with
Google** from the same page worked (same-tab redirect). The console's Microsoft
half is MSAL `loginPopup`, which needs a real popup window with a live
`window.opener`; the driven views' `setWindowOpenHandler` denied every
`window.open`, `about:blank` included, and a denied `window.open` returns `null`
— nothing about that containment can be rebuilt from the offered URL.

The design is `docs/design/browser-oauth-popups.md`; the implementation is
`fix(browser): open driven-page OAuth popups as gated child windows`.

## The files

| file | what it is |
| --- | --- |
| `console-failure-before.png` | BEFORE (tree at `654c58f5f6`): the console login page as the app's own view saw it, after a real CDP input click on **Continue with Microsoft** (JS `.click()` was not used — user activation is part of the measurement). The site's own error state is the picture: *"Microsoft sign-in could not be completed."* The app ran headless on a scratch profile; the frame is the view's own `Page.captureScreenshot`, so nothing on the operator's screen was involved. |
| `console-waiting-after.png` | AFTER, same click, same run shape: no error. The page waits on the popup the next file shows. |
| `signin-popup-after.png` | AFTER: the popup target itself — `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?...&state={"interactionType":"popup"}...` — the real Microsoft sign-in page, captured from the popup's own CDP target while the run stayed headless. THE RUN STOPS HERE: no field is filled, no account is chosen, no sign-in is performed. |
| `popup-under-headless.png` | The harness proof's own popup (`scripts/browser-host-proof.mjs`), captured the same way under a headless run; its status line reads `opener=present cookies=shared held` — the cross-window readings are inside the frame. The about:blank-first capture (the copy-prefs creation path) came back byte-identical and is not committed twice; that path is asserted in `transcript-proof-after.md`. |
| `transcript-live-before.md` | The live rig's BEFORE run: the click, the site's error state, the popup target list (the click adds none), and the app log line `blocked a non-http popup: about:blank` — MSAL opens the blank window FIRST, so the denial lands before an http URL is ever proposed. |
| `transcript-live-after.md` | The live rig's AFTER run: `tab 2 opened a popup: about:blank (disposition=new-window, presentation=never)`, the popup target that appeared, and the check that after closing the popup the same tab still navigates to `accounts.google.com` from **Continue with Google** — the half that already worked, re-verified so the fix is not a second regression. |
| `transcript-proof-after.md` | `scripts/browser-host-proof.mjs` on this branch: the popup parity dance all-green (opener/postMessage both ways, cookie jar shared in both directions, grandchild refused, cap boundary at the 4th live child — `0:opened,1:opened,2:refused`, tab-close cleanup, `presentation=never` in every opened line, and the app-not-frontmost sampler reading 0/41 samples). |
| `transcript-proof-before.md` | The same proof at the base, run as-is: the page's `popup: blocked` and the log's `blocked a popup from a driven page` are the deny-all this change replaces. Its three `[FAIL]`s are kept as recorded — the old popup check's stale tab-count clause, and the two cookie-store checks that fail IDENTICALLY on both sides (below). |

## The commands

Both live phases (the app headless on a scratch profile, a devtools port, the
rig connecting to the app's own view targets):

```sh
env -u XPC_FLAGS RIG_APP_DIR=<tree> RIG_OUT=<scratch>/live \
  node live-console-run.mjs before   # and: after
```

The proof, on each tree:

```sh
env -u XPC_FLAGS node scripts/browser-host-proof.mjs
```

## What passed, and the honest limits

- Popup dance end to end on a real page with real child windows — opened,
  `opener=yes`, `selfCookie=yes`, `sharedJar=yes` (the opener sees the popup's
  cookie, the popup sees the opener's), `grandchild=denied`, `ack=sent`,
  `closed=yes`, and the opener never navigated. The about:blank-first child
  reports `opener=present cookies=shared` on its own status line.
- The live console run: the Microsoft popup opens onto
  `login.microsoftonline.com` (`interactionType":"popup"`), the opener shows no
  error, and Google's same-tab redirect still works after the Microsoft popup is
  closed.
- The operator's final sign-in click is the closing acceptance and is NOT
  performed here — no credential is entered anywhere in these runs.

`transcript-proof-*.md` carry two `[FAIL]`s each side, both pre-existing and
identical before and after: the local Chromium's cookie store reads empty after
the run's clean quit (`sqlite3 … cookies` — no rows) and a persistent cookie
consequently does not survive the restart. They are recorded rather than
suppressed because this change neither causes nor fixes them, and no claim here
rests on the cookie store — the cookie-jar claims above are observed live, in
the running session, through the opener and the popup.

The frames are committed as PNG, not `<name>/<theme>.webp`: the webp convention
serves frames that are pictures of the app painted under a palette, and every
frame in this set is a page or popup capture whose ground is the site's own (the
console's near-black, Microsoft's white). This is the same shape as
`docs/evidence/relaunch-during-quit/` and `docs/evidence/browser-challenges/` —
sets of PNG frames with run transcripts, declared by no supplementary set and
counted by no sweep.
