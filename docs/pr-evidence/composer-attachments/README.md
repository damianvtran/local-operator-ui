# Composer attachments — the desktop half

Frames for attachment contract v1 (§5 history, §6 composer), captured with the
repository's own Storybook rig (`scripts/capture-evidence.mjs`) plus one live-app
frame from the dev driver. Nothing here is a macOS screenshot.

## Commands

The worktree's `node_modules` is a symlink to the primary checkout, so the binary
is called directly (`pnpm` refuses a symlinked `node_modules`):

```bash
node_modules/.bin/storybook dev -p 6017 --ci --no-open
```

Then, per story and theme pair:

```bash
node scripts/capture-evidence.mjs --only=<story-id> \
  --themes=localOperatorLight,localOperatorDark --allow-backend
```

`--allow-backend` is required only because the operator's own daemon listens on
1111; these stories call no backend. Frames land in the ignored
`docs/evidence-frames/` tree, and are copied here as the PR's hosted evidence.

Story ids captured (light and dark unless noted):

- `chat-message-input--pending-send-pdf`
- `chat-message-input--pending-send-pdf-remove-focus`
- `chat-message-input--pending-send-mixed` (real 64×64 PNG fixture, not a path
  that exists on no machine)
- `chat-message-input--pending-send-many-files` (six cards; the eight-card
  maximum is a separate story that is deliberately not a frame because the
  composer's 240px preview area scrolls)
- `chat-message-input--pending-send-narrow-long-name` (440px rung)
- `chat-message-input--pending-send-image-remove-focus`
- `chat-sent-file-card--sent-file`
- `chat-sent-file-card--sent-file-long-path` (a 123-character path, middle
  truncated; the copy proof is the un-captured `…--sent-file-long-path-copy-proof`
  play, which stubs `navigator.clipboard.writeText` and asserts the full record
  value byte-for-byte)
- `chat-sent-file-card--placement-unknown-no-claim`
- `chat-sent-file-card--moved-or-deleted`
- `chat-canonical-user-card-measure--file-attachment`

## Before state

Captured on a throwaway worktree at `origin/main` = `cf673bee`, with the same
composer and the PDF staged through the pre-change chip (a temporary story then
removed):

```bash
node scripts/capture-evidence.mjs --only=chat-attachment-before--pdf-chip \
  --themes=localOperatorLight,localOperatorDark --allow-backend
```

## Live paperclip

Isolated daemon (scratch `HOME`, config, logs, random bearer) on 8090, the app
built against it, then:

```bash
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat <scratch>/token)" \
  node scripts/renderer-driver.mjs --scene attach \
  --backend http://127.0.0.1:8090 --attach <scratch>/report.pdf \
  --seed-onboarding-complete --out <scratch>/frames
```

Result: `ALL CHECKS PASSED` — the persisted store held exactly the given path,
one chip was painted, the row carried the pending caption, and the app log named
the queue-answered dialog. The frame shows a daemon with no provider connected
(`Connect a provider`), which is the state that daemon is in; it is not a claim
about a send.

## Not shown

- **A live upload or a live send.** The core lane's `POST /v1/desktop/attachments`
  is not on `origin/main` yet, so the daemon this UI can reach does not serve it.
  The transport is exercised against a local HTTP server in
  `scripts/attachment-files.test.mjs`; the app path above proves the paperclip
  and the staging, not the upload.
- **The answer path** (`--attach-prompt` / `--attach-expect-answer`) needs that
  route plus a provider that can answer. The scene refuses rather than reporting
  a staged-only pass when the send cannot be admitted.
