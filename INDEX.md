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
| 01 | first stage | `Step 1 of 4 · 0:01 elapsed · about 25 s left` over the rail |
| 02 | mid install | `Step 3 of 4 · 0:09 elapsed · about 15 s left` + `3 large downloads finished · 55 packages in all.` |
| 03 | slow network | `0:41 elapsed · taking longer than usual` — the estimate in words, never a negative count — and `Fetching the large files…` above it |
| 04 | verifying | `Step 4 of 4`, plain label `Starting it up` |
| 05 | installed | every step complete, Cancel spent |
| 06 | failure | unchanged failure composition (sentence + captured line) |

Before/after labels: `Preparing the runtime` → `Getting ready`, `Creating its own
Python` → `Setting up Local Operator`, `Downloading components` → `Downloading
what it needs`, `Checking the installation` → `Starting it up`; `This takes a few
minutes the first time, on this computer.` → `This usually takes less than a
minute.`; the status line and the sub-progress line are new.

`after/` was re-shot for the round-1 remediation (frames `01`, `02`, `03`, `04`,
`05`, `07`, `08`, `09`, `10`); `06`, `11` and `12` are unchanged surfaces and keep
their first-round frames. The line above is read off the RE-SHOT frame 01, which
is the correction for this file's earlier claim of `about 10 s left` (design round
1, D7 - the frame said 20 s at the time, because the darwin baselines changed in
the same round).

## Onboarding (U1, A2, U7, D11, D12)

| # | state | what the frame shows |
| --- | --- | --- |
| 07 | step 1, collapsed | title `Connect an AI account`; intro naming Radient as easiest and the rest as `More providers` (the brands are the trigger's line, not the prose - D6/D11); featured rows Radient (Recommended) / Anthropic / OpenAI / Google |
| 08 | step 1, disclosure open | trigger reads `More providers: local models, xAI, OpenRouter, DeepSeek and 6 more` and the panel below leads with exactly those local rows (D8); the rest of the list continues past the fold |
| 09 | step 3, no Aida | web search only, primary `Finish` |
| 10 | step 3, Aida available | title `Web search, then meet Ada`; `Next: meet Ada`; ghost `Skip to chat`, primary `Meet Ada` (name read from `aida.status`, not spelled); the preview promises her hello, which is the ledger's `owed` path |
| 13 | step 3, greeting settled | the same screen with `greeting_state: delivered`: no promise of a first hello - `Her conversation is where you pick up with her` (`aidaOwesGreeting`) |

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
| the new status line (`[data-install-status]`, mid-install) | - | 232.4 x 20 px at top 124.5, `overflowY: visible`, `clipped: false`; re-shot at `text-body-sm`/`ink-muted` = 13 px `rgb(194,188,175)` while the static expectation is now `ink-dim` `rgb(166,160,145)` (they swapped rank: design round 1, D2) |
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

## Round 1 remediation readings

The EXPANDED frame `08` is at the SHIPPED window (1380x900), which is what makes
D1's claim checkable rather than argued; the collapsed frame `07` is at the
Storybook default **1280x900** (the round-2 re-shot one), and the box numbers
below were measured on the round-1 render at 1380x900 - the dialog is a
fixed-width modal whose height is content-driven, and design round 3 re-measured
the re-shot `07`'s box as identical (532.5 CSS including borders, rows 368..1432
device), so the numbers describe both. Read out of `08`'s geometry JSON, same
render as the frame:

| reading | value |
| --- | --- |
| viewport / dialog | 1380x900 / top 32, bottom 868 (836, the clamp), body 638x706 |
| the four featured rows | 201.1 - 428.1 |
| **the local group (LM Studio, Ollama, vLLM, llama.cpp, OpenAI-compatible)** | **559.1 - 843.1; the body ends at 798, not 868** |
| the groups after it (Kimi onward) | 884.5 - 1436.9, i.e. the list visibly continues past the fold |
| the whole list | 18 rows, `dialog 640x836 \| body 638x706 \| grid 590x1239.9` |

**868 IS THE DIALOG'S EDGE, NOT THE BODY'S** (design round 2, D9; code review round
2, M-2): the footer begins at ~799, so the body ends at 798. FOUR of the five
local rows are fully on screen (559.1 - 787.1); the fifth, OpenAI-compatible,
spans 787.1 - 843.1 and is cut by the footer, which is a scroll cue rather than a
missing row. Under the shipped group order the same rows sat below the
subscription and key groups, whose own rows start at ~970 - past the body and
off-screen. Both readings come from this frame's row boxes rather than from
arithmetic about an unseen render.

The download line is monotonic in the re-shot `02`/`03`: `3 large downloads
finished \u00b7 55 packages in all.` where the old shape read `3 of 6 ... done`
and, on the pip fallback, `0 of N` over a growing denominator (D3/R2).

## What the JSONs' text snapshots are, and are not

Each frame's `.json` carries a `text` snapshot and a set of measured boxes. The
TEXT snapshots beside the re-shot frames (`01`-`04`, `07`, `08`, `10`) were
refreshed on 2026-10-09 from the round-2 captures, so they read what the frame
reads - frame `01`'s status line is `about 30 s left`, frame `03`'s live line
carries the real ellipsis (`Fetching the large files\u2026`) rather than the ASCII
dots it used to, and no snapshot in this directory still quotes a retired shape
(`3 of 6 large downloads done`, `a few minutes`, the old trigger order). The BOXES were measured on the round-1 render
and were not re-measured: design round 3 verified they are unchanged across
rounds (see the frame table below), and the one number that was not - `07`'s
viewport, which the round-2 frame took at the Storybook default - is corrected in
its JSON.

## Round 2 remediation frames

`after/` was re-shot again on 2026-10-08 for the round-2 batch, and three frames
are CARRIED rather than re-shot:

| frame | state | why |
| --- | --- | --- |
| `01` | re-shot | the estimate reads `about 30 s left` where the round-1 frame read 25: the darwin `environment` budget went 1.5 s -> 3 s (Q2-1) |
| `02` | re-shot | its only pixel delta was the spinner's ANIMATION PHASE (a 26 x 27 px box on the ring; the status line and sub-progress text are byte-identical), so the round-1 frame was equally true - the re-shot one is carried here for uniformity |
| `03` | re-shot | `Fetching the large files…` - the ellipsis (D12) |
| `04` | re-shot | spinner phase only, as `02` |
| `07`, `08` | re-shot | the intro lost its self-describing clause (D11) and the trigger now names the groups in the order the panel paints them (D8). NO REFLOW: the only deltas are those two text lines (design round 3 measured `07`'s box at rows 368..1432 device = 532.5 CSS including borders, and `08`'s at 64..1735 = 836.0 CSS, identical in both rounds, with the intro still wrapping to three lines), so the geometry JSONs beside them still describe the frames and the readings above stand. `07`'s JSON `viewport` is now `1280x900`, which is the viewport its frame was actually taken at |
| `10` | re-shot | byte-differs from round 1 in one 20 px text band with the SAME text and the same dialog box: the paragraph became a single interpolated string, and the text run re-shapes under it. Not a copy change - recorded so nobody hunts for one |
| `05`, `06`, `09`, `11`, `12` | CARRIED | byte-identical surfaces (`05`, `09`) or untouched ones (`06`, `11`, `12`) |
| `13` | new | the settled-greeting copy. No geometry JSON: the capture ran without a measuring pass and the host was under a disk/swap hold, so I quote no box of my own. Design round 3 measured it at **513.0 CSS px, identical to frame `10`** - so the missing JSON costs nothing for the copy judgement, and the box claim is theirs, not mine |

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
