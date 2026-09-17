# Composer status row — clearing the goal, and stopping or clearing a loop

The two DISMISS affordances this change adds to the composer's status row, at rest
and revealed, and the interaction that makes them worth having: the goal clearing
off the wire, a running loop stopping, a settled loop clearing, and a refusal
staying in the row's voice rather than going silent.

`docs/composer-status-tabs.md` § 12-13 is the design record these frames answer
to; this file says where the pixels came from and what each one is evidence of.

**The frames come from the OPERATOR'S BROWSER, not from a rig's own headless
Chromium.** That is a deliberate divergence from the twelve-theme sweep and it is
recorded rather than implied: this machine's operator policy forbids a screenshot
produced by a scripted browser engine (the same policy
`manifest.json`'s `chat-run-panel/mcp-grant-confirm` entry cites for its own owed
re-capture), and the interaction these frames exist for cannot be driven from a
story at all — it needs a bridge and a wire. So the two halves are:

| Half | Driven by | Frames |
|---|---|---|
| The STORY states (the row's own bands, at two column widths and the floor) | the served Storybook, in the operator's browser, at `?args=theme=…` | `goal-tab-rest/`, `goal-tab-revealed/`, `loop-tab-rest/`, `loop-tab-revealed/` |
| The INTERACTION (press → command → wire) | `harness/`, served by its own Vite config, in the operator's browser | `interaction-rest/`, `interaction-performed/`, `interaction-refused/` |

## The commands

```sh
# The stories, served from THIS worktree. 6018 because a sibling worktree held
# 6017 while this ran (`docs/evidence/chat-composer-status-row/README.md` records
# the same walk-forward).
npx storybook dev -p 6018 --no-open --quiet

# The interaction harness. Its own port variable, `strictPort: true`, and a
# scratch port because it is not the sweep and must never fight one.
COMPOSER_STATUS_CLEAR_PORT=5214 npx vite \
  --config docs/evidence/composer-status-clear/harness/composer-status-clear.vite.mjs
```

Then, in the operator's browser, one page per frame:

```
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-clear&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-chip&viewMode=story&args=theme:localOperatorLight
http://localhost:5214/docs/evidence/composer-status-clear/harness/composer-status-clear.html?theme=localOperatorDark
```

`args=theme:<id>` is how a story takes a palette (`.storybook/preview.tsx`'s
`theme` arg, applied by its own decorator), and it is the ONLY channel a browser
tool has: the sweep sets the attribute through CDP, which is exactly what the
policy above forbids here.

## The reveal, and how it was produced without a hover verb

`:hover` IS BROWSER STATE, and it is what reveals these controls. The `browser`
tool has no hover action, so the revealed frames are produced by the one route
that reaches the same state honestly: a press on the control. A press moves the
real pointer there first, so the frame is of a genuine `:hover` — and in a STORY
the press has no other effect (the row's props are the story's, so the wire cannot
move). In the HARNESS the same press does what it does in the app.

The keyboard half of the reveal is pinned in
`scripts/composer-tabs.test.mjs` (both `group-hover` and `group-focus-within` cut
across every media state, and the refusal frame below shows the control staying
revealed while it holds focus), and the click-through by `tooltip` in the story
frames is the accessible name the same test asserts.

## The frames

| Frame | What it shows |
| --- | --- |
| [`goal-tab-rest/`](goal-tab-rest/) | The `GoalClear` story at rest, four bands: the goal's dismiss HELD (nothing painted, its 89px box reserved so a hover cannot move the snippet — the numbers are printed into the frame: `900px column · row 32px tall · overflowX 0px · 2 chips · 1 dismiss (89px) · goal 257px (text 188/188)`), the goal alone on the row, a long goal beside the count, and the 240px band where the dismiss's word is dropped and its X and accessible name stay. |
| [`goal-tab-revealed/`](goal-tab-revealed/) | The same story with the pointer on the goal's dismiss: the `X` and `Clear goal` are painted at the item's trailing edge with the chip's own hover ground, and the tooltip `Clear goal — Reconcile the March invoices` is the one derived string the control is named by. |
| [`loop-tab-rest/`](loop-tab-rest/) | The `LoopChip` story at rest: the loop chip alone at the row's start (`Loop: running, 2 of 5 turns`), the goal/loop/plan pair, `judging` with no figure beside its word, and the settled `achieved` case whose affordance already reads `Clear loop`. |
| [`loop-tab-revealed/`](loop-tab-revealed/) | The same story with the pointer on the running loop's dismiss: `X` and `Stop loop` revealed, tooltip `Stop loop — running, 2 of 5 turns`. |
| [`interaction-rest/`](interaction-rest/) | The harness at rest: three bands, each with the wire it reads (`wire: goal … · loop …`) and an empty command log. |
| [`interaction-performed/`](interaction-performed/) | **The point of the whole set.** Three presses, one per band, and the log line each one left: `sessions.command goal --clear -> session clear-goal` (the wire's goal is now `""` and the row renders NOTHING — no chips above the box), `sessions.command loop --stop -> session stop-loop` (the wire's loop is `none`, the loop chip is gone and the goal chip beside it is not), `sessions.command loop --clear -> session clear-loop` (the same, from the settled state). The fourth band is the control and is untouched. |
| [`interaction-refused/`](interaction-refused/) | The refusal path: the bridge answers 503, and the row answers it in the backend's own words through the app's toast channel — ` /goal did not run: the backend refused: no standing goal to clear` — while the wire does NOT move and the control stays revealed under the pointer that pressed it. |

## What these frames are not

- **Not a backend proof.** The wire the harness moves is the harness's own: it
  applies `goal --clear` / `loop --stop` / `loop --clear` to the frontend state
  the row reads, which is what the renderer sees of those commands. The backend
  half of the pair is `local-operator`'s change, and no frame here claims it.
- **Not the twelve-theme sweep.** Two brand palettes, which is
  `docs/branding.md` § 9.9's minimum and where contrast defects hide, not twelve.
  A full sweep of this surface needs the rig, and the reason it was not run is at
  the top of this file.
- **Not the story set next door, and that set is STALE for this change.**
  `docs/evidence/chat-composer-status-row/` is the swept set: its frames are
  pictures of the row BEFORE the goal's dismiss box and the loop chip existed, and
  the row they name has moved (the goal chip's snippet now yields to a held 89px
  box; a sixth chip can appear). Its frames are left in place rather than deleted
  — they are the record of the arrangement the design record's § 2, § 3.1 and § 5.4
  quote numbers from — and the re-capture is OWED, for the reason recorded in
  `manifest.json`'s `captureOrigin.browserToolPass` and in this set's own
  `supplementary` entry.
- **Not a hover frame for the keyboard case.** The keyboard half of the reveal is
  a class-string pin in `scripts/composer-tabs.test.mjs` and the focus state of a
  dismiss under its own focus, not a frame of a Tab walk.
