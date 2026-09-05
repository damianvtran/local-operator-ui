# Inline edit live-buffer contract

Both canvas editors pass their current `content` state to `InlineEdit`, which
sends it as `file_content` to `/v1/chat/agents/{id}/edit`. The server can generate
diffs from an unsaved or empty document without reopening the desktop's path.
The path remains useful display identity; the client does not change agent
workspace configuration to make an arbitrary canvas file readable by the server.

This is an additive request field. Older backends ignore it and retain their
existing disk-read behavior; patched backends use it instead of a disk read.
Release this desktop update before the backend workspace-confinement patch to
avoid a window where an older desktop tries to edit files outside its agent
workspace and receives 403. No response fields or apply/reject semantics change. Empty-file proposals now
use a zero-width CodeMirror widget: empty mark/replacement ranges throw before
the user can inspect the proposal. Nonempty diff decoration branches stay the
same. `pnpm check-edit-diffs` exercises the production plugin with real
CodeMirror state for single/multiline insertions and normal/dismissed previews;
the live fixture covers rendered visibility and accept/reject.
Import continues to use the ID returned by the API. Attachments are unchanged.

## Renderer + real API fixture

`Canvas / Edit API integration / Live buffer` mounts the production CodeEditor
and WysiwygMarkdownEditor, the real InlineEdit request path, and real diff review.
It does not fabricate an HTTP response. It needs a **disposable backend** on
`http://127.0.0.1:18762`, with isolated HOME and LOCAL_OPERATOR_CONFIG_DIR and
an edit-capable model configuration. Never point it at a personal server: each
mount creates a disposable agent through the real API.

```sh
# From a clean checkout; use the existing shared dependency tree if appropriate.
HOME=/tmp/lop-editor-gallery-home \
LOCAL_OPERATOR_CONFIG_DIR=/tmp/lop-editor-gallery-home/.local-operator \
pnpm exec storybook dev -p 16006 --host 127.0.0.1 --no-open --disable-telemetry
```

Open `/iframe.html?id=canvas-edit-api-integration--live-buffer&viewMode=story`.
Use the code/Markdown/empty buttons, then `Open AI edit (fixture)`. Enter an edit
prompt in the real popover, submit it, and accept/reject the returned diffs.
The receipt shows the actual request, actual status/response, and the native
save request. Edit text directly before opening the popover to verify the live
state differs from the original document prop. The 360px canvas toggle is only
a review viewport; it adds no production control.

The fixture replaces Electron's platform/speech-subscription bridge and records
native saves in memory instead of writing files. Its shortcut button dispatches
Cmd+K because the adapter reports macOS; Ctrl+K on macOS is CodeMirror's
kill-line command. This is evidence of renderer handlers, not a physical
keyboard shortcut, Electron IPC, packaged builds, or actual disk persistence.
The client-only path intentionally does not exist on the backend.

For deterministic request/error/loading verification, the security PR evidence
includes the disposable API entry point with only its model executor replaced.
It returns a SEARCH/REPLACE block for the submitted buffer; `[delay]` in the
prompt waits eight seconds, `[error]` raises a provider failure, and
`[multiline]` returns a two-line proposal. Label such
evidence **renderer + real API, deterministic provider/native-save adapters**,
not a live third-party model test. Never use provider credentials or user data
for the boundary regression probes.
