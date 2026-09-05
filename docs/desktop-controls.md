# Desktop control transport

`src/shared/desktop-contract.ts` is the allowlisted desktop operation vocabulary.
Main and preload share its types. Main validates every received request with its
schema and maps it to a fixed backend path/method; renderer code cannot submit an
arbitrary URL, header, HTTP method, or bearer.

`BackendServiceManager` generates a fresh 32-byte capability for each backend it
starts. Both global and bundled-venv spawn paths receive it only as
`LOCAL_OPERATOR_DESKTOP_TOKEN`. It is not written to a file or logged. Explicit
external/dev pairing may supply that variable to the main process environment;
a backend with no matching capability cannot provide protected controls.

The preload surface is `window.api.desktop.request(operation)` and
`openAuthorization(operationId, reopen?)`. Main verifies the IPC sender is the
owned main frame, loaded from the packaged renderer file or exact configured dev
origin. Subframes, foreign windows, and navigated external pages are rejected.
Fetch redirects are errors so a capability cannot follow a redirect to another
service. Validation and transport failures return generic errors, not submitted
keys or raw exception strings.

Authorization opening retrieves the current URL from the backend operation;
the renderer cannot submit a URL to this method. Main opens each operation URL
once unless the user explicitly requests reopening. Only HTTPS provider pages
and HTTP loopback callback pages are allowed. Provider OAuth state/PKCE/refresh
remain backend-owned.

Legacy configuration, instructions, and credential calls now use this same
transport because a managed backend protects those older paths too. New feature
controls must negotiate `GET /v1/capabilities` before enabling themselves. A
missing/unsupported capability requires a visible backend update/setup action;
there is no unauthenticated fallback for privileged new operations.

## Browser development

`desktopProxyPlugin()` exposes the same typed vocabulary at the same-origin
`POST /__desktop` route during Vite development. Supply the isolated token to the
Vite **Node process**, not a `VITE_*` variable, and set
`LOCAL_OPERATOR_DESKTOP_BACKEND_URL` to the isolated backend URL. The backend
process receives the same token. Never commit or print either environment.

The proxy requires a JSON POST from the exact loopback development origin,
limits request size, and reuses the main transport validator. It does not expose
a generic URL proxy or token endpoint. Electron development normally uses IPC
instead; this proxy is for the real-browser development/QA surface only.

## Validation

`pnpm test:desktop` runs Node built-in tests against the actual bundled transport
modules: a real loopback HTTP listener checks bearer routing, typed bodies,
redirect rejection, fail-closed unpaired behavior, and no HTTP request for
invalid operations. An Electron fixture checks frame ownership and one-time
backend-authorized URL opening. This fixture is deliberately **not** evidence
that the packaged Electron app booted, painted, or delivered a notification;
those paths require separate native-app validation.

## Canonical session checkpoint

The request allowlist now includes `sessions.list/create/get/history/message/
command/answer/watch`, mapped only to `/v1/desktop/sessions` and its fixed child
paths. These are canonical12-hex session IDs, not legacy agent UUIDs. Request IDs
for creation/messages/commands are lowercase UUID strings. For `sessions.answer`,
requestId is the pending gate's opaque ID and epoch is the **owner frontend**
epoch. questionIndex is required for ask text; approved is a strict boolean.
Closed Zod validation still runs in main before any HTTP request.

`src/shared/desktop-session-contract.ts` defines the response and stream types.
Large roster/accounting/model additions retain unknown fields so a newer owner
is not silently truncated by an older renderer. This file is a contract, **not a
renderer reducer or a runtime response validator**.

The backend checkpoint supports stable create/reopen, canonical owner admissions,
owner-only command results, history, ask/approval answers and authenticated SSE
watch leases. It does not yet advertise the broad `sessions` or35-command feature
capability. The owner-command endpoint is NOT the complete command palette: only
rename/model/effort/fast/context/goal/compact/approvals/team/agent are accepted.
Bare forms may return owner picker metadata; there is no native picker UI yet.
Team/agent attachment results carry an already-admitted consumed request under
`result.admission`; never send that text/images again from the composer.

### Required next integration

- Implement main-process authenticated fetch streaming and scoped preload IPC
  subscription/unsubscription. Native EventSource cannot carry the bearer. There
  is **no** stream relay in this checkpoint; do not fall back to token URLs or an
  unauthenticated renderer request. Browser-only Vite streaming needs the same
  server-side boundary, not the JSON-only `/__desktop` request route.
- Subscribe at `.../{id}/events?epoch=<receipt-epoch>&after_seq=<receipt-seq>`.
  `open` reports a stream subscription ID and gap flag. Replay comes BEFORE the
  authoritative snapshot, followed by live `frontend.update` and `event` frames.
  Never advance the semantic receipt cursor from `open.seq` before processing
  replay: a newer snapshot does not acknowledge steering/terminal receipts.
- Apply canonical owner epoch/sequence independently of HTTP receipt epoch/seq.
  Gap/restarted/detached streams get a new authoritative snapshot and history page.
  A missing history cursor requires the history endpoint to reconcile. Rendering
  must merge stable message/entry identities, not append snapshot and replay as
  unrelated rows. Load older pages with beforeId; snapshots contain only100rows.
- Renew `sessions.watch` for the **active SSE subscriptionId** within45seconds.
  visible means a person can currently answer in this session; canNotify means
  native delivery is genuinely possible. Until native notifications are wired,
  send canNotify=false. Closing a window detaches, never stops the runtime.
- Implement main-owned gate/turn notification dedupe and exact-session click
  navigation, plus explicit stop/abort, loop, aside/fork, full native command
  arguments, MCP/catalog controls and canonical attachment/trajectory retrieval.
  None is supplied by a typed endpoint mapper alone.
- The existing JSON main/dev proxy budget remains262,144bytes, less than the
  backend's900,000byte control-frame budget. Larger image submission needs a
  coordinated transport-budget/attachment slice, not a schema-only size promise.

A200 message response is admission, NOT model success or completion. Replay of a
completed HTTP receipt returns replayed=true across backend restarts. Changed
input under a reused request UUID is409. A control interrupted after its durable
reservation but before result commit returns409 indeterminate and requires state
reconciliation; only natural owner-idempotent admissions can retry that state.
Do not display an indeterminate command as successful or automatically mint a new
UUID to retry it. Backend API details and actual assembled HTTP/runtime evidence
are documented in its `docs/DESKTOP_API.md` and desktop e2e tests.
