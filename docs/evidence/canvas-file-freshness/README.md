# Canvas file freshness

Three frames from the **real built app**, driven by the repo's own harness
(`scripts/renderer-driver.mjs --scene canvas-freshness`), of the one surface this
change adds: the document's own line — the file's last modification, in the
reader's local timezone, with the control that re-reads the file — and the
behaviour behind it.

They exist because the claims under review are claims about a running
application, and a unit test with a fake bridge cannot reach either end of them:

- a file written **by another process, on disk**, while its tab is open has to
  appear with no interaction. Only a real `statSync` in main, a real `readFile`
  over IPC and a real mount can show that;
- the rewrite that matters most is the one no probe can see — same mtime,
  different bytes — so its only witness is a frame before and after a press;
- "the tab that is not on screen is left alone" is a claim about what does NOT
  happen, which is why the run reads the app's own persisted store rather than
  trusting a frame.

| frame | what it shows |
| --- | --- |
| [`before/localOperatorDark.webp`](before/localOperatorDark.webp) | The document opened from disk: the line reads `Modified September 18, 2026 at 12:13 AM` (the file's own mtime, rendered in the capturing machine's timezone) with the re-read control at the right, above the markdown toolbar. The editor holds `first-version`, which is what the file says. |
| [`after/localOperatorDark.webp`](after/localOperatorDark.webp) | The same tab after a rewrite whose mtime was restored to the value the app already held — a write the two-second poll cannot see, because the mtime is what decides. The press on the re-read control is what applied it, and the editor now holds `third-version` under a line reading `Modified September 18, 2026 at 12:14 AM`. |
| [`activation/localOperatorDark.webp`](activation/localOperatorDark.webp) | Two tabs, the second document on screen, and `notes.md` re-selected after its file was rewritten off screen. The switch applied the new bytes (`fourth-version`) and the line moved with them: `Modified September 18, 2026 at 12:15 AM`. |

All three are full-window frames of an **isolated** run: a scratch `HOME`, a
scratch `LOCAL_OPERATOR_CONFIG_DIR`, a scratch `--user-data-dir`, the app's own
`headless` window mode (never shown, never focusable), `CMUX_*`/`LOP_*` stripped
from the child environment, and a backend this run started and reaped itself. The
sidebar's session list is empty and the conversation is a staged draft, so
nothing in these frames is the operator's data. The window is 1380x900 and the
frames are the app photographing itself with `webContents.capturePage()`.

## What produced these frames

`scripts/renderer-driver.mjs --scene canvas-freshness`, against a live, isolated
`lop serve` this run owns. The renderer has to have been built against that
backend's URL (the address is inlined at build time), and the run asserts it:

```bash
# 1. build the renderer against the port the scratch backend will listen on
env VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:54881 \
  npx dotenv-cli -e .env -- pnpm build

# 2. a scratch backend, with a token only this run holds
export LOCAL_OPERATOR_CONFIG_DIR=$(mktemp -d)/config
export LOCAL_OPERATOR_DESKTOP_TOKEN=<64 chars, never printed>
lop serve --port 54881 &            # its record lands in $LOCAL_OPERATOR_CONFIG_DIR/run/serve

# 3. the scene, which writes the subject files itself
node scripts/renderer-driver.mjs --scene canvas-freshness \
  --backend http://127.0.0.1:54881 \
  --backend-records "$LOCAL_OPERATOR_CONFIG_DIR/run/serve" \
  --seed-onboarding-complete \
  --out /tmp/canvas-freshness-frames --clean
```

The scene writes both subject files (`notes.md`, `report.py`) and sets their
mtimes explicitly, so every claim in it is exact rather than clock-dependent; it
fails rather than skips if any of them does not hold. The run's own output —
every check, the mtimes it set, the stamped line it read back, the geometry it
measured and the two latencies — is quoted in the pull request.

## What it does not show

- **A genuinely hidden window.** The run's renderer reports
  `document.visibilityState === "visible"` (a headless Electron window is not a
  hidden one), so the `visibilitychange` half of the trigger cannot be produced
  here. The check it guards is the same check the poll runs, and the
  `hidden` half is asserted in `scripts/canvas-file-freshness.test.mjs` at the
  level the decision lives at.
- **A real reader's typing**, so the dirty-buffer suppression is not in these
  frames: it is covered against the shipped module by
  `scripts/canvas-file-freshness.test.mjs` (a dirty document is not even probed;
  a forced check reports that the file moved on and applies nothing). A frame of
  it would need a typing gesture this harness has no verb for.
- **The other viewers.** Every document in the canvas gets the line and the
  control, and the byte viewers re-read by moving the object URL's cache key,
  but only the markdown and code surfaces appear above. The viewers' own
  re-read is the same store write the tests assert, not a second mechanism.
