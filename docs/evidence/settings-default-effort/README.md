# Settings → Model settings → Default effort

Frames for the `feat/settings-default-effort` change: the new **Default effort**
row beside Hosting provider and Model, and the provider callout under them.

Every set is the **real Electron app** — this repository's built checkout, booted
by its own Electron in the documented `headless` window mode, never shown and
never focused — driven by `scripts/renderer-driver.mjs` (scene
`settings-default-effort`, added by this change) and photographed by the app
itself with `webContents.capturePage()`. Behind it is an **isolated
`local-operator serve`** (v0.73.13) this run owns, on its own scratch port, with
its own `HOME`, config root, log dir and bearer. The operator's daemon on 1111 is
never touched, and each run's own checks prove the app holds a connection to that
run's backend and none to the operator's.

## The sets

The callout's visibility is the provider census's answer, and the unset row's
description only exists while NOTHING is stored on a model the backend resolves a
level for. One backend cannot answer all of those, so there are four configs,
each recorded in both palettes branding asks for (light and dark):

| Directory | Backend config | Theme | Callout |
| --- | --- | --- | --- |
| `no-provider/` | `hosting: openai`, `model_name: gpt-6-astra`, no provider credential | `localOperatorDark` | VISIBLE |
| `no-provider-light/` | the same | `localOperatorLight` | VISIBLE |
| `provider-connected/` | the same, plus `OPENAI_API_KEY` in the daemon's environment | `localOperatorDark` | ABSENT |
| `provider-connected-light/` | the same | `localOperatorLight` | ABSENT |
| `seeded-model/` | `hosting: anthropic`, `model_name: claude-opus-5-5`, no credential (offline-resolvable) | `localOperatorDark` | n/a |
| `seeded-model-light/` | the same | `localOperatorLight` | n/a |
| `fresh-install/` | a fresh config root with NO hosting at all | `localOperatorDark` | VISIBLE |
| `fresh-install-light/` | the same | `localOperatorLight` | VISIBLE |

## The source the options come from

The composer's per-model effort availability is `reasoning_efforts` on the model
the backend resolves. A draft pane gets it from `POST /v1/desktop/sessions/preview`
(op `sessions.preview`) through `draftPreviewQuery`; Settings has no session, so
the row asks that same op with the selected hosting/model and
`reasoning_effort: null`, and reads `snapshot.effective_model` through the same
`bandReadings` / `effortLadder` / `effortLevel` helpers the composer's picker
uses. The model catalogue does not carry the field, so there is no second source
and none is derived here.

**The ladder is not the value space.** `model_effort` stores `""` plus the
daemon's `EFFORT_ORDER`; a model's ladder may also carry a sentinel — Radient's
ladder is `auto/low/medium/high`, and `auto` there is the registry's LABEL for
`""`, not a value the validator accepts. The row therefore offers only rungs that
appear in the settings row's own `choices[].value`, and its clamp writes only a
value from that set (or `""`). The OpenAI halves cannot exercise that rule — no
OpenAI ladder carries a sentinel — so it is pinned by
`scripts/default-effort-options.test.mjs` over a Radient-shaped ladder, and each
run additionally asserts that every offered rung IS a storable value read from
`GET /v1/settings`.

**One measured fact worth recording for a future reader.** The preview's
`effective_model.reasoning_effort` is not simply "null when the request sent
null": when the machine configures `model_effort`, the preview reports the
backend's own clamp of that configured level into the selected model's ladder.
Measured on this rig: with `model_effort = "max"` stored, a preview for `o3`
(ladder `low/medium/high`) answered `reasoning_effort: "high"`. That is exactly
the value the row's clamp writes, and it is why the model-switch assertion below
can compare the stored value against a backend-computed one rather than a local
guess. It is also why the stored value is part of the preview's cache KEY: the
answer is a function of the selection AND of `model_effort`, so a write that
changes the stored value must change the key or the row would read an answer
computed for the previous value. The `clamped` frame and the clear-then-reopen
step are the visible and asserted halves of that.

## The run, exactly

```sh
# 0. the app, built once against the port every run below uses. The OAuth values
#    are inert: replace-backend-config refuses to compile without them and no
#    run signs in.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 1. One run of the scene. Every invocation gets its OWN scratch root, because
#    the scene drives the daemon: it switches Model to `o3` and leaves
#    `model_effort` at `high`, so a reused root would change what the next run
#    starts from. The daemon is reaped by exact pid.
run_set() {
  local label=$1 hosting=$2 model=$3 credential=$4 mode=$5 theme=$6 callout=$7 out=$8
  local rig token daemon status
  rig=$(mktemp -d /tmp/lop-default-effort-XXXXXX)
  mkdir -p "$rig/home" "$rig/config" "$rig/logs"
  openssl rand -hex 32 >"$rig/token.hex"
  token=$(cat "$rig/token.hex")

  local hosting_args=()
  if [ "$hosting" != "-" ]; then
    printf 'values:\n  hosting: %s\n  model_name: %s\n' "$hosting" "$model" \
      >"$rig/config/config.yml"
    hosting_args=(--hosting "$hosting" --model "$model")
  fi
  local credential_env=()
  if [ "$credential" != "-" ]; then
    credential_env=(OPENAI_API_KEY="$credential")
  fi

  env -u XPC_FLAGS HOME="$rig/home" \
    LOCAL_OPERATOR_CONFIG_DIR="$rig/config" \
    LOCAL_OPERATOR_LOG_DIR="$rig/logs" \
    LOCAL_OPERATOR_DESKTOP_TOKEN="$token" \
    "${credential_env[@]}" \
    local-operator serve --host 127.0.0.1 --port 8080 "${hosting_args[@]}" \
    >"$rig/logs/serve.out" 2>&1 &
  daemon=$!

  for _ in $(seq 1 200); do
    curl -sf -H "authorization: Bearer $token" \
      http://127.0.0.1:8080/v1/config >/dev/null && break
    sleep 0.1
  done

  LOCAL_OPERATOR_DESKTOP_TOKEN="$token" \
    node scripts/renderer-driver.mjs --scene settings-default-effort \
      --backend http://127.0.0.1:8080 \
      --backend-records "$rig/config/run/serve" \
      --seed-onboarding-complete \
      --callout-expect "$callout" \
      --effort-mode "$mode" \
      --theme "$theme" \
      --out "$out" --clean
  status=$?

  kill "$daemon" 2>/dev/null
  wait "$daemon" 2>/dev/null
  echo "RUN $label finished status=$status"
  return $status
}

# 2. The two callout halves, in both palettes.
run_set no-provider-dark openai gpt-6-astra - full localOperatorDark present \
  docs/evidence/settings-default-effort/no-provider
run_set no-provider-light openai gpt-6-astra - full localOperatorLight present \
  docs/evidence/settings-default-effort/no-provider-light
run_set provider-connected-dark openai gpt-6-astra rig-key full localOperatorDark absent \
  docs/evidence/settings-default-effort/provider-connected
run_set provider-connected-light openai gpt-6-astra rig-key full localOperatorLight absent \
  docs/evidence/settings-default-effort/provider-connected-light

# 3. The unset row's description, which needs a model the backend resolves a
#    level for while NOTHING is stored. `claude-opus-5-5` seeds `medium` and is
#    offline-resolvable, so no credential is involved.
run_set seeded-dark anthropic claude-opus-5-5 - seeded localOperatorDark present \
  docs/evidence/settings-default-effort/seeded-model
run_set seeded-light anthropic claude-opus-5-5 - seeded localOperatorLight present \
  docs/evidence/settings-default-effort/seeded-model-light

# 4. The fresh-install composition: a config root with no hosting at all, so
#    Hosting provider and Model are empty and the effort row has no model to
#    describe.
run_set no-model-dark - - - no-model localOperatorDark present \
  docs/evidence/settings-default-effort/fresh-install
run_set no-model-light - - - no-model localOperatorLight present \
  docs/evidence/settings-default-effort/fresh-install-light
```

Each run printed `ALL CHECKS PASSED`. The logs carry 64 PASS lines for a
callout-present full run, 51 for the callout-absent half, 23 for a seeded run and
20 for a fresh-install run — harness checks and scene checks together. Every run's
harness half proves it booted the BUILT app headless, against this run's daemon and
none on 1111, and that no process from it outlived its boot.

## What each frame shows

`no-provider/` and `no-provider-light/` — the callout is VISIBLE (no provider has
a credential); eight frames each:

| Frame | State |
| --- | --- |
| `settings-default-effort-rest.png` | Model settings settled: Hosting provider `OpenAI`, Model `GPT-6 Astra`, Default effort reading **Model default**, the row's helper, and the callout below. |
| `settings-default-effort-open.png` | The list OPEN: `Model default`, `Low`, `Medium`, `High`, `xHigh`, `Max` — the daemon's ladder for `gpt-6-astra`, read back from `/v1/desktop/sessions/preview` in the same run and compared row for row. The unset row carries NO description here: the daemon resolves no level for this model with nothing stored. |
| `settings-default-effort-saved.png` | After picking the top rung: the row reads **Max**, and `GET /v1/settings` holds `model_effort: "max"`. |
| `settings-default-effort-clamped.png` | After switching Model to `o3`: the row reads **High** and the row's helper carries the announcement **“Max is not available on OpenAI o3. Using High.”** — the level the backend itself resolves for `o3` with `max` stored. Taken before the list is reopened so the sentence is not covered by the popover. |
| `settings-default-effort-model-switched.png` | The reopened list on `o3`'s ladder (`Model default`, `Low`, `Medium`, `High`), read from the daemon in the same run. `GET /v1/settings` holds `model_effort: "high"`. |
| `settings-default-effort-callout.png` | The callout with the inline **Providers** link, list closed. |
| `settings-default-effort-providers-jump.png` | After pressing **Providers**: the Model providers section, measured at 80px below the scroll container's top (the page's own `HEADER_ROOM`), the rail's current row on Model providers, scroll position moved from the top. The Keyboard shortcuts row visible above the heading is the section immediately above, seen through that 80px of header room. |
| `settings-default-effort-providers-jump-keyboard.png` | The SAME landing reached without a pointer: REAL Tab from the Default effort row to the **Providers** link (no click), Enter activating it. The section is focusable only as a programmatic `tabIndex={-1}` rest-stop, so it lands with NO ring (measured as `:focus-visible` plus the computed `outline-style: none`), and the next Tab puts the caret in the providers search field. Pixels are identical to the pointer frame by construction: the landing is one state, reached two ways. |

`provider-connected/` and `provider-connected-light/` — the callout is ABSENT (the
census reports a credential for `openai`). Same steps, six frames each: the same
`rest`, `open`, `saved`, `clamped` and `model-switched` states, and
`settings-default-effort-callout-absent.png` where System prompt follows the
Default effort row directly.

`seeded-model/` and `seeded-model-light/` — two frames each, on
`anthropic/claude-opus-5-5`, which reports `medium` with nothing stored:

| Frame | State |
| --- | --- |
| `settings-default-effort-rest.png` | The row at rest reading **Model default**, nothing stored. |
| `settings-default-effort-open.png` | The list OPEN with **“Runs at Medium for this model.”** under Model default — the description the unset row exists for, naming the level the backend resolves rather than a level the user chose. |

`fresh-install/` and `fresh-install-light/` — one frame each, against a config
root with no hosting: Hosting provider and Model both empty, the disabled Default
effort row showing its placeholder with the helper **“Select a model to choose its
effort levels.”**, and the provider callout VISIBLE.

## What the run asserts, not just photographs

Every claim below is a reading taken in the same run, printed in its log:

- the row is present and ENABLED on the configured model, reading `Model default`
  while `model_effort` is unset;
- the open list's rows are `Model default` plus exactly the daemon's ladder
  rungs that `GET /v1/settings` says `model_effort` can store, in the backend's
  order — the guard against offering a sentinel such as `auto`;
- the unset option's description names the daemon's own resolved level when it
  has one, and is ABSENT when it reports none;
- a pick is written to the settings registry, read back through `GET /v1/settings`;
- clearing the row writes `""`, and the reopened unset row's description is
  re-derived for the cleared value — the stale-answer assertion: with `max`
  stored the old answer would still print “Runs at Max for this model.”;
- after a model switch the rendered options are the NEW model's storable ladder,
  and the stored `model_effort` equals the level the backend itself resolves for
  that model — both read from the isolated daemon, neither hard-coded;
- the clamp is ANNOUNCED at the row, naming the unavailable level and the one in
  force;
- the callout is present iff the provider census says no provider is connected
  (the two halves are that iff), and its "Providers" affordance is a `<button>`,
  not an anchor;
- pressing it moves whichever element scrolls, lands the section at the page's
  80px header room, and updates the rail — measured as numbers — and ONE Tab
  after the press keeps focus inside the Model providers section with the
  landing unmoved (the skip-link behaviour);
- the SAME jump walked by keyboard: a real Tab from the effort row reaches the
  link, Enter lands focus INSIDE the section at the same header room, the
  landing target reports `:focus-visible` with a computed outline style of
  `none` (the ring is withheld from a non-interactive rest-stop), and the next
  Tab lands on the providers search field;
- with no hosting at all, Hosting provider and Model are both empty, the effort
  row is disabled with its "Select a model" helper and shows no chosen row, and
  the callout is visible.

## What these frames do not prove

- The **focus ring's pixels**: a headless window is never shown and cannot be
  focused, so no frame photographs a ring while typing. The jump's focus MOVE is
  measured as `document.activeElement`, and its ring SUPPRESSION is measured as
  the landing target's own `:focus-visible` state plus its computed
  `outline-style` — property readings, not a looked-at ring.
- A **stored level during the preview load** as a picture: the row's loading
  states are transient and were never framed at any head; their corrected
  selection (unset row only when nothing is stored, placeholder otherwise) is
  pinned by `scripts/default-effort-options.test.mjs`, and the settled frames
  are the same in both readings.
- Anything about a **packaged** build, an **installed provider**, or a live
  **model call**: every option list and level here is the offline resolution of a
  shipped registry, and `sessions.preview` does not call a provider.
- The **full-theme sweep**: these sets are `localOperatorDark` and
  `localOperatorLight`, the pair branding asks for a new control. The broader
  palette question is carried by the sweep's own frames.
- The **single-rung state** of the row. No shipped model exposes a one-rung
  ladder (UX measured 90 of 135 catalogue models, and the backend's per-model
  table defines none), so no run fabricates a model to photograph a state the
  daemon cannot answer. Its logic is pinned by
  `scripts/default-effort-options.test.mjs` (`one-level`) and its disabled render
  mechanics by the same disabled-control walk the fresh-install state shows.
- The **Radient `auto` ladder** as a picture: these OpenRouter/OpenAI daemons ship
  no Radient sentinel, so the rule is pinned by the pure tests over a
  Radient-shaped ladder and by the per-run assertion that every offered rung is
  storable.
