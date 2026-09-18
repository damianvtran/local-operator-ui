# `scratchpad://` in the Files panel, and in the canvas

Four frames from the **real built app**, driven headless against a **real
isolated backend**, over a **real transcript** - one produced by an actual agent
turn that wrote its files through `scratchpad://`. They exist because the two
claims under review are claims about a running application:

- the panel's content is *inferred* from transcript text rather than carried on
  the wire, so nothing in `test:desktop` can show that the absolute path a
  scratchpad result prints becomes a tile;
- `.txt` routing is a claim about which surface opens a file, and the difference
  between the app's own editor and the platform's is pixels.

| frame | what it shows |
| --- | --- |
| [`scratchpad-files-panel.png`](scratchpad-files-panel.png) | The panel's `4 files` head over exactly the four tiles this run's transcript produced - `perf.md`, `metrics.csv`, `session-log.txt`, `run-config.json` - and nothing else. |
| [`scratchpad-markdown-canvas.png`](scratchpad-markdown-canvas.png) | `perf.md` open in the canvas: the markdown WYSIWYG editor, a heading and three bullets, the document's name on its tab. |
| [`scratchpad-csv-canvas.png`](scratchpad-csv-canvas.png) | `metrics.csv` open as a spreadsheet: the ag-grid `Sheet1` view of the header row and its three data rows. |
| [`scratchpad-text-canvas.png`](scratchpad-text-canvas.png) | `session-log.txt` open in the app's OWN editor - CodeMirror's `.cm-editor`, line numbers and all. This is the frame the routing fix exists for; see *The `.txt` change* below. |

All four are clipped to the canvas panel (`[data-tour-tag="canvas-container"]`'s
own measured rect, 659x868 CSS px = 1318x1736 at devicePixelRatio 2), so none
carries the sidebar, the session list or the transcript.

```
c0983c5edd0a1f14de94efe6871af183e28d79779b3778e1d61936d5026a809a  scratchpad-csv-canvas.png       41663 B
01361ab8c538a3236c68ea16cc0683ec54e03087c2766c587a26fbcfee7a7327  scratchpad-files-panel.png      31764 B
27c5c878d42a490d49ae5ab571c4932b42d4995d5938d9111ea4c049160ab453  scratchpad-markdown-canvas.png  69014 B
aa0b9f7be32db150e4b0f55af02e1304e0d7fffe4c9416cb0f1bd19468f68894  scratchpad-text-canvas.png      49832 B
```

## What produced these frames

```sh
bash out/evidence-harness/run-scratchpad-files.sh        # SKIP_BUILD=1 to reuse out/
```

That script is the whole sequence: one real agent turn that writes four files
through `scratchpad://`; an isolated `local-operator serve` over the session it
produced; `pnpm build` with `VITE_LOCAL_OPERATOR_API_URL` pointed at that
backend; and `out/evidence-harness/scratchpad-files-proof.mjs`, which boots the
built app headless and drives it over raw CDP. The frames committed here are the
output of exactly that command, run in one pass.

**Which backend produced the transcript, exactly.** The feature is not yet on the
backend's `main`: the run used the sibling worktree
`~/workspace/repos/lo-notes-protocol` at
`ba225070f12180d18c22dbab20d25048577f5542`, with the feature and its rename
present as working-tree changes - `local_operator/scratchpad.py` sha256
`5d831ca41be1f08a744d672486cd30cec09063919cd5f472db43b0b67b70699a`, and
`local_operator/guides/scratchpad/GUIDE.md` sha256
`f46111c2341f3c7a874bc98b12eafa032d234b200700f86b628cc630066212d1`. Every string
the panel inferred from is therefore the feature's own, not a paraphrase of it:

```
Created scratchpad://run/perf.md -> /private/tmp/…/sessions/c54fc0702a3d/scratchpad/run/perf.md
Created scratchpad://run/metrics.csv -> /private/tmp/…/sessions/c54fc0702a3d/scratchpad/run/metrics.csv
Created scratchpad://run/session-log.txt -> /private/tmp/…/sessions/c54fc0702a3d/scratchpad/run/session-log.txt
Created scratchpad://run/run-config.json -> /private/tmp/…/sessions/c54fc0702a3d/scratchpad/run/run-config.json
```

The turn ran on `openrouter/deepseek/deepseek-v4.1-flash` with `--yolo`. The
model is named because it is the one thing here a reader cannot reproduce
byte-for-byte: the files' *content* and the committed frame hashes will differ
on another run. What is not model-dependent is everything under test - the URL in
the arguments, the resolved absolute path in the result text, the file on disk
under the session's `scratchpad/` directory, and the four readings below.

**The isolation is enforced, not intended.** Scratch `HOME`,
`LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR`, a scratch
`--user-data-dir`, and the app launched with a **scratch cwd** and an ABSOLUTE
app path - because `src/main/backend/config.ts` loads `.env` from
`process.cwd()` with dotenv `override: true`, so the scratch cwd's `.env` is
what the app resolves and the worktree's own cannot win. `CMUX_*` and `LOP_*`
are stripped from the child environment. The run refuses to start unless the
isolated backend answers `/v1/desktop/sessions` with this run's token and the
app reports `desktop_available: true`. The scratch tree is named by its PHYSICAL
path, once: macOS's `/tmp` is a symlink to `/private/tmp`, and the backend
resolves every scratchpad path with a realpath, so a tree named by one spelling
and resolved by the other yields two tiles for one file - measured, a panel of
nine tiles for four files, before that line was added.

**Nothing raised a window.** The app's own line in the run's log:

```
[window-mode] state: visible=false focused=false focusable=false size=1380x900 content=1380x868
```

`document.visibilityState` reads `visible` in the same run, and that is the mode
working rather than a contradiction: a `headless` launch keeps the page
UNTHROTTLED while the window is never shown (`src/main/window-mode.ts`). The
window's state is the app's own line above; the page's is not evidence about it.

**The first-run wizard was dismissed on purpose, and the frame says so.** A
fresh scratch Electron profile is a first-run profile, and the first capture this
rig took had `Step 1 of 6` covering half the panel. The rig now writes the
wizard's own persisted flags (`onboarding-storage`: `isModalComplete` **and**
`isTourComplete` - a completed modal with an incomplete tour starts the Shepherd
tour, which spotlights the surfaces being photographed) into the scratch profile
and reloads, then walks anything still on screen with real presses of the
wizard's buttons. The run refuses to capture while a dialog remains.

## The readings, from `report.json`

```
mentionedFiles   4   (panelCount 4, panel head "4 files", scan settled)
tiles            …/sessions/c54fc0702a3d/scratchpad/run/perf.md          markdown    present
                 …/sessions/c54fc0702a3d/scratchpad/run/metrics.csv      spreadsheet present
                 …/sessions/c54fc0702a3d/scratchpad/run/session-log.txt  text        present
                 …/sessions/c54fc0702a3d/scratchpad/run/run-config.json  code        present
txt tile         .cm-editor 1, ag-grid rows 0  → the app's own editor
csv tile         ag-grid rows 3                → the spreadsheet viewer
md  tile         [contenteditable] 1           → the markdown WYSIWYG editor
```

The four tiles are the whole of what the transcript's four `write` results
named, and the four `read` results that followed add no fifth: a read prints
`<url> -> <path>` for a path already mentioned, so it is the same tile. A
`read` of the DIRECTORY also adds none - it prints the root's absolute path (a
directory, no extension) and its entries by bare name, and the prose tier
demands an absolute path *with* a known extension. That is the backend's
deliberate trade, and this run measures it rather than repeating the design
document.

The `.json` file is in the panel and opens as code; no frame of it is here
because the markdown, spreadsheet and text surfaces are the three the panel's
routing table answers differently, and those are the three the change touches.

**Scratch scripts are covered by the contract tests, not by a frame here.** The
guide now names script sources as one of the shapes the folder holds, so
`scripts/mentioned-files.test.mjs` asserts that `<scheme>run/rollout.sh`,
`<scheme>run/rollout.bash` and `<scheme>run/collect.py` each resolve to exactly
one tile from the absolute path their result prints, and that all three route to
the code editor rather than the markdown one (a shebang rendered as a heading is
the failure that table exists to catch). Both extensions were already in
`KNOWN_EXTENSIONS` and already routed to `code`, so no `file-kind.ts` change was
needed for them; this run wrote no script, so there is no frame of one rather
than a frame of something the run did not do.

## A false positive the transcript can carry, recorded rather than fixed

One run of this rig - the one taken before the rename, where the agent chose to
read the guide - produced a FIFTH tile, `/scratchpad/logs/run.md`, for a file
that does not exist. The agent had read the guide the feature ships, and the
guide teaches the result shape with this line:

```
`scratchpad://logs/run.md -> /…/sessions/<id>/scratchpad/logs/run.md`
```

The panel's extractor cuts the token at `<` (excluded from its character class)
and then resumes scanning at `/scratchpad/logs/run.md` after the `>` - and `>`
IS an allowed prefix, because a shell redirect (`convert in.png > /tmp/out.png`)
is a real mention. So the tail of that placeholder is admitted as a path.

This contradicts the scout's report to the effect that nothing about the scheme
leaves a junk tile in the panel: true of a scheme URL in tool *arguments*, false
of the guide's own example line, which any session that reads the guide carries.
The defect is the prose tier's missing placeholder guard - the file-url tier has
one (`URL_TRUNCATION`), the prose tier does not - so its fix belongs with that
tier's real-payload audit rather than in this change. It is pinned as a contract
test (`scripts/mentioned-files.test.mjs`, "the guide's own example line leaves
one tile behind") against the guide's current line, so the behaviour is visible
and falsifiable rather than waiting to be rediscovered.

## The `.txt` change, and why there is no `before` frame

`viewerFor` used to answer `null` for `.txt`/`.log`/`.text` - the "hand it to
the OS" branch - because the last gate it consulted, `isCanvasSupported`, reads
CodeMirror's language map, which carries none of them. A session log therefore
opened in the platform's editor instead of in the app. `viewer-routing.ts` now
answers `code` from `file-kind.ts`'s `textExtensions`, which is the set
`fileKind` already reported as `"text"`.

There is no `before` frame for this, and the reason is a rule rather than an
omission: on the tree before the change, clicking that tile calls
`window.api.openFile`, which hands the file to the OS - measured in the routing
code, `canvas-file-viewer.tsx`'s `fallbackAction`. Photographing it would open
the platform's editor on the operator's desktop and take his focus, which is the
one thing every rig in this repository exists not to do. The before/after
evidence for this change is therefore the contract test, which fails on the old
routing table and passes on the new one (measured: reverting
`viewer-routing.ts` fails "every promised format opens in the viewer a user
expects"), plus this frame of the after.

## Why these are PNG and not part of the sweep

`pnpm check-evidence` walks `.webp` under `docs/evidence`, which is the Storybook
sweep's format; these are live-app frames from a real backend, and they are
committed as `.png` from the CDP screenshot of the app's own window - the same
position `docs/evidence/renderer-driver/` occupies. Nothing here is capturable by
the sweep at all: its fixtures have no scratchpad directory and no session to
infer a tile from.
