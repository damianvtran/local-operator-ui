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
