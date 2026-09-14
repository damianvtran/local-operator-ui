job 23fd25cd5921 (desktop-413-audit) [completed] model=anthropic/claude-opus-5
I could not run `git log -S 262144` — this role has no shell — so the history question is answered from the documentary record instead, and I flag exactly what would settle it. I also cannot write the file; the full report is below, ready to save verbatim to `~/local-operator-ui/docs/evidence/tui-parity/desktop-413-audit.md`.

## Answer first

**The 256 KiB cap in `desktop-transport.ts:30` is a hard-coded global that contradicts the schema declared 150 lines away in the same package, and is 3.4× stricter than what the backend actually accepts.** One ordinary Retina screenshot exceeds it. There is no client-side downscaling anywhere in the UI, unlike the TUI, which bounds every pasted image to 1024px before it ever reaches the wire. And a second bug rides along: the 413 sets `admissionAttempted` *before* it fires, so the refused draft is then locked to byte-identical retry — the user physically cannot remove an image to make it fit.

---

# Desktop 413 audit — long message with pasted screenshots refused

Scope: `local-operator-ui` @ v0.16.0 (`main`), backend `~/local-operator`.
Read-only reconnaissance. No files modified.

## 0. Reproduction path

| Step | Location |
|---|---|
| Paste → `FileReader.readAsDataURL` → attachment is a `data:` URL | `src/renderer/src/features/chat/components/message-input.tsx:506-530` |
| Send → strip prefix, keep raw base64, cap at 8 | `src/renderer/src/features/chat/components/chat-page.tsx:45-69` |
| `admitChatDraft(...)` → `admissionAttempted = true` **then** `desktopResult` | `src/renderer/src/shared/store/canonical-sessions-store.ts:154-162` |
| IPC `desktop-request` (no size check) | `src/main/desktop-ipc.ts:90-93` |
| `desktopEndpoint()` builds `{request_id, text, images, mode}` | `src/shared/desktop-contract.ts:870-880` |
| **`Buffer.byteLength(body) > 262144` → 413, before `fetch`** | `src/main/desktop-transport.ts:28-35` |
| Banner renders `detail` + "Your message is kept below…" | `src/renderer/src/features/chat/components/chat-page.tsx:297-327` |

The refusal is entirely local. No HTTP request is made (`fetch` is at line 36, after the guard). The backend never sees the message.

## 1. Per-image cap and the arithmetic

`sessionImage` — `src/shared/desktop-contract.ts:18-23`:

```ts
const sessionImage = z.object({
    data_b64: z.string().min(1).max(1_000_000),
    mime_type: z.enum(["image/png","image/jpeg","image/gif","image/webp"]),
}).strict();
```

`sessions.message` — same file, `:179-188`: `text: z.string().max(200000)`, `images: z.array(sessionImage).max(8).optional()`.

Base64 is JSON-safe (alphabet `A–Za–z0–9+/=`), so `JSON.stringify` adds **zero** escaping to `data_b64`. Per-image wire cost is exact:

```
per image  = len(data_b64) + ~46 bytes envelope
           ("{"data_b64":"…","mime_type":"image/png"},")
```

**Schema maximum:**

```
images : 8 × (1,000,000 + 46)        =  8,000,368
text   : 200,000 (unescaped minimum) =    200,000
envelope (request_id, mode, keys)    =        ~90
                                       -----------
total                                =  8,200,458 bytes  ≈ 7.82 MiB
transport cap                        =    262,144 bytes  =  256 KiB
ratio                                =      31.3×
```

**A single image at its schema maximum is 3.81× the transport cap** (1,000,046 vs 262,144). The two limits cannot both be right.

Text alone can also breach it: 200,000 chars is under 262,144, but JSON escaping inflates. 200,000 newlines serialize to 400,000 bytes (`\n` → `\\n`); any non-ASCII is 2–4 UTF-8 bytes counted by `Buffer.byteLength`. **A message with no images at all, within the declared text limit, can be refused.**

**Verdict: yes, self-contradictory.** The same file that promises 8 × 1 MB images and 200k chars of text is fronted by a transport that accepts 256 KiB total. The declared contract is unreachable by a factor of 31.

**What this means in practice.** Working backwards from 262,144 bytes: the base64 budget is ~262,000 chars ⇒ ~196,500 raw image bytes ⇒ **~192 KiB of PNG across *all* attachments combined.** A macOS Retina screenshot of a browser window is typically 300 KB–2 MB. **One** screenshot busts it. The reported case — long text plus several screenshots — misses by an order of magnitude, which is why it reads as a bug rather than a limit.

## 2. Where 262144 comes from

**Grep is exhaustive — three occurrences, no comment on any of them:**

- `src/main/desktop-transport.ts:30` — the failing check. Bare literal, no named constant, no comment.
- `scripts/vite-plugins/desktop-proxy.ts:246` — the browser-dev proxy, same bare literal, same absence.
- `docs/desktop-controls.md:107-109` — **the only justification that exists anywhere in the repo:**

> "The existing JSON main/dev proxy budget remains 262,144 bytes, less than the backend's 900,000 byte control-frame budget. Larger image submission needs a coordinated transport-budget/attachment slice, not a schema-only size promise."

This is decisive on intent. 262,144 is **not** derived from a backend limit, an IPC frame limit, or a measurement. It is an arbitrary conservative default (2^18) that the authors *knew* was below the backend's real ceiling, deferred to a later slice, and never revisited — while the schema in the same package was subsequently written to promise 8 MB. The doc even names the failure mode that shipped: "a schema-only size promise."

The comment at `chat-page.tsx:37-41` propagates the error as fact: *"the JSON transport budget is 256 KiB, see the backend contract."* The backend contract says 900,000. The comment cites a source that contradicts it.

**Not settled by evidence:** I could not run `git log -S 262144 -p` (read-only role, no shell). The documentary record above is strong on *what* the number is and *that* it was known to be below the backend's, but it does not prove no commit message adds a further constraint. **What would settle it:** `git log -S 262144 -p -- src/main/desktop-transport.ts scripts/vite-plugins/desktop-proxy.ts` in `~/local-operator-ui`. I expect it to show the constant introduced with the proxy and copied to the transport, matching `docs/desktop-controls.md`.

**No IPC frame limit is implicated.** Electron `ipcMain.handle` uses structured clone with no practical size ceiling, and the sibling media relay on the same IPC accepts **16 MiB** (`src/main/desktop-media.ts:23`, `MAX_UPLOAD_BYTES = 16 * 1024 * 1024`) with a 32 MiB download bound. The same process already moves 64× more bytes over the same channel for file uploads. An IPC constraint would have capped that too.

## 3. What the backend actually accepts

Endpoint: `POST /v1/desktop/sessions/{session_id}/messages` → `local_operator/server/routes/desktop_sessions.py:255-286`.

Body model `Prompt` — `desktop_sessions.py:89-105`:

```python
class Prompt(Input):
    request_id: RequestID
    text: str = Field(max_length=200_000)
    images: list[Image] = Field(default_factory=list, max_length=8)
    mode: Literal["prompt", "steer"] = "prompt"

    @model_validator(mode="after")
    def nonempty(self):
        ...
        if len(self.model_dump_json().encode()) > 900_000:
            raise ValueError("Message exceeds the canonical control-frame limit")
```

`Image` — `desktop_sessions.py:77-86` — `data_b64: str = Field(max_length=1_000_000)`, identical enum. **The UI's Zod schema is a faithful mirror of the backend's Pydantic model. Only the transport guard diverges.**

**The real ceiling is 900,000 bytes**, enforced by that validator. Everything else is looser or absent:

- **uvicorn/starlette: no body-size limit.** `local_operator/cli.py:3271-3279` calls `uvicorn.run("local_operator.server.app:app", host=…, port=…, reload=…)` with no limit arguments. Uvicorn enforces no request-body ceiling by default; `h11_max_incomplete_event_size` bounds headers only. This is the process the desktop app spawns (`src/main/backend/backend-service.ts:604-605, 646, 681` — all `local-operator serve --port <n>`).
- **No middleware.** `local_operator/server/app.py:360` registers `CORSMiddleware` and nothing else. No `Content-Length` check exists anywhere under `local_operator/server/` (grep for `content_length|MAX_REQUEST|body_size`: zero matches).
- **The wall behind the wall.** The admitted prompt travels to the session owner over a loopback control socket whose frame limit is **1 MiB** — `local_operator/session/runtime/server.py:98-100` (`_MAX_LINE_BYTES = 1 << 20`), server bound at `:913-914` (`asyncio.start_server(..., limit=_MAX_LINE_BYTES)`), client mirrored at `local_operator/mobile/attach_client.py:71-75` (`_READ_LIMIT_BYTES = 1 << 20`). Path: `desktop_sessions.py:263` → `session/remote.py:1400-1415` `admit_prompt` → `attach_client.py:498-501` `writer.write(json.dumps(frame) + b"\n")`. The 900,000 figure is 1 MiB minus ~14% envelope headroom — it is a *derived* number with a real physical wall behind it, unlike 262,144.

| Layer | Limit | Source |
|---|---|---|
| UI transport guard | **262,144** | `desktop-transport.ts:30` (arbitrary) |
| UI Zod schema promise | ~8,200,458 | `desktop-contract.ts:18-23,179-188` |
| Backend Pydantic frame budget | **900,000** | `desktop_sessions.py:101` |
| Owner control socket frame | 1,048,576 | `runtime/server.py:100` |
| uvicorn body | *(none)* | `cli.py:3271-3279` |

**The UI refuses at 29% of what the backend accepts.** 900,000 − 262,144 = 637,856 bytes of headroom thrown away.

## 4. Base64 inflation and the absence of downscaling

**Inflation happens before the check, twice, with no bounding at either site.**

- **Pasted images** — `message-input.tsx:506-530`: `reader.readAsDataURL(file)` stores the whole `data:image/png;base64,…` URL as the attachment path. Inflation is the standard 4/3: `ceil(raw/3) * 4`.
- **File attachments** — `chat-page.tsx:59-66`: `window.api.readFile(path, "base64")` → `readFileSync(path, "base64")` in `src/main/index.ts:457`. Same 4/3.
- **Encoding for the wire** — `chat-page.tsx:50-58`: the `data:` prefix is stripped via `IMAGE_DATA_URL` capture group 3, so no double-prefix cost. `.slice(0, 8)` at line 68 is the only bound applied, and it is a *count*, never a size.

**There is no downscaling, compression, re-encoding, or dimension bound anywhere in the renderer.** Grep for `createImageBitmap|OffscreenCanvas|toBlob|maxEdge` across `src/`: four hits, all of them the `mime_type` enum string. The clipboard bytes go to the wire verbatim.

**The TUI does the opposite, deliberately, and documents why.** `local_operator/tui/widgets/editor.py:5773-5819`:

```python
# BOUND before attaching, in a thread. […] Forwarding verbatim was
# therefore not "lossless", it was a delayed fault: a 2206x266
# paste sat harmlessly in the history for a hundred turns and then
# wedged the session permanently […]
payload, wire_mime, _summary = await asyncio.to_thread(bound_image_for_model, data, info)
...
if len(payload) > MAX_ATTACHMENT_BYTES:   # 4 MiB, editor.py:163
    return None
```

`bound_image_for_model` (`local_operator/imaging.py:449`) runs a measured ladder: verbatim if in bounds → resize to `IMAGE_INGEST_MAX_EDGE = 1024` long edge and re-encode PNG (`imaging.py:154`) → JPEG at `IMAGE_JPEG_QUALITY = 85` if that PNG exceeds `IMAGE_MAX_BYTES = 1 MiB` (`imaging.py:206-209`). The module's own measurement, `imaging.py:5799-5804`: **"a Retina screenshot is 8.4-8.5 MB on the pasteboard and 0.28 MB once bounded."**

That is the whole bug in one number. The TUI sends 0.28 MB where the UI sends 8.5 MB — and the UI then refuses its own payload at 0.25 MB.

## 5. Recommended fix

### 5a. Make the cap per-op, not global — and set it from the backend's real number

The global constant is wrong twice over: too tight for `sessions.message`/`sessions.command` (the only ops carrying images), and needlessly loose for control ops that should never approach it. Replace the literal at `desktop-transport.ts:30` with a per-op budget resolved from the op name.

```
sessions.message  →  880_000
sessions.command  →  880_000
everything else   →  262_144   (unchanged; profiles/teams/settings are ≤ 8000-char fields)
```

**Why 880,000 and not 900,000.** The backend measures `model_dump_json()` of the *parsed* model; the client measures `JSON.stringify` of the object `desktopEndpoint` builds. These agree to within a handful of bytes — `desktopEndpoint:874-879` emits every field explicitly including defaults (`images: []`, `mode: "prompt"`), key order matches declaration order, and pydantic v2 emits raw UTF-8 like `JSON.stringify`. But landing exactly on a boundary means a client-accepted message becomes a backend 409 (`desktop_sessions.py:173-181` maps `ValueError` → 409), which is a worse experience than a clear local refusal. A ~2.2% margin costs nothing and mirrors the discipline `imaging.py:167-182` already applies (`IMAGE_REPAIR_TARGET_EDGE = 1960` against a 2000 ceiling, for exactly this reason).

Define it as a named exported constant in `src/shared/desktop-contract.ts` — next to the schema it must agree with, not buried in main — with a comment pinning it to `desktop_sessions.py:101` and naming the 1 MiB socket wall behind it. Both `desktop-transport.ts:30` and `desktop-proxy.ts:246` must import it; two literals in two files is how they drifted from the schema in the first place.

### 5b. Downscale client-side before encoding — this is the actual fix

Raising the cap alone is insufficient, and the arithmetic says so plainly. Even at 880,000 bytes, unbounded Retina screenshots at 8.5 MB each mean **zero** attach successfully. Conversely, bounded ones mostly fit:

```
1024px-bounded UI screenshot   ≈ 200–400 KB PNG
              as base64        ≈ 267–533 KB
880,000-byte budget            → 1–3 such images per message
```

Note honestly: **8 bounded screenshots still do not fit**, and cannot — 8 × 267 KB = 2.1 MB against a 1 MiB socket frame. The `.max(8)` in the schema is reachable only for small images. That is a structural property of this transport, not something a constant can fix, which is why 5c exists.

Add a downscale step in `encodeImageAttachments` (`chat-page.tsx:45`), mirroring `imaging.py`'s ladder so the two surfaces bound identically — the invariant `tools/builtin.py:189-194` states explicitly for its own two call sites: *"both have to bound identically or the unbounded one wedges the session for both."*

1. `createImageBitmap(blob)` → if `max(width, height) <= 1024`, forward verbatim (no re-encode can improve an image sent at native size; PNG round-tripping routinely grows files — `imaging.py:469-473`).
2. Otherwise draw to an `OffscreenCanvas` scaled to a 1024 long edge, `convertToBlob({type: "image/png"})`.
3. If that PNG exceeds 1 MiB, re-encode `{type: "image/jpeg", quality: 0.85}` and keep it **only if actually smaller** (`imaging.py:479-483`).
4. GIF is exempt — canvas re-encoding destroys animation. Forward verbatim and let the budget check catch it.

Use the browser's real decoder, not a library. This runs on the send path, so keep it off the paint path; `createImageBitmap` is already async and off-main-thread.

### 5c. Move the budget check into the renderer, before `admissionAttempted`

**This is a distinct bug and it is arguably worse than the cap itself.**

`canonical-sessions-store.ts:154` sets `admissionAttempted: true` *before* `desktopResult` is awaited at line 155. The 413 is generated at `desktop-transport.ts:30`, **before** `fetch` — nothing was admitted, and the client knows it with certainty. But the flag is already set, so the guard at `canonical-sessions-store.ts:93-108` now fires on the next attempt:

> "The previous send has not been confirmed. Retry it unchanged, or discard it to send something different."

Images are part of that identity check (`:102-103`, added deliberately). **So the user who is told "send it again" cannot remove a screenshot to make it fit** — that is a payload change, and it is refused. The only exit is "Discard unsent message" (`chat-page.tsx:310-323`), which throws the long message away. The banner's advice and the store's guard contradict each other, and the guard wins.

The flag's own docstring (`canonical-sessions-store.ts:46-54`) says it should be set only when "its outcome is genuinely unknown to us" and names pre-admission failures as the case it must *not* cover. A local size refusal is exactly that case.

Two changes, both needed:

- Compute the encoded byte size in the renderer after `encodeImageAttachments` (`chat-page.tsx:200`) and refuse *before* calling `admitChatDraft` — so the composer keeps text and attachments editable and the user can drop one image and send.
- Keep the main-process guard as the backstop it is, but move `admissionAttempted: true` to *after* the `desktopResult` promise is issued, or have `requestDesktop` return a 413 that the store recognizes as pre-admission and does not latch on.

### 5d. Error copy

Current: `"This desktop request is too large."` (`desktop-transport.ts:33`) plus `"Your message is kept below — send it again, or discard it to write something else."` (`chat-page.tsx:302`).

Three failures against `docs/branding.md:389` — *"Errors say what happened, what it means, and what to do, in that order, in the user's terms"*: it names no quantity, blames "this desktop request" (the user sent a message, not a request), and the advice is actively wrong per 5c.

Since the renderer now owns the check, it has the numbers. Sentence case, no emoji, no exception text (`branding.md:391-393`):

> **These images total 2.4 MB, more than the 880 KB one message can carry. Remove an image, or send them in a second message.**

Text-only overflow gets its own sentence, because the remedy differs:

> **This message is 1.1 MB of text, more than the 880 KB one message can carry. Split it across two messages.**

Format sizes with one decimal in MB above 1 MB, whole KB below. Keep the main-process 413 string as the untargeted backstop but make it honest: `"This message is too large to send in one request."`

**Banner styling** stays as-is and is already correct — `role="alert"`, `text-body-sm text-danger`, retained text in `border-control bg-surface text-ink` (`chat-page.tsx:298-309`). Every className there is a named role, so §1 of `branding.md` is satisfied. If the banner is edited, note that `chat-page.tsx:286`, `:290`, `:298`, `:307` currently pass bare strings — per `AGENTS.md:60-70`, wrap each in `cn(...)` from `@shared/lib/utils` while you are in there, since `tailwind-merge` is what keeps a type step and an ink role from silently colliding.

### 5e. Also fix the misleading comment

`chat-page.tsx:37-41` asserts "the JSON transport budget is 256 KiB, see the backend contract." The backend contract says 900,000 (`desktop_sessions.py:101`). Correct it to state the real budget, cite the Python line, and record that images are bounded client-side to 1024px before encoding — with the "why", per the repo's documentation convention.

## 6. Summary of files an implementer touches

| File | Change |
|---|---|
| `src/shared/desktop-contract.ts` | Export per-op byte budgets (880,000 / 262,144), comment pinning them to `desktop_sessions.py:101` and the 1 MiB socket wall |
| `src/main/desktop-transport.ts:30` | Replace literal with per-op lookup; 413 detail becomes the honest backstop sentence |
| `scripts/vite-plugins/desktop-proxy.ts:246` | Same lookup — must not drift from main |
| `src/renderer/src/features/chat/components/chat-page.tsx:37-69` | Downscale ladder in `encodeImageAttachments`; fix the false 256 KiB comment |
| `src/renderer/src/features/chat/components/chat-page.tsx:200-211` | Pre-flight byte check before `admitChatDraft`, with the sized error copy |
| `src/renderer/src/shared/store/canonical-sessions-store.ts:154` | Do not latch `admissionAttempted` on a pre-admission local refusal |

## 7. Evidence not obtained

- **`git log -S 262144 -p`** — not runnable in a read-only role. The documentary justification (`docs/desktop-controls.md:107-109`) is unambiguous about intent, but only the history proves no other constraint was recorded in a commit message.
- **A live 413 reproduction with byte counts.** The arithmetic above is derived from the schemas and the code path, not from an observed request. Standing the app up, pasting three screenshots, and logging `Buffer.byteLength(body)` at `desktop-transport.ts:29` would confirm the measured size against the 262,144 boundary — and after the fix, that the same payload is admitted. That belongs in the implementing MR's testing evidence per the standing rule that evidence means the real path exercised, not a green suite.