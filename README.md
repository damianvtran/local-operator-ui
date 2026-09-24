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
