# `panels-without-session-baseline` — the same four gestures on `origin/main`

The before half of `../panels-without-session/`, and neither half derives from
the other: this set was captured from an **unmodified** worktree at
`origin/main` (`2d4a9c091`, the commit this branch is cut from), with the same
built app, the same story list, the same isolated backend on 127.0.0.1:8080 and
the same rig bytes — `run-before.json` records the rig's own `sha256`, which
matches the after run's.

What it is here to show, per frame:

| Frame | What the old tree does |
| --- | --- |
| `draft-analytics` | `/analytics` typed on a pane with no conversation prints "`/analytics` needs an open conversation. Start one first." and opens nothing. |
| `draft-info` | the same refusal for `/info`. |
| `palette-settings` | choosing **Info** from the palette while reading Settings moves the route to `/chat` before presenting anything, and the panel that opens carries the old description ("…and the conversation in front of you."). |
| `palette-browser` | the same move away from `/browser`. |

A draft pane is staged before each palette gesture, and that is deliberate rather
than incidental: on this tree a palette row is offered only while the chat pane
can present SOMETHING (a session or a draft), so the gesture is not otherwise
possible at all — which is itself half of what the after set changes.

Provenance: `source`/`why`/`capturedAt` in `../manifest.json`, and the raw reads
beside the frames in `run-before.json`.

## Rig revision, and why two hashes appear

The frames in this set were produced by `scripts/panels-without-session-evidence.mjs`
at revision `78b708c3…`, which is the hash `run-after.json` records. The committed
file is that same revision **reformatted by biome** (`pnpm lint:scripts` requires
it); the differences are an import-list reorder and two wrapped call sites, and
nothing else:

```
$ git show <this commit>^:scripts/panels-without-session-evidence.mjs > /tmp/as-run.mjs
$ diff -w /tmp/as-run.mjs scripts/panels-without-session-evidence.mjs
42d41   < readdirSync,
43a43   > readdirSync,
627,630c627   < await clickFirstRow(  (wrapped over four lines)
              > await clickFirstRow(debugPort, '#command-palette-results [role="option"]');
641,644c638   < the same call, wrapped
              > the same call, on one line
```

So the pair is comparable in the way that matters — **both halves ran the same
bytes** (`78b708c3…` on the before tree and on the after tree) — and the hash in
each run record is the hash of what ran, not of what is committed. Stated here
rather than silently corrected in the JSON, because a record quietly rewritten to
match the tree is worth less than a record that says which revision it is.
