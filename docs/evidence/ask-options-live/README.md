# Live proof: a real click on a real pending ask gate

Not a story and not a fixture. These are the shipped renderer, served over Vite
with `desktopProxyPlugin`, talking to an **isolated** `local-operator` backend
on a scratch port that is holding a gate opened by the owner's own
`_ask_gate([AskQuestion(...)])` — the same seam
`tests/e2e/test_desktop_sessions.py` uses, so no model and no mock is involved.
The operator's live backend on 127.0.0.1:1111 was never touched; the rig ran
with its own config root, its own token and an OS-assigned port.

## What was proved

| | |
| --- | --- |
| the options are real controls | three `<BUTTON>` elements, `pointer-events: auto`, none disabled at rest |
| the click is a real click | `Input.dispatchMouseEvent` press + release at the option's painted pixels (580, 1094), after `elementFromPoint` confirmed those pixels resolve to that button |
| the accessible name is the label | the ordinal is `aria-hidden`; the name reads "Popup is not open…", not "2. Popup is not open" |
| **the answer is the LABEL** | the owner received `{"PAIRING": ["Popup is not open"]}` — see `owner-answer.json` |
| the gate resolves | the pending gate cleared and the owner's `_ask_gate` future returned |

The **second** option was clicked, deliberately: a pass on the first would be
indistinguishable from an index-0 accident.

`click-result.json` is the driver's own record (the pre-click DOM state, the
aim point, the post-click state). `before-click.png` is the card as the user
sees it; `after-click.png` is the frame after the click.

## What these frames also caught

`before-click.png` shows a `session incident / Stopped with an error` row above
the gate. That is the RIG, not the app: its scripted provider stream holds one
turn and the harness asked for a second. It is left in the frame rather than
cropped out, because a doctored screenshot is worth less than an honest one,
and it does not touch the gate below it.

## Reproduction

```sh
# 1. Isolated backend holding a real gate with options (own config root, own
#    token, OS-assigned port; never :1111).
python /tmp/ask-gate-rig/serve_gate.py          # prints RIG READY port=…

# 2. The shipped renderer over Vite, pointed at that backend. The renderer's
#    CSP pins REST to :1111, so the rig proxies the isolated backend at the
#    Vite origin ('self') rather than widening the shipped CSP.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:5199 \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:<rig-port> \
LOCAL_OPERATOR_DESKTOP_TOKEN=<rig-token> \
  npx vite-node vite.web.mjs

# 3. Drive the click over CDP (the same private headless Chromium
#    scripts/capture-evidence.mjs already drives - not a second browser stack).
node /tmp/ask-gate-rig/proof.mjs
```

Two stand-ins were needed to boot the app in a browser at all, and both are
recorded rather than hidden because they are pre-existing gaps in the
browser-development surface that this change did not introduce and does not
fix:

- `app.tsx` and several hooks read `window.electron.ipcRenderer` and
  `window.api.*` unguarded, which only Electron supplies. The shim provides
  them — and deliberately leaves `window.api.desktop` UNDEFINED, because that
  is what makes `desktop-api.ts` take its shipped **browser** branch through
  `/__desktop`, which is the path under test.
- The provider-onboarding modal opens on any install with no credential and has
  no close control. It is settled by seeding the onboarding store's own
  persisted completion flag, the way a returning user would have it.
