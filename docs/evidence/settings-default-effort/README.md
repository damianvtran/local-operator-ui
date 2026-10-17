# Settings → Model settings → Default effort

Frames for the `feat/settings-default-effort` change: the new **Default effort**
row beside Hosting provider and Model, and the provider callout under them.

Both sets are the **real Electron app** — this repository's built checkout, booted
by its own Electron in the documented `headless` window mode, never shown and
never focused — driven by `scripts/renderer-driver.mjs` (scene
`settings-default-effort`, added by this change) and photographed by the app
itself with `webContents.capturePage()`. Behind it is an **isolated
`local-operator serve`** (v0.73.12) this run owns, on its own scratch port, with
its own `HOME`, config root, log dir and bearer. The operator's daemon on 1111 is
never touched, and the driver's own checks prove the app holds a connection to
this run's backend and none to the operator's.

Two runs, because the callout's visibility is the provider census's answer and
one backend cannot answer both ways:

| Directory | Backend config | Callout |
| --- | --- | --- |
| `no-provider/` | `hosting: openai`, `model_name: gpt-6-astra`, no provider credential | VISIBLE |
| `provider-connected/` | the same, plus `OPENAI_API_KEY` in the daemon's environment | ABSENT |

## The source the options come from

The composer's per-model effort availability is `reasoning_efforts` on the model
the backend resolves. A draft pane gets it from `POST /v1/desktop/sessions/preview`
(op `sessions.preview`) through `draftPreviewQuery`; Settings has no session, so
the row asks that same op with the selected hosting/model and
`reasoning_effort: null`, and reads `snapshot.effective_model` through the same
`bandReadings` / `effortLadder` / `effortLevel` helpers the composer's picker
uses. The model catalogue does not carry the field, so there is no second source
and none is derived here.

**One measured fact worth recording for a future reader.** The preview's
`effective_model.reasoning_effort` is not simply "null when the request sent
null": when the machine configures `model_effort`, the preview reports the
backend's own clamp of that configured level into the selected model's ladder.
Measured on this rig: with `model_effort = "max"` stored, a preview for `o3`
(ladder `low/medium/high`) answered `reasoning_effort: "high"`. That is exactly
the value the row's clamp writes, and it is why the model-switch assertion below
can compare the stored value against a backend-computed one rather than a local
guess.

## The run, exactly

```sh
# 0. a scratch root this run owns; nothing below reads or writes the operator's
RIG=$(mktemp -d /tmp/lop-default-effort-XXXXXX)
mkdir -p "$RIG/home" "$RIG/config" "$RIG/logs"
openssl rand -hex 32 >"$RIG/token.hex"

# 1. the backend's own hosting, written BEFORE the daemon starts. A fresh config
#    root holds none, and every session dies in HostingNotConfiguredError
#    without it (docs/agent-driver.md, "the daemon must be told its hosting").
cat >"$RIG/config/config.yml" <<'YAML'
values:
  hosting: openai
  model_name: gpt-6-astra
YAML

# 2. the isolated daemon, port 8080 (one index.html's connect-src allows)
env -u XPC_FLAGS \
  HOME="$RIG/home" \
  LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
  LOCAL_OPERATOR_LOG_DIR="$RIG/logs" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token.hex")" \
  local-operator serve --host 127.0.0.1 --port 8080 \
    --hosting openai --model gpt-6-astra &

# 3. the app, built against that backend's URL and with inert OAuth values
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 4a. the callout-VISIBLE half (the frames in no-provider/)
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token.hex")" \
  node scripts/renderer-driver.mjs --scene settings-default-effort \
    --backend http://127.0.0.1:8080 \
    --backend-records "$RIG/config/run/serve" \
    --seed-onboarding-complete --callout-expect present \
    --out docs/evidence/settings-default-effort/no-provider --clean

# 4b. the callout-ABSENT half. Restart the daemon with a provider credential in
#     ITS environment (the census reads `OPENAI_API_KEY`; `has_credential` needs
#     nothing more, and sessions.preview never validates the key), on a FRESH
#     config root so the stored model_effort the scene starts from is empty.
env -u XPC_FLAGS HOME="$RIG/home" LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
  LOCAL_OPERATOR_LOG_DIR="$RIG/logs" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token.hex")" \
  OPENAI_API_KEY=rig-evidence-not-a-credential \
  local-operator serve --host 127.0.0.1 --port 8080 \
    --hosting openai --model gpt-6-astra &
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token.hex")" \
  node scripts/renderer-driver.mjs --scene settings-default-effort \
    --backend http://127.0.0.1:8080 \
    --backend-records "$RIG/config/run/serve" \
    --seed-onboarding-complete --callout-expect absent \
    --out docs/evidence/settings-default-effort/provider-connected --clean
```

Recreate the config root (and stop the previous daemon by exact pid) before
starting the 4b daemon: the scene asserts its walk starts from `model_effort`
unset, and it ends both halves with the daemon configured on `o3` and the effort
stored as `high`, because that is what the scene drives.

## What each frame shows

`no-provider/` — the callout is VISIBLE (no provider has a credential):

| Frame | State |
| --- | --- |
| `settings-default-effort-rest.png` | Model settings settled: Hosting provider `OpenAI`, Model `GPT-6 Astra`, Default effort reading **Model default**, the row's helper, and the callout below. |
| `settings-default-effort-open.png` | The list OPEN: `Model default`, `Low`, `Medium`, `High`, `xHigh`, `Max` — the daemon's ladder for `gpt-6-astra`, read back from `/v1/desktop/sessions/preview` in the same run and compared row for row. |
| `settings-default-effort-saved.png` | After picking the top rung: the row reads **Max**, and `GET /v1/settings` holds `model_effort: "max"`. |
| `settings-default-effort-model-switched.png` | Model switched to `o3` (ladder `low/medium/high`, read from the daemon): the row reads **High** and the open list carries `Model default` plus the three new rungs. `GET /v1/settings` holds `model_effort: "high"` — the level the backend resolves for `o3` with `max` stored, i.e. its own clamp. The unset row carries NO description here on purpose: with a level stored the preview reports that level's clamp, which is a fact about the selected row, not about what `""` would run. |
| `settings-default-effort-callout.png` | The callout with the inline **Providers** link, list closed, after the switch. |
| `settings-default-effort-providers-jump.png` | After pressing **Providers**: the Model providers section, measured at 80px below the scroll container's top (the page's own `HEADER_ROOM`), the rail's current row on Model providers, and the scroll position moved from the top. The Keyboard shortcuts row visible above the heading is the section immediately above, seen through that 80px of header room. |

`provider-connected/` — the callout is ABSENT (the census reports a credential
for `openai`). Same steps and the same five states; the set exists to show the
one difference:

| Frame | State |
| --- | --- |
| `settings-default-effort-rest.png` | Model settings at rest; no callout between the row's helper and System prompt. |
| `settings-default-effort-open.png` | The list open on `gpt-6-astra`'s ladder. |
| `settings-default-effort-saved.png` | The top rung saved (`model_effort: "max"`). |
| `settings-default-effort-model-switched.png` | Switched to `o3`; the row shows the clamped `High` and the new ladder. |
| `settings-default-effort-callout-absent.png` | The state the absent half exists for: System prompt follows the Default effort row directly. |

## What the run asserts, not just photographs

Every claim below is a reading taken in the same run, printed in its log
(`ALL CHECKS PASSED` on both halves):

- the row is present and ENABLED on the configured model, reading `Model default`
  while `model_effort` is unset;
- the open list's rows are `Model default` plus exactly the daemon's
  `reasoning_efforts` for that model, in the backend's order;
- a pick is written to the settings registry, read back through `GET /v1/settings`;
- after a model switch the rendered options are the NEW model's ladder, and the
  stored `model_effort` equals the level the backend itself resolves for that
  model — both read from the isolated daemon, neither hard-coded;
- the callout is present iff the provider census says no provider is connected
  (the two halves are that iff), and its "Providers" affordance is a `<button>`,
  not an anchor;
- pressing it moves whichever element scrolls, lands the section at the page's
  80px header room, and updates the rail — measured as numbers.

## What these frames do not prove

- The **focus ring**: a headless window is never shown and cannot be focused, so
  the ring while typing is not in any frame. Nothing asserted here depends on it.
- Anything about a **packaged** build, an **installed provider**, or a live
  **model call**: every option list and level here is the offline resolution of a
  shipped registry, and `sessions.preview` does not call a provider.
- The **fifty-nine-theme sweep**: these are `localOperatorDark` only.
- The **single-rung, empty-ladder, loading, error and unsupported-gate states** of
  the row. They are asserted in `scripts/default-effort-options.test.mjs` over
  hand-built ladders rather than photographed, because the shipped registry's
  openai models all offer more than one rung and no frame here fabricates a
  model to get a state the daemon cannot answer.
