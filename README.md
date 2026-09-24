# Integrations redesign — evidence frames (UI PR B, #491)

Not merged anywhere; an orphan branch so the PR can embed the stills without
committing them to the tree.

- `before/` — the design audit's Integrations frames and the UX walk's Integrations
  shots, both at `origin/main` c3572ba90.
- `after/` — Storybook stills of `settings-integrations--*` at UI head 7452bb585,
  captured with the browser tool.
- `live/` — the real Electron app, headless, driven by
  `--scene settings-integrations` against an isolated daemon served from
  `damianvtran/local-operator#1511` (head 111d8e193): a fresh config with NO model
  provider and no session, adding a stdio server and a remote URL through the form,
  testing both, removing both. `live-run.log` is that run's whole output (27/27 PASS);
  `echo-mcp.py` and `remote-mcp.py` are the two MCP servers the rig started, and
  `rig-up.sh` starts the isolated daemon.

## Round 1 (`after-r1/`, `live-r1/`)

Stills re-captured on the round-1 head, and the live run that answers it. Two
things about this set are corrections rather than additions:

- **The theme pair is real in this set.** The first round-1 capture used
  `globals=theme:` in the iframe URL; Storybook's preview reads the theme from
  `args=theme:` (which is what `scripts/capture-evidence.mjs` itself uses), so
  every "light" frame was byte-identical to its dark twin - the images were
  pairs in name only. Re-captured with `&args=theme:<theme>`; sizes now differ
  per theme and both files are in this directory.
- **The live run is the round's own**, at the head it answers: 38/38 PASS, no
  FAIL, including Q1's reload case (a chat with a project folder, then a real
  app reload, then the project row still there).

`after-r1/`: nine states x two brand themes (`localOperatorDark`,
`localOperatorLight`), from `settings-integrations--*` at the round-1 head.

`live-r1/`: the frames and the whole log of `scripts/renderer-driver.mjs
--scene settings-integrations` driving the real Electron app in `headless`
window mode against an isolated daemon built from the backend branch's head,
with a fresh config holding **no model provider and no chat**.
