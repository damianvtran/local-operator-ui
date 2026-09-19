# File transfer, in composition

Five frames from `scripts/browser-file-transfer-proof.mjs`, which drives the built
app with its own browser host and photographs what a user meets: the chrome band,
the download row, and the driven page in one frame, at the window size the app runs.
They are here because the change's own claim is a COMPOSITION claim, and no story
can answer it. The download row appears in the 41-pixel band above a live page and
the page area moves down by exactly that much; a Storybook frame renders the row on
a decorator, where "the strip reflowed rather than overlapped" is not in the
picture at all.

| frame | what it is for |
|---|---|
| `01-receipts-before.webp` | the state the row appears FROM: seven receipt links and a "Download all" button, no row, the page area at y=78 with height 790 |
| `02-receipts-after.webp` | the motivating case, after ONE click started seven downloads: every receipt landed in the harness-composed quarantine directory, and the row reports the newest one. The page area's y is 119 — 78 + the row's own 41 — which is the number that says the strip reflowed rather than covering the page |
| `03-refused-exe.webp` | the refusal: a page offering `setup.exe` is refused by NAME before anything lands, and the row carries the typed reason on `danger-wash`. Nothing is on disk behind it, which the transcript's `C2` asserts rather than this frame |
| `04-upload-form.webp` | the upload case, photographed BEFORE the form is sent: a real `<input type=file multiple>` in a real form, holding the three attached files (`Choose Files · 3 files`). The evidence that the bytes ARRIVED is the next frame and the transcript's `D6`, not this one |
| `05-upload-received.webp` | the page the receiving server answered on: the browser's own view of `{"received":3}` from `/echo`. This is the server's word for what it got, and `D6` is the digest comparison that makes it evidence of the right bytes rather than of a count |

TWO FACTS ABOUT THESE FRAMES THAT ARE THE RUN'S, NOT THE FRAME'S, so a reader
does not read determinism into them: the row in `02` names whichever receipt
finished LAST (seven downloads run concurrently, so which one that is varies
between runs — the claim is the row and the 41-pixel reflow, not the name), and the
row in `04`/`05` still shows the over-cap refusal from the case before, because the
row speaks about the newest decision and an upload is not a row state at all.

The refusal's copy in `03` is worth reading against the host's own words: the row
shows `setup.exe is an executable/script type; nothing was saved` while the tool
result carries `refused: \`setup.exe\` is an executable/script type; nothing was
saved`. The row drops the `refused:` prefix and the backticks (the app's chrome does
not print sentences in monospace, branding § 7) and keeps every other word.

Source, exactly:

```bash
pnpm build
node scripts/browser-file-transfer-proof.mjs --out /tmp/ft-frames
```

The rig prints its own transcript to stdout (36 checks) and writes
`transcript.json` beside the frames; each frame is the renderer's own
`Page.captureScreenshot` composited with the page as the HOST's `screenshot` action
returns it, at the rectangle the renderer reports to main. Frames are encoded to
`.webp` at quality 90.

**What these frames do NOT show, said rather than implied:** a real `DeepSeek`
receipts page behind a login (the rig drives a local fixture server, which is the
reproducible half of that case — §12.1's E1 names the live site as BLOCKED without
the operator's paired profile), and the window itself (the run is headless by
design, so the pixels come from the app photographing itself rather than from the
desktop).
