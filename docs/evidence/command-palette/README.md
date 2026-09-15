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
Appearance), `--commands-scope` (`>` narrowed to destinations and actions) and
`--no-results`.

**The four panel rows are in no frame here, and cannot be.** `info`, `usage`,
`analytics` and `session.diagnostics` are presented by the chat pane, a story has
no pane, and the palette deliberately does not offer a row it could not open — so
`--commands-scope` shows no Panels group, which is the gate working rather than a
missing capture (an earlier draft of this file claimed the opposite; design round
1, D4). The PANELS THEMSELVES are captured, as their own story sets:
`panels-info--*`, `panels-analytics--*`, `panels-session--*` and `chat-usage--*`,
twelve themes each, in the directories named for them beside this one. What is
not in any frame is the palette's ROW that leads to one, which needs a live pane;
that path is covered by the unit tests over the rows and by the live-backend pass
below.

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
writes five frames from the **built app** (`palette-rail-dark.png`,
`palette-rail-light.png`, `palette-browse-dark.png`, `palette-query-dark.png`,
`palette-dismissed-dark.png`) and asserts what pixels cannot:

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
own window rather than through a preview. The rail is captured in TWO themes
(`localOperatorDark` and `localOperatorLight`) because the rail's chord is plain
monospace on a `sunken` ground rather than the panel's key caps, and that is the
one treatment in this change whose contrast could not otherwise be judged outside
the default theme (design round 1, D4).

The conversation and registry groups, which need a live backend, are not in
either set. They are covered by the unit tests over the ranking and the join,
and by the live-app checks recorded in the pull request.
