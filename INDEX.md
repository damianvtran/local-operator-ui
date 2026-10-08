# Lane D evidence — first-run onboarding (desktop)

Frames are rendered from the real components: `before` is the base worktree at
`15a7a4ed522` (origin/main), `after` is head `3aa857e`. Storybook 8 driven by one
headless Chrome (mock keychain, scratch profile, reused across every frame), one
screenshot per story at 2x. Each frame is paired with a JSON of the geometry read
out of the same render (`before/<name>.json`, `after/<name>.json`), visible
elements only; see `README.md` for the layout and the stand-ins. These files are
NOT in the PR's tree, per AGENTS.md - they live on branch
`evidence/first-run-onboarding` and the PR body links to them with `?raw=true`.

Pairs: `before` / `after`. `slow-network`, `meet-aida`, `greeting-hidden` and
`greeting-unmarked` exist only on the head (they are the new states), so they
have one frame each.

## Installer (D9, D10, U8, Q5)

| # | state | what the frame shows |
| --- | --- | --- |
| 01 | first stage | `Step 1 of 4 · 0:01 elapsed · about 10 s left` over the rail |
| 02 | mid install | `Step 3 of 4 · 0:09 elapsed · about 9 s left` + `3 of 6 large downloads done · 55 packages in all.` |
| 03 | slow network | `0:41 elapsed · taking longer than usual` — the estimate in words, never a negative count |
| 04 | verifying | `Step 4 of 4`, plain label `Starting it up` |
| 05 | installed | every step complete, Cancel spent |
| 06 | failure | unchanged failure composition (sentence + captured line) |

Before/after labels: `Preparing the runtime` → `Getting ready`, `Creating its own
Python` → `Setting up Local Operator`, `Downloading components` → `Downloading
what it needs`, `Checking the installation` → `Starting it up`; `This takes a few
minutes the first time, on this computer.` → `This usually takes less than a
minute.`; the status line and the sub-progress line are new.

## Onboarding (U1, A2, U7, D11, D12)

| # | state | what the frame shows |
| --- | --- | --- |
| 07 | step 1, collapsed | title `Connect an AI account`; intro naming Radient as easiest and xAI/OpenRouter/DeepSeek/local as `More providers`; featured rows Radient (Recommended) / Anthropic / OpenAI / Google |
| 08 | step 1, disclosure open | trigger reads `More providers: xAI, OpenRouter, DeepSeek, local models and 6 more`; subscription and API-key groups behind it |
| 09 | step 3, no Aida | web search only, primary `Finish` |
| 10 | step 3, Aida available | `Next: meet Ada`; ghost `Skip to chat`, primary `Meet Ada` (name read from `aida.status`, not spelled) |

## Aida's greeting (A4, U1)

| # | state | what the frame shows |
| --- | --- | --- |
| 11 | `details.hidden: true` | her message is the FIRST row; no wake receipt, no user row, no trigger text |
| 12 | same page, marker absent | the old behaviour: a `Wake` receipt row above her message |

Both frames go through the real reducer (`applyHistoryPage`) and the real
transcript component; only the marker differs, so the pair is the fix and its
control.

## Geometry (the numbers behind the pixels)

Read from the same live renders as the frames. The installer's own window is
640x480 in every state:

| reading | before | after |
| --- | --- | --- |
| installer story root, all six states | 480 px exactly | 480 px exactly (unchanged: the panel absorbs the new line) |
| document `scrollHeight` vs window | 480 | 480 - nothing pushed out of the window, nothing internally `clipped` |
| the new status line (`[data-install-status]`, mid-install) | - | 232.4 x 20 px at top 124.5, `overflowY: visible`, `clipped: false` |
| installer rail | 4 rows x 20 px | 4 rows x 20 px, labelled `Getting ready` / `Setting up Local Operator` / `Downloading what it needs` / `Starting it up` |
| live region (`<output>`, detail + sub-progress) | 40 px | 40 px (the reserved two lines were already there) |
| step 1 dialog | 640 x 510.1 | 640 x 531.8 (+21.7 px: the instructional intro is two lines) |
| step 1 row list / first row | 590 x 268.7 / 590 x 57 | identical - the hit target did not move |
| step 1 dialog, disclosure open | 18 rows | 18 rows |
| step 3 dialog, no Aida | 562.5 px tall | **407.3 px** (-155.2 px: the name field and its description are gone) |
| step 3 dialog, Aida available | - | 513 px; buttons `Back` / `Skip to chat` / `Meet Ada` |
| her conversation, hidden trigger | - | one record: `assistant:aida-hello`, 129.6 px |
| the same page, marker absent | - | `wake-greeting` 34.7 px (kind unset) **plus** `assistant:aida-hello` 129.6 px |

The last two rows are the A4 proof in numbers: the row the marker removes is
34.7 px tall, and with `details.hidden: true` it is not in the record list at all.

## Measured install timings

macOS 15 (M-series, aarch64), bundled uv 0.12.17, empty uv cache, scratch
`HOME`/support dir, `bash src/main/backend/scripts/macos-install-script.sh`:

| phase | before | after |
| --- | --- | --- |
| environment | 1.21 s | 1.32 s / 1.23 s |
| components | 7.57 s | 7.11 s / 10.40 s |
| script total | **9.77 s** | **9.83 s / 13.26 s** |

`verify` (the app's own smoke probe: `local-operator serve` until `/health`
answers) 3.34 s, measured with the same environment's binary. End to end on a
cold clean device: **~13 s** of install work, against the <30 s target.

pip fallback (same host, `LOCAL_OPERATOR_UV_BIN` unset), the change being the
removed self-upgrade and `--verbose`: **28.55 s → 25.67 s**.

Linux (`python:3.12-slim`, aarch64 container, empty caches, same pinned uv):

| arm | before | after |
| --- | --- | --- |
| uv path (whole script) | 13.05 s | **8.77 s** |
| — environment (`uv venv --seed`) | 2.80 s (venv module) | 0.87 s |
| — components | 8.67 s | 6.74 s |
| pip fallback | 30.72 s | 27.04 s |

The uv-built environment keeps pip (`+ pip==26.2.1` in its own log), which the
app's backend-update path needs.

**Windows is not measured here** — this machine is macOS and there is no Windows
runner available to me. The script changes there are covered by the
`install-scripts-check` job on `windows-latest`, whose uv arm this PR extends to
assert `Using Python installed by uv` and that no User-scope `PYENV`/`PYENV_HOME`
is written. That CI job is the gate for that platform; it is not a substitute for
a measurement on real Windows hardware.

## Commands

```bash
# after: Storybook on the head worktree, before: the same on a base worktree
node capture.mjs evidence/frames http://localhost:6612=before http://localhost:6611=after

# macOS, per run, empty cache each time
LOCAL_OPERATOR_SUPPORT_PATH=<scratch>/support bash src/main/backend/scripts/macos-install-script.sh

# Linux, in python:3.12-slim, pinned uv 0.12.17 staged from the release
LOCAL_OPERATOR_UV_BIN=/work/uv bash /work/after.sh
```
