# Streaming transport: SSE, with a WebSocket fallback

The renderer now streams a turn over **Server-Sent Events** where the backend
offers it, and falls back to the WebSocket where it does not. Everything above
the transport — the rAF coalescing, the equality gate, the global registry, the
stores, the rendering — is unchanged, because both transports present the same
emitter surface.

## Why

The socket only ever carried server-to-client data. The one frame the client
sent upstream was a keepalive `ping`; cancellation was already an HTTP call.
SSE therefore costs no capability and buys three things the socket cannot:

- **Resume with a cursor.** `EventSource` reconnects on its own and replays
  `Last-Event-ID`, so a dropped connection continues at the exact event. The
  socket had no sequence and simply lost whatever arrived while away.
- **Plain HTTP.** No upgrade handshake, so proxies, the Vite dev server and
  ordinary tooling work without special handling.
- **A server-driven keepalive.** The backend heartbeats every 15s, so there is
  no client ping timer, and a stalled stream is *detectable* — the client now
  notices instead of showing a live indicator over a black-holed connection.

## The pieces

| File | Role |
| --- | --- |
| `shared/api/local-operator/sse-api.ts` | `SseClient` — EventSource transport, same emitter surface as `WebSocketClient` |
| `shared/api/local-operator/streaming-transport.ts` | `StreamingClient` — picks the transport, and falls back with the consumer unaware |
| `shared/hooks/use-websocket-message.ts` | now builds a `StreamingClient` instead of a `WebSocketClient`; no call site changes |
| `shared/api/local-operator/websocket-api.ts` | `EventEmitter` exported (one line) so both transports share the emitter |
| `features/chat/components/sse-transport.stories.tsx` | no-backend fixture proving stream, resume, and both fallbacks |

## Compatibility contract

A backend that predates SSE answers **404** on `GET /v1/sse/capabilities`; that
404 is the entire fallback signal, not an error. `record.update` /
`record.complete` carry the legacy `CodeExecutionResult` dump verbatim
(including the injected `message_id` and `connection_type` keys), and the
client republishes it under `update:<messageId>` unchanged — so a consumer
cannot tell which transport delivered its events.

Two failure kinds are handled, and they are different:

- **Backend too old** — detected once per base URL by the capability probe,
  cached for the session.
- **SSE broken in transit** (a buffering proxy) — the stream opens and goes
  silent. Detected per connection by the stall timer (silence past 45s, versus
  the server's 15s heartbeat) and by a terminal error before any frame. Falls
  back for that message and remembers it, so the next message skips the doomed
  attempt instead of paying the stall again. `resetTransportCache()` re-probes.

## What's new beyond parity

The socket bridge discarded `message_update.delta`, tool progress, turn
boundaries, compaction and retries. Those now arrive as first-class events
(`message.delta`, `tool.start`/`delta`/`end`, `turn.start`/`end`,
`agent.start`/`end`, `job.status`, `notice`), forwarded additively by
`StreamingClient`. Nothing requires them; a consumer can opt in to true
incremental text (`message.delta`) and stop re-rendering a whole message per
frame.

A second channel kind is available: `GET /v1/sse/jobs/{job_id}` is openable the
instant the async chat call returns, before any record id exists — removing the
race where the client polled job status until a record id appeared and relied
on cumulative frames to catch up. `StreamingClient` takes `channelKind: "job"`.

## Backend to develop against

- Repo: `~/local-operator`, branch `feat/harness-rewrite` (commit `27cebcc`).
- Serve: `local-operator serve --port 1111` (default `0.0.0.0:1111`).
- Discovery: `GET /v1/sse/capabilities`.
- Streams: `GET /v1/sse/messages/{message_id}`, `GET /v1/sse/jobs/{job_id}`.
  Resume via the `Last-Event-ID` header or `?after_seq=<n>`.

## Pointing the UI at it

The `dev` script greps `.env`, and none ships, so create one:

```env
VITE_LOCAL_OPERATOR_API_URL=http://localhost:1111
VITE_DISABLE_BACKEND_MANAGER=true
```

`VITE_DISABLE_BACKEND_MANAGER=true` stops Electron from installing or killing
your backend. Then `pnpm dev`. The CSP in `src/renderer/index.html` already
permits `http://localhost:1111`.

## Verifying without a backend

`pnpm storybook`, then **Chat → SSE transport**. Four buttons:

- *Stream over SSE* — transport `sse`, the message fills in, completes, one
  stream URL with no cursor.
- *Drop mid-stream, then resume* — the connection drops and reports
  `CONNECTING`, and the client reconnects.
- *Old backend, no SSE* — the probe 404s and transport is `websocket`, with no
  stream URL opened.
- *SSE advertised but silent* — opens, produces nothing, and the stall detector
  switches to `websocket`.

## Verified against a live backend

- The probe selects `sse` when the route exists.
- A real turn streams records that carry the answer and the legacy socket keys,
  then closes on `stream.terminal`.
- A backend without the route falls back to the socket.
- A stream that opens and dies falls back too.

The backend's own evidence (resume across a real disconnect, late-attach
snapshot recovery, concurrent-listener fan-out, WebSocket/SSE record parity)
is in `~/local-operator/docs/VERIFICATION.md`.
