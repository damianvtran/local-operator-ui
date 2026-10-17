# The `$skill` seal — before / after frames

A `$name` send persists the RENDERED payload as the user's message: the header
sentence, `<skill name=… invocation=…>`, the SKILL.md file verbatim (front matter
included), `</skill>` and the request. The desktop painted that string as the
user's own bubble; the harness's own record calls a full-payload bubble a defect
(`docs/design/history-fold-convergence.md` row D8 in `damianvtran/local-operator`,
where the TUI and the phone read the typed line back via `_typed_line_of`), and
the desktop's write half shipped without its reader (`adf86a39c`, PR #690).

These fourteen frames are the SAME seeded conversation, read by two trees: the
base at `origin/main` `af6de1dd9` and the branch `feat/skill-invocation-seal`
(`f014b46e7`).

| File | Tree | State |
| --- | --- | --- |
| `skill-seal-1380x900-dark-payload.png` | base | the defect: the whole payload as the user's bubble |
| `skill-seal-1380x900-light-payload.png` | base | the same, light |
| `skill-seal-1380x900-dark-collapsed.png` | branch | the seal, closed: token, `·`, the folded purpose, the request |
| `skill-seal-1380x900-dark-expanded.png` | branch | the press: instructions on the recessed ground |
| `skill-seal-1380x900-dark-long-purpose.png` | branch | the second invocation, whose purpose is longer than the row |
| `skill-seal-1380x900-dark-long-body.png` | branch | the third invocation, a 40-step body: capped, scrolling inside itself |
| `skill-seal-1380x900-dark-hover.png` | branch | the pointer on the trigger: the chevron steps ink |
| `skill-seal-1380x900-dark-focus.png` | branch | a real Tab on the trigger: the global 2px outline |
| `skill-seal-1380x900-light-{collapsed,expanded,long-purpose,long-body,hover,focus}.png` | branch | the same six, light |

## How they were shot

An isolated daemon on a rig-owned port (NOT the operator's 1111, and not 8080 —
`--scene session-archive` measured that the port is not the discriminator: the
app's transport is main's, so any free port is reachable), a seeded journal whose
three user rows are rendered payloads, and the built app headless over CDP:

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
skills actually use), a long plain one whose caption the row has to ellipsize
(`seal-audit`), and a 40-step body (`seal-steps`) at the length the shipped skill
library actually runs (17-156 lines — the one-line body this fixture seeded first
is the shape that HID the uncapped block). The fixture's payload strings are
asserted byte for byte against the app's own `renderSkillInvocation` by
`scripts/skill-row.test.mjs`, so a drifted writer fails that suite rather than
being photographed.

## What the run reported

Head run (`--seal-expect seal`): **38 of 38 checks PASS**, in both themes. The
readings a reader cannot see in a still, as the run printed them:

| Check | Observed (dark) |
| --- | --- |
| the 40-step block is capped and scrolls inside itself | `clientHeight 320` against a cap of `min(320px, 40vh)` = 320, `scrollHeight 509` |
| opening the long body keeps the row's own header inside the scroller | trigger `top 173`, scroller viewport `72…766` |
| hovering the trigger steps the chevron's ink | resting `rgb(166, 160, 145)` → hovered `rgb(194, 188, 175)` |
| a keyboard user reaches the trigger, and the app outlines it | `outline solid 2px`, `:focus-visible` true, focused true |

Base run (`--seal-expect payload`): **16 of 16 checks PASS** — the header
sentence, the tag, the front matter, the body and "no disclosure is rendered on
an invocation row on this tree".

Both runs also assert that no process from the run outlived its boot, and the
daemon was reaped by the pid in `$RIG/daemon.pid` after each shot.
