# UX review — round 1 (PR #482 at `97ff24e1d`)

Frames from ONE headless pass of a driver-only scene (`--scene btw-ux`, source in
`ux-scene.js.txt`, appended to `scripts/renderer-driver.mjs` after the QA round's
helpers in the reviewer's own uncommitted worktree). The built app at
`97ff24e1d` (`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build`),
`--window-mode=headless` (asserted `visible=false`), 1380x900 window →
1380x868 CSS at dpr 2, `localOperatorDark`. Backend: `local-operator`
origin/main `56e91b78b` (contains #1488 `c2529404e`) in its own worktree + uv
venv, the QA round's paced OpenAI-compatible stub (first chunk 1.8 s, then
300 ms; a `SLOWTURN` marker slows a thread turn to 2 s/chunk), all on OS-chosen
ports behind the QA proxy on 8080. Every key is a real `Input.dispatchKeyEvent`
/ `insertText`; every step reads `document.activeElement`, the placeholder, the
panel, its live region and the transcript. `driver-run.log` is the full output.

Frame `05-first-settled` onward follow the scene's step order; `18`–`20` are
the follow-up-while-streaming probe, taken after flow 2.
