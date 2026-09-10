# TUI-parity tool rows and the working line

Frames of the rebuilt canonical tool row — the TUI's dense fixed-column ledger,
ported to this app's own medium — and of the working line that replaced the
three pulsing dots.

Two capture surfaces, and the difference matters when reading them:

- **Storybook frames** (`states`, `names-and-fallbacks`, `narrow`,
  `working`, `working-labels`) render the **production `CanonicalTranscript`**
  from fixture `TranscriptRecord`s. They cover the states that are slow or
  awkward to produce live: an interrupted call needs a turn stopped at exactly
  the right moment, an `mcp__*` row needs a server connected, a narrow row needs
  a resize. Captured over CDP with `scripts/check-evidence.mjs`'s own
  `assertFramePaints` guard.
- **`real-conversation-tool-rows`** is the **real Electron app** — the app's own
  compiled main and preload, its real `window.api` IPC bridge, its real
  `BrowserWindow` — showing one of the operator's actual conversations served by
  a real `local-operator serve` backend.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| [`states`](states/) | Every outcome in one column: success, a write with `+42 -11` diff counters, a failure on the danger ground with a cross, an interrupted call with the slashed circle, and a running `web_fetch` with a live clock and **no** outcome glyph. The empty status column is what says "still running". |
| [`names-and-fallbacks`](names-and-fallbacks/) | Long builtin names, two `mcp__linear_*` calls displaying as just `create_issue` / `list_issues` with the plug glyph, and unknown tools (`some_custom_tool`, `team`, `eval`) taking the wrench. The wrench and the plug are deliberately different marks: "I do not know this tool" and "this came from a server you connected" are different answers. |
| [`narrow`](narrow/) | The same rows at 420px. The shed ladder is visible: the `edit` row's `+42 -11` counters are **gone**, the summaries truncate with an ellipsis, and the outcome glyph and duration survive — they are the last thing to go, not the first. |
| [`working`](working/) | The working line under a running tool row. The row states the ARGUMENTS and that call's own execution time; the line states the KIND of work and the phase age. They do not restate each other. |
| [`working-labels`](working-labels/) | Every label the line can carry — `thinking`, `responding`, `composing a call`, the model's own sanitised intent, and `running 3 tools` for a batch. No trailing ellipsis anywhere: the clock is what says it is ongoing. |
| [`real-conversation-tool-rows`](real-conversation-tool-rows/) | The real app, real backend, real conversation: 41 real tool rows including a live turn caught mid-flight (a running `bash` row with no outcome glyph, and the working line reading "Verifying nexus MR 69"). |

Both brand themes for each. The 12-theme sweep was **not** regenerated — see
`manifest.json`'s `partialCapture` — but the five story ids are registered in
`STORIES` in `scripts/capture-evidence.mjs`, so the next full recapture covers
them.

## Measured, not eyeballed

The stills show the symptom; the geometry shows the cause. Read out of the live
DOM in the real app window:

```
tool:1  x=182 w=65 'bash'       x=255 w=665 'ls ~/ | head -50; echo'  x=948 w=36 '2.9s'
tool:2  x=182 w=65 'read'       x=255 w=665 '~/local-operator-ui/do'  x=948 w=36 '0.0s'
tool:6  x=182 w=65 'web_fetch'  x=255 w=665 'https://example.com/ve'  x=948 w=36 '0s'
```

Every name starts at the same x, every summary at the same x, every duration at
the same x — one shared column each, grown to the longest visible name
(`web_fetch`, 9 characters) between the 8ch floor and the 24ch ceiling. That
alignment is the whole reason a run of twenty rows can be scanned by position
instead of read one at a time, and it is the property a screenshot alone cannot
demonstrate.

## What these frames do NOT prove

- **Packaged Electron.** The real-app frames run the compiled main and preload
  from `out/` against a Vite renderer, not an installed `.app`. Native dialogs,
  auto-update and the packaged bundle are untested here.
- **The shipped CSP string.** The live harness rewrites the backend port inside
  the policy so it can reach a backend on its own port (see the note in the PR).
  The one CSP change this branch makes — `blob:` in `img-src` — is asserted
  directly against the committed HTML in `scripts/tool-row.test.mjs`, precisely
  so it cannot be certified by a surface that rewrote it.
- **Ten of the twelve themes.** Only the two brand palettes were captured.
  `pnpm check-themes` covers all twelve numerically (1884 assertions); these
  frames do not.
