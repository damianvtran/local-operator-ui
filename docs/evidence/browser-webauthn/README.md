# The passkey chooser, on the round-3 remediation head

Frames from `scripts/browser-challenge-proof.mjs --arm webauthn --attempts 1`
(committed, re-runnable) against this branch's built tree, `--window-mode=headless`.
Each `chooser-*` frame is the APP'S OWN RENDERER, captured over CDP
(`Page.captureScreenshot`) while the chooser is up. That is the whole frame in this
arm: the native page view is suppressed by the dialog's own overlay policy, and the
arm opens no tab — so there is no second layer to composite, and nothing in these
pictures is a stand-in.

The four `*-storybook.webp` frames are the exception, and they say so in their
names: they are the committed stories file rendered through Storybook and captured
in a real browser.

- `chooser-answering-storybook.webp` + `chooser-several-named-storybook.webp` show
  design round 2's N1 dim (same dialog, same rows, one state disabled). The
  Answering state is the one state the app-side rig cannot hold — measured, not
  assumed: the preload's `contextBridge` object refuses the patch
  (`api.respondToWebauthn = …` leaves the original in place), and the only way to
  keep the IPC pending from the main process would freeze the same process that
  serves the screenshot.
- `chooser-nameless-dark-storybook.webp` + `chooser-nameless-light-storybook.webp`
  are design round 3's D11 in both brand ramps: the recovery clause in the lead,
  wrapped and fully painted, and the rows back to the one machine sentence they
  were built for.

Run:

```
node scripts/browser-challenge-proof.mjs --arm webauthn --attempts 1 --out /tmp/webauthn
```

Result on this head: **arm=webauthn pass=1/1**, 22 checks, all PASS. Per-check output
is in the run's `proof.md`; the numbers cited below are from that transcript.

| frame | state | what it shows |
| --- | --- | --- |
| `chooser-several-named.webp` | two named passkeys | the everyday multi-match: the lead names the site, both rows carry a name and a login |
| `chooser-answered.webp` | after choosing | the dialog is gone, the credential reached Electron's callback, focus is back on the rail row it was on before |
| `chooser-nameless.webp` | three unnamed credentials | the lead says what the choice decides and carries the recovery clause in prose (design D11 / UX U9); every row's second line is the short "The site stored no name for this passkey." |
| `chooser-long-names.webp` | a long display name and a 76-character login | both rows wrap: `client=396 scroll=396`, `overflowing=false`, no text outside the panel |
| `chooser-many-accounts.webp` | twelve credentials | the list scrolls; the Touch ID sentence stays inside the panel (`notePinned=true`) |
| `chooser-queued.webp` | two requests at once | the second is COUNTED as waiting ("One more passkey request is waiting." — requests, not sites: N3/U7) instead of replacing the first |
| `chooser-oldest-expiring-while-queued.webp` | the older of two, seconds before it expires | both requests live, oldest first: `rows=2`, lead names `oldest.example.com` |
| `chooser-queued-oldest-expired.webp` | the older one has expired, the newer is still live | **the round-2 blocker measured**: `elapsed=61s open=true rows=2 expires=1` — the panel still shows `newer.example.com`, and no ending is on screen |
| `chooser-ending-after-the-queue.webp` | the newer one cancelled | the ending the live request was hiding becomes the panel: `rows=0`, "This passkey request expired", one Close |
| `chooser-ending-dismissed.webp` | the ending dismissed | the dialog is gone and the caret is back on the rail row — `activeElement=nav-item-chat` (UX U6) |
| `chooser-plain-expiry-ending.webp` | a single request, nobody answered, 60 s | the ending on its own — the shape a user actually meets, and the one round 2's check did not walk |
| `chooser-plain-expiry-dismissed.webp` | that ending dismissed | the dialog is gone and the caret is on the rail row: `activeElement=nav-item-chat`, with the instrumented tape showing the app's own `focus(nav-item-chat)` at the dismissal (UX round 3, U6) |
| `chooser-on-chat-route.webp` | raised while the browser surface is NOT mounted | `hash=#/chat`, `surface-mounted=false`, and the dialog is up and answerable |
| `chooser-after-return.webp` | back on the surface | byte-identical to `chooser-several-named.webp` — the same request, unchanged by the route change |
| `chooser-expired.webp` | 60.3 s later | the rows are replaced by the ending in words, not a live-looking dialog whose click would be discarded |
| `chooser-answering-storybook.webp` | the Answering state (stories file) | the rows' text takes the disabled ink and "Answering…" is pinned in the footer beside Cancel (design N1) |
| `chooser-several-named-storybook.webp` | the same dialog, enabled | the contrast half of that pair: the labels paint `ink` |

## What was measured, and what it is evidence for

Round 1's findings, each with the number the rig printed:

| finding | measurement |
| --- | --- |
| agent review 1 MAJOR / UX U2 — a request raised while the surface is not mounted was unreachable | `hash=#/chat surface=false open=true rows=2`; returning to `#/browser` keeps it |
| agent review 2 MAJOR — the listener accumulated across host starts | `listenerCount=1` after nine requests in one process, read from the Session itself |
| agent review 7 / UX U1 — a nameless list offered nothing to choose by | the lead reads "Your Mac holds 3 passkeys for this site and did not give their names, so the one you pick is the account you sign in as", and each row reads "The site stored no name for this passkey." |
| design D1 — a long login was cut mid-character at the panel edge | `client=396 scroll=396` on both long rows (round 1 measured `scrollWidth 584` against a `524` client width, ending 59px outside the panel) |
| design D2 — the 60 s expiry never reached the renderer | `expiry settled after 60274ms`, and the renderer's own settle subscription saw `outcome="expired"` |
| design D8 — the Touch ID sentence scrolled away | `notePinned=true` with twelve accounts |
| design D7 — the panel's width followed its content | 398px for both the two-account and the twelve-account states (`fullWidth maxWidth="xs"`) |
| UX U5 — focus landed on `<body>` after the dialog closed | `before=nav-item-chat after=nav-item-chat` |
| agent review 2 R1 / UX U2 — a live request hidden behind an ending, cancelled by its Close | `elapsed=61s open=true rows=2 expires=1` (the living request stays on screen), then `rows=0` with the ending only after the queue emptied, and `the ending's Close answers nothing: the tape does not grow` |
| UX U6 — dismissing an ENDING left the caret on `<body>` | `activeElement=nav-item-chat` after the ending's Close, and the frame `chooser-ending-dismissed.webp` |
| design N1 — the Answering state's text no longer dimmed | pixels sampled from the two story frames: label-region `ink` 2902 → 1539 and `ink-disabled` 118 → 2585 (same dialog, same rows) |
| UX round 3 U6 — the caret after an UNATTENDED expiry | `activeElement=nav-item-chat` on both doors, with the tape reading `[{…,browser-webauthn-account,inDialog:true}, {…,BUTTON,inDialog:true}, {…,nav-item-chat,inDialog:false}]` — Radix's two calls, then the app's restore at the dismissal (the previous head had no third call at all) |
| design round 3 D11 / UX round 3 U9 — the recovery clause clipped in the row | the clause is in the lead, wrapped over four lines in both ramps (the two nameless story frames); the row's line is 41 characters against the 380px box design round 3 measured, with no ellipsis in either ramp |

## The one synthetic part, stated plainly

Electron fires `select-webauthn-account` out of the OS credential path, so it needs
a signed bundle whose signature carries the `keychain-access-groups` entitlement —
neither of which exists on this machine, and a CDP virtual authenticator answers
the request inside the renderer without ever routing account selection to the
embedder (QA round 1, Q2). The arm therefore **emits the event on the app's real
`Session` from the main process**, with synthetic accounts. Everything downstream
of that emit is the shipped code: the registered listener, `WebauthnChooser`, the
IPC push, the preload's payload validation, the shell's dialog, and the answer
travelling back into Electron's own callback (which the arm reads back:
`value="Y3JlZC1i"` for the chosen row, `null` for a dismissal and for an expiry).

Two limits that follow, and are not papered over:

- the ACCOUNT LIST is synthetic, so these frames cannot show what macOS puts in a
  real `displayName` (UX U1's severity depends on that, and U1 says so too);
- the OS Touch ID sheet that follows a real choice has never been seen here. It is
  owed to the next signed release, together with the release gate's new
  `app-webauthn-entitlement` check and a real two-account `select-webauthn-account`
  — see `docs/design/browser-challenges-and-passkeys.md` § 5.

## Not swept

The chooser's stories file
(`src/renderer/src/features/browser/components/browser-webauthn-dialog.stories.tsx`)
is committed with six `STORIES` rows in `scripts/capture-evidence.mjs`
(`browser-webauthn-dialog--*`), so the swept set covers this surface from the next
sweep onward. The sweep for THIS pass could not run: `capture-evidence.mjs` refuses
to capture while a Local Operator backend answers on `localhost:1111`, and the
operator's own backend is up on this machine — stopping it is not this rig's
business. The frames above are the declared substitute, captured from the running
app instead of from Storybook — except the two `*-storybook.webp` frames, whose
provenance is stated at the top — and the manifest's `webAuthnRemediationNote`
records that.
