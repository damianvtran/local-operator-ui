# Live proof: the ask gate's options, in the shipped renderer, against a real gate

Two frames of the shipped renderer — served over Vite with `desktopProxyPlugin`
— talking to an **isolated** `local-operator` backend on a scratch port that is
holding a gate opened by the owner's own `_ask_gate([AskQuestion(...)])`: the
same seam `tests/e2e/test_desktop_sessions.py` uses, so no model and no mock is
involved. The operator's live backend on `127.0.0.1:1111` was never touched; the
rig runs with its own config root, its own 32-byte token and an OS-assigned port.

## Read this before the frames: what each one shows, and what it does NOT

| frame | what it is |
| --- | --- |
| `before-click/localOperatorDark.webp` | **The card, live.** A real pending gate in the shipped renderer: three `<BUTTON>` options with a fill and an edge, the `Recommended` mark beside the second option's label (the harness rotated `recommended: 1` to the front), and the hint. This is the only frame in the repository of the real card rather than a story fixture. |
| `after-click-unresolved/localOperatorDark.webp` | **NOT the resolution, and it is named that way on purpose.** The frame after the click, taken from the same run — but the Vite dev server died between the two frames, so it shows the gate still on screen with three failure surfaces (`server is offline`, `The backend could not complete this request…`, `Desktop controls could not reach the backend process.`) rather than a gate that cleared. It is kept rather than deleted because deleting it would hide the failure it documents; it is renamed because the previous name — `after-click` — presented it as evidence of the clearing, which it is not. |

**So the pair does NOT evidence that the click resolves the gate.** `owner-answer.json`
does still record what the owner received (`{"PAIRING": ["Popup is not open"]}`),
and `click-result.json` still records the pre-click DOM, the aim point and the
post-click DOM — including the fact that its own `after` block reports
`{"found": true, "count": 3}`, i.e. the DOM had not cleared. Those two files are
consistent with a real click having reached the owner; they are not a picture of
the gate resolving, and this file says so instead of implying otherwise.

The reason the dev server died is fixed in this round: `desktop-proxy.ts` set a
status and ended a response the SSE relay had already started, which throws
`ERR_HTTP_HEADERS_SENT` from inside a connect middleware and takes Vite down
with it (QA round 1, Q1/Q2). The guard is now in the plugin —
`res.headersSent` means the response is committed, so an aborted relay destroys
the socket instead of writing a second status.

## Reproduction, from the repository

The rig is committed, so these frames can be re-derived rather than taken on
trust. Three pieces, all in the tree:

- `harness/serve-gate.py` — the isolated backend. Real uvicorn, the app's own
  bearer/origin gate, the real `desktop_sessions` routes, a real `Session` over a
  real transcript, a real `ServingSessionHandle`/`RuntimeServer`, and a real
  `_ask_gate`. Only the provider stream is a stand-in, and it raises if it is
  ever called, because nothing here starts a turn.
- `harness/ask-gate.vite.mjs` — the renderer's browser dev server, with the
  committed `desktopProxyPlugin`, the app's own CSP, and the preload shim the
  browser-development surface needs (below).
- `scripts/click-proof.mjs` — the driver: a private `--headless=new` Chromium
  driven over raw CDP with real `Input.dispatchMouseEvent` press/release, the
  same technique `scripts/capture-evidence.mjs` uses.

```sh
# 1. The isolated backend. Own config root, own token, OS-assigned port; it
#    prints and writes the port, and arms the card only when the driver asks.
python docs/evidence/ask-options-live/harness/serve-gate.py \
  --scratch /tmp/ask-gate-rig \
  --token-file /tmp/ask-gate-rig/token \
  --result-file /tmp/ask-gate-rig/owner-answer.json

# 2. The shipped renderer, pointed at it. The token is read by the Vite NODE
#    process, never by a VITE_* variable, and never printed.
VITE_LOCAL_OPERATOR_API_URL=http://localhost:5199 \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:$(cat /tmp/ask-gate-rig/port) \
LOCAL_OPERATOR_DESKTOP_TOKEN=$(cat /tmp/ask-gate-rig/token) \
  npx vite --config docs/evidence/ask-options-live/harness/ask-gate.vite.mjs

# 3. Open the session, wait for the app shell, then arm the card and click it.
node scripts/click-proof.mjs http://localhost:5199 docs/evidence/ask-options-live a1a1a1a1a1a1
```

`click-proof.mjs` waits for the app shell, calls `/rig-arm` (proxied to the
rig's own control route), waits until the option is genuinely **hit-testable**
— `elementFromPoint` at its painted centre resolves to that button — then
presses and releases there. It writes `click-result.json` and exits non-zero
without overwriting it when a step fails, so a failed run cannot be mistaken for
a successful one.

**The healthy re-capture of this pair is deferred, not done.** The driver gets
the card standing and hit-testable in a story, but not yet in the live app: with
the onboarding store's completion flags seeded (without which the modal covers
the transcript) the option's rect comes back at `top: -30` inside a pane whose
scroller has already been measured empty, so the click cannot be aimed honestly.
Committing frames of a card the layout had not placed would be a worse defect
than the one being fixed, and a doctored screenshot is worth less than an
honest gap. It is recorded as `deferred` on the PR with the exact blocker, and
QA round 2 owns it.

Two stand-ins were needed to boot the app in a browser at all. Both are
pre-existing gaps in the browser-development surface that this change neither
introduces nor fixes, and both are in `harness/ask-gate.vite.mjs` rather than
hidden in a scratch directory:

- `app.tsx` and several hooks read `window.electron.ipcRenderer` and
  `window.api.*` unguarded, which only Electron supplies. The shim provides
  them — and deliberately leaves `window.api.desktop` UNDEFINED, because that is
  what makes `desktop-api.ts` take its shipped **browser** branch through
  `/__desktop`, which is the path under test.
- The provider-onboarding modal opens on any install with no credential and has
  no close control. It is settled by seeding the onboarding store's own
  persisted completion flag (`onboarding-storage`), the way a returning user
  would have it.

## What these frames also caught

`before-click/localOperatorDark.webp` shows a `session incident / Stopped with
an error` row above the gate. That is the RIG, not the app: its scripted provider
stream holds one turn and the harness asked for a second. It is left in the frame
rather than cropped out, because a doctored screenshot is worth less than an
honest one, and it does not touch the gate below it.
