# `code-review-real` - the code review pane against real forges

Two frames (dark + light) of the real app on an isolated backend, showing the
per-session code-request pane with THREE REAL rows fetched live: an opened
GitHub PR from QA's scratch repo (closed, `3/3 passed`, its lane `Round 1 ·
clean · stale - reviewed 470f938, head 40d937e`), a merged GitHub PR
(`damianvtran/local-operator#1192`, `16/16 passed`, `Round 3 · terminal`), and a
merged GitLab MR (`minervaai/minerva-skills!57`, state-only `CI passed`,
`Round 3 · terminal`). Every summary, lane, CI figure and comment count is the
PR1b backend's own fetch of the real refs; nothing about them is fabricated.

## What produced them

A session-owned rig (round-2 remediation m2), not the storybook sweep. In one
command sequence:

1. Seed one user session - `sessions/c0de57a11a11/transcript.jsonl` plus its
   `created_at.json` - into the run's own config root. The transcript carries an
   opened row (a `gh pr create` bash call with its real tool-result shape:
   `exit code: 0` then the stdout/stderr sections, the `gh-pr-create-stdout`
   rule's input) and the two mentioned refs in URL form (`/pull/1192`,
   `/-/merge_requests/57`; the bare `owner/repo#N` shorthand is deliberately
   ambiguous on GitHub and renders link-only).
2. Start the PR1b worktree's daemon on that root, with its own HOME/config/log
   dirs and a run-chosen bearer:

   ```sh
   RIG=<scratch>/rig-r2; PORT=47831
   LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" \
     HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
     GH_TOKEN="$(gh auth token)" GITLAB_TOKEN="$(glab config get token --host gitlab.com)" \
     "$LO_WORKTREE/.venv/bin/local-operator" serve --host 127.0.0.1 --port $PORT \
     --hosting test --model mock-model
   ```

   The route proof runs BEFORE the app boot: `GET
   /v1/desktop/sessions/c0de57a11a11/code-requests` must return all three rows
   with summaries from the live fetch (it did, on the first attempt).
3. Build this branch's renderer against that URL (`VITE_LOCAL_OPERATOR_API_URL`,
   `LOCAL_OPERATOR_UI_NO_BYTECODE=true`, placeholder OAuth ids) and boot it
   headless (`--window-mode=headless --use-mock-keychain`) with the dev driver
   armed; open the pane through the app's own verbs (navigate to the session,
   `press` the rail's code item) and photograph it with the app's own
   `webContents.capturePage()` at devicePixelRatio 2; crop to the pane's
   bounding rect (596x868 CSS). The app pid is reaped; the daemon is SIGTERM'd
   by its recorded pid.
