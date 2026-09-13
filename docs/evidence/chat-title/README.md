# The header and the row it was opened from

The reported defect: clicking into a conversation changed it to **Untitled
chat** when it already had a title. These frames are the pair that shows it, on
the two trees, at the same viewport, through the same script.

| | `origin/main` (`a09f2e6f4`) | this branch |
| --- | --- | --- |
| click the row named from its opening message | **`Untitled chat`** over a row reading `Improve the ask function clickable options` | `Improve the ask function clickable options` |
| click the row with a journalled title | **`Untitled chat`** over a row reading `Retention sweep notes` | `Retention sweep notes` |
| click the session with no nameable opening message | `Untitled chat` | `Untitled chat` (unchanged) |

A note on what the second row demonstrates. `Retention sweep notes` is a
JOURNALLED title, but its session carries no turn-end checkpoint, so its live
`conversation_title` is empty on the wire (verified by QA's independent pass
against this same seeded backend). That pair is therefore the **catalogue
fallback** at work — the fix reading the row's name where the live field is
blank — and not the "live title wins" path, which the live-first branch covers
and which the unit suite pins (`a live title wins, so a rename still shows where
it landed`). The two are deliberately separate claims here rather than one.

## What produced these frames

**The real built Electron app, not Storybook and not a browser.** Each tree was
built with `pnpm build` and then run from its own `out/` with
`npx electron . --remote-debugging-port=<port> --user-data-dir=<scratch>`, so
`import.meta.env.DEV` is false and the development-only `Chat | Raw` tab strip
does not exist. That detail is load-bearing rather than incidental: under
`electron-vite dev` the strip is rendered and paints over the chat header, which
is how a first attempt at this evidence produced byte-identical "before" and
"after" frames with a perfectly correct DOM — the subject was covered.

What is real: the app's own main and preload processes, its real IPC desktop
transport, its own stores, the real sidebar and the real header, and a real
`local-operator serve` backend.

The backend is **isolated**: `LOCAL_OPERATOR_CONFIG_DIR` / `LOCAL_OPERATOR_HOME`
point at a scratch directory and the store is written by
`out/evidence-harness/seed.mjs`, so no request can reach the operator's own store
on 1111. The app and the backend are paired through a shared
`LOCAL_OPERATOR_DESKTOP_TOKEN`. The before tree is a detached worktree at
`a09f2e6f4` with the same script, the same seeded backend and its own window.

The store holds three conversations, chosen so each branch of the name
resolution is falsifiable:

- **opener-named** — a transcript whose opening user message is the only thing
  naming it, and no title sidecar. `resume.session_name()` names the row from the
  opener; the live `conversation_title` is empty. This is the defect.
- **journalled** — a `title.json` sidecar, `Retention sweep notes`, whose opener
  is a *different* string, so a header that fell back to the opener would be
  visible rather than plausible.
- **nameless** — a transcript with no opening message at all, which must still
  read `Untitled chat`.

Each row was clicked with a real `Input.dispatchMouseEvent` press/release at the
row's own coordinates — never by calling the store — and the header was read from
`[data-tour-tag="chat-header"] h2` at the same moment the frame was taken.

### One intervention, applied to both trees

The app's own danger banner ("The server is offline…") is hidden in these frames.
It is there because the harness points the app at a backend on a port of its own
and the built renderer's CSP allows only 1111/8080 for its legacy REST probes —
a fact about this setup, not about the change (`docs/evidence/send-error/README.md`
records the same strip in the same setup). Here, unlike there, it matters: the
banner is laid across the top of the chat column, which is exactly where the
header is.

The element is found by asking the document what is at the header's own centre
and hiding it until the header is topmost, and the frames are only taken once
that has been verified — a frame whose subject is not the topmost element at its
own centre fails the run. `visibility: hidden`, not `display: none`, so the
element keeps its box and the geometry the app laid out is unchanged. The same
clearing runs on both trees, which is what keeps a pixel comparison between them
meaningful.

## The measurement, per pair

`magick compare -metric AE`, full frame and the header band
(`1760x120+980+0` in device pixels — the header rect is `{x:500,y:0,w:880,h:56}`
at a device pixel ratio of 2, so the band is generous around it):

| pair | theme | full frame | header band |
| --- | --- | --- | --- |
| `open-alpha` | localOperatorDark | 215254 | **36148** |
| `open-alpha` | localOperatorLight | 227343 | **33235** |
| `open-bravo` | localOperatorDark | 33259 | **9089** |
| `open-bravo` | localOperatorLight | 37224 | **7583** |
| `open-charlie` | localOperatorDark | 574344 | 1940 |
| `open-charlie` | localOperatorLight | 544136 | 2158 |
| `rest` | localOperatorDark | 33725 | 0 |

`open-alpha` is the claim: a sixth of the header band changes (36148 of
211,200 px, the crop's own 0.171155), and it changes to the row's own name. `open-charlie` is the control that must NOT change with it —
both trees read `Untitled chat`, and its small non-zero delta is elsewhere in the
frame (the sidebar's own selected-row treatment after a different sequence of
clicks), not in the title text.

Geometry asserted before every frame, and recorded in the run's JSON: window
`1380x872` CSS at `devicePixelRatio 2`, header `{x:500,y:0,w:880,h:56}`, its `h2`
`{x:560,y:7,w:760,h:22}`, no `[role="tablist"]` in the document.

## What these frames do NOT prove

- **Not the packaged/notarised build.** This is the real main and preload
  processes running from a build output tree; code signing, the DMG and the
  updater are not exercised.
- **Two themes, not twelve.** `localOperatorDark` and `localOperatorLight` — the
  two brand palettes — at one window size, 1380x872.
- **Not the transient blanking of the row.** The click-through frames show the
  header and the selected row agreeing after the change and disagreeing before
  it, but the row's own transient blanking is not among them: the set was taken
  with three samples after the click (~1s, ~2s and past the 5s catalogue poll),
  and on both trees the three were BYTE-IDENTICAL, so they were not committed -
  a frame that repeats its sibling is not evidence of a second state. That half of
  the defect is pinned by the unit suite instead, which drives the store merge
  directly (`scripts/chat-title.test.mjs`).
- **No model inference.** No turn is sent; what is proven is which name each
  surface wears, not what an agent would then reply.
- The offline banner is hidden, as described above.

## Re-capturing this set

**`pnpm capture-evidence` cannot re-derive these frames** — no story renders the
chat header or the sidebar — so the set is declared `supplementary` in
`manifest.json` and a routine sweep leaves it alone. To re-take it:

1. `pnpm build` in each tree, with the four OAuth client variables set (the
   renderer config refuses to load without them) — the build's own env, not this
   harness's concern.
2. `bash out/evidence-harness/run-app.sh` (gitignored, like the rest of `out/`).
   It seeds the isolated store, starts the backend, runs the built app from each
   tree in turn with its own `--user-data-dir` and CDP port, and drives
   `out/evidence-harness/app-drive.mjs` over raw CDP for both palettes. The driver
   takes three samples after the click; the duplicates they produce on this store
   were dropped from the committed set, so a re-capture should expect sixteen
   distinct frames out of twenty-four taken.
   `BASELINE=…` points it at the before tree; it refuses to capture if a port is
   held by a process it did not start.
3. Assert before committing: no two frames in the set share a SHA-256 (sixteen
   frames, sixteen hashes), and every CLICKED state's `before-*` frame differs
   from its `after-*` counterpart in the header band — `magick compare -metric AE`
   over the crop above. The `rest` pair is the exception and must stay one: it is
   the control, the header is absent before a conversation is open, and its band
   delta is 0 by design in both palettes (and 0 it must remain — a non-zero delta
   there means something moved that no finding claims).

The harness and the driver are gitignored because they exist to take evidence,
not to run in CI; the numbers above are what a reviewer checks them against.
