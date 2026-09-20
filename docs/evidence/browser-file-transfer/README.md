# File transfer, in composition

Ten frames from `scripts/browser-file-transfer-proof.mjs`, which drives the built
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
| `04-upload-form.webp` | the upload case, holding the three attached files (`Choose Files · 3 files`), with the strip carrying the upload's OWN line — the state round 1 found with `notes: []` and nothing on screen while three files left the machine (U3). It NAMES the files rather than only counting them (round 2, U11): `brief.pdf + 2 more were attached to 127.0.0.1:<port>`, because a user whose assistant attached three files out of a twelve-file folder could not otherwise tell which three left. The port in that sentence is the fixture's own, ephemeral per run — design round 5's D3 measured `63328` in one run and `49198` in an earlier set, so the row here is quoted with `<port>` and the frame is what carries the number. The evidence that the bytes ARRIVED is the next frame and `D6`, not this one |
| `05-upload-received.webp` | the page the receiving server answered on: the browser's own view of `{"received":3}` from `/echo`. This is the server's word for what it got, and `D6` is the digest comparison that makes it evidence of the right bytes rather than of a count. THE STRIP IN THIS FRAME IS EMPTY, AND THE ROW'S OWN LINE IS CHECKED ELSEWHERE (design round 5, D6): the still is captured once the tab is on `/echo`, a moment before `D8`'s wait resolves, and the renderer paints the upload's note after that — the previous set's `05` carried `brief.pdf + 2 more were attached to … · just now` for the same code, so its presence here is a timing property of when the note is painted, not a behaviour that changed. `D8` is the claim (it reads the line, on this head, as `brief.pdf + 2 more were attached to 127.0.0.1:<port> · just now · on the agent's tab`), and the `04` -> `05` pair is NOT evidence that the row persists across the state change |
| `06-downloading.webp` | a transfer IN FLIGHT, which §12.3 asks for and no earlier version of these frames showed: the row reports the percentage and the bytes rather than one static line (D6, U6). THE PAGE HALF OF THIS FRAME IS TAKEN AFTER THE TRANSFER FINISHES, and that is the host's own structure rather than a shortcut: `screenshot` is tab-scoped, so it waits on the tab's command lane — the lane the `download` call holds until it answers — and asking for the page in flight comes back empty (the first version of this case did exactly that and shipped a blank page area). The page does not change while the transfer runs, and the row's pixels are the mid-flight ones |
| `07-row-and-band.webp` | the row STACKED with the consent band — the composition worst case (three strips above one page), and the arrangement the "it reflowed rather than overlapped" claim had not been shown for (D6). The row in it is the RUNTIME-CAP refusal (`G12`), which round 2 split out as its own rule so the consequence reads "The partial file was discarded." rather than "Nothing was saved." The frame is taken BEFORE `G13` opens the folder control's own tooltip (design round 3, D15): an open tooltip is painted across the alert glyph, `Download refused —`, the file name and the first clause, so the row's own sentence would be the one part of the picture a reader could not read |
| `08-long-name-refused.webp` | a refusal whose NAME cannot fit: the name elides and `Nothing was saved.` does not. The transcript's `G8` measures which span is the clipped one rather than leaving it to the eye (D3), and `G8b` measures the half round 2 added — the name is now CAPPED rather than merely shrinkable, so it can shorten the reason without clipping it to a fragment (round 2, D11: the rule span used to be 74 px of `is an exec…`, and reads `is an executable/script type.` in full here). The rule carries no floor since design round 4 (D17): the floor round 3 added resolved to 196.5 px around a 168 px clause and held a 26.5 px HOLE mid-sentence at this width, and `G8d` asserts the consequence still follows the rule by the row's own 4 px gap. The clause also rides the span's own `title` (round 3), so it is recoverable wherever a narrower row clips it |
| `09-long-name-refused-minimum-window.webp` | the SAME refusal at the app's 800 px MINIMUM window, and — since design round 4 (D16, review R4-1) — the state where the sentence WRAPS. The wrap is GATED ON THE ROW'S OWN WIDTH (`@max-[64rem]/browserrow`, the container this row is for that reason; design round 5's D1 and review R5-1 found round 4's ungated `flex-wrap` tripling the DECIDED row — and this one in `07` — at the app's DEFAULT window, because `flex-wrap` breaks on each item's content size and a truncating span cannot yield inside its line). So the default window keeps its one line and only a row too narrow for its own sentence breaks; `B13` asserts that on the decided branch and `G8d` on the refused one, which is what a leak back to the wide window now fails. At this width the strip's paragraph is 268.7 px while the row's NON-ELIDABLE clauses alone need 316.5 px (`Download refused —` 124.7 + `Nothing was saved.` 118.0 + the age 57.8 + four 4 px gaps), so no division of the name and the rule holds this sentence on one line: with a floor on each span, which is what round 3's head had, four runs shared columns and the age struck through the `Open folder` label. The clauses take their own lines now — the name yields on the first, the reason renders UNCUT on the second, the consequence and the age share the third — and `G8c` asserts the two halves of that rather than describing them: no two runs' rectangles intersect, no run paints outside the paragraph, and the rule is unclipped. Measured in that run: paragraph **269 px**, name **121 px** (clipped — it yields, and no longer has to shrink to its floor because the reason is not competing for the same line: round 3's one-line arrangement squeezed it to 43 px), rule **170 px with `clipped: false`** against the 22 px `is …` that finding was filed about, consequence 118, age 58, the sentence on **3 lines**, none of them sharing a column. The app's own 800 px window spends 220 px of it on the navigation rail (design round 4, D18: this line and the rig said ~248 px, measured wrong against `rowBox.x = 220` at both widths), which is why the paragraph is as tight as it is |
| `10-saved-minimum-window.webp` | the DECIDED branch at that same minimum window, photographed for the first time because design round 4 observed it colliding there for the same reason and no frame in this set showed it: it still carried the shape the refusal had before round 3 (`max-w-[32ch] shrink-0`, an absolute 237.5 px), so its own sentence had no way to break either. It takes the refusal's proportional cap and floor now, and `G8c` holds this frame to the same two rules — rectangles that do not intersect, nothing painting outside the paragraph. Measured in the same run: name **121 px** (clipped, yielding), `was saved to` 78, the path **269 px** (clipped from the left, so the tail that identifies the directory survives) on its own line, age 58 — 3 lines, all inside the paragraph |

TWO FACTS ABOUT THESE FRAMES THAT ARE THE RUN'S, NOT THE FRAME'S, so a reader
does not read determinism into them: the row in `02` names whichever receipt
finished LAST (seven downloads run concurrently, so which one that is varies
between runs — the claim is the row and the 41-pixel reflow, not the name), and
every decided row carries the age it had when the frame was taken, so `just now` in
one frame and a later frame's `1 min ago` are the same decision seen twice.

**This pair's account chip DIFFERS: `01` reads `U` / `User`, `02` reads `DT` / the
account's name and the address.** That is the measured reading of the committed frames
(cropped out of the rail's own 0..220 CSS px column at 2x and looked at), and it
reverses the note this paragraph carried for three rounds, which said both frames read
`U` / `User` and cited a 15,997/763,840 (2.09%) edge-only diff. Design round 5's D2
filed exactly that: the committed `02` was the resolved variant while the prose
withdrew it. The diff here, counted per pixel over the rail's own device columns 0..440
with any channel differing at all (tolerance 0, `01` vs `02`, 440 x 1736 = 763,840
pixels): **7,960 differing, 1.04%** — 7,003 (0.92%) if each pixel is judged at a
tolerance of 8 per channel. Design's own count over the region was 41,511 (5.43%),
i.e. a stricter per-channel arithmetic over the same columns; the two agree on the fact
and differ only in how a changed glyph is counted. The resolved ink is the chip's own:
the avatar's `U` becomes `DT` and the one-line `User` becomes a name over an address.
**AND IT IS A BOOT-TIMING PROPERTY, NOT A RULE OF THE PAIR.** The second run of this
same head, minutes later, produced a pair in which BOTH frames read `U` / `User` and
the rail columns differ by 0 pixels at tolerance 0 — which is what round 2 saw. So the
claim here is about THIS pair and no more: it shows the profile resolving, the pair is
not evidence that it always does inside the frames' own window, and the reflow claim
does not rest on it at all (the page area's top edge is 78 -> 119 measured inside each
frame, from the row's own 41 px band).

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
# THE FRAMES IN THIS DIRECTORY ARE FROM THE ROUND-5 RUNS ON THIS HEAD: `origin/main` =
# `60c1dc615` (`chore(release): bump version to 0.29.11`, #412 — `d109863e2`, PR #407's
# rig-focus change, is its ANCESTOR, not the base) plus this round's one commit — the
# wrap GATED on the row's own width (R5-1 / D1), which is what puts the default window's
# row back to one line, plus the nits that came with it. All TEN frames were re-taken on
# a REBUILT app (`out/` is gitignored, and the row's own classes changed, so a stale
# bundle would photograph the previous layout). Five of the ten differ from round 4's
# set byte for byte (`02`, `04`, `05`, `07`, `10`); the other five are identical, which
# is the determinism the two runs of this head also show. The frames committed are the
# FIRST run's; the transcript quoted below is that run's, and the second run of the same
# head — run for QA's Q6, on the same script — recorded the same 69 checks, the same 0
# FAIL and the same three BLOCKED, label for label.
```


WHAT THE BOUNDS IN THAT RIG ARE FOR, MEASURED ON THIS BOX (2026-09-19, load 100-190
with ~25 sessions): every wait in it is a ceiling on the PRODUCT answering, and the
first version of them was tuned on a quiet machine — which is how a run here failed in
three ways that had nothing to do with the change. The host took ~210 s to write its
state file (its main thread is in V8 compiling the bundle — sampled, not guessed), so
the wait for it is 300 s rather than 60. The debugging TARGET exists before its first
navigation COMMITS, so the rig now waits for the renderer's own `file://` document
before writing a route into it: writing `#/browser` into the pre-commit `about:blank`
document is how `A0` reported `hash: ""` on a head whose renderer paints that route in
~7 s. And the host's own `loadURL("about:blank")` — the call that gives a fresh view a
renderer before `debugger.attach` — timed out at its then-5 s vendored ceiling, which is
why `policy/adapter.ts` gives that bound its own measured 15 s
(`WEB_CONTENTS_DEADLINE_MS`) instead of aliasing the driver's browser-IPC number.

The rig prints its own transcript to stdout — **69 checks recorded, 0 FAIL, 3 BLOCKED**
on the first of the two runs this round's frames came from (the second run of the same
head agrees check for check; the frames in this directory are the FIRST run's) — and
writes `transcript.json` beside
the frames; each frame is the renderer's own `Page.captureScreenshot` composited with
the page as the HOST's `screenshot` action returns it, at the rectangle the renderer
reports to main. Frames are encoded to `.webp` at quality 90.

**THREE CHECKS ARE BLOCKED: THE TWO ROUND-2 CASES THIS RIG CANNOT DRIVE, AND ONE
MISSING VENV** —
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
- `F1` (a credential file is refused before it can be attached) is blocked because the
  check drives the harness's own policy path through this worktree's `.venv`, and this
  worktree has none: it is a UI checkout with no Python environment, and the check
  reports the missing interpreter rather than a pass. It is the third blocked case
  round 5's R5-7 caught this section undercounting — the run has recorded three since
  the venv was absent, and the two above are the ones this section explains.

**THE RUNTIME CAP'S ASSERTION IS THE RULE AND THE DISCARD, and the byte readings
beside it are reported rather than gated** (`G12`, and this changed in round 3 for QA
Q6). `overrun` on a chunked body can only come from the host's own sampler —
Chromium's `updated` is silent for one, which is the whole of Q4 — so the rule
firing, with the partial discarded and nothing on disk, is the property a loaded box
cannot fake; the case fails if the sampler ever stops bounding the write, because the
refusal would then come at the call's deadline. The OVERSHOOT is a reading of the
machine, not of the code: the host samples every 100 ms, so the write runs on by one
sample interval of throughput (~52 MiB at the ~525 MiB/s this box writes), and a
starved main process makes that interval late — **8.9 MiB (76 ms past the cap) on an
idle box, 58.8 MiB (219 ms) and 60.2 MiB (182 ms) busy, 125.5 MiB (399 ms) at load
124, and 515.2 MiB (1,030 ms) at load 100+** while another session's evidence sweep
ran. Those are the same code path at different scheduling latencies. The two runs this
round's frames came from, on this head minutes apart and at load 100-140, both read
**805,306,368 bytes read at cancel (512.0 MiB over the 256 MiB cap)** — 392 ms past the
cap after 2301 ms of writing in the first run, 11 ms after 2133 ms in the second — and
the size they converge on is the rig's own fixture backstop (768 MiB: the origin stops
pushing there), which is the instrument that carried the bound in both runs rather than
the host's sampler. The disk poller corroborated both: 801,243,127 bytes in the first
run (LESS than the host had counted, which is the relationship this check asserts —
the host counts bytes received, the disk holds bytes written) and 805,306,368 in the
second (equal, which the assertion `disk <= host` also satisfies). The host's RULE
fired in both — `overrun`, the partial discarded, the quarantine directory empty —
which is the part that is not a reading of the machine. Earlier runs of the previous
head, at load 100+, read 406,519,575 (138.1 MiB over, 340 ms) and 376,307,685 (107.9
MiB over, 382 ms). The disk poller
is the cross-check beside the host's own reading: it sees the partial under its final
name, and it can only see LESS of it than the host counted (the host counts bytes
received, the disk holds bytes written) — a relationship that holds whatever the box
is doing, which is why it is the one bound asserted. QA round 2's regression, for
comparison, read **734,003,200 bytes (2.7x the cap) with the server still pushing and
no bound at all** under the `updated`-only trigger this replaced. WHICH INSTRUMENT
CARRIES THE CHECK is what round 3 changed: the disk poller used to be the assertion's
premise (`crossedAt > 0`), so a starved Node process could fail the case without the
code being wrong — two runs of one head went FAIL then PASS, and QA's own 5 ms poller
measured an effective 19-33 ms tick on this box. A child process does not fix that
(the starvation is machine-wide rather than the rig's own event loop), so the check
asserts the host's reading at cancel and the poller's agreement, and reports the
poller's tick gap, the write's duration and the server's pushed bytes beside them.

**And it deliberately does NOT bound the overshoot any more** (design round 4, R4-3),
so that no later reader takes it for the bound this feature does not have:
`hostReadAtCancel > DOWNLOAD_CAP_BYTES` holds for a slower sampler cadence and for a
starved main process alike — the two are indistinguishable from this instrument — and
the spread in the readings above is the proof that a byte ceiling there would gate the
machine's load rather than this code. A sampler that stops firing entirely still fails,
through the `overrun` rule and the empty directory beside it.

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
the operator's paired profile); and the window itself (the run is headless by design,
so the pixels come from the app photographing itself rather than from the desktop).
The app's MINIMUM window is here from round 3 on, as `09`, with the caveat its own
row states: the width is pinned by the emulation domain rather than by resizing a
window, because this Electron's CDP exposes no window bounds. The
`browser-file-transfer-row/*` story `LongNameAtMinimumWindow` renders the same width
against a decorator, which is where that state lived before it had a frame of its own
— a rendered row, but not the app.
