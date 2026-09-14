job deb43bfdf50c (tui-image-spec) [completed] model=anthropic/claude-opus-5
I could not write the file — this role has no write/edit tool (read/grep/glob/web only). **The spec is below in full; it needs saving verbatim to `~/local-operator-ui/docs/evidence/tui-parity/image-rendering-spec.md`** (that directory does not exist yet).

---

# Headline

**Images cannot render in the canonical UI today, and the blocker is the wire, not the view.** Three findings, in order of how much they cost an implementer:

1. **Durable history rows do not contain image bytes.** They carry a content-addressed digest (`{"attachment": "<32-hex>", "mime_type": ...}`) with `data` removed. No desktop op, endpoint, or media relay can resolve that digest. **A new backend route + a new media op must be added.**
2. **`imageCount()` in the reducer is broken for durable rows and always returns 0.** It filters on `block.type === "image"`, but the transcript encoder dumps with `exclude_defaults=True` and `type` *is* the pydantic default, so it is absent from every durable row. "N images attached" only ever appears on live `message_start` events, never after a reload.
3. **Live `tool_execution_end` events DO carry full base64** (`type: "image"`, `data`, `mime_type`). Screenshots from the browser tool — the operator's main complaint — are renderable *right now*, live, with no backend change. Only the durable replay needs the new endpoint.

---

# A) TUI side — how images render

## Files
- `~/local-operator/local_operator/tui/widgets/image_block.py` (504 lines) — the widget
- `~/local-operator/local_operator/tui/images.py` (717 lines) — protocol detection, fit arithmetic, kitty encoding
- `~/local-operator/local_operator/tui/session_presentation.py:858-914` — `append_image_blocks`, the single mount point
- `~/local-operator/local_operator/tui/widgets/transcript.py:985-1105` — `UserBlock`'s separate text receipt

## When an image block appears

`append_image_blocks` (`session_presentation.py:858`) is the **only** entry point; three callers:

| Source | Call site | Label rule |
|---|---|---|
| User attachment (live + resume replay) | `session_presentation.py:715` | from the prompt's own `[Image #N]` citations, in citation order |
| Tool result (screenshots) | `session_presentation.py:849-855` — filters `result.content` for `ImageContent`, mounts **under the settled tool card** | positional `#1`, `#2` |
| Resume replay of both | same two call sites | same |

Labels are emitted **only when the batch has more than one image** (`session_presentation.py:896-901`); a single image gets `label=""` because the row above already named it (review round 1, F4).

## What is shown

Three modes, resolved once at first paint (`image_block.py:223-226`), best-first:

**1. `kitty` — real pixels.** Kitty graphics via Unicode placeholders (`images.py:6-16`). Bytes transmit **once** (APC `a=t`), a virtual placement names a cell grid (`a=p,U=1`), then the grid paints as ordinary text: `U+10EEEE` (`images.py:93`) plus row/column combining diacritics, image id carried in the **foreground RGB** (`image_block.py:280-282`). Because the cells are text, Textual's compositor scrolls/clips/repaints them normally — that is the whole reason it works inside a TUI. Sixel and iTerm2 are deliberately not offered (they'd be shredded by the next compositor frame).

**2. `halfcell` — pixels as text.** `▀` (U+2580) per cell, **foreground = top pixel, background = bottom pixel** (`image_block.py:50`, `333-396`). Letterboxed, never stretched (design round 1, D2); bars are theme background so they are invisible. Transparent pixels composite over `theme.semantic_color("bg")`. Consecutive same-colour cells share one styled span.

**3. `text` — a one-row receipt, no pixels.**

- Healthy: `↑ image attached (1920x1080)`, or with a label `↑ image attached ('#2', 1920x1080)` — `image_block.py:398-404`
- Unavailable: `▨ image '#2' unavailable — could not be decoded` or `— no longer in the transcript` — `image_block.py:406-413`

Glyphs, exactly (`image_block.py:50-59`):
- `▀` U+2580 — half-cell pixel
- `▨` U+25A8 — **exclusively** the unavailable mark
- `↑` U+2191 — the healthy "attached" mark; matches the prompt's own attachment row so a glyph scan distinguishes fine-but-not-shown from broken (design round 1, D3)

Receipt ink is `theme_mod.semantic_color("muted")` (`image_block.py:429`). Receipts are pre-truncated in the string with a real `…` — not via `Text(overflow="ellipsis")`, because `set_content` drops those flags (design round 1, D1).

**Separately**, `UserBlock` renders its own text receipt row `↑ 2 images attached` (`transcript.py:1093-1102`) — so the TUI shows *both* the count receipt on the prompt bubble **and** the actual pictures below it. That receipt is marked `copy_row_is_chrome` so a drag-copy never pastes it (`transcript.py:1012-1024`).

## Sizing rules

`images.py:79-90`:
```
MAX_ROWS = 18      # shared height ceiling — the "ledger" rule
MAX_COLS = 100
```
Every image lands at the same height ceiling with width following its own aspect ratio, so a column of mixed screenshots reads as ledger rows rather than a scrapbook. 18 rows is legibility-driven: 12 rows turned the browser tool's 1080p captures into thumbnails where labels were guesswork.

`fit_cells` (`images.py:526-555`):
- aspect preserved **in pixels**, not cells (a cell is ~2× taller than wide; computing in cells halves every image's height)
- `scale = min(max_cols*cell.w/px_w, max_rows*cell.h/px_h, 1.0)` — **never upscales**; an icon stays icon-sized
- both axes clamped to ≥1 cell

Per-block grid (`image_block.py:189-203`): `avail = max(8, width - SPINE_INDENT)`, then `fit_cells(px_w, px_h, min(avail, 100), 18)`. `SPINE_INDENT = 2` (`transcript.py:70`) — images indent onto the transcript's text column, not the gutter.

At the default cell size `CellSize(8, 16)` (`images.py:461`), the ceiling is **800 × 288 device pixels**.

Memory: decode once with Pillow, `_shrink` to the cap grid, **drop the base64** (`image_block.py:90-109`, `151-162`). Kitty transmit frame is that same shrunk copy, letterboxed to the exact placement rectangle with transparent bars so kitty's stretch-to-fill stays aspect-true (`image_block.py:292-331`).

## Click / keyboard behaviour

**None. The block is completely inert.** No `BINDINGS`, no `can_focus`, no click handler, no zoom, no open-in-viewer. `copy_row_is_chrome` returns `True` for **every** row (`image_block.py:500-504`) — "the image is not text, so the clipboard gets nothing from it." A drag-copy over an image pastes nothing rather than placeholder codepoints or half-block soup.

*(Parity note for the UI: there is no TUI behaviour to port here. Any click-to-expand in the Electron app is a net-new affordance, not parity — and the legacy `ImageAttachment` already has one.)*

## Fallback when the terminal cannot draw pixels

`_detect_mode()` (`images.py:483-508`), in evaluation order:

| Condition | Mode |
|---|---|
| `LOCAL_OPERATOR_IMAGES` = `kitty`/`halfcell`/`text` | forced |
| `LOCAL_OPERATOR_IMAGES=off` | `text` |
| `NO_COLOR` set | `text` (the id rides the fg colour; stripped colour = bare tofu) |
| setting `display.images` = false | `text` |
| `TERM` = `dumb` or empty | `text` |
| `TMUX` set, or `TERM` starts `screen`/`tmux` | `halfcell` |
| `TERM=xterm-kitty`, `KITTY_WINDOW_ID`, or `TERM_PROGRAM=ghostty` | `kitty` |
| everything else | `halfcell` |

WezTerm and Konsole advertise the kitty protocol but do **not** render placeholder cells, so they take half-cells. Default setting is images-ON (`tui/settings.py:73-78`).

Runtime degradation:
- kitty transmit or placement write fails → demote to `halfcell` in place (`image_block.py:214-220`, `265-276`)
- **live-image budget**: `MAX_LIVE_KITTY_IMAGES = 8` (`images.py:77`). Terminals keep every transmitted image in a per-terminal store that survives `CSI 2J`; past the cap the oldest is evicted and `_demote_to_halfcell` swaps placeholder text for half-cell pixels — the picture stays in scrollback, it just stops costing terminal store (`image_block.py:484-496`)
- unmount deletes the terminal-side image (`image_block.py:476-482`)

The UNAVAILABLE state is **deliberate UX, not an error path** (`image_block.py:24-29`): bytes pruned from a resumed transcript, or HEIC without the codec, renders a one-row receipt naming what is missing and why. "The reader learns an image WAS here, which is the fact the empty space would have hidden." A construction failure is caught per block and skipped without taking down the message dispatch (`session_presentation.py:902-911`).

---

# B) Wire side — what a frontend can get today

## The content block model

`~/local-operator/local_operator/harness/types.py:109-117`:
```python
class ImageContent(BaseModel):
    type: Literal["image"] = "image"
    data: str = ""          # base64
    mime_type: str = "image/png"

Content = TextContent | ImageContent
```
It rides on `Message.content` (`types.py:183`) and `ToolResult.content` (`types.py:148`). There is **no** media-reference id in the wire model.

## The durable transcript — the critical divergence

`~/local-operator/local_operator/session/attachments.py` is a content-addressed store at **`<config_dir>/attachments/<digest>.bin`** + `<digest>.json` sidecar, keyed by `sha256(decoded bytes)[:32]` (`attachments.py:122`, `_DIGEST_CHARS = 32` at line 60). Motivation: base64 image payload was 102 of 134 MB across 142 real sessions.

On write, `encode_message_payload` (`transcript.py:145-181`) does:
```python
payload = message.model_dump(exclude_defaults=True, exclude={"id"})
_externalize_attachments(payload, attachments)
```
`_externalize_attachments` (`transcript.py:198-227`), for any block whose base64 `data` is **≥ 1024 chars** (`_ATTACHMENT_FLOOR_BYTES`, line 262):
```python
block.pop("data", None)
block["attachment"] = ref.digest
block["mime_type"] = ref.mime_type
```

**Two consequences an implementer must internalise:**

**(a) `type` is gone.** The encoder's own comment (`transcript.py:215-218`) states it outright:
> *"Identify image blocks by the `data` key, NOT by `type`: the encoder dumps with `exclude_defaults`, and `type` IS the pydantic default on both content models, so the discriminant is absent from the encoded row. A text block never carries `data`."*

So a durable image block on the wire is one of exactly:
```jsonc
{ "attachment": "a3f1…32hex", "mime_type": "image/png" }   // ≥1024 b64 chars (the normal case)
{ "data": "<base64>" }                                      // <1024 b64 chars; mime_type also omitted if png
```
…and a durable **text** block is `{ "text": "…" }`. No `type` on either.

**(b) The desktop history endpoint does NOT rehydrate.** `DesktopSessionBridge.history` (`server/utils/desktop_sessions.py:331-352`) calls `read_transcript_page` and serves `json.loads(row.to_json())` — raw entries, **no `AttachmentStore` anywhere in that path**. Contrast `_entry_to_message` (`transcript.py:1412-1436`), which *does* call `_resolve_attachments` — but that is the LLM-replay path, not the wire path.

Verified endpoints:
- `GET /v1/desktop/sessions/{id}/history` → `desktop_sessions.py:244-252` → `HistoryPage` of raw rows
- `GET /v1/desktop/sessions/{id}` (snapshot) → embeds the same raw history page (`desktop_sessions.py:316-318`)

**Durable history gives a frontend a digest and nothing else.**

## The live event stream — bytes ARE present

`DesktopSessionBridge._event` (`desktop_sessions.py:195-196`):
```python
def _event(self, event: Any) -> None:
    self.publish("event", event.model_dump(mode="json"))
```
Plain `model_dump` — **no `exclude_defaults`**. So a live frame carries the full canonical shape:
```jsonc
{ "type": "image", "data": "<full base64>", "mime_type": "image/png" }
```
- `tool_execution_end` (`types.py:1246-1262`) → `result.content[]` → **browser-tool screenshots arrive here with full bytes**
- `message_start` (`types.py:1128-1130`) → `message.content[]` → user attachments with full bytes

Transport ceiling: `publish` disconnects a subscriber if `queued_bytes + size > REPLAY_BYTES` (8 MiB, `desktop_sessions.py:47`, `184-193`). A single ~1.4 MB screenshot is fine; a backed-up queue of them forces a gap + reconnect snapshot.

**One exception — the reconnect seed is stripped.** `CanonicalFrontendState.live_events` is bounded by `_bound_live_result_in_place` (`frontend_state.py:1985-2070`). Share = `max(200, 60_000 // len(results))`. A block with no `text` key (i.e. an image) that exceeds its share is **replaced** by:
```
[dropped from the reconnect snapshot — see the transcript]
```
(`LIVE_EVENT_BLOCK_ELIDED_PLACEHOLDER`, `frontend_state.py:275`). A 1.4 MB base64 image always blows a 60 kB frame budget, so **a mid-turn reconnect never gets image bytes from the seed** — it must fall back to the durable path, i.e. to the endpoint that does not exist yet.

## The desktop transport surface in the UI

| File | What it has for images | Verdict |
|---|---|---|
| `src/shared/desktop-session-contract.ts` | **zero** matches for `image`/`media`/`attachment` (grep). `DesktopHistoryPage.entries[].payload` is `Record<string, unknown>` (lines 126-135) | untyped passthrough |
| `src/shared/desktop-contract.ts` | `sessionImage` (lines 18-23) — `{data_b64, mime_type}`, `image/png\|jpeg\|gif\|webp`, ≤1 MB. **Upload only**, used by `sessions.message` (line 185) and `sessions.command` (line 199). No read op. | outbound only |
| `src/main/desktop-media.ts` | allowlist is exactly `speech.create`, `speech.agent`, `transcription.create`, `agent.import`, `agent.export` (lines 26-61). Returns `{kind:"bytes", mimeType, data: Uint8Array}`, ≤32 MiB download (line 24) | **the right relay, wrong allowlist** |
| `src/renderer/src/shared/api/local-operator/desktop-api.ts` | `desktopMedia()` (line 295) wraps it; `desktopResult<T>()` (line 163) is JSON-only | ready to extend |
| `src/main/desktop-transport.ts` | JSON only, `Accept: application/json`, 256 KiB **request** body cap (line 30), 20 s timeout | cannot carry bytes |

## Answer to "which op can fetch image bytes today"

**None.** Explicitly ruled out:
- No `sessions.attachment` / `sessions.image` op exists in `desktop-contract.ts`.
- `desktop-media.ts` has a closed 5-item allowlist; renderer code "cannot pick a URL, method or header" (its own docstring, lines 6-9).
- `GET /v1/static/images?path=…` (`server/routes/static.py:74-141`) serves arbitrary disk paths and is **not** behind the managed gate (`_LEGACY_GATED_PREFIXES` = `/v1/agents`, `/v1/jobs`, `/v1/schedules` — `server/app.py:212`). But it calls `mimetypes.guess_type()` on the filename and rejects anything outside `ALLOWED_IMAGE_TYPES` (lines 115-120). Attachment files are named `<digest>.bin` → `application/octet-stream` → **400**. It cannot serve the store as-is.
- The mobile daemon **does** have exactly this endpoint — `GET /api/sessions/{session_id}/image?entry=<message_id>&i=<image_index>` (`mobile/daemon.py:2554`, handler at `2245-2284`, resolver `_image_bytes` at `942-987`). It is a separate Starlette process on a different port behind mobile auth, **not reachable from the desktop transport**. It is the design precedent to copy, not a route to call.

## What must be added

### B1. Backend route (`local_operator/server/routes/desktop_sessions.py`)

```
GET /v1/desktop/sessions/{session_id}/attachments/{digest}
```
- validate `digest` against `^[a-f0-9]{32}$` (matches `_DIGEST_CHARS = 32`) — this is the path-traversal gate
- `AttachmentStore().get(digest)` → `(base64, mime_type)`; the store already verifies the sha256 and returns `None` on mismatch (`attachments.py:146-168`)
- respond `Response(content=raw_bytes, media_type=mime_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})` — immutable is safe because the digest **is** the content key, exactly as the mobile route argues (`daemon.py:2254-2260`)
- `404` on any miss. A missing attachment must never 500 — the store's contract is "callers must treat that as ordinary and degrade to a placeholder" (`attachments.py:149-153`)
- run the read in `asyncio.to_thread` (disk I/O, matching `bridge.history`)
- it lands under `/v1/desktop/` so it is already bearer-gated by `managed_desktop_boundary` (`server/app.py:321`)

Prefer keying by **digest**, not `(entry_id, index)` as mobile does: the desktop history row hands the frontend the digest directly, so digest-keying needs no history re-fold per image and dedupes identical screenshots across the whole conversation for free.

### B2. Media op (`src/main/desktop-media.ts`)

Add to `mediaRequestSchema` (after line 60):
```ts
z.object({
    op: z.literal("sessions.attachment"),
    sessionId: z.string().regex(/^[a-f0-9]{12}$/),
    digest: z.string().regex(/^[a-f0-9]{32}$/),
}).strict(),
```
And in `endpoint()` (line 74):
```ts
case "sessions.attachment":
    return {
        path: `/v1/desktop/sessions/${request.sessionId}/attachments/${request.digest}`,
        method: "GET",
    };
```
It is a GET, so it takes the `body = undefined` branch alongside `agent.export` (line 113-115) — extend that condition. `MAX_DOWNLOAD_BYTES` (32 MiB) already covers any screenshot. Also add `image/*` to the `Accept` header at line 144.

The relay already returns `{kind:"bytes", mimeType, data: Uint8Array}`, which is exactly what a blob URL needs. **No change is required in `desktop-transport.ts` or `desktop-api.ts`** — `desktopMedia()` is generic over the schema.

---

# C) Current UI behaviour and the change list

## Confirmed as described in the brief

`transcript-reducer.ts`:
```ts
// line 42        images: number;                         (in the "user" record)
// lines 130-135
function imageCount(message: Record<string, unknown> | undefined) {
    const content = message?.content;
    if (!Array.isArray(content)) return 0;
    return (content as ContentBlock[]).filter((block) => block?.type === "image").length;
}
// line 253       images: imageCount(payload),            (durable path, durableRecord)
// line 470       images: imageCount(message),            (live path, message_start)
```
`ContentBlock` (line 118) is `{ type?: string; text?: string; data?: string }` — note it does not even model `attachment`.

`canonical-transcript.tsx:112-118`:
```tsx
{record.images > 0 && (
    <p className="mt-1 text-ink-dim text-meta">
        {record.images === 1 ? "1 image attached" : `${record.images} images attached`}
    </p>
)}
```
Note this `<p>` is a **raw string className, not wrapped in `cn`** — it violates the AGENTS.md rule (`AGENTS.md:29-32`, `65-70`) and should be fixed while the file is open.

## The latent bug (fix this regardless of thumbnails)

`imageCount` filters on `block?.type === "image"`. **Durable rows never carry `type`** (§ B, `transcript.py:215-218`). Therefore:

- `durableRecord` (line 253) → **always 0**. "N images attached" has never once appeared on reloaded history.
- `message_start` (line 470) → correct, because live events dump without `exclude_defaults`.

**Correct predicate**, mirroring `_externalize_attachments`'s own discriminant:
```ts
type ContentBlock = {
    type?: string;
    text?: string;
    data?: string;
    attachment?: string;
    mime_type?: string;
};

const isImageBlock = (b: ContentBlock) =>
    b?.type === "image" || typeof b?.attachment === "string" ||
    (typeof b?.data === "string" && b.data.length > 0);
```
Also verify `messageText` (lines 121-128): it uses `(block.type ?? "text") === "text"`, so a typeless image block passes the filter and contributes `block.text ?? ""` = `""`. Harmless today, but once `isImageBlock` exists, `messageText` should exclude image blocks explicitly rather than relying on that accident.

## Change list for real thumbnails

### C1. Record shape (`transcript-reducer.ts`)

Replace `images: number` on the user record and add the same field to the tool record:

```ts
/**
 * One image on a transcript row.
 *
 * Two sources, one shape. A LIVE event carries the bytes inline (the owner
 * dumps events without `exclude_defaults`, so `type` and `data` are both
 * present); a DURABLE row carries only a content-addressed digest, because
 * the transcript externalises every image over 1 KiB of base64 into
 * `<config>/attachments/<digest>.bin` and strips `data` from the row. The
 * view must handle both without knowing which source it came from, so the
 * fields are a union in practice: exactly one of `data` / `attachment` is
 * populated.
 */
export type TranscriptImage = {
    /** Stable key: `${recordId}:${index}` — position among IMAGE blocks only. */
    id: string;
    /** Base64 payload when the event carried it inline. Live path only. */
    data: string | null;
    /** Attachment-store digest when the row referenced it. Durable path only. */
    attachment: string | null;
    mimeType: string;
};
```
- user record: `images: TranscriptImage[]` (drop `images: number`)
- tool record: **add** `images: TranscriptImage[]` — this is what makes browser-tool screenshots visible, and it does not exist in any form today

**Identity gate:** `shallowEqual` (lines 143-150) compares by `!==`. A freshly-built array fails that on every frame and would re-render every image row per token. Extract images with a memo that returns the **same array object** when contents are unchanged, or compare `images` by a joined id string inside `shallowEqual`. This is not optional — `canonical-transcript.tsx:15-25` states the per-token repaint contract explicitly.

### C2. Reducer wiring

| Site | Change |
|---|---|
| `durableRecord` user branch, line 253 | `images: extractImages(payload, entry.id)` |
| `durableRecord` tool branch, lines 292-311 | add `images: extractImages(payload, entry.id)` — durable tool rows carry `ImageContent` in `content` exactly as user rows do (`session_presentation.py:849-855` proves the TUI reads them from there) |
| `message_start`, line 470 | `images: extractImages(message, message.id)` |
| `tool_execution_end`, lines 610-641 | add `images: extractImages(result, id)`; `result` is already destructured at line 615. **This is the operator's complaint, and it needs no backend work.** |
| `applyHistoryPage` merge, lines 367-378 | the durable-over-live tool merge keeps `args`/`intent` from the live record. Do the same for `images`: `images: record.images.length ? record.images : current.images` — a durable row has digests, a live row has bytes, and the bytes are already decoded in the browser. Preferring the live array avoids a needless refetch on the row the user is looking at. |

### C3. Fetch hook (new file, `canonical/use-attachment-url.ts`)

```ts
export function useAttachmentUrl(image: TranscriptImage, sessionId: string): string | null
```
- `image.data` present → `` `data:${image.mimeType};base64,${image.data}` `` (synchronous, no fetch)
- `image.attachment` present → `desktopMedia({ op: "sessions.attachment", sessionId, digest: image.attachment }, null)`; on `kind === "bytes"` build `URL.createObjectURL(new Blob([result.data], { type: result.mimeType }))`
- **`URL.revokeObjectURL` in the effect cleanup** — the transcript window is 60 rows (`canonical-transcript.tsx:74`) and rows unmount as the user scrolls; without revoke this leaks a blob per scroll
- module-level `Map<digest, string>` cache: the digest is content-addressed and immutable, and the same screenshot recurs across rows and sessions — refetching per mount is pure waste
- error → return `null`, let the view draw `BrokenAttachment`. Never throw; a missing attachment is an ordinary outcome (`attachments.py:149-153`)

### C4. View (`canonical-transcript.tsx`)

**Reuse `ImageAttachment` — do not write a second image component.** See § D.

`UserRow` (lines 94-124), replacing lines 112-118:
```tsx
{record.images.length > 0 && (
    <div className={cn("mt-2 flex flex-col gap-2")}>
        {record.images.map((image) => (
            <CanonicalImage key={image.id} image={image} sessionId={sessionId} />
        ))}
    </div>
)}
```

`ToolRow` — mount the same list **below the `TraceLine`'s disclosure**, matching the TUI's "images show under the settled card" rule (`session_presentation.py:846-848`). Screenshots should be visible without expanding the disclosure: in the TUI they are unconditionally in the flow, and hiding the picture behind a toggle is the exact complaint being fixed.

Colour roles, all already in the design system and already used by `attachment-frame.tsx`: `border-hairline`, `bg-sunken`, `text-ink-dim`, `text-ink-muted`, `text-ink`, `rounded-sm`. Every `className` goes through `cn` from `@shared/lib/utils` (`AGENTS.md:29-32`, `65-70`). **No hex, no `theme.palette.*`.**

Sizing to echo the TUI ledger rule: a shared height ceiling with width following aspect. `max-h-[240px] max-w-full object-contain` (already `image-attachment.tsx:188`) is the closest existing analogue; the TUI's literal ceiling is 18 rows × 16 px = **288 CSS px**. Either is defensible — pick 240 for consistency with the legacy view and say so, rather than inventing a third number.

Reflow: `AttachmentFrame` already reserves the box and `min-h-16`, and `image-attachment.tsx:186-198` holds the `<img>` at `opacity-0` until `onLoad`. This matters more here than in the legacy view — the canonical transcript is `column-reverse` (`canonical-transcript.tsx:27-29`), where a late-decoding image yanks the text the reader is on.

`sessionId` is not currently threaded to `UserRow`/`ToolRow`; it must be added to `CanonicalTranscriptProps` (lines 77-90) and passed down, or read from context.

### C5. Contract types (`src/shared/desktop-session-contract.ts`)

Currently has **zero** image types. Add the durable block shape so the reducer is not casting blind:
```ts
export type CanonicalContentBlock = {
    /** Absent on durable rows: the encoder drops pydantic defaults. */
    type?: "text" | "image";
    text?: string;
    /** Inline base64. Live events always; durable rows only under 1 KiB. */
    data?: string;
    /** Attachment-store digest. Durable rows over 1 KiB. */
    attachment?: string;
    mime_type?: string;
};
```

---

# D) The reusable piece — how the legacy view gets its bytes

`src/renderer/src/features/chat/components/message-item/image-attachment.tsx` (222 lines).

**It never fetches anything.** It is a pure presentational component taking `src: string` as a prop (line 15). The URL is built by its **callers**:

- `message-item/index.tsx:152-156` and `streaming-message.tsx:80-88`:
  ```ts
  const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
  if (isImage(path)) return client.static.getImageUrl(normalizedPath);
  ```
- `shared/api/local-operator/static-api.ts:13-30` →
  ```ts
  `${baseUrl}/v1/static/images?path=${encodeURIComponent(normalizedPath)}`
  ```

**So the legacy path is fundamentally different and does not port.** It works because legacy messages carry image **file paths on disk** (`Message.files`), which `/v1/static/images` serves directly by path. Canonical messages carry **base64 or a store digest** — there is no path, and the static route rejects `.bin` on MIME (§ B). The legacy transport is a dead end for canonical images.

**What IS reusable, and should be reused verbatim:**

1. **`ImageAttachment` itself** — it takes any `src`, so a `data:` URL or a blob URL drops straight in. Its `isLocalFile` guard (line 168) already excludes `data:`/`http` from the file-actions menu, so a canonical image simply renders without that menu. No modification needed to render; only if you want a canonical-specific action.
2. **`attachment-frame.tsx`** — `AttachmentFrame` (reserved box, `min-h-16`, `bg-sunken`, `border-hairline`) and `BrokenAttachment` (named failure, `ImageOff` icon, `text-ink-dim`/`text-ink-muted`, neutral ground not `danger`). Its docstring (lines 1-25) documents the three failure modes — broken/tiny/reflow — that an ad-hoc `<img>` re-introduces. **This is the design-review-approved answer to the unavailable state, and it is the direct analogue of the TUI's `▨ … unavailable` receipt.**
3. **The load/error state machine** — `hasError`/`isLoaded`, `opacity-0` until decode, `BrokenAttachment` on error (lines 45-46, 164-198). No spinner, by design (lines 22-25).

Recommended shape: a thin `CanonicalImage` wrapper that calls `useAttachmentUrl` and renders `<ImageAttachment src={url} …>`, or `<BrokenAttachment name={…}>` when the URL is `null`. **Do not fork `ImageAttachment`** — a second image component beside an established one is the defect AGENTS.md warns about.

---

# E) Summary of work

| # | Change | File | Backend? |
|---|---|---|---|
| 1 | Fix `imageCount` predicate (`type` is absent on durable rows) | `transcript-reducer.ts:130-135` | no |
| 2 | Wrap the `images attached` `<p>` className in `cn` | `canonical-transcript.tsx:113` | no |
| 3 | `TranscriptImage[]` on user **and tool** records; extract in all 4 sites | `transcript-reducer.ts` | no |
| 4 | Render live tool-result screenshots (bytes already on the wire) | `canonical-transcript.tsx` | **no** |
| 5 | `GET /v1/desktop/sessions/{id}/attachments/{digest}` | `server/routes/desktop_sessions.py` | **yes** |
| 6 | `sessions.attachment` media op | `src/main/desktop-media.ts` | no |
| 7 | `useAttachmentUrl` + blob cache/revoke | new `canonical/use-attachment-url.ts` | no |
| 8 | `CanonicalContentBlock` type | `desktop-session-contract.ts` | no |
| 9 | Preserve identity of the `images` array through `shallowEqual` | `transcript-reducer.ts:143-150` | no |

**Items 1-4 ship without touching Python and already fix the operator's main complaint for live sessions.** Items 5-7 are what make images survive a reload.

# F) What the evidence does not settle

- **Whether durable tool rows reliably carry image blocks in `content`.** I inferred it from `session_presentation.py:849-855` (the TUI resume path reads exactly that) plus `ToolResult.content: list[Content]` (`types.py:148`). I did not read an actual `transcript.jsonl` to confirm the on-disk shape of a tool row that returned a screenshot. **One `grep -c '"attachment"' ~/.local-operator/sessions/*/transcript.jsonl` plus one row inspected would settle it** — worth doing before implementing item 3's tool branch, since it decides whether tool-result images are digest-referenced or dropped entirely on the durable path.
- **Whether every install has externalised attachments.** The store is a recent optimisation; older transcripts may still carry inline `data` above 1 KiB. The `isImageBlock` predicate in § C handles both, so this is not a blocker — but it means the `data` branch of `useAttachmentUrl` is live code, not dead.
- **Behaviour when `AttachmentStore.get` returns `None`** on a shared/synced config dir — I have the code path (returns `None`, caller degrades) but no observed instance.