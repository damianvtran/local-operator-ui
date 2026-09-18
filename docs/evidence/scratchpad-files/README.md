# `scratchpad://` in the Files panel, and in the canvas

Five frames from the **real built app**, driven headless against a **real
isolated backend**, over a **real transcript** - one produced by an actual agent
turn that wrote four files through `scratchpad://`. They exist because the claims
under review are claims about a running application:

- the panel's content is *inferred* from transcript text rather than carried on
  the wire, so nothing in `test:desktop` can show that the absolute path a
  scratchpad result prints becomes a tile - or that an ABBREVIATED path does
  **not**;
- whether a `.txt` file reaches the app's own editor is a claim about a surface,
  and the routing branch that decides it is only half the story (see *The `.txt`
  branch* below).

| frame | what it shows |
| --- | --- |
| [`scratchpad-files-panel-before.png`](scratchpad-files-panel-before.png) | The SAME transcript on the BASE tree: the panel head reads `6 files`, and two of the six tiles are phantoms - `run.md` and `probe.sh`, both `No longer on disk` - invented from the guide's own example lines. |
| [`scratchpad-files-panel.png`](scratchpad-files-panel.png) | The same session on this tree: `4 files`, exactly the four files the transcript's `write` results named, and no phantom. |
| [`scratchpad-markdown-canvas.png`](scratchpad-markdown-canvas.png) | `perf.md` open in the canvas: the markdown WYSIWYG editor, a heading and three bullets, the file's name on its tab. |
| [`scratchpad-csv-canvas.png`](scratchpad-csv-canvas.png) | `metrics.csv` open as a spreadsheet: the ag-grid `Sheet1` view of the header row and its three data rows. |
| [`scratchpad-text-canvas.png`](scratchpad-text-canvas.png) | `session-log.txt` open in the app's own editor - CodeMirror's `.cm-editor`, line numbers and all. |

All five are clipped to the canvas panel (`[data-tour-tag="canvas-container"]`'s
own measured rect, 659x868 CSS px = 1318x1736 at devicePixelRatio 2), so none
carries the sidebar, the session list or the transcript.

```
aed35221da88585bae851ad20ccd18073a3cfcebeac20686780c54feb77d630d  scratchpad-files-panel-before.png  43545 B
01361ab8c538a3236c68ea16cc0683ec54e03087c2766c587a26fbcfee7a7327  scratchpad-files-panel.png         31764 B
d25484d7a33ab13824ee3a9276fa8e0e90bed07d6220e7fda6bc3a3059154ccf  scratchpad-markdown-canvas.png     73919 B
9782e2aa8f0dea488ffe07782440e3c09eeb5cb4673e88541d770daa73ef89ab  scratchpad-csv-canvas.png          40382 B
68ca92d87650332d3443c0fc64a0defd22d7dd1aaa35fe99153623cdc4a8440a  scratchpad-text-canvas.png         48919 B
```

The panel pair differs by **15,273 pixels (0.67% of the frame)** - `magick
compare -metric AE` - which is two tiles and one word of head copy, and nothing
else. The two panel frames are byte-comparable because they are the same session
on two builds: same names, same order, same grid.

**Both panel frames survived the rebase byte-for-byte.** `scratchpad-files-panel.png`
and `scratchpad-files-panel-before.png` were re-captured on the rebased tree, from
a session with a different id, and came back with the SAME sha256 - 0 differing
pixels from the frames committed before the rebase. That is the reading that says
main's movement did not disturb this surface (see *Why the frames still describe
this tree*).

### Why the frames still describe this tree

The frames were first taken on `3a5b66c54` and the branch has since folded two
windows of `main` onto itself. Main's movement names the panel's own host files,
so "nothing visual changed" has to be shown rather than assumed:

- `chat-content.tsx` and `chat-page.tsx` DID change (+26 and +46 lines). Every
  line is composer @-mention plumbing - `mentionsEnabled` and `mentionsUnsupported`
  props threaded to `MessageInput` - and no line touches the canvas host, the
  Files grid, the canvas container or any geometry the frames measure.
- Nothing else in the render path moved: `git diff --stat` over
  `features/chat/components/canvas/`, `features/chat/canonical/`,
  `shared/themes/` and `styles/` is empty for both windows.
- And the measurement agrees with the reading: the panel frame re-captured on the
  rebased tree is **byte-identical** (0 differing pixels, same sha256), and the
  `-before` frame likewise. A layout shift inside the canvas container would move
  both.

The canvas frames are re-taken from the run the rebased harness performs, so the
whole set is one session on the current tree - the panel pair happens to hash the
same as before, the three canvases carry the new run's own file contents.

### What a fresh reader reproduces, and what they do not

`run-scratchpad-files.sh` needs: `HOME` and `PATH` with the repo's own `electron`
and `pnpm`, the sibling backend worktree at `$BACKEND_ROOT` (default
`~/workspace/repos/lo-notes-protocol`) with its `.venv` and the `scratchpad://`
feature, a provider credential at `$HOME/.local-operator/credentials.env`, a free
port `1149`, and `python3` for the seeding step. `ISO=` names the scratch tree; it
is created (`mkdir -p`) if it does not exist and then resolved to its physical
path, so any writable location works. Port 1149 in use by another run is the one
environmental hazard: the script starts its own backend and fails loudly if that
backend does not answer.

Reproducible from the script alone: **`scratchpad-files-panel.png`**,
**`scratchpad-markdown-canvas.png`**, **`scratchpad-csv-canvas.png`** and
**`scratchpad-text-canvas.png`** (four of the five - its own turn, its own seeding
step, its own capture).

NOT reproducible from the script: **`scratchpad-files-panel-before.png`**, which
needs a second build of the same tree with the extractor checked out from main:

```sh
git checkout origin/main -- src/renderer/src/features/chat/canonical/mentioned-files.ts
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:1149 pnpm build
# re-run the driver against the same scratch tree and session:
NOTES_EVIDENCE_SCRATCH=$ISO LOCAL_OPERATOR_CONFIG_DIR=$ISO/config \
  LOCAL_OPERATOR_DESKTOP_TOKEN=$(cat $ISO/token.txt) \
  node docs/evidence/scratchpad-files/harness/scratchpad-files-proof.mjs $ISO/frames-before $SID
git checkout HEAD -- src/renderer/src/features/chat/canonical/mentioned-files.ts
```

It is committed rather than merely described because it is the half that shows
the defect: a reader who runs only the script sees a four-tile panel and no reason
to believe it was ever anything else.

## What produced these frames

```sh
bash docs/evidence/scratchpad-files/harness/run-scratchpad-files.sh   # SKIP_BUILD=1 to reuse out/
```

The harness is committed beside its frames (`harness/`), not left in the
gitignored `out/`: it is the only reproduction of this set, and a command that
resolves for nobody but its author is not one. It is three files:

- `run-scratchpad-files.sh` - the whole sequence: one real agent turn that reads
  the scheme's guide and writes four files through `scratchpad://`; the replay of
  the two placeholder lines (below); an isolated `local-operator serve` over the
  session it produced; `pnpm build` with `VITE_LOCAL_OPERATOR_API_URL` pointed at
  that backend; and the driver.
- `scratchpad-files-proof.mjs` - boots the built app headless and drives it over
  raw CDP: navigate to the session, open the canvas, settle on the Files view,
  clip-frame the panel, then click each tile and clip-frame the canvas.
- `seed-placeholder-lines.py` - see *Why the harness replays two lines*.

The `before` frame is the same driver, the same session and the same backend on a
build where ONE file is main's - `src/renderer/src/features/chat/canonical/mentioned-files.ts`,
the extractor, checked out from `origin/main` and then restored. That is a
narrower base than round 1's, which used the whole pre-PR tree, and a better one:
the two builds differ by the extractor rule and nothing else, so the pair isolates
the fix rather than the fix plus a rebase.

### Why the harness replays two lines

The panel's extractor is exercised by transcript TEXT, and the text that produced
the phantom tiles came from the backend guide's own examples:

```
`scratchpad://logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`
the printed path (`bash /…/scratchpad/probe.sh`, `eval`, `grep`)
```

The guide has since been edited to drop them, so a fresh run no longer carries
either line - and a fresh run would show a four-tile panel for the WRONG reason
(there is nothing abbreviated in the transcript to reject). `seed-placeholder-lines.py`
replays the two lines as a transcript record so the before/after is honest and
reproducible: the base tree tiles six files from this transcript, this tree tiles
four. The record is a copy of a real assistant row from the same transcript with
its text replaced, so it is the shape the reducer already parses; the turn, the
four files it wrote and their tool results are the run's own.

**Which backend produced the transcript, exactly.** The feature is not yet on the
backend's `main`: the run used the sibling worktree
`~/workspace/repos/lo-notes-protocol` at
`ba225070f12180d18c22dbab20d25048577f5542`, with the feature present as
working-tree changes - `local_operator/scratchpad.py` sha256
`5d831ca41be1f08a744d672486cd30cec09063919cd5f472db43b0b67b70699a`, and
`local_operator/guides/scratchpad/GUIDE.md` sha256
`f46111c2341f3c7a874bc98b12eafa032d234b200700f86b628cc630066212d1` as it stood at
the run. Every string the panel inferred from is the feature's own:

```
Created scratchpad://run/perf.md -> /private/tmp/…/sessions/7208bfe8ee16/scratchpad/run/perf.md
Created scratchpad://run/metrics.csv -> /private/tmp/…/sessions/7208bfe8ee16/scratchpad/run/metrics.csv
Created scratchpad://run/session-log.txt -> /private/tmp/…/sessions/7208bfe8ee16/scratchpad/run/session-log.txt
Created scratchpad://run/run-config.json -> /private/tmp/…/sessions/7208bfe8ee16/scratchpad/run/run-config.json
```

The turn ran on `openrouter/deepseek/deepseek-v4.1-flash` (the selector the
session's own `selected_model` record names) with `--yolo`. The model
is named because it is the one thing here a reader cannot reproduce
byte-for-byte: the files' *content* and the frame hashes will differ on another
run. What is not model-dependent is everything under test - the URL in the
arguments, the resolved absolute path in the result text, the file on disk under
the session's `scratchpad/` directory, and the readings below.

**The isolation is enforced, not intended.** Scratch `HOME`,
`LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR`, a scratch
`--user-data-dir`, and the app launched with a **scratch cwd** and an ABSOLUTE
app path - because `src/main/backend/config.ts` loads `.env` from
`process.cwd()` with dotenv `override: true`, so the scratch cwd's `.env` is what
the app resolves and the worktree's own cannot win. `CMUX_*` and `LOP_*` are
stripped from the child environment. The run refuses to start unless the isolated
backend answers `/v1/desktop/sessions` with this run's token and the app reports
`desktop_available: true`. The scratch tree is named by its PHYSICAL path, once:
macOS's `/tmp` is a symlink to `/private/tmp`, and the backend resolves every
scratchpad path with a realpath, so a tree named by one spelling and resolved by
the other yields two tiles for one file - measured, a panel of nine tiles for
four files, before that line was added.

**Nothing raised a window.** The app's own line in the run's log:

```
[window-mode] state: visible=false focused=false focusable=false size=1380x900 content=1380x868
```

`document.visibilityState` reads `visible` in the same run, and that is the mode
working rather than a contradiction: a `headless` launch keeps the page
UNTHROTTLED while the window is never shown (`src/main/window-mode.ts`). The
window's state is the app's own line above; the page's is not evidence about it.

**The first-run wizard was dismissed on purpose, and the frame says so.** A fresh
scratch Electron profile is a first-run profile, and the first capture this rig
took had `Step 1 of 6` covering half the panel. The rig now writes the wizard's
own persisted flags (`onboarding-storage`: `isModalComplete` **and**
`isTourComplete` - a completed modal with an incomplete tour starts the Shepherd
tour, which spotlights the surfaces being photographed) into the scratch profile
and reloads, then walks anything still on screen with real presses of the
wizard's buttons. The run refuses to capture while a dialog remains.

## The readings, from `report.json`

```
BASE (3a5b66c54)   panelCount 6   head "6 files"
                   …/scratchpad/run/perf.md          markdown    present
                   …/scratchpad/run/metrics.csv      spreadsheet present
                   …/scratchpad/run/session-log.txt  text        present
                   …/scratchpad/run/run-config.json  code        present
                   /scratchpad/logs/run.md           markdown    missing   ← phantom
                   /…/scratchpad/probe.sh            code        missing   ← phantom

HEAD (this branch) panelCount 4   head "4 files"  - the four real files and nothing else

txt tile           .cm-editor 1, ag-grid rows 0  → the app's own editor
csv tile           ag-grid rows 3                → the spreadsheet viewer
md  tile           [contenteditable] 1           → the markdown WYSIWYG editor
```

The four tiles are the whole of what the transcript's four `write` results named,
and the four `read` results that followed add no fifth: a read prints
`<url> -> <path>` for a path already mentioned, so it is the same tile. A `read`
of the DIRECTORY also adds none - it prints the root's absolute path (a
directory, no extension) and its entries by bare name. That is the backend's
deliberate trade, and this run measures it rather than repeating the design
document.

The `.json` file is in the panel and opens as code; no frame of it is here because
the markdown, spreadsheet and text surfaces are the three the panel's routing
table answers differently from each other.

**Scratch scripts are covered by the contract tests, not by a frame here.** The
guide names script sources as one of the shapes the folder holds, so
`scripts/mentioned-files.test.mjs` asserts that `<scheme>run/rollout.sh`,
`<scheme>run/rollout.bash` and `<scheme>run/collect.py` each resolve to exactly
one tile from the absolute path their result prints, and that all three route to
the code editor rather than the markdown one (a shebang rendered as a heading is
the failure that table exists to catch). Both extensions were already in
`KNOWN_EXTENSIONS` and already routed to `code`, so no `file-kind.ts` change was
needed; this run wrote no script, so there is no frame of one rather than a frame
of something the run did not do.

## The abbreviated path, and the phantom tile

The two phantom tiles in the `before` frame are the extractor's documented worst
failure - a tile for a file that does not exist - and they come from two different
placeholder shapes, both measured in review round 1:

- **the tail of an angle-bracket template.** `<scheme>logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`
  is one templated path. The scanner stops at `<` (excluded from the token class)
  and used to resume at `/scratchpad/logs/run.md` after the `>`, admitting the
  placeholder's tail. `>` is an allowed prefix because a shell redirect
  (`convert in.png > /tmp/out.png`) is a real mention, so the seam cannot be
  closed by rejecting `>`.
- **an abbreviated path.** `/…/scratchpad/probe.sh` - an ellipsis standing where a
  directory name was elided - was admitted whole, because the ellipsis is a legal
  character in a filename.

Both are rejected now, in the one place candidates are canonicalised, so every
tier shares the rule: `…` (U+2026) joins the placeholder-marker class, and a
candidate whose path contains a segment of three or more dots is an abbreviation
too. The two rules are pinned against the exact measured strings in
`scripts/mentioned-files.test.mjs`, which also asserts the negatives that keep the
rule honest: a real scratchpad result still tiles, and `convert in.png > /tmp/out.png`
and its unspaced spelling `convert in.png>/tmp/out.png` are still mentions.

**The placeholder guard is deliberately narrow, and review round 2 is why.**
"The word before the candidate ends with `>` and contains a `<`" is also every
HTML tag, every TypeScript generic and every heredoc or closing tag glued to a
path - measured, `use <code>/tmp/real/notes.md`, `done </b>/tmp/real/notes.md`,
`Map<T>/tmp/notes/real.md`, `<br/>/tmp/notes/real.md`,
`compare <image-a.png>/tmp/real/notes.md` and `cat <<EOF>/tmp/real/notes.md` are
all real mentions that the first version dropped. So the placeholder must also
LOOK like one: the text before its `<` has to be path-like - non-empty and
carrying a `/` - which keeps `/…/sessions/<id>/…` (its head is `/…/sessions/`) and
drops the tags, the generics and the glue, while a `<` at the start of a word can
never qualify. Both directions are asserted. The residual trade is stated in the
code: a word that is BOTH path-like and carries a generic (`a/b<T>/tmp/real.md`)
still loses the path after it, and no transcript in this corpus produces that
shape.

**The trade, stated rather than discovered later:** a real file whose NAME
contains an ellipsis is admitted by no tier here. That is this module's standing
direction - a missing tile, never a tile for a path no file has - and the
asymmetry is deliberate: a character that means "text was removed" is the one
thing a text-inferring scanner cannot tell from a name. It has its own test.

**What changed in the existing suite:** nothing. The 50 rows that passed on
`95181c3cc` still pass unchanged (each new rule's fixtures are new rows), the row
that used to PIN the phantom tile is now the row that asserts it is gone, and the
suite is 52 rows. Verified the other way too: reverting the extractor hunk turns
the new assertions red and leaves every old row green.

## The `.txt` branch: a guard, not a user-visible fix

**Round 1's first claim - and this README's own - was wrong, and the correction is
here rather than quietly dropped.** The branch that answers `code` for
`.txt`/`.log`/`.text` does NOT change what a user sees, and the base tree never
opened these files in TextEdit:

| call | base | head | the app reaches it? |
| --- | --- | --- | --- |
| `viewerFor(path, "text")` | `code` | `code` | **yes** - this is the panel's call, and it was already `code` |
| `viewerFor(path)` | `null` | `code` | no - both call sites pass a type |
| `viewerFor(path, "other")` | `null` | `code` | not for a `.txt` document; its type is derived from its own path |

Both production call sites (`canvas-file-viewer.tsx`'s click, `canvas-content.tsx`'s
render) pass the document's type, a canvas document's type is derived from its
path (`canvas-document.ts` → `getFileTypeFromPath` → `fileKind`), and
`TYPE_KINDS.text = "code"` is on the base too. So the answer for a `.txt` tile was
already `code` through the type fallback, and QA round 1 confirmed it in the app:
the base build opens the `.txt` tile in the app's own CodeMirror editor with **no
OS handoff at all** (they instrumented `shell.openPath` in both builds and
recorded zero calls in either).

What the branch therefore is: a GUARD that stops the routing table disagreeing
with itself. `fileKind` calls these extensions `"text"`, the tile shows that type,
and the table answered `null` - the documented "hand it to the OS" - for the
type-less call. It is pinned because it is correct, and it is described as a guard
because that is what it is; the release line and the PR body were corrected in the
same round. Because the change is not user-visible, no `before` frame is due for
it, and there is none.

The one semantic change it carries is precedence: the branch sits ABOVE the `type`
fallback, so a document whose type disagrees with its path now routes by the PATH.
That is deliberate - the path is the stronger evidence of format, and in every
production construction the type is derived from that same path - and it is pinned
by a test with the three rows a 61-row base/head matrix moves
(`/x/weird.txt` as `spreadsheet` and as `image`, `/x/weird.log` as `markdown`).

## Why these are PNG and not part of the sweep

`pnpm check-evidence` walks `.webp` under `docs/evidence`, which is the Storybook
sweep's format; these are live-app frames from a real backend, and they are
committed as `.png` from the CDP screenshot of the app's own window - the same
position `docs/evidence/renderer-driver/` occupies. Nothing here is capturable by
the sweep at all: its fixtures have no scratchpad directory, no session to infer a
tile from, and no transcript text to abbreviate.
