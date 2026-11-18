# UI #1977 — QA round 2 real-app frames

These are frames from the built desktop app (electron-vite build, headless Electron under Xvfb on lop-remote-node-2). Each frame was taken with the app's own `capturePage()` through `scripts/renderer-driver.mjs` `launchApp`. During the capture the window was hidden and unfocused (`visible:false, focused:false`, asserted). Window size: 1380×872. Theme: Operator Dark, plus Operator Light for the AFTER set.

| Arm | UI build | Backend |
|---|---|---|
| `after-*` | PR head `25c275e413af6c2cc7264a6ea5e99aea4ae045dc` (`src-status-after.txt`: HEAD and a clean `src/` at build start and end) | real `lop serve` from core #4238 @ `0d9fb8b7a76e7eb31c1c46723680ce614d5df678`; advertises `team_bridge_card_body: 1` |
| `before-*` | origin/main `c8e9c494b691a9c1b00579999574738cd9e96a77` (`src-status-before.txt`) | installed `lop` v0.107.3 (no capability; the body route returns 404) |
| `headoldbackend-*` | PR head `25c275e4` | installed `lop` v0.107.3. This is the R3 check: the pane matches main |

## Seeding

`rig/seed.py` seeds one isolated config through core #4238's own APIs. It uses `Store.commit_enrollment`, a Radient credential row, `DisplayBodyStore.record(source="turn")`, and `Store.persist_hold` with `model_hold` (awaiting_review) and `provider_error` (transient). It writes 8 `team_bridge_message` cards.

The cards are written as `type:"message"` with `payload.kind:"custom"`. That is the journal shape the UI's own `scripts/fixtures/bridge-incoming.json` uses, and the open-frame read serves it. The core test helper's `type:"custom"` rows are dropped by `open_frame.strip_entry`'s allow-list, so they never reach a surface.

The BEFORE config is a byte copy of the AFTER config, taken before either server started. Ids are synthetic (`acc_1`, `ep_1`, `bcv_abcdefgh`, `bcmsg_*`, session `abcdef012345`).

## Hub double

`rig/lop_fake.py` runs the real `lop` CLI and replaces only the hub wire. It patches the network methods of `TeamBridgeClient`, and each card's answer is keyed by `before_seq`:

| Card | Hub answer |
|---|---|
| refused | `body_state.state = rejected` |
| deleted | `deleted_at` |
| offline | `BridgeRefusal("bridge_unreachable")` |
| all others | an empty page |

`conversation_body`, the classification fetch, raises if it is called; it was called 0 times. Everything else is real: routes, auth, resolver, stores and the renderer.

## Driver

`rig/bridge-capture.mjs` is the driver. Its boot and app-root code is adapted from node2's loading-capture rig.
