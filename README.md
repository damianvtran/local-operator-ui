# PR #490 round-1 evidence

Orphan branch: nothing here is in the PR's diff, and none of it is committed to
`main`. Frames are PNG captures from the built app; the JSON beside each frame is
the run's own record (request log, per-frame counts, timings). No JSON or text
file here carries an absolute path.

## How the runs were made

Both trees were built with `pnpm build` and booted **headless** — never shown,
never activated:

```
env -u NODE_TEST_CONTEXT -u XPC_FLAGS FIXTURE_TREE=<this branch> \
  node seed-label-rig-r1.mjs --tree <tree> --label <before|round0|after> \
    --moment <labels|counts> --case <open|switchback> --out <dir> --delay 2500
```

The app talks to a stub backend serving the sanitized fixture
(`scripts/fixtures/seed-label-gap.json`) the way a runtime serves a viewer joining
mid-turn: an `open` + `snapshot` SSE frame whose page is the journal's newest 100
entries and whose `live_events` seed is the fixture's own, plus a `/history` route
with the backend reader's semantics (no cursor = tail, `before_id` exclusive,
`has_more`). Every history request is logged with its time, `limit` and cursor;
answers are delayed 2.5 s so the first frame can be photographed.

Isolation per run: its own scratch `HOME`, config dir, `--user-data-dir`, log dir
and cwd; `CMUX_*`/`LOP_*`/`XPC_*` stripped; notifications and telemetry off; the
backend manager disabled; the app reaped by process group. No live session, store
or backend was touched.

## Files

`*-labels-open.*`, `*-counts-open.*` — the open, for the `labels` and `counts`
moments, in `origin/main` (`before-`), the round-0 head `d2975e6f5` (`round0-`)
and this branch (`after-`). `01-first-frame` is the frame before any read
answered, `01b` the same paint scrolled to the seeded rows, `02-after-read-1` the
first answer, `03-settled`, `04-revealed-oldest` the oldest rows after the
reader's own scroll-up.

`*-labels-switchback.*` — leave the conversation and come back. Two seams:

- `--via '#/chat'` (files without a `-via` suffix) keeps the pane mounted, so it
  does NOT exercise the per-mount bookkeeping; recorded because it shows how the
  mechanism is missed rather than because it proves anything.
- `--via '#/chat/000000000000'` (files suffixed `-via`) changes the session id, so
  the pane unmounts and re-mounts — which is what QA's case measured. The seed
  carries two `--orphan-end 2` calls whose assistant rows are absent, so they keep
  their stand-in on every mount and the return can be asked whether it blanks
  them. `05-switchback-blank` is captured only when a sample finds an empty object
  column: the round-0 head has one
  (`round0-via-labels-05-switchback-blank.png`), this branch does not.

`*-via-labels-switchback.json` — `blankFrames` counts samples whose object columns
were empty on the return: round-0 head `d2975e6f5` **34** of 123 samples; this
branch **0** of 121; `origin/main` 0 of 122 (it holds nothing, so it cannot blank
anything). Every tree shows the two unlabelable rows' stand-ins steady
(`standInFrames` = all samples) once the return settles.

`cross-tree-tests.md`, `cross-main.txt`, `cross-round0.txt`, `cross-head.txt` —
this branch's `scripts/seed-label-gap.test.mjs` run against three `src/` trees,
same command, with the file and fixture copied into each.
