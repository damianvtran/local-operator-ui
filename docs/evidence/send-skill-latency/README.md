# Send-skill-latency evidence

Pressing Enter on a message that names `$skill`s used to leave the text sitting
in the composer with no bubble in the transcript for as long as the skill bodies
took to read: one desktop IPC and one daemon catalogue scan per name, awaited
**before** `onSendMessage`, so the bubble and the box waited on the wire. The
operator's report was "I press enter and it's sometimes a few milliseconds
before it sends or even up to a second when there are skills noted in the
message too".

These files are the measurement that split the report into two facts and
recorded each one on both trees:

- **A. keydown to the user bubble** — the first commit of the typed line into
  the transcript. The felt lag.
- **B. keydown to `POST …/messages`** — when the request leaves. The send
  itself.

The fix is `a4103f69a1` ("fix(chat): paint the sent message before reading
`$skill` bodies"). It makes the press paint the typed line first and hands the
skill-body read to the `beforeAdmission` seam, which is the send's own path and
still awaits the bodies. `B` therefore still waits for the reads; `A` no longer
does. The numbers below are that claim, executed.

## What was measured, and how

Both timestamps are the page's own `Date.now()` on the machine clock:

- **The press** is a `window` capture-phase `keydown` listener, installed after
  boot so it precedes the app's own handler.
- **The bubble** is a `MutationObserver` on `document.body` keyed to a per-press
  nonce embedded in the typed line. A unique token cannot appear anywhere else
  until the message renders, so no selector guess is involved; the textarea's
  `value` is not part of `textContent`, so text still in the box cannot satisfy
  it.
- **The POST** is stamped at an HTTP proxy the app is built against. The request
  is issued by Electron main, not the renderer, so keydown → POST includes
  renderer → preload → main → HTTP.

**The arms.** `plain` carries no `$name`. `one-skill-cold` and
`three-skills-cold` name one and three seeded skills; `Page.reload` precedes
each press, and the app has no persisted query cache, so the cache is genuinely
cold. `three-skills-warm` follows the cold three-skill press that fills the
cache and reads 0 bodies over HTTP (30 s `staleTime`). `control-delay-200` is
the negative control: three skills, with each `skills` GET held 200 ms at the
proxy. Samples run round-robin, one per arm per round, so load drift hits every
arm alike.

**What makes a sample count** (a failed premise is retried, never averaged): the
bubble committed within 20 s and the box cleared with it; a `POST …/messages`
arrived after the keydown; the POST body carries every seeded body
(`Step 1: <name> line 1`) for a skill press and none for a plain press; a cold
press issued exactly N `skills.list?...name=` GETs and the warm press issued
none. Both final runs are 0 invalid samples.

**The negative control runs first.** Before the fix, the proxy's 200 ms holds
must move the bubble by roughly 3 × 200 ms (one hold per serial read) or the rig
cannot see the reads and stops. After the fix the same holds must move the POST
and leave the bubble where it is. Each run re-states the mechanism inside its
own load conditions; neither control is inferred from the other run.

## The two trees

| column | worktree | head |
| --- | --- | --- |
| before | `.worktrees/send-baseline` | `ccc99372ac60c86963f4384541207c393d1e81d4` (`chore(release): bump version to 0.58.0`) |
| after | `.worktrees/send-after` | `a4103f69a12971db785d82f1304c76036d8fc924` (`fix(chat): paint the sent message before reading $skill bodies`) |

Both were built from the same environment, against the same daemon binary, with
the same three seeded `SKILL.md` files, the same isolated `HOME` / config /
logs / profile inside the rig directory and the same proxy port 11879. The only
difference between the columns is the tree under test.

The branch has since gained the dictated-send commits. **The after column
describes `a4103f69a1`, not the PR head**; nothing after that commit is
measured here.

## Results

n = 11 per measurement arm, 4 for the negative control, 0 invalid. Cell is
**p50 / p95 / max** in ms.

| arm | skills | bubble before | bubble after | POST before | POST after |
| --- | --- | --- | --- | --- | --- |
| plain | 0 | 40 / 87 / 87 | 37 / 59 / 59 | 13 / 37 / 37 | 10 / 20 / 20 |
| one-skill cold | 1 | 670 / 1513 / 1513 | 43 / 62 / 62 | 636 / 1477 / 1477 | 387 / 403 / 403 |
| three-skills cold | 3 | 2132 / 3661 / 3661 | 35 / 61 / 61 | 2113 / 3630 / 3630 | 1105 / 1178 / 1178 |
| three-skills warm | 0 (cached) | 37 / 110 / 110 | 39 / 56 / 56 | 11 / 55 / 55 | 40 / 57 / 57 |
| control, GETs held 200 ms | 3 | 3976 / 4148 / 4148 | 20 / 29 / 29 | 3943 / 4137 / 4137 | 1292 / 1328 / 1328 |

Readings that carry the mechanism:

- **The bubble stops waiting for the reads.** Three skills: 2132 → 35 ms p50
  (−98.4%); one skill: 670 → 43 ms (−93.6%). Both after values sit at the plain
  press (37 ms p50), which is the whole claim: a message with skills now paints
  like a message without them.
- **The control still sees the reads.** On the before tree the 200 ms holds move
  the bubble from 40 to 3976 ms (+3936); on the after tree they move the POST
  from 10 to 1292 ms (+1282) and the bubble does not move (20 ms against a
  37 ms plain p50). A rig that could not see the reads would show neither.
- **The POST is still gated by the reads, by design.** Three skills: 2113 →
  1105 ms p50 (−47.7%; the reads now run in parallel, so three scans cost one
  scan deep rather than three); one skill: 636 → 387 ms (−39.2%).
- **The ordering is the fix, not an inference.** On the after tree the reads
  are issued together at the press (three-skill arrival p50 3 ms, max 4; one
  skill p50 4, max 5); every read is still in flight when the bubble commits
  (11/11 in both cold arms); no POST leaves before a read's response end
  (26/26 skill-press samples, control included). The before tree holds the
  converse: no bubble commits before every read ends (26/26), and the reads are
  serial — the next `skills` GET arrives 1–15 ms after the previous response
  ends (gap p50 2 ms).
- **The before bubble was the reads.** Median sum of the read response times
  against the same press's keydown → bubble: 2098 vs 2132 ms (three skills),
  604 vs 670 ms (one skill). Paint and send after the reads cost 30–70 ms, the
  same as a plain press.
- **Cache hit removes the reads.** The warm arm reads 0 bodies in both runs and
  paints at plain speed (37 ms before, 39 ms after).

## Why two rig scripts, and what the unchanged run shows

One script with a mode flag would be smaller, if the flag were trivial. It is not:
the baseline rig's three central premises invert on the fixed tree, and a flag
would put three branches inside the sample loop while ending the before column's
reproducibility from the code that produced it.

`scripts/submit-skill-latency-baseline.mjs` samples the POST on the bubble tick
(valid on the before tree because the POST always precedes the bubble, 0
exceptions in 26 skill-press samples), counts a cold press's reads in
keydown → bubble, and expects the control's holds to move the bubble.

`scripts/submit-skill-latency-after.mjs` changes exactly those three things: it
waits (bounded 20 s) for the POST before sampling it, counts the reads in
keydown → POST, and flips the control verdict (POST moves by ~3 × 200 ms, bubble
does not). Arms, n, seeding, daemon, isolation, build and the payload assertion
are untouched.

The unchanged rig was run on the fixed tree (`samples-after-unchanged.json`) as
a control for that change of premise: its plain arm is valid (bubble 19 / 25 /
25 ms, POST 6 / 10 / 10), and every skill and control sample is invalid with
**"no sessions.message POST seen at the proxy"** — the POST now lands after the
bubble, which is the ordering change under test being observed by the old
instrument. That run is not a second after column and its invalid arms carry no
numbers.

## Load was not matched

| run | loadavg 1-min at start | at end |
| --- | --- | --- |
| before (`baseline-final2`) | 21.75 | 13.62 |
| after (`after-final2`) | 5.13 | 7.25 |

The before column ran under a substantially busier host, and the machine-wide
average moved during it. **Absolute before/after milliseconds are therefore not
a clean like-for-like comparison.** What survives the mismatch:

- both columns' control arms re-state the mechanism inside their own run;
- the after bubble equals its own run's plain bubble (35–43 vs 37 ms p50), a
  within-run comparison that load cannot explain: the skill presses stopped
  costing more than a plain press in the same run;
- the after POST tracks its own run's read completion (p50 1105 vs 1104 ms for
  three skills, 387 vs 386 ms for one), also within-run.

The load bias runs in the before column's disfavour, so the absolute bubble
delta is inflated in the after column's direction and is not the claim. The
claim is the within-run equality (skill presses cost what plain presses cost)
and the ordering (reads in flight at the bubble, POST after their end). The POST
reduction is partly load and partly the reads now running concurrently; its
within-run tracking is what shows the concurrency.

## Reproducing

Build the worktree against the rig's proxy. The four OAuth variables are
required by the build's `replace-backend-config` plugin and were placeholder
values, never real credentials.

```sh
cd <worktree>
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:11879 \
VITE_DISABLE_BACKEND_MANAGER=true \
VITE_GOOGLE_CLIENT_ID=placeholder VITE_GOOGLE_CLIENT_SECRET=placeholder \
VITE_MICROSOFT_CLIENT_ID=placeholder VITE_MICROSOFT_TENANT_ID=placeholder \
  pnpm build
```

Run the before column (baseline worktree `ccc99372ac`):

```sh
LO_SUB_REPO="$PWD" \
LO_SUB_OUT="$LOCAL_OPERATOR_SCRATCHPAD/baseline" \
LO_SUB_LABEL=baseline-final2 \
LO_SUB_N=11 \
LO_SUB_BACKEND_BIN="$HOME/.local/share/lop/current/bin/local-operator" \
  node scripts/submit-skill-latency-baseline.mjs
```

Run the after column (after worktree `a4103f69a1`): the same command with
`LO_SUB_LABEL=after-final2` and `scripts/submit-skill-latency-after.mjs`.

Run the unchanged-rig control on the fixed tree: the **baseline** script, same
build, `LO_SUB_LABEL=after-unchanged`.

Take the baseline payload probe: the **after** script on the baseline worktree,
`LO_SUB_LABEL=baseline-payload-probe LO_SUB_ARMS=three-skills-cold LO_SUB_N=1`.
It stores the baseline's POST body, which the baseline run itself did not keep;
its one sample is bubble 1032 ms, POST 1007 ms, three reads.

The rig starts an isolated `local-operator serve` (`hosting: test`,
`model_name: mock`, its own bearer), seeds the three `SKILL.md` files into the
isolated `$HOME/.local-operator/skills`, launches the **built** app with its own
Electron in `--window-mode=headless` (never shown, never focused, its own
`--user-data-dir`), drives it over CDP (`Input.insertText`,
`Input.dispatchKeyEvent`) and reaps everything it starts by process-group pid;
each run printed `[alive-after-reap] (none)`.

## Files here

- `samples-baseline-final2.json` — the before column. 48 samples (4 control +
  four arms × 11), `head` = `ccc99372ac`, per-sample stamps, read spans and POST
  body.
- `samples-after-final2.json` — the after column, `head` = `a4103f69a1`.
- `samples-after-unchanged.json` — the unchanged baseline rig on `a4103f69a1`;
  its `notes` carry the invalidation reason per sample.
- `samples-baseline-payload-probe.json` — the one-press baseline body probe.
- `scripts/submit-skill-latency-baseline.mjs`,
  `scripts/submit-skill-latency-after.mjs` — the two rigs. The committed copies
  are the run-as files after the repository's `pnpm lint:scripts` gate
  (`biome check --write`): whitespace, import order, three template literals
  without interpolation and the name of one uncalled local inside `press()`
  changed; no executed path did.

The JSON files are the rigs' own `samples-<label>.json` output, including each
sample's POST body. **Every p50/p95/max in this file was re-derived from them**
with the rig's own nearest-rank percentile (`sorted[ceil(p/100 × n) − 1]`), not
copied from a summary. Time units are ms on the machine clock.

## What this does not prove

- **Not the packaged or notarised app, and not a real provider.** The backend is
  `local-operator serve` at `hosting: test` / `model_name: mock`; the reply is
  the mock model's and no tokens are spent.
- **Not paint timing.** These are `Date.now()` stamps around a committed DOM
  mutation and a request arrival, not frame timings.
- **The transcript bubble is real, the render behind it is not measured.** A
  MutationObserver sees the row commit; it says nothing about pixels.
- **The proxy is not the renderer's clock.** keydown → POST includes
  renderer → preload → main → HTTP because main issues the request, but the
  arrival stamp is taken after main's HTTP stack, not inside it, and the proxy
  adds one local hop (~0.2 ms). In the control arm only, the deliberate 200 ms
  hold per `skills` GET is added.
- **Absolute scan cost is this host's, at this load.** The structural claim —
  the bubble no longer waits for N catalogue scans, and the scans now run
  concurrently — is what the fix changes. The constant is not portable: the
  fix's own commit message cites a quiet-host scan of p50 67 ms, max 80 ms,
  n=15, against 602–1276 ms per request measured here under fleet load.
- **The warm arm's POST moved 11 → 40 ms and is unexplained.** The warm arm
  issues no `skills` GET, carries no bodies, and its bubble moved 37 → 39 ms;
  n = 11 per arm and the runs are at different load. It is named here rather
  than averaged away, and it does not bear on either claim above.
- **The after column is `a4103f69a1`.** The dictated-send work that followed on
  this branch is not covered.

## Environment notes from the run

- The dev checkout `~/workspace/repos/local-operator` at `088519586` does not
  advertise `skill_catalogue`, which the renderer gates the `$` vocabulary on;
  against it `$skill` never expands and the rig would measure plain presses.
  The runs therefore used the installed runtime
  `~/.local/share/lop/current/bin/local-operator` **v0.106.7**, which does.
  Every run's `/v1/capabilities` reported `session_catalogue = 3`, the feature
  the warm session route needs.
- The before worktree's `node_modules` was a symlink to a complete tree
  (`~/workspace/repos/lo-ui-pele/node_modules`, Electron 45.1.0) because the
  shared checkout was missing declared packages for `ccc99372ac` at the time
  (the baseline session recorded 13, including `intl-messageformat`). A fresh
  `pnpm install` is the normal route; the symlink is an artefact of this
  machine's fleet setup, not a requirement of the rig.

## Where this set is declared

It is **not** a declared set in `docs/evidence/manifest.json`. The directory
holds JSON measurements, not `.webp` frames, and the pixel sweep
(`scripts/check-evidence.mjs`) counts frames per declared set; declaring a
zero-frame set would buy only the on-disk count assertion, at the cost of a
manifest edit this lane does not need. The frame counts in the manifest do not
describe this evidence, and a green pixel sweep says nothing about it either
way.
