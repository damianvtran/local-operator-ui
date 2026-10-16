# The `$skill` seal — before / after frames

A `$name` send persists the RENDERED payload as the user's message: the header
sentence, `<skill name=… invocation=…>`, the SKILL.md file verbatim (front matter
included), `</skill>` and the request. The desktop painted that string as the
user's own bubble; the harness's own record calls a full-payload bubble a defect
(`docs/design/history-fold-convergence.md` row D8 in `damianvtran/local-operator`,
where the TUI and the phone read the typed line back via `_typed_line_of`), and
the desktop's write half shipped without its reader (`adf86a39c`, PR #690).

These eight frames are the SAME seeded conversation, read by two trees:

| File | Tree | State |
| --- | --- | --- |
| `skill-seal-1380x900-dark-payload.png` | `origin/main` `0e846d2e6` | the defect: the whole payload as the user's bubble |
| `skill-seal-1380x900-light-payload.png` | `origin/main` `0e846d2e6` | the same, light |
| `skill-seal-1380x900-dark-collapsed.png` | `feat/skill-invocation-seal` | the seal, closed |
| `skill-seal-1380x900-dark-expanded.png` | the branch | the press: instructions on the recessed ground |
| `skill-seal-1380x900-light-collapsed.png` | the branch | the seal, light |
| `skill-seal-1380x900-light-expanded.png` | the branch | the press, light |
| `skill-seal-1380x900-dark-long-purpose.png` | the branch | the second invocation, whose purpose is longer than the row |
| `skill-seal-1380x900-light-long-purpose.png` | the branch | the same, light |

## How they were shot

An isolated daemon on a rig-owned port (NOT the operator's 1111, and not 8080 —
`--scene session-archive` measured that the port is not the discriminator: the
app's transport is main's, so any free port is reachable), a seeded journal whose
two user rows are the rendered payloads, and the built app headless over CDP:

```sh
RIG="$LOCAL_OPERATOR_SCRATCHPAD/rig"
node scripts/skill-seal-fixture.mjs "$RIG/config"
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" HOME="$RIG/home" \
  LOCAL_OPERATOR_CONFIG_DIR="$RIG/config" \
  local-operator serve --host 127.0.0.1 --port 49321 --hosting test --model mock-model &
# both trees built with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:49321
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$RIG/token")" node scripts/renderer-driver.mjs \
  --scene skill-seal --seal-expect seal --session 1a9efacade02 \
  --backend http://127.0.0.1:49321 --backend-records "$RIG/config/run/serve" \
  --seed-onboarding-complete --out "$RIG/frames/after"
# the base tree runs the HEAD's driver and fixture with --seal-expect payload
```

The seeded skills are a FOLDED `description: >-` (`seal-demo`, the shape shipped
skills actually use) and a long plain one (`seal-audit`). The fixture's two
payload strings are asserted byte for byte against the app's own
`renderSkillInvocation` by `scripts/skill-row.test.mjs`, so a drifted writer fails
that suite rather than being photographed.

## What the run reported

Head run (`--seal-expect seal`): 29 of 31 checks PASS, including "the typed line
is the row, in the composer's own token", "a FOLDED description reaches the row as
one line", "the payload's parts are NOT in the document", "both invocations carry a
disclosure, closed by default", "the press discloses the instructions sent with the
message" and "the front matter is still stripped from the expanded body".

Base run (`--seal-expect payload`): the tag, the front matter, the body and "no
disclosure on those rows" all PASS.

**Two checks FAIL in these runs, and both are the SCENE's assertions rather than
the product** — disclosed here rather than left for a reader to find:

- *head*, `a long purpose is one ellipsized line with the sentence in its title`:
  the reading printed beside it is
  `{"clipped":true,"title":"Audit this branch for the riskiest change, …"}` — the
  claim holds (the span clips and the whole sentence is the `title`), and the
  clause that fails is the assertion's own `title.length > text.length`, where
  `textContent` is the full string even when CSS truncates it.
- *base*, `the payload's own header sentence is painted (the defect)`: the
  assertion looks for the writer's sentence with its backticks, and markdown
  renders `` `seal-demo` `` as a code span, so the painted text has none. The
  defect is still proven by the same run's tag/front-matter/body checks and by the
  frame.

Both are one-line fixes to `scripts/renderer-driver.mjs`'s scene assertions,
queued for the next commit rather than made inside a running review round.

## Also visible in the frames

The chat header shows `The user invoked the \`seal-demo\` skill directly. Follow
it for…` — the SESSION TITLE is derived from the stored payload by the harness
(`local_operator/session/naming.py`), which is the sibling half of this change and
not this PR's: `damianvtran/local-operator#2526`. These frames are its evidence too.

## What a frame cannot say

Nothing here is a layout measurement of its own: the clamp, the ellipsis and the
spacing are shown, not measured. The transitions (the body UNMOUNTED while
collapsed, the press, Copy yielding the typed line) are asserted in
`scripts/skill-seal-behaviour.test.mjs`, which mounts the shipped row in jsdom.
