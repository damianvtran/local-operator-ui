# The affirmation, and the event that takes it back

QA round 1 (Q1): the whole-check sentence outlived the fact it stated. A check
that proved both channels current left "The application and server are up to
date" on screen for its six seconds, so the NEXT check — the one that finds a
server release to offer — put that offer and that sentence up together. QA
reproduced it in a real browser two ways: a second manual press, and a
background `{silent:true}` server check whose offer event arrives with no button
pressed at all. Both are photographed here, after the fix.

Two states, each in `localOperatorLight` and `localOperatorDark`:

- `first-check-affirmation/` — one manual press of the section's own "Check for
  updates" button with both channels current. The verdict carries
  `UP_TO_DATE_AFFIRMATION`, so the green sentence is up and no offer is.
- `superseded-by-offer/` — the same claim after an event that makes it false.
  The offer panel is up and **the sentence is gone**. The dark frame is the
  background path (a silent server check's `backend-update-available` delivered
  with no press); the light frame is the manual path (a second press whose
  verdict is `{app: current, server: available}`). Each palette therefore shows
  one of the two retirement paths the fix adds.

The pre-fix half of both comparisons is not committed to this repository: it is
`repeat-after-light.png` and `late-offer-clean.png` in the QA pass's own scratch
directory (`/tmp/pr172-qa`), which show the identical state WITH the green
sentence still under the offer. This set is the AFTER half; the before half of
the *reported* defect — the panel with "You are up to date" over it — remains
`../update-check-affirmation-before/`.

## What produced these frames

Captured with the **browser tool**, not the repository's `capture-evidence.mjs`,
and not by a CDP script: the harness is the QA pass's controlled runtime
(`runtime.mjs` + `bridge.js`, copied to `/tmp/pr172-evidence` for this run), which
serves the production Storybook build's own JS/CSS unchanged and replaces only
the preload bridge.

```sh
# 1. A production build of the story the frames come from.
pnpm build-storybook                                   # storybook-static/, ~17s here

# 2. The controlled runtime: the REAL UpdateService (bundled from this tree),
#    a real loopback /health server, the registered check-for-all-updates
#    handler, native Electron/updater substituted. Port 6035.
node /tmp/pr172-evidence/runtime.mjs --matrix

# 3. The page, in the browser tool:
#    http://127.0.0.1:6035/qa.html?id=settings-app-updates-section--all-current&viewMode=story&scenario=current
#    press the section's own "Check for updates"; then either press it again
#    with "Arm current then server" queued, or click "Background server offer".
```

Captured as PNG by the browser tool and converted with
`magick <frame>.png -quality 88 <frame>.webp`, the quality
`capture-evidence.mjs` writes. No cropping, retouching or compositing: the
frames are whole-viewport screenshots of the real page.

Two things in the frames are the FIXTURE's, not the product's:

- the grey control strip at the top and its `{"success":…,"server":…}` line.
  That strip is the QA harness's own instrumentation, and it reports TWO
  measurements of two different MOMENTS, which matters most in the dark frame:
  the line reading `{"success":…,"server":…}` is a live DOM measurement of the
  section - the product state - while the verdict text beside it is the harness's
  echo of the check that produced the state. In the light frame that echo is the
  depicted (second, manual) check's,
  `{"app":"current","server":"available","affirmation":null}`. In the dark
  (background-path) frame it is still the FIRST check's - the one that earned the
  sentence,
  `{"app":"current","server":"current","affirmation":"The application and server are up to date"}`
  - because a `{silent:true}` check's verdict is never applied to the button.
  That stale echo is deliberate rather than a leftover: it is the claim the
  product has just withdrawn, printed on the same frame as the DOM line and the
  panel that withdraw it. The product UI is everything at or below the
  "Application updates and info" heading.
- the offer panel, and its remedy wording ("The server is a uv tool install
  built from source on this machine…"). The wording is this host's real install
  classification, produced by the shipped `resolveBackendUpdatePlan` for the
  operator's own uv-tool install; it is not the report's 0.54.43 → 0.54.44 pip
  wording. The panel is also a DIFFERENT VARIANT of that surface rather than the
  approved one re-worded, and the two sets must not be read as before/after of
  one panel: the frames captured here show a **400 × 590 CSS px** panel with
  **four** actions (`Copy command`, `Update later`, `Check for updates`,
  `Copy details`) and a **re-check** as the primary action, against the approved
  `../settings-app-updates-section/server-update-offered/` pair's **400 × 209
  CSS px** with **two** (`Update later`, `Update server`) and an update primary.
  Both are legitimate states of the same surface and this change styles neither,
  so the difference is the variant the fixture happened to produce, not a change
  under review.

## How the two states register against each other

The pair is not vertically aligned, and the misalignment is the fixture's rather
than the product's: the harness strip above the product grows by one line
between the two states (its ground/canvas boundary sits at y=260 device px in
`first-check-affirmation/` and y=291 in `superseded-by-offer/`, in both
palettes), so the whole product block sits **31 device px (~15.5 CSS px) lower**
in the superseded frames. The product itself does not move: aligning the two
product regions by +31 px drops the mean absolute channel difference to 0.26
(light) / 0.34 (dark) out of 765, against 2.96-3.01 at the neighbouring offsets.
A reader flicking between the committed frames should expect the section to
slide by 15.5 px, because that is exactly the motion that can hide a one- or
two-pixel change; the alternative is pinning the strip's height in the harness,
which no re-capture here did.

Each frame is 2880×1634 device pixels at a 1440×817 CSS viewport; no scrollbar
appeared in any captured state. The harness's fixture fonts and the section's own
geometry are the production build's.

The fixture-truth change this round required: the runtime's `__loTestAppCheck`
must return `versionInfo` on BOTH outcomes, because electron-updater's
`AppUpdater.doCheckForUpdates` does. Without it the app channel is correctly
reported `unavailable` under the Q2 rule (an absent reading is not "nothing
newer"), and the affirmation cannot be earned at all.