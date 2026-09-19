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
| `03-refused-exe.webp` | the refusal: a page offering `setup.exe` is refused by NAME before anything lands, and the row reads `Download refused — setup.exe is an executable/script type. Nothing was saved.` on `danger-wash`. Nothing is on disk behind it, which the transcript's `C2` asserts rather than this frame |
| `04-upload-form.webp` | the upload case, holding the three attached files (`Choose Files · 3 files`), with the strip carrying the upload's OWN line — the state round 1 found with `notes: []` and nothing on screen while three files left the machine (U3). The evidence that the bytes ARRIVED is the next frame and `D6`, not this one |
| `05-upload-received.webp` | the page the receiving server answered on: the browser's own view of `{"received":3}` from `/echo`. This is the server's word for what it got, and `D6` is the digest comparison that makes it evidence of the right bytes rather than of a count |
| `06-downloading.webp` | a transfer IN FLIGHT, which §12.3 asks for and no earlier version of these frames showed: the row reports the percentage and the bytes rather than one static line (D6, U6). THE PAGE HALF OF THIS FRAME IS TAKEN AFTER THE TRANSFER FINISHES, and that is the host's own structure rather than a shortcut: `screenshot` is tab-scoped, so it waits on the tab's command lane — the lane the `download` call holds until it answers — and asking for the page in flight comes back empty (the first version of this case did exactly that and shipped a blank page area). The page does not change while the transfer runs, and the row's pixels are the mid-flight ones |
| `07-row-and-band.webp` | the row STACKED with the consent band — the composition worst case (three strips above one page), and the arrangement the "it reflowed rather than overlapped" claim had not been shown for (D6) |
| `08-long-name-refused.webp` | a refusal whose NAME cannot fit: the name and the rule clause elide and `Nothing was saved.` does not. The transcript's `G8` measures which span is the clipped one rather than leaving it to the eye (D3) |

TWO FACTS ABOUT THESE FRAMES THAT ARE THE RUN'S, NOT THE FRAME'S, so a reader
does not read determinism into them: the row in `02` names whichever receipt
finished LAST (seven downloads run concurrently, so which one that is varies
between runs — the claim is the row and the 41-pixel reflow, not the name), and
every decided row carries the age it had when the frame was taken, so `just now` in
one frame and a later frame's `1 min ago` are the same decision seen twice.

**The sidebar's account chip is UNRESOLVED in `01` (`U` / `User`) and resolved in
`02`** (`DT` / the account's name and address), which round 1 filed as D9: the
before/after pair differs in a second, unrelated surface, so a reader comparing the
two is looking at something the row did not change. It is the run's own state
rather than something the rig pins — the profile resolves from the local cache a
few seconds into a boot, and these two frames are seconds apart — and it does not
touch the reflow measurement, which is taken INSIDE each frame (the page area's own
top edge), so the 78 -> 119 claim is unaffected. Recorded here rather than left for
a reader to wonder about.

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
```

The rig prints its own transcript to stdout — **51 checks recorded, 0 FAIL, 0
BLOCKED** on the capture these frames came from — and writes
`transcript.json` beside the frames; each frame is the renderer's own
`Page.captureScreenshot` composited with the page as the HOST's `screenshot` action
returns it, at the rectangle the renderer reports to main. Frames are encoded to
`.webp` at quality 90.

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
