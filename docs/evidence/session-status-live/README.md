# Session status strip, in the live app

The Storybook frames under `docs/evidence/chat-session-status-strip/` cover the
states that are slow or impossible to reach live — a saturated window, an
unpriceable cost, a backend with no effort ladder. These four frames cover the
one thing a story cannot: that the strip reads a **real
`CanonicalFrontendState` off the real canonical stream**, in the real composer,
and that its chips open the **existing** pickers rather than new ones.

## What produced these frames

The app's own `src/renderer/index.html`, served by Vite with the repo's
renderer aliases, Tailwind pipeline and `desktopProxyPlugin`, talking to an
**isolated** Local Operator backend on its own port with its own config dir.
Driven over raw CDP the same way `scripts/capture-evidence.mjs` drives
Storybook: private headless Chrome, fresh user-data-dir, focus emulation on.

The session had a real model selected (`openrouter/openai/gpt-5`, 400k window,
a four-rung effort ladder) and **a real turn was sent with the page already
open**. That last part is not incidental. The accounting fields
(`context_tokens`, `cumulative_parent_cost`, `cost_knowledge`) never appear on
the cold `GET /v1/desktop/sessions/{id}` snapshot — they arrive only as
`frontend.update` changes on the live event stream, from an owner that is
actually running. A harness that merely opened a settled session photographed
the honest EMPTY strip, which is a real state but not the one under test.

| Frame | What it shows |
| --- | --- |
| [`composer/localOperatorDark.webp`](composer/localOperatorDark.webp) | All four readings in the real composer, above the real attach / working-directory / mic / send row |
| [`composer/localOperatorLight.webp`](composer/localOperatorLight.webp) | The same, in the light brand palette, where contrast defects hide |
| [`picker-model/localOperatorDark.webp`](picker-model/localOperatorDark.webp) | The model chip clicked: the existing `/model` picker, searchable over providers and models, keyboard-driven, current model ticked |
| [`picker-context/localOperatorDark.webp`](picker-context/localOperatorDark.webp) | The context wheel clicked: the existing `/context` breakdown |

The strip read, verbatim from the page, at capture time:

```
OpenAI: GPT-5 | auto | 3.4%/400k | ≥$0.028
```

`auto` because no effort level was set on that session and the model has a
ladder; `≥` because the owner reported `cost_knowledge: floor`.

## The two assertions these frames carry

**The chips reuse the slash-dispatch path.** The harness clicks the chip and
reads back the dialog the click produced — it does not merely screenshot and
hope. Both assertions are hard failures in the harness:

```
CLICK chip 0 opened: "Model  This session runs openrouter/openai/gpt-5. Choosing another applies to this session only unless you also set it as the default.  Also make it the default"
CLICK chip 2 opened: "Context  Estimated next request  Instructions ~4.6k  Tool inventory ~58  Tool schemas ~10.4k  Environment ~39  Skills / MCP / goal ~356  Messages ~2.8k  Total ~18.2k"
```

**The mirror agrees with the backend's own answer.** `picker-context` is the
owner's `/context` block beside the strip that was computed independently from
the raw fields, and they agree: the view reports `Window 400000` and
`Cost knowledge floor`, and the strip spells that same state `3.8%/400k` and
`≥$0.060` in the composer behind it.

## What these frames do not prove

- **Not the packaged Electron app.** The renderer runs in Chrome, so the
  preload bridge is stubbed and `window.api.desktop` is deliberately left
  undefined, which routes the desktop transport down its real `/__desktop` HTTP
  path. Electron IPC and the packaged build are not exercised here.
- **Two themes, not twelve.** The twelve-theme sweep belongs to the Storybook
  pipeline; the contrast contract covers the wheel's four rungs across all
  twelve palettes numerically (`scripts/contrast-contract.mjs`, `CONTROLS`).
- **One window state.** The live session was at 3-4% of a 400k window, so the
  warm and danger rungs are shown by the Storybook frames rather than here.

## Re-capturing

These cannot be re-derived by `pnpm capture-evidence`: the composer in a live
session is not a story. The harness that took them is
`out/evidence-harness/session-strip-live.mjs` (gitignored, since `out/` is a
build directory), and the procedure is the one in
`../sidebar-new-chat/README.md` with one addition — send a prompt while the
page is open, or the accounting fields never arrive. Start the backend with an
isolated `LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_HOME`, point
`LOCAL_OPERATOR_DESKTOP_BACKEND_URL` at it, and never at the operator's own.
