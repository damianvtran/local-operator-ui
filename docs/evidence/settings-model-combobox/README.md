# Settings model combobox evidence

Before/after frames for the operator's report that the settings provider and
model fields should be searchable dropdowns sourced from the backend's own
login state, rather than two empty text boxes.

## What produced these frames

The `before/` and `after/` directories are the LIVE-APP pair described here. Every other
directory is the same surface as a STORYBOOK frame, swept across the twelve themes by
`scripts/capture-evidence.mjs` — separate pictures of the same states, taken over a stubbed
transport, and the two sets are not interchangeable evidence. The sibling set, one line each,
because this list is where a reader learns what a directory is evidence OF:

| Directory | The state it is a picture of |
| --- | --- |
| `chrome-less/` | The field with no label rendered, which is what the registry rows ask for |
| `labelled/` | The same field with its label, icon and help text |
| `no-matches/` | A query matching nothing: the list names the outcome and stays open |
| `open-filtered/` | A query that narrowed the list rather than closing it |
| `open-grouped/` | The list at rest, grouped, with the credential state on every row |
| `unknown-value/` | A stored value no listing contains, shown rather than blanked |
| `active-row/` | The active row's mark, with the typed text selected |
| `disabled/` | The field while the row cannot be edited |
| `loading/` | The in-flight catalogue: the list says it is asking |
| `scoped-notice/` | The model list stating the provider it is narrowed to |
| `unresolved-scope/` | That scope failing to resolve, so the list falls back to all models |

Two neighbours on the OTHER settings surface are worth naming here because they are easy to
mistake for this set: `../settings-backend/catalogue-partial/` (a listing that answered with
errors) and `../settings-backend/catalogue-in-flight/` (the same list before it answers).

**The real Electron app**, driven by this repository's own harness —
`scripts/renderer-driver.mjs`, whose contract is `docs/agent-driver.md` — with
the app built headless (`--window-mode=headless`, never shown, never focused)
and photographed with its own `webContents.capturePage()`.

Every frame comes from one of three runs, and each run is a single command:

```sh
# 1. The BASE tree's own build (origin/main), for the before frames.
git worktree add <dir> origin/main && cd <dir> && pnpm install --frozen-lockfile
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> pnpm build
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node <branch>/scripts/renderer-driver.mjs \
  --scene settings-fields --backend http://127.0.0.1:<port> \
  --seed-onboarding-complete --out before/ --clean

# 2. This branch, the same scene: the after half of the pair, same labels.
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene settings-fields --backend http://127.0.0.1:<port> \
  --seed-onboarding-complete --out after/ --clean

# 3. This branch, the feature scene: the popover states themselves.
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene settings-model --backend http://127.0.0.1:<port> \
  --seed-onboarding-complete --out after/ --clean
```

Run 1 uses **this branch's rig against the base tree's build**, which is the
point of `settings-fields`: it waits for a field in the row rather than for a
combobox, so it describes both trees and the two frames it writes carry the
same labels. A scene that asserted the control would refuse to photograph the
tree the change is measured against.

**These rows cannot be photographed without a backend**, and the frames here
were not. `--backend` points the app's transport at an isolated
`local-operator serve` started for the run on its own scratch port, with `HOME`,
`LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR` all scratch and every
inherited `CMUX_*`/`LOP_*` variable stripped. That isolation is the driver's own
and it prints it; the reason it is named here is that with no daemon the
settings section paints its offline surface, and that the daemon is never the
operator's.

`--seed-onboarding-complete` is passed because a scratch profile in front of a
fresh backend is a first-run user, whose six-step wizard is a modal over the
window (the first probe run of this set photographed exactly that).

Every frame is taken after the app held still for it: the harness captures
twice, 150 ms apart, and commits the second only if the two are byte-identical
and no transient toast is on the frame. Every assertion the scenes make — 35
checks in the feature scene, 13 in the pair scene — passed in the runs these
frames come from.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before/settings-hosting-rest.png](before/settings-hosting-rest.png) | `origin/main`'s build. "Default provider" and "Default model" are two BARE EMPTY INPUTS: no placeholder, no chevron, no list. Read from the page in that run: `{"value":"","placeholder":"","role":null}` for both rows. |
| [after/settings-hosting-rest.png](after/settings-hosting-rest.png) | The same two rows on this branch: `"Search providers"` and `"Search models"` placeholders, a trailing affordance on each, and `role="combobox"` on the input. |
| [before/settings-model-typed.png](before/settings-model-typed.png) | The model row holding a value no listing contains — the only form `origin/main` could render it in, which is free text typed into a plain box. |
| [after/settings-model-typed.png](after/settings-model-typed.png) | The same value in the same row, now in a field that can show you what else exists and clear what is there. |

The three popover states (open, filtered, no match) have **no before frame by
construction**: on `origin/main` there is no list to open, so a "before" for
them would be a second copy of `before/settings-hosting-rest.png`. That is
stated rather than papered over.

## The after frames, and what each one is for

| Frame | What it shows |
| --- | --- |
| [after/settings-hosting-open.png](after/settings-hosting-open.png) | The provider list open: the WHOLE login registry grouped usable-first — "Needs a running server" with LM Studio, Ollama, vLLM, llama.cpp and OpenAI-compatible, each sub-lined "No key needed", above the sign-in group. The operator's "tied to what providers are actually available and logged in" as a picture. |
| [after/settings-hosting-filtered.png](after/settings-hosting-filtered.png) | The same list under a query, narrowed by the filter rather than closed. |
| [after/settings-model-open.png](after/settings-model-open.png) | The model list open, scoped by the hosting row's own DRAFT: every row is `anthropic/…`, with `Anthropic (Claude Pro/Max), no credential` as each sub-line. The sub-line carries the REGISTRY's own name for the provider rather than a capitalised id, and the hosting row above it shows the same name while the value stored is the bare id — which is why the scoping can be to `anthropic/` at all. |
| [after/settings-model-no-match.png](after/settings-model-no-match.png) | Text that matches no row. The list says "Nothing matches that model" and stays open; this is the state that must not read as an error. |
| [after/settings-model-free-text.png](after/settings-model-free-text.png) | After Enter on that text: it is committed VERBATIM and the row goes dirty. Suggestions assist; they do not constrain. |
| [after/settings-model-unknown-value.png](after/settings-model-unknown-value.png) | Re-opened: the stored value no listing contains is listed under its own "Current value" heading, labelled "Custom model", with no sign-in state claimed for it — and the field itself shows the value rather than blanking. |

## The numbers behind the pictures

Read from the page in the same runs, not from the frames:

| | base (`origin/main`) | this branch |
| --- | --- | --- |
| `hosting` row, placeholder | `""` | `Search providers` |
| `model_name` row, placeholder | `""` | `Search models` |
| `hosting` row, input `role` | `null` | `combobox` |
| `model_name` row, input `role` | `null` | `combobox` |
| provider rows offered | n/a (no list) | 17, every provider the registry returns |
| model rows offered, `hosting: anthropic` | n/a | every row `anthropic/…`, plus the field's own value |
| deep link `?setting=hosting` | focuses the row's input, scrolls it into view | focuses the combobox's input, scrolls it into view (`{"focused":true,"onScreen":true}`) |

## What these frames do not prove

- The **focus ring**: a `headless` window is never shown and cannot be focused,
  so no frame in this set shows what the field's ring looks like while a user
  types. Nothing asserted here depends on it.
- Anything about the **packaged** app: this is a built checkout booted by its
  own Electron, not an installed and signed bundle.
- The **twelve-theme** sweep: these frames are the default palette only. The
  component's own states are swept across all twelve themes by
  `capture-evidence.mjs` (`settings-model-combobox--*`, `settings-backend--*`).
- The **General section's** pair of provider and model controls, which this
  change deliberately leaves alone, and onboarding, which it also leaves alone.
  Both still write the same two keys; that duplication is named as the
  follow-up in the pull request rather than fixed here.
