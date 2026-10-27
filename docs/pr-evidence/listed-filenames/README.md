# Bare filenames listed under an introducing directory: before/after

Operator report (2026-10-27): an assistant turn ended

```
Files are in `~/Documents/Radient/`:
- Radient-IP-Scope-for-Counsel-2026-10-27.pdf
- Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx
```

and only the directory linked. The two deliverables were dead text.

## What is photographed

The BUILT app (`pnpm build`, synthetic OAuth placeholders), driven headless
(`window-mode=headless`, never shown, never focused) through the facade of
`scripts/renderer-driver.mjs` by `capture.mjs`. It ran against an ISOLATED
`local-operator serve` (v0.90.19) on `127.0.0.1:8080`, with scratch
HOME/TMPDIR/config, `hosting: test`, `model_name: mock-model`, a synthetic bearer
and CMUX_* stripped. `seed.mjs` writes two synthetic sessions whose introducer
points at a scratch directory holding two synthetic files with the exact names.
The operator's live session was never touched. `before-*` is `origin/main`
(`1a535a371c`); `after-*` is this branch. Both ran the same script against the
same daemon and sessions.

| Frame | Session text | Reading (`listItems` from the rig's own DOM read) |
| --- | --- | --- |
| `before-final.png` | the reported final message, bare names | 2 items, linked: false, false |
| `after-final.png` | same | linked: true, true; hrefs `<dir>/Radient-IP-Scope-for-Counsel-2026-10-27.pdf`, `<dir>/Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx` |
| `before-screenshot-1227.png` | the screenshotted 12:27 shape: item 2 is `<name> — <description>` | linked: false, false |
| `after-screenshot-1227.png` | same | linked: true, true. Item 2's anchor text is exactly the head `Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx`; the description stays plain |

## What it does NOT show: the canvas Files list

`after-files-panel-backend-ledger.png` reads `files 0`, and that is not this
change failing. On a daemon that advertises `session_files`
(`local_operator/server/features.py`), the canvas list is the BACKEND's ledger
(`chat-content.tsx`: `allowLegacyFiles = !session_files`). The isolated daemon's
`GET /v1/desktop/sessions/<id>/files` answered `total: 0` for this text. The
renderer scan this PR extends (`mentioned-files.ts`) is the fallback for older
daemons. It is covered by `scripts/link-targets.test.mjs`
(`extractMentionedPaths` on the exact text) but has no frame here. The ledger
half is a separate local-operator change.
