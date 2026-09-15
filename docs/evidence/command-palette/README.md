# Command palette evidence

Two sets, because the surface has two halves and one capture cannot show both.

## `command-palette-commandpalette/` — Storybook, twelve themes per story

The palette itself, swept from Storybook by `scripts/capture-evidence.mjs`:

```bash
npx storybook dev -p 6017 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=command-palette http://127.0.0.1:6017
```

Five stories: `--default` (the browse layout and the scope legend),
`--filtered`, `--settings-scope` (`,theme` finding a row the settings rail calls
Appearance), `--commands-scope` (`>`, the only frame showing the Panels group)
and `--no-results`.

**What these frames cannot show, and why they are captured offline.** Storybook
has no backend, so the conversation list and the settings registry are absent —
and their ABSENCE is correct rather than missing evidence: the palette does not
offer a row it cannot open, so a story with no backend is the honest picture of
an offline app. The harness refuses to capture while a Local Operator backend
answers on the configured port (`assertBackendDown`), because a frame that shows
the operator's own agents and settings is not a function of the tree. The run
above was taken with the worktree's `.env` pointed at a dead port for exactly
that reason — the committed frames are the offline state, and the app's real
data never entered them.

## `renderer-driver/` — the built app, driven

`node scripts/renderer-driver.mjs --scene palette --out docs/evidence/renderer-driver`
writes four frames from the **built app** (`palette-rail-dark.png`,
`palette-browse-dark.png`, `palette-query-dark.png`, `palette-dismissed-dark.png`)
and asserts what pixels cannot:

- that the rail's Search row is what received the press (hit-tested at its
  painted centre);
- that pressing it opened the palette and put focus in the query field;
- that typing narrowed the list (`Input.insertText` through CDP's own input
  pipeline, not a synthetic DOM event);
- that Escape closed the dialog and that focus came back to the row that opened
  it, which is the defect this change fixes rather than inherits.

A driver run reaches no backend by construction (its scratch `.env` points at a
port the script verified dead), so these frames are the offline palette in the
real Electron app — the same state the Storybook set depicts, through the app's
own window rather than through a preview.

The conversation and registry groups, which need a live backend, are not in
either set. They are covered by the unit tests over the ranking and the join,
and by the live-app checks recorded in the pull request.
