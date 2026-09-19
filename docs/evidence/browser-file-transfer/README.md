# File transfer, in composition

Eight frames from `scripts/browser-file-transfer-proof.mjs`, which drives the built
app with its own browser host and photographs what a user meets: the chrome band,
the transfer row, and the driven page in one frame, at the window size the app runs.
They are here because the change's own claim is a COMPOSITION claim, and no story
can answer it. The row appears in the 41-pixel band above a live page and the page
area moves down by exactly that much; a Storybook frame renders the row on a
decorator, where "the strip reflowed rather than overlapped" is not in the picture
at all.

| frame | what it is for |
|---|---|
| `01-receipts-before.webp` | the state the row appears FROM: seven receipt links and a "Download all" button, no row, the page area at y=78 with height 790 |
| `02-receipts-after.webp` | the motivating case, after ONE click started seven downloads: every receipt landed in the harness-composed quarantine directory, and the row reports the newest one, the folder it went into, and how long ago. The page area's y is 119 — 78 + the row's own 41 — which is the number that says the strip reflowed rather than covering the page |
| `03-refused-exe.webp` | the refusal: a page offering `setup.exe` is refused by NAME before anything lands, and the row reads `Download refused — setup.exe is an executable/script type. Nothing was saved. · just now` on `danger-wash`. Nothing is on disk behind it, which the transcript's `C2` asserts rather than this frame. The age is there because round 2's U9 found the loud half was the only row that could not say whether it happened now or five minutes ago |
| `04-upload-form.webp` | the upload case, holding the three attached files (`Choose Files · 3 files`), with the strip carrying the upload's OWN line — the state round 1 found with `notes: []` and nothing on screen while three files left the machine (U3). It NAMES the files rather than only counting them (round 2, U11): `brief.pdf + 2 more were attached to 127.0.0.1:49198`, because a user whose assistant attached three files out of a twelve-file folder could not otherwise tell which three left. The evidence that the bytes ARRIVED is the next frame and `D6`, not this one |
| `05-upload-received.webp` | the page the receiving server answered on: the browser's own view of `{"received":3}` from `/echo`. This is the server's word for what it got, and `D6` is the digest comparison that makes it evidence of the right bytes rather than of a count |
| `06-downloading.webp` | a transfer IN FLIGHT, which §12.3 asks for and no earlier version of these frames showed: the row reports the percentage and the bytes rather than one static line (D6, U6). THE PAGE HALF OF THIS FRAME IS TAKEN AFTER THE TRANSFER FINISHES, and that is the host's own structure rather than a shortcut: `screenshot` is tab-scoped, so it waits on the tab's command lane — the lane the `download` call holds until it answers — and asking for the page in flight comes back empty (the first version of this case did exactly that and shipped a blank page area). The page does not change while the transfer runs, and the row's pixels are the mid-flight ones |
| `07-row-and-band.webp` | the row STACKED with the consent band — the composition worst case (three strips above one page), and the arrangement the "it reflowed rather than overlapped" claim had not been shown for (D6). The row in it is the RUNTIME-CAP refusal (`G12`), which round 2 split out as its own rule so the consequence reads "The partial file was discarded." rather than "Nothing was saved." |
| `08-long-name-refused.webp` | a refusal whose NAME cannot fit: the name elides and `Nothing was saved.` does not. The transcript's `G8` measures which span is the clipped one rather than leaving it to the eye (D3), and `G8b` measures the half round 2 added — the name is now CAPPED rather than merely shrinkable, so it can shorten the reason without clipping it to a fragment (round 2, D11: the rule span used to be 74 px of `is an exec…`, and reads `is an executable/script type.` at 170 px here) |

TWO FACTS ABOUT THESE FRAMES THAT ARE THE RUN'S, NOT THE FRAME'S, so a reader
does not read determinism into them: the row in `02` names whichever receipt
finished LAST (seven downloads run concurrently, so which one that is varies
between runs — the claim is the row and the 41-pixel reflow, not the name), and
every decided row carries the age it had when the frame was taken, so `just now` in
one frame and a later frame's `1 min ago` are the same decision seen twice.

**The sidebar's account chip is UNRESOLVED IN BOTH frames of the before/after pair (`U`
/ `User`), and round 1's D9 note said otherwise.** The earlier note here claimed `01`
showed it unresolved and `02` resolved (`DT` / the account's name and address). Round
2's design review cropped that region out of both frames at 2x and both read `U` /
`User`; a per-pixel diff over the whole sidebar column gives 15,997 differing pixels
out of 763,840 (2.09%), diffuse and edge-only — text antialiasing and WebP decode
noise, with no changed glyphs. So the recorded explanation of a difference was a
difference the reader cannot find, which is worse than the silence it replaced. What
the pair DOES differ in is what the frames are for: the row, and the page area's own
top edge (78 -> 119, measured inside each frame, so the reflow claim is unaffected).
The profile resolving a few seconds into a boot is real, and it did not happen inside
this pair's own window — which is why the pair is not claimed to show it.

The refusal's copy in `03` is worth reading against the host's own words, and the
relationship is the change this round made: the host's `reason` is written for the
TOOL RESULT — `refused: \`setup.exe\` is an executable/script type; nothing was
saved` — while the ROW composes its own sentence from the note's `rule` and its
numbers. The row therefore drops the `refused:` prefix and the backticks (the app's
chrome does not print sentences in monospace, branding § 7) and states the limit as
a unit: `huge.pdf` reads `is over the 256 MiB per-file download limit; nothing was
saved` rather than two nine-digit byte counts one apart, which are the same number
in every human unit (round 1, D1/D3/U5).

Source, exactly:

```bash
pnpm build
node scripts/browser-file-transfer-proof.mjs --out /tmp/ft-frames
# the rig writes PNGs (the composited frame plus its two layers); the committed
# `.webp` frames are those PNGs through sharp at quality 90, one per frame name.
#
# THE FRAMES IN THIS DIRECTORY ARE FROM THE RUN ON THIS HEAD, after the branch was
# folded onto `origin/main` = `181a9c4fd` (77 upstream commits): every one of the
# eight was re-taken, because the app's own chrome around the row is part of the
# picture and upstream moved it. The transcript quoted below is that run's.
```


The rig prints its own transcript to stdout — **61 checks recorded, 0 FAIL, 2
BLOCKED** on the capture these frames came from — and writes `transcript.json` beside
the frames; each frame is the renderer's own `Page.captureScreenshot` composited with
the page as the HOST's `screenshot` action returns it, at the rectangle the renderer
reports to main. Frames are encoded to `.webp` at quality 90.

**TWO CHECKS ARE BLOCKED, AND THEY ARE THE ROUND-2 CASES THIS RIG CANNOT DRIVE** —
recorded rather than bent to fit, with the measurement that says why:

- `G10` (an upload whose form submits itself to an unapproved origin) and `G11` (the
  same shape landing on an APPROVED origin, whose read-back cannot be taken). Both
  need the document to change WHILE the upload action runs. It does not, on Electron:
  with the page's own `change` handler holding the renderer's main thread for 400 ms
  while the POST goes out and its response arrives, the read-back and the post-perform
  authorization still run first — a DevTools command outranks the navigation's commit
  task — so the call answers before the document changes. `document.open()` destroys
  nothing: Chromium reuses the execution context, and the read-back still completes
  (recorded as an observation beside them). PR A measured the opposite ordering on
  Chrome, which is where the raw `-32000` those findings cite comes from. The
  discriminating cases are the unit tests on the same commit
  (`scripts/browser-host.test.mjs`, both marked "review round 2"): one drives the epoch
  change at exactly the point `perform` returns, and the other makes the read fail and
  asserts the marker, the facts and the answer.

**THE RUNTIME CAP'S BOUND IS MEASURED OFF THE DISK, not off this host's self-report**
(`G12`): a 10 ms poller watches the partial at its final path from the rig, so the
number is what the write actually reached rather than what the host said it had
received. The bound the host's own clock can promise is the cap plus one sample
interval of throughput, and the interval is what the MACHINE decides — measured at the
shipped 100 ms cadence: **277,348,110 bytes (8.9 MiB over the cap, 76 ms past the
limit)** idle, **327,221,015 (58.8 MiB over, 219 ms)** and **328,662,599 (60.2 MiB
over, 182 ms)** on busy runs, and **394,002,389 (125.5 MiB over, 399 ms)** at a load
average of 124. The check's ceilings (192 MiB / 1200 ms) are set for that last case,
because what it asserts is that a starved main process still cancels on its OWN clock
rather than waiting on `updated` — against QA round 2's 734,003,200 (**2.7x the cap**,
server still pushing, no bound at all) under the trigger this replaced.

**The app is launched with `--use-mock-keychain --password-store=basic`**, through
`withMockKeychain` from `scripts/chrome-keychain.mjs`. Both are load-bearing here:
`HOME` is redirected to a scratch tree with no login keychain, so without them
Chromium asks macOS to CREATE one and the operator gets a "Keychain Not Found"
dialog from a rig he did not start (round 1, operator-safety item — and note that
`scripts/chrome-keychain.test.mjs` cannot see this launch, because it classifies a
site by whether the command says `chrome`; the Electron rigs are outside its reach).

**What these frames do NOT show, said rather than implied:** a real `DeepSeek`
receipts page behind a login (the rig drives a local fixture server, which is the
reproducible half of that case — §12.1's E1 names the live site as BLOCKED without
the operator's paired profile); the window itself (the run is headless by design,
so the pixels come from the app photographing itself rather than from the
desktop); and the row at the app's 800px MINIMUM window, which is committed as the
`browser-file-transfer-row/*` story `LongNameAtMinimumWindow` instead — a rendered
frame of the row at that width, but a decorator rather than the whole app.
