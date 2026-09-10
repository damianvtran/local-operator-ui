# Failed-send evidence

The failed send moves off a banner at the top of the chat page and onto the
composer that holds the message. These frames are the before state, the after
state, the two ways the error clears, and one `errorCode` remedy.

## What produced these frames

**The real Electron app**, not Storybook. `electron-vite dev` running this
worktree's source, with the app's own main and preload processes and its real
IPC desktop transport, against a real `local-operator serve` backend paired
through a shared `LOCAL_OPERATOR_DESKTOP_TOKEN`. Frames were captured over the
Chrome DevTools Protocol against that window, the same raw-CDP approach as
`scripts/capture-evidence.mjs`, by `scripts/send-error-evidence.mjs`.

The failures are **real failures**, not props set on a component:

- The unreachable-backend frames were produced by stopping the backend process
  and pressing Enter in the composer. The error is the app's own transport
  reporting that it could not reach a backend.
- The `unresolved_attachment` frame was produced by answering the admission
  POST (`/v1/desktop/sessions/<id>/messages`) with the 409 the backend itself
  returns for that condition (`detail.code`, the shape asserted in
  `scripts/desktop-renderer-transport.test.mjs`). Only the backend's verdict was
  substituted, at the HTTP boundary; the app's own transport parsed it, its own
  `DesktopControlError` carried the code, and its own draft store recorded it.

Text was entered through the native `HTMLTextAreaElement` value setter followed
by a real `input` event, and sends were triggered by a real `Enter` keydown on
the focused textarea, so the app's own submit path ran in every case.

**What these frames do not prove:** the packaged/notarised build (this is the
dev main process), any theme other than `localOperatorDark`, any window size
other than 1380x872, or screen-reader announcement (the `role="alert"` is
present in the DOM, which is not the same as hearing it). The
`profile_registry_unavailable` remedy shares one code path with the
`unresolved_attachment` remedy captured here and was not photographed
separately. The "server is offline" strip visible along the top of every frame
is the legacy agents REST probe against a backend that does not serve that API;
it is present on `origin/main` too and is unrelated to this change.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before-banner-at-top.png](before-banner-at-top.png) | The reported state, on `origin/main`. The error, a read-only echo of the message, and a "Discard unsent message" link are pinned above the header. The composer at the bottom already contains the same text. |
| [after-error-at-composer.png](after-error-at-composer.png) | Same failure on this branch. The error sits directly on top of the composer, edge-aligned with it, and the message is in the input, editable. No echo. |
| [after-edit-clears-error.png](after-edit-clears-error.png) | After typing one more clause into the composer. The alert is gone; the amended text remains. |
| [after-retry-succeeded.png](after-retry-succeeded.png) | The backend restarted and the same draft re-sent with the send button's normal path. Session `1f0eb47ed29d` was created and the agent is answering. |
| [after-unresolved-attachment-actions.png](after-unresolved-attachment-actions.png) | The `unresolved_attachment` 409. The backend's own message plus "Choose agent" and "Choose team" at the composer, with the text still editable. |

## The measurement

The sibling PR (#101) independently measured this banner as rendering "525px
away at y=0, above the header, while the chip it names sits at the bottom".
Measured here in the running app at 1380x872, on the same conversation:

| | banner/alert top | composer top | distance |
| --- | --- | --- | --- |
| `origin/main` | 36 | 744 | **709px** |
| this branch | 529 | 600 | **0px gap**, edges aligned to 0px |

`gapPx` is the space between the alert's bottom edge and the composer's top
edge, and `edgeDeltaPx` is the difference between their left edges. Both are 0:
the alert shares the composer's track, so the two read as one unit.

## What was checked in the running app, not in the code

Captured alongside the frames by `scripts/send-error-evidence.mjs`:

- `textareaValue` after a failed send is the submitted message, and
  `textareaEditable` is `true`. The copy's claim that the message is still in
  the composer is a measured fact, not an assertion.
- `echoedCopyPresent` is `false` on every after frame: no element inside the
  alert repeats the textarea's contents.
- Editing clears the alert (`alertBeforeEdit: true` -> `alertAfterEdit: false`)
  while keeping the amended text.
- "Discard unsent message" clears the alert, empties the textarea, and drops the
  store's retained claim (`clicked: true, alertGone: true, value: ""`).
- "Choose agent" opens the real agent picker (`pickerOpen: true`), so the remedy
  is usable where it now lives rather than merely rendered there.

One behaviour worth recording because it was observed rather than designed: with
an unconfirmed send retained, re-sending the same text unchanged surfaces the
store's own guard message ("The previous send has not been confirmed. Retry it
unchanged, or discard it to send something different.") at the composer. That
guard is unchanged by this work; discarding clears it, which is what the discard
control is for.

## Reproducing

```
export LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32)
local-operator serve --host 127.0.0.1 --port <your-port>

LOCAL_OPERATOR_DESKTOP_TOKEN=$... npx electron-vite dev \
  --remoteDebuggingPort=<your-cdp-port> -- --user-data-dir=<scratch>
```

`--user-data-dir` is required when another Electron instance is already running:
the app takes a single-instance lock and a second copy otherwise exits at once.
Then, with a message typed in the composer, stop the backend and press Enter:

```
node scripts/send-error-evidence.mjs <cdp-port> docs/evidence/send-error <name>
```
