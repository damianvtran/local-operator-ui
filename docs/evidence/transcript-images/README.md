# Screenshots in the canonical transcript

The operator's complaint: "the screenshots from the conversation don't show up
in the same way as they do on the TUI". Before this change the canonical
transcript rendered the text `N images attached` and nothing else — and even
that only on a live event, never after a reload.

`real-conversation-images` is the fix, in the **real Electron app**: the app's
own compiled main and preload, its real `window.api` IPC bridge, its real
`BrowserWindow`, one of the operator's actual conversations, served by a real
`local-operator serve` backend. A real screenshot renders as a real thumbnail
under a real `read` tool row, with dense ledger rows above and below it.

## What the frame shows

| Frame | What it shows |
| --- | --- |
| [`real-conversation-images`](real-conversation-images/) | Session `e87ea91673da`. A durable image, referenced in the transcript only by content digest, fetched by digest through the media relay and painted in place. Tool rows for `bash`, `read`, `task` and `wait` surround it, each with its glyph, aligned columns, tick and duration. |

Both brand themes.

## The chain this frame exercises, end to end

Read out of the live DOM in the real app window:

```json
{ "scheme": "blob", "natural": "720x694", "shown": "249x240", "inToolRow": true }
```

Every field is load-bearing:

- **`scheme: blob`** — the bytes did not ride the transcript. The durable row
  carries `{attachment: <32-hex>, mime_type}` with the payload stripped, so the
  renderer asked main for it, main fetched it over the new
  `GET /v1/desktop/sessions/{id}/attachments/{digest}` route with the desktop
  bearer, and the renderer wrapped the returned `Uint8Array` in a blob. This is
  the path that did not exist before this change.
- **`natural: 720x694` with `shown: 249x240`** — a real decoded image,
  letterboxed under the shared 240px height ceiling with its own aspect
  preserved. The TUI never stretches; neither does this.
- **`inToolRow: true`** — mounted under the call that produced it, outside the
  disclosure. Hiding a picture behind a toggle is a smaller version of the
  complaint being fixed, not a fix for it.

The route itself was exercised directly against the real store, with the digests
of real screenshots on this machine:

```
GET /v1/desktop/sessions/8b5a3a71e677/attachments/0238cd06be7bc1054a6269e5e7dc0cd5
HTTP/1.1 200 OK          content-type: image/png     cache-control: no-store
bytes=226051             PNG image data, 1024 x 631, 8-bit/color RGBA
sha256[:32] of body = 0238cd06be7bc1054a6269e5e7dc0cd5   (identical to the URL)
```

and refused every way of asking for something else — traversal encoded and
dotted, 31 and 33 hex characters, uppercase hex, a suffix injection, an unknown
session, a missing bearer, and a foreign `Origin`.

## The bug, measured on real data

`imageCount()` filtered `block.type === "image"`, but durable rows are encoded
with `exclude_defaults=True` and `type` **is** the pydantic default, so it is
absent from every row on disk. Against one real history page:

```
entries: 200   tool rows: 90
image blocks present:      8   shapes: {('attachment', 'mime_type')}
old predicate would count: 0
```

## A defect this evidence caught

`blob:` was **not** in the app window's `img-src` CSP. Measured in the real
window, a blob `<img>` was **BLOCKED** while an identical `data:` URI loaded —
so the durable path would have silently drawn the "unavailable" placeholder in
production with nothing saying why. `src/renderer/index.html` now allows
`blob:`, and `scripts/tool-row.test.mjs` asserts it against the committed HTML
so a future tightening cannot pass unnoticed. A green typecheck would never have
found this; only loading the real window did.

## What this frame does NOT prove

- **Packaged Electron.** The compiled main and preload run against a Vite
  renderer, not an installed `.app`.
- **The shipped CSP string.** The live harness rewrites the backend port inside
  the policy so it can reach a backend on its own port (port 1111 was owned by
  another session). The `blob:` change is asserted separately against the
  committed HTML for exactly this reason.
- **Live `tool_execution_end` base64 rendering.** That path is covered by the
  reducer tests in `scripts/transcript-reducer.test.mjs`, not by this frame:
  producing a fresh browser-tool screenshot needs a live agent turn, and the
  browser tool was unavailable this session. The durable path shown here is the
  strictly harder half — it needed a new backend route, a new media op and a CSP
  fix, none of which the live path requires.
