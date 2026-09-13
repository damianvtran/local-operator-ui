# The child reader, live — the run sidebar against a real running child

Two frames, both brand themes: the run pane's child reader, opened in the BUILT
app on a real child of a real session, reading that child's durable transcript
over the desktop control route `subagents.transcript`.

```
reader-live/localOperatorDark.webp    reader-live/localOperatorLight.webp
```

These are not a story and cannot be. A story renders a fixture; the claim here is
a FLOW — pair the app to a backend, delegate to a subagent, open the pane, click
the child's row, and watch the child's transcript arrive over the wire, then
arrive AGAIN when the child's pulse moves. `scripts/capture-evidence.mjs`
photographs the shell with a page injected through the reader's preview seam,
which proves the row pipeline and says nothing about the wire.

## What each frame is a picture of

- the pane's chrome: breadcrumb (`Run details / Re-check the pending rows against
  the le…`), back and sibling stepper, then the reader's facts row — state mark,
  label, `running`, role, elapsed, context, cost and `openrouter/openai/g…`;
- the child's own conversation: its launch row, its `bash` tool rows
  (`sleep 150`), its assistant text — real rows, delivered by the backend;
- the pane's foot: § 5.6's read-only statement, which is the whole reason a
  running child is legible in this state;
- and the ABSENCE of a `Delegated with` block: the transcript already carries the
  instruction as its own user turn, so the brief stands down. The 2026-09-13
  capture of this same pair is what proved that rule needed to tolerate the
  wire's abbreviation of `launch_prompts` (see *Readings*).

## How it was paired

Per `docs/run-sidebar.md` § 11.3. Nothing here touches the operator's own
backend, sessions or config directory, and nothing takes the window's focus.

1. **An isolated backend from the parallel backend worktree**, read-only use:

   ```sh
   PYTHONPATH=~/local-operator-worktrees/desktop-subagent-transcript \
   LOCAL_OPERATOR_CONFIG_DIR=<throwaway> \
   LOCAL_OPERATOR_DESKTOP_TOKEN=<32 random bytes> \
   LOCAL_OPERATOR_DESKTOP_ORIGINS=http://localhost:<proxy port> \
   OPENROUTER_API_KEY=<dev key> \
   ~/local-operator/.venv/bin/python -m local_operator.cli serve --host 127.0.0.1 --port <own port>
   ```

   The worktree's package shadows the editable install through `PYTHONPATH`,
   which is how its new route runs without writing a venv into somebody else's
   checkout. The config dir is empty, so the sessions, the roster and the
   transcript in these frames are all synthetic.

2. **The app built against it**: `VITE_DISABLE_BACKEND_MANAGER=true` and
   `VITE_LOCAL_OPERATOR_API_URL` pointed at that port in `.env` (which is not
   committed), `LOCAL_OPERATOR_DESKTOP_TOKEN` in the MAIN process environment —
   the pairing § 11.3 names — then `pnpm build` and:

   ```sh
   LOCAL_OPERATOR_UI_WINDOW_MODE=headless LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
     npx electron . --remote-debugging-port=<port> --user-data-dir=<throwaway> --window-size=1280x900
   ```

   The BUILT app rather than `pnpm dev:headless` for the one measured reason
   recorded in `docs/evidence/chat-title/README.md`: in dev the development-only
   Chat|Raw strip paints over the header, and this frame's subject starts there.
   Headless means the operator's focus is never taken.

3. **The turn**: a parent turn that delegates with `task` to a `reviewer` child
   whose instruction is four sequential steps, three of them `bash`. Sequential
   tool calls are deliberate: each one is a `subagent_progress` event, so the
   reader's pulse has something to follow.

4. **Driven over raw CDP** by a small harness (not committed — it lives under
   `out/`, and this file is the record of what it did): set the persisted theme,
   reload, navigate to `#/chat/<session>`, click the trigger, click the child's
   row, wait for the reader's transcript, hold, screenshot.

One detail is worth writing down because it is not obvious and it is not the
app's fault: the renderer's CSP (`src/renderer/index.html`) allows `connect-src`
only for the app's own documented origins, and an isolated backend runs on its
own port, so the harness enables `Page.setBypassCSP`. That affects the
RENDERER'S OWN fetches only — every operation behind these frames (the canonical
stream, the transcript page) travels main's typed IPC transport, which no CSP
governs.

## Readings

Taken from the backend's own access log and from the DOM of the frame above, on
the 2026-09-13 pairing (parent session `fa411391514d`, child job `efc788c30b50`,
child session `e571dc19fa5a`):

| reading | value |
|---|---|
| `GET …/children/e571dc19fa5a/transcript?limit=100` | **4** requests while the reader was open |
| first frame | 8 transcript rows on open |
| the pair | one capture run: both frames show the child `running`, seconds apart |

The four requests are the point: one is the read the pane issues when it opens,
and the rest are the pulse — `subagent_progress` fires as the child finishes each
`bash` call, the reader's `§ 5.3` cadence re-reads the tail (coalesced to at most
1 Hz, and never for a settled child). A fixture cannot show that, which is why
this pair exists.

An earlier pairing in the same session produced a stronger reading still — 27
reads for one child session — because that child ran longer; the frames above are
a later, cleaner capture of the same path.

### What the first pairing of this pair found

The 2026-09-13 capture is also the evidence behind a fix that no fixture had
caught. In the live app the reader rendered the `Delegated with` block AND the
instruction as a user turn — the duplication `reader-resumed` was fixed for —
because the wire ABBREVIATES `launch_prompts`: the row delivered a 201-character
entry ending `…` where the job's own `prompt` carried all 264. `briefIsInTranscript`
compared for equality, the truncated copy is not equal to the full brief, so the
block stayed. The rule now also treats a record whose whole text is a prefix of
the brief as the same instruction, and the frames above show the result.

## Provenance

Both frames come from the BUILT app of the branch's own source tree, paired as
above. `manifest.json` declares this set as `supplementary` with its own
`source`, because no sweep can re-derive it: it needs a live backend, a model
call and a child that is running at the moment the shutter opens. Re-taking them
means redoing the four steps above, not running `pnpm capture-evidence`.
