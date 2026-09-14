# Baseline frames: the trace legibility defect, on unmodified `main`

Eight frames of the four stories the branch adds, captured with the same tooling
(`scripts/capture-evidence.mjs`), the same fixtures and the same two palettes,
from **unmodified `origin/main` at `7f0511dd4`** — the state the operator
reported.

They exist because the fixed frames cannot show what was wrong. A reader looking
at `chat-tool-rows/expanded-detail/` sees one unremarkable pane; only this pair
shows that it used to be a JSON dump inside two nested boxes, and that a peer
message used to paint the model's own XML on the row.

| surface | here (unmodified `main`) | `chat-tool-rows/…` |
| --- | --- | --- |
| `expanded-detail` | `{ "command": "pnpm test:desktop 2>&1 \| tail -3" }` in a bordered `<pre>`, the result in a SECOND bordered box under an `Output` label | `command: pnpm test:desktop 2>&1 \| tail -3` and the result in one pane, split by that label |
| `expanded-json-result` | the tool's JSON result printed as JSON, braces and all | `items.0.id: ENG-1284` — one `key.subkey: value` line per leaf |
| `expanded-failed-edit` | arguments in JSON above the error, in a second box | the same arguments as labels, the error under its own label in the danger ink |
| `receipt-rows` | rows labelled `peer message` / `wake prompt` whose bodies are `<peer-session-message from_pid=92064 …>` and `(alarm) Scheduled wake w-9 … — cancel with wake({op:"cancel",id:"w-9"})` | one `peer` ledger row and one `wake` ledger row: sender identity, message body, headline |

## Why these live outside `chat-tool-rows/`

`clearSweptFrames` deletes every top-level entry in `docs/evidence/` that no
`supplementary` declaration names, and a full sweep then re-derives its own
`frames` count from what it captured. A directory the sweep cannot regenerate —
these, which need a different SOURCE TREE rather than a different fixture — has to
be its own declared set at the top level, or the next sweep deletes it and the
manifest's arithmetic stops matching the disk. That is what the `supplementary`
entry for `trace-legibility-baseline` in `manifest.json` is for, and it is the
same mechanism `tool-rows-baseline` uses.

## What differs from the branch, and why it has to

The three `expanded-*` stories were copied from the branch verbatim: their
fixtures are `TranscriptRecord`s of kinds `main` also has, and the fields they
fill (`args`, `output`, `isError`) are the same fields `main`'s transcript paints,
so the only difference between the two frames is the code under test. That is the
whole point of the pair.

`ReceiptRows` could NOT be copied. The branch's fixture feeds `peer` and `wake`
records, and `main` has neither kind: its `durableRecord` projects both custom
types to `{ kind: "custom", customType, text }` (`transcript-reducer.ts`, the
`kind === "custom"` branch), where `text` is `details.text` — the MODEL-FACING
envelope. The baseline story therefore builds exactly those records from the same
two wire rows, so the before frame shows what `main` really paints for that input.

## Reproducing them

```sh
git worktree add /tmp/ui-baseline origin/main 7f0511dd4
cd /tmp/ui-baseline && cp ~/local-operator-ui/.env .env && pnpm install --prefer-offline
# the story file and the capture list must come from the fixing branch: the
# stories do not exist on main, and the capture list has to name their ids. Every
# SOURCE file the stories render from stays main's.
cp <branch>/src/renderer/src/features/chat/canonical/tool-row.stories.tsx \
   src/renderer/src/features/chat/canonical/tool-row.stories.tsx
cp <branch>/scripts/capture-evidence.mjs scripts/capture-evidence.mjs
# then replace the ReceiptRows story's records with the `custom`-shaped ones
# described above (main has no `peer`/`wake` kinds to type the fixture against)
pnpm exec storybook dev -p 6065 --no-open &
for s in chat-tool-rows--expanded-detail chat-tool-rows--expanded-json-result \
         chat-tool-rows--expanded-failed-edit chat-tool-rows--receipt-rows; do
  node scripts/capture-evidence.mjs http://localhost:6065 --only=$s \
    --themes=localOperatorDark,localOperatorLight --allow-backend
done
```

**This needs one local change that is NOT in the tree, and it needs it on
`main` too.** `pnpm storybook` cannot build its preview at this head: Storybook's
`reactDocgen: "react-docgen-typescript"` pulls `react-docgen-typescript@2.2.2`,
which reads the TypeScript 7 JS compiler API that no longer exists, so the preview
fails with `Cannot read properties of undefined (reading 'React')` before any
story renders. That reproduces on unmodified `main` (measured, this machine,
2026-09-14), so it is a pre-existing toolchain breakage rather than anything this
branch introduced, and it is reported in the branch's PR as a finding rather than
patched here. The captures above were taken with `reactDocgen: false` in a
**local, untracked** `.storybook-local/` config (`-c .storybook-local`), which is
the workaround the other branches in this tree use; docgen feeds only Storybook's
props tables, so no frame is a function of it. The control that says so:
`chat-tool-rows--states` re-captured on this machine differs from the committed
frame by 663 of 1,152,000 pixels (0.058%) in `localOperatorDark` and 1,142
(0.099%) in `localOperatorLight` — WebP encoder noise, not a render difference.

The harness also refuses to run while a Local Operator backend answers on its
configured port; `--allow-backend` is the documented opt-in for a narrowed
capture of fixture-driven stories, and it is safe here because none of these
stories talks to a backend at all.
