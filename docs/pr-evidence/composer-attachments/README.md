# Composer attachments — the desktop half

Frames for the attachment contract v1 (`§5` history, `§6` composer), produced by the
repository's own Storybook capture path, plus one live-app frame from the dev driver.

## Commands

Storybook: `node_modules/.bin/storybook dev -p 6017 --ci --no-open` from this
worktree (the `node_modules` symlink is why the binary is called directly; `pnpm`
refuses the symlink). Then, once per story and theme pair:

```bash
node scripts/capture-evidence.mjs --only=<story-id> \
  --themes=localOperatorLight,localOperatorDark --allow-backend
```

`--allow-backend` is required only because the operator's own daemon answers on
1111; none of these stories calls a backend, and `--only` makes the flag legal.

Ids captured (after): `chat-message-input--pending-send-pdf`,
`chat-message-input--pending-send-pdf-remove-focus`,
`chat-message-input--pending-send-mixed`, `chat-message-input--idle`,
`chat-sent-file-card--sent-file`, `chat-sent-file-card--moved-or-deleted`,
`chat-canonical-user-card-measure--file-attachment`.

Before: a throwaway worktree at `origin/main` (`cf673be`) with one uncommitted rig
story, `chat-attachment-before--pdf-chip`, captured on port 6018 by the same tool.
That story stubs `window.electron.ipcRenderer` (a Storybook frame has no preload
bridge) and nothing else.

Live: an isolated daemon (`lop serve --port 8080`, scratch HOME/config, random
bearer), an app built against that URL, then:

```bash
LOCAL_OPERATOR_DESKTOP_TOKEN=<scratch token> node scripts/renderer-driver.mjs \
  --scene attach --backend http://127.0.0.1:8080 \
  --attach /abs/path/Complete_With_Docusign.pdf --seed-onboarding-complete \
  --out <frames>
```

The scene presses the real paperclip; only the native picker is answered from the
`--attach` queue. It passed: the store held exactly the given path, one chip, the
pending caption, and the app log named the queue-answered dialog.

## What the pair shows

- `before-pdf-chip-*`: the 100px tile, filename broken and truncated, no type, no
  size, no pending caption.
- `after-pending-pdf-*`: the file card — type icon, whole filename, `PDF · 2.4 MB`,
  and `Not sent yet` under the row.
- `after-pending-mixed-*`: image tile and PDF card in one row.
- `after-remove-focus-*`: the remove control focused; its play takes the card's box
  before and after focus and throws if it moved.
- `after-sent-file-*` / `after-moved-deleted-*`: flat history row, no control; the
  missing verdict names the retained digest instead of leaving a dead chip.
- `after-in-transcript-*`: the same card inside a real user bubble.
- `live-attach-staged.png`: the real app after a real paperclip press (frame is the
  app's own `capturePage`, 1024x668 at the run's window size).

## Not proved here

The upload route itself: the core lane lands `POST /v1/desktop/attachments`
concurrently, so no live upload or send is exercised in these frames. The
composer's card, refusal copy, and history mapping are exercised by
`scripts/attachment-files.test.mjs` and the live paperclip frame.

i18n ledger: `ui.chat.attachments` translations are authored and the catalogue
gates pass, but `ledger-check` needs an independent i18n-auditor row per locale —
see the PR's "what could not be exercised".
