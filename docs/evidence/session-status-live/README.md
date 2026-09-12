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

---

## Round 2: the real Electron app

`reload/` and `backend-down/` were taken in the **packaged Electron binary**,
not the renderer-in-Chrome surface the frames above used. That closes the first
limitation this README declares: `window.api.desktop` is the real preload
bridge (asserted as `"object"` before anything else runs), so every desktop call
in these two frames crossed real IPC rather than the `/__desktop` HTTP path.

The harness is `out/evidence-harness/r2-live.mjs` (gitignored with the rest of
`out/`). It drives `out/main/index.js` under
`node_modules/electron/dist/.../Electron` over CDP on a port it owns, against an
isolated backend on its own config dir and home. Three things it must get right,
each learned by getting it wrong first:

1. **Run Electron from a cwd with no `.env`.** `src/main/backend/config.ts`
   loads `join(process.cwd(), ".env")` with `override: true`, so the repo's own
   `.env` beats the environment and silently pointed main at port 1111 — the
   OPERATOR's live backend. The harness sets `cwd` to its throwaway
   user-data-dir.
2. **Put the isolated backend on 8080.** `src/renderer/index.html`'s CSP pins
   `connect-src` to 1111 and 8080, so a backend anywhere else is unreachable by
   the renderer's own health probe (the same CSP note QA filed as Q3).
   `VITE_DISABLE_BACKEND_MANAGER=true` stops main starting a second one.
3. **Seed `isTourComplete` as well as `isModalComplete`.** They are separate
   flags and the tour alone covers the composer.

### What these two frames prove

| Frame | Finding | Before (round 1) | After |
| --- | --- | --- | --- |
| `reload/` | U1 | `openai/gpt-5-mini`, effort chip GONE, 3 chips | `OpenAI: GPT-5 Mini \| auto \| 3.3%/400k \| >=$0.0040`, 4 chips |
| `backend-down/` | U2 | 16 s of nothing | `/model could not run: The backend could not complete this request. Check its connection and try again.` |

Read out of the live DOM in the same run, not from the pixels:

```
PRELOAD window.api.desktop: object
WARM   strip: OpenAI: GPT-5 Mini | auto | 3.3%/400k | >=$0.0040   (4 chips)
RELOAD strip: OpenAI: GPT-5 Mini | auto | 3.3%/400k | >=$0.0040   (4 chips)
RELOAD +20s : OpenAI: GPT-5 Mini | auto | 3.3%/400k | >=$0.0040
U4 model : opened "Model | This session runs openrouter/openai/gpt-5-mini..." -> Escape -> BUTTON / IN-STRIP / "OpenAI: GPT-5 Mini"
U4 effort: opened "Reasoning effort | Effort levels openrouter/openai/gpt-5-mini" -> Escape -> BUTTON / IN-STRIP / "auto"
U2 click with backend down: "The backend could not complete this request. Check its connection and try again."
```

U4 is the assertion that cannot be photographed: round 1 left focus on `BODY`
after Escape and 25 Tabs did not reach the chip again. `IN-STRIP` is the
`document.activeElement` being the invoking chip itself.

### Still not proven here

- **Twelve themes.** These two are `localOperatorDark` only; the Storybook
  sweep owns the rest.
- **The warm and danger rungs live.** The session sat at 3.3% of a 400k window,
  so the coloured rungs remain Storybook frames plus the contrast contract's
  new arc-vs-track assertions.
