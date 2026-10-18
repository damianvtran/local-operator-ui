# Model select — canonical provider IDs, before/after frames

Before/after frames for the operator's report that the Settings "Model
settings" row, with the provider-qualified value he actually had
(`hosting: openai`, `model_name: openai/gpt-6.1-sol`), rendered that value raw
and could not find its own catalogue row by its raw canonical ID. The fix under
evidence is `fix/openai-sol-settings` "recognize and search canonical provider
model IDs" — the shared `ModelSelect`
(`src/renderer/src/shared/components/hosting/model-select.tsx`, used by
Settings and by the agent forms).

## What produced these frames

**The real built Electron app**, booted by this repository's own window-mode
harness (`docs/evidence/window-mode/harness/run.sh`, mode `headless`, never
shown, never focused, 1380x900 closed at 2760x1800 on this 2x display), each
run against an isolated `local-operator serve` on ports the run owns and an
isolated `HOME`/config scratch: nothing the operator's own store holds was read
or written.

BOTH TREES RAN THE **IDENTICAL seed and driver scripts**, committed with this
set — `docs/evidence/window-mode/harness/seed-model-select.mjs` and
`drive-model-select.mjs`; the app build is the only thing that differs between
the halves. The driver ignores `run.sh`'s default route and navigates to
`#/settings` itself; every driven interaction is a real CDP input event
(`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText`),
and every wait is a bounded predicate poll over the DOM, never a fixed sleep
that could photograph a state that has not arrived.

```sh
# The seed, before either run (into the run's own scratch, by run.sh via EXTRA_SEED):
#   one synthetic openai OAuth credential through the backend's own AuthStore,
#   plus the native-shaped openai listing document through the catalogue's own
#   writer (row gpt-6.1-sol / "GPT 6.1 Sol" - the pair the change's own
#   regression test pins; no live provider contacted, and the synthetic token
#   is never sent because the seeded document is fresh).

# BASE run: a detached worktree at origin/main, its own build, THIS branch's rig.
git worktree add --detach ~/local-operator-ui/.worktrees/sol-base origin/main
cd ~/local-operator-ui/.worktrees/sol-base
NODE_PATH="$PWD/node_modules/.pnpm/node_modules" pnpm build

cd ~/local-operator-ui/.worktrees/sol-catalogue
ELECTRON_BIN=$PWD/node_modules/.bin/electron \
EXTRA_SEED=$PWD/docs/evidence/window-mode/harness/seed-model-select.mjs \
DRIVE_SCRIPT=$PWD/docs/evidence/window-mode/harness/drive-model-select.mjs \
SCRATCH=/tmp/model-select-evidence/base CDP_PORT=9531 BACKEND_PORT=14431 \
  bash docs/evidence/window-mode/harness/run.sh \
    ~/local-operator-ui/.worktrees/sol-base base headless 1380x900

# AFTER run: this branch's own build, the same scripts, same labels.
NODE_PATH="$PWD/node_modules/.pnpm/node_modules" pnpm build   # in the branch tree
ELECTRON_BIN=$PWD/node_modules/.bin/electron \
EXTRA_SEED=$PWD/docs/evidence/window-mode/harness/seed-model-select.mjs \
DRIVE_SCRIPT=$PWD/docs/evidence/window-mode/harness/drive-model-select.mjs \
SCRATCH=/tmp/model-select-evidence/after CDP_PORT=9532 BACKEND_PORT=14432 \
  bash docs/evidence/window-mode/harness/run.sh "$PWD" after headless 1380x900
```

The trees as captured: **before** = `origin/main` at
`3c484790b19f379e0bb94dd0ae2bf7a81c227c3f` (detached, `.worktrees/sol-base`),
**after** = this branch at `cd3f42ebddf3dfcaae618f3da3f517042df86e6a`. The two
builds ran serially, one at a time. Both ran with `NODE_PATH` pointed at the
shared store's hoisted bucket (`node_modules/.pnpm/node_modules`) — a
build-environment bridge for this pnpm worktree's shared `node_modules`
symlink, which defeats the bytecode step's Babel plugin lookup; `pnpm build` is
otherwise unchanged on both trees. Both trees carry their own `.env` with the
four client-id variables `replaceBackendConfigPlugin` requires, as synthetic
fixtures.

**Causal comparability, checked rather than assumed:** nothing under
`src/renderer/src` moved between this branch's merge-base
(`8b0a826b53b7ff0468076c12e091719373788c79`) and the captured `origin/main`
tip — the drift between them is additive es/ru locales, generated `keys.gen.ts`
imports, i18n receipts and test lists, none of which renders on this surface.
The two halves therefore differ, on the photographed surface, by this change
and nothing else.

`run.sh` reports both runs cleanly isolated: the app was frontmost in **0 of
30** samples (base) and **0 of 34** (after), the mode/size it reported is the
one asked for, **0 renderer errors** in either run, and neither run left an
app or `serve` process behind. Measurements are committed beside the frames
(`before/metrics.json`, `after/metrics.json`), so the numbers below are
re-derivable from the tree.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before/01-stored-value.png](before/01-stored-value.png) | The row at rest on `origin/main`: the field holds the stored value **raw** — `openai/gpt-6.1-sol` (read from the page: `inputValue: "openai/gpt-6.1-sol"`). |
| [after/01-stored-value.png](after/01-stored-value.png) | The same row, same stored config value, on this branch: the field displays the catalogue row's own label — `GPT 6.1 Sol` (`inputValue: "GPT 6.1 Sol"`). |
| [before/02-select-open-populated.png](before/02-select-open-populated.png) | The list open at rest (the whole catalogue, one row, plus the field's own value): TWO rows — the catalogue's `GPT 6.1 Sol` (unselected) and a **Custom row** `openai/gpt-6.1-sol` / "Custom model", which is the row **marked selected**. The stored value has no catalogue identity on this tree. |
| [after/02-select-open-populated.png](after/02-select-open-populated.png) | The same open list on this branch: **one** row, `GPT 6.1 Sol` / "Model listed by OpenAI", **marked selected** — the stored value resolves to the catalogue row and no Custom row exists for it. |
| [before/03-search-canonical-id.png](before/03-search-canonical-id.png) | The raw canonical ID `gpt-6.1-sol` typed: the list admits the Custom value row plus `Use "gpt-6.1-sol"` ("Not in any listing; saved as typed.") — read from the page: `known: false, typed: true`. **The catalogue row is not in the list.** |
| [after/03-search-canonical-id.png](after/03-search-canonical-id.png) | The same query on this branch: the list admits **the catalogue row alone** — `GPT 6.1 Sol` / "Model listed by OpenAI" — and no typed fallback (`known: true, typed: false`): the raw ID is a known model, not just text that could be committed. |
| [before/04-search-no-match.png](before/04-search-no-match.png) | A query matching nothing (`zzz-unlisted-query`): the list says **"No matches"** and **stays open** (`noMatches: true`, `expanded: "true"`), offering the typed row. |
| [after/04-search-no-match.png](after/04-search-no-match.png) | The same query, same reading — unchanged by the fix. |
| [before/05-custom-typed-row.png](before/05-custom-typed-row.png) | A genuinely unknown value typed (`openai/synthetic-not-listed`): the typed row is offered — `Use "openai/synthetic-not-listed"` / "Not in any listing; saved as typed." |
| [after/05-custom-typed-row.png](after/05-custom-typed-row.png) | Unchanged by the fix: the custom path survives (`allowCustom` is preserved), with no catalogue row shadowing the unknown value. |
| [before/06-custom-committed.png](before/06-custom-committed.png) | After the deliberate click on that typed row: the field holds the value it was given, and the run's scratch config shows the write — `model_name: openai/synthetic-not-listed`. |
| [after/06-custom-committed.png](after/06-custom-committed.png) | The same commit on this branch, same result (a "Configuration updated" toast accompanies it in `07`). |
| [before/07-custom-selected-row.png](before/07-custom-selected-row.png) | Re-opened: the committed value renders under its own **Custom** row (`Custom model`), marked selected, beside the catalogue row. |
| [after/07-custom-selected-row.png](after/07-custom-selected-row.png) | Same shape on this branch: a genuinely unknown value still renders as Custom — the immovable control. |

The catalogue-in-flight state the gate names (loading) has **no frame here**,
and that is stated rather than papered over — see "What these frames do not
prove" below for the two attempts per tree and the driver's refusal to ship a
frame the app does not corroborate.

## The numbers behind the pictures

Read from the page and from the run's scratch config in the same runs
(`before/metrics.json`, `after/metrics.json`), not from the frames:

| Reading | base (`origin/main`) | this branch |
| --- | --- | --- |
| stored value, closed field | `openai/gpt-6.1-sol` | `GPT 6.1 Sol` |
| open-list rows at rest | 2 (catalogue + the value's Custom row) | 1 (the catalogue row) |
| selected row at rest | the Custom value row | the catalogue row |
| raw-ID query `gpt-6.1-sol`: catalogue row visible | **no** (`known: false`) | **yes** (`known: true`) |
| raw-ID query: typed fallback offered | yes (`typed: true`) | **no** (`typed: false`) |
| no-match query: list text | `No matches` + typed row, stays open | same |
| unknown value typed: typed row | `Use "openai/synthetic-not-listed"` / "Not in any listing; saved as typed." | same |
| commit of the unknown value | writes `openai/synthetic-not-listed` | same (via a real click; `07` also shows the product's own "Configuration updated" toast) |

## The no-save control

The store of record is the scratch `config/config.yml` the settings page
writes through, read three times per run:

| When | base | this branch |
| --- | --- | --- |
| at rest, before any interaction | `openai/gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| after the display and search states (01–05) | `openai/gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| after the deliberate commit (click on the typed row) | `openai/synthetic-not-listed` | `openai/synthetic-not-listed` |

So resolving the displayed label and filtering the list never save on either
tree, and the one write in the run is the deliberate selection — the behaviour
the change's own component test pins, re-read here from the file rather than
from the component.

## What these frames do not prove

- **The catalogue-in-flight state is not shipped.** Nothing here claims it. The
  driver photographed only when the app reported the fetch in flight on both
  sides of the shutter; attempted twice per tree (the fast first attempt plus
  the driver's own ordered retry), the in-flight window ended inside the
  shutter's own latency on every attempt in these loaded-host runs, and each
  uncorroborated capture was deleted rather than shipped
  (`00-loading-catalogue: in-flight window ended before the shutter; not
  shipped` — the run's own driver output says so twice per tree). What a
  reader should take from that is the stated limit, not a picture: on this
  machine the local catalogue fetch answers within roughly a second, and CDP
  screenshots at this window size were slower than its tail.
- **The catalogue is one synthetic row** — `gpt-6.1-sol` / `GPT 6.1 Sol`, the
  pair this change's regression test pins — seeded through the product's own
  credential store and catalogue writer, not a live fetch. Matches and misses
  against a longer catalogue are not pictured.
- **One theme.** The harness boots the app's own default (`localOperatorDark`).
  No other palette is photographed here, and `.png` frames are not swept by
  `scripts/capture-evidence.mjs` — the set is declared `supplementary` with
  `frames: 0` by that walker's `.webp` rule, the same mismatch the
  `model-picker-human-name-search` set records for the same reason.
- **The focus ring and any focus-dependent state**: a `headless` window is
  never shown and cannot be focused; no frame shows what the field looks like
  while focused by a person.
- **The packaged app**: this is a built checkout booted by its own Electron,
  not an installed and signed bundle.
- **Other surfaces using the same component** (agent forms, onboarding) are
  not photographed; the fix is shared, but this set's claim is the Settings
  row, where the operator's report lives.
