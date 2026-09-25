# UX round 5 frames: PR #482 at cf5a12f95

A **closure pass for U22 plus a fold spot-check**, not a new round's walk. Head
**`cf5a12f9557dd03e73c0f70fcd6b68196182f689`**, verified with
`git rev-parse origin/feat/btw-aside-panel` and `gh pr view 482 --json headRefOid`
before the first pass and again before posting.

- **Reviewer:** independent `ux-reviewer` subagent (Local Operator), model
  **`deepseek/deepseek-flash`**. **Mid-round failover, disclosed:** the session
  began on `anthropic/claude-opus-5-5`; the runtime reported the fallback to
  `deepseek/deepseek-flash` at the very start of the round, before the app was
  built and before any reading was taken, so **every number and frame here is
  `deepseek/deepseek-flash`'s** and none had to be re-taken. I authored no commit
  on the PR branch, edited nothing in it, pushed nothing to it, added no
  reviewers and @-tagged nobody.
- **App:** the renderer built at the head, in the UI worktree
  `~/local-operator-ui-worktrees/ux482-r5-7c31f9`, run `--window-mode=headless`
  through a COPY of `scripts/renderer-driver.mjs` (untracked) carrying rounds
  1-5's helper layers and scenes plus this round's `btw-ux5` and `btw-ux5b`.
  The app source is unmodified (`git status --porcelain` shows only that
  untracked file).
- **Backend:** the REAL daemon from local-operator `origin/main` in its own
  worktree with its own `uv` venv (`d91f671e2`, version 0.62.33), asserted
  in-process with `local_operator.__file__`.
- **Stub:** the scripted OpenAI-compatible provider, unchanged, with round 3's
  `MERMAIDANS`, `SLOWANS`, `LONGANSWER` and the `TOOLCALL2` marker.
- **Isolation:** `env -i`, scratch `HOME`/`TMPDIR`/`LOCAL_OPERATOR_CONFIG_DIR`,
  `GIT_CONFIG_SYSTEM=/dev/null`, no `CMUX_*`/`LOP_*`; every listener reaped by
  exact pid inside the capture script; the run asserts the app holds a connection
  to this run's backend and **none** to the operator's own at 1111.

## Ports: 8080 was NOT available, so this round ran on 8391

Rounds 1-4 ran the rig on **8080**, the one port the shipped `connect-src`
already allows beside 1111. On this host at this hour 8080 is held by the
operator's OWN app (`ps` → `Local Operator [serve] port=1111 … --listener-fd 3`,
which also listens on 8080), so waiting for it could never end and signalling it
is out of the question. This round therefore bound **8391**, which nothing on
this host listens on, and widened `connect-src` for it **in the gitignored build
output only** (`out/renderer/index.html`; `.gitignore:9` excludes `out/`, and
`widen-csp-ux5.sh` is idempotent and refuses if the anchor is not exactly once).
No `src/` file was touched. The shared 8080 lock was deliberately **not** taken,
because this rig never touches 8080 and holding it would block peers who do.
**1111 was never bound.**

## What each pass is

| pass | width | scene | result |
| --- | --- | --- | --- |
| `ux5narrowfix` | 800x900 | `btw-ux5` — U22's closure in the flow, the narrow comfort arms, U23/U24 | **28 PASS / 0 FAIL** |
| `ux5wide` | 1380x900 | `btw-ux4` — U19's three arms, U17's floor, U18's copy | **25 PASS / 0 FAIL** |
| `ux5narrow2` | 800x900 | `btw-ux4b` — U18/U19 at narrow, U16/U17's two presses | **15 PASS / 0 FAIL** |
| `ux5diag` | 1380x900 | `btw-ux4c` — U21 three ways | 16 PASS / **1 FAIL**¹ |
| `ux5settle` | 800x900 | `btw-ux4d` — round 4's own U22 probe | 12 PASS / **2 FAIL**² |
| `ux5r3wide` | 1380x900 | `btw-ux3` — round 3's whole scene | 40 PASS / **7 FAIL**³ |
| `ux5r3wide3` | 1380x900 | the same scene, again | **44 PASS / 3 FAIL**³ |
| `ux5r3wide4` / `ux5r3wide5` | 1380x900 | the same scene, again x2 | **44 PASS / 3 FAIL** each |
| `ux5r3narrow` | 800x900 | `btw-ux3b` — round 3's narrow scene | **14 PASS / 0 FAIL** |
| `ux5r3diag` | 1380x900 | `btw-ux3d` — round 3's late-diagram scene | **11 PASS / 0 FAIL** |
| `ux5fold4` | 800x900 | `btw-ux5b` — this round's fold spot-check | 19 PASS / **1 FAIL**⁴ |

¹ the known unreachable arm: the mermaid module is cached by then, so the box
never grows after the hand-scroll (`grew: 0`). Byte-identical reading to round 4's
own `ux4c` failure — unchanged, not a new defect.

² **these two checks assert the BROKEN state on purpose.** They are round 4's own
diagnostic for U22, written to FAIL once the defect is fixed ("a diagnostic, not a
verdict, and worded so it can FAIL"). They passed at `f105c9953` and fail here
with the healthy reading (7 of 7 rows inside the clip, the phrase naming Esc's
cost 2.4 px inside; the region resting at its own end, `221.5` of `maxScroll 222`,
because the move's target is reachable now). That flip is U22's closure measured
by the very probe that characterised it.

³ the three: `5a` twice and `5b` once — round 3's scene presses the second adopt
chord as soon as the confirm paints (~60-100 ms), which the round-4 floor swallows
**by design**; the later steps re-derive their own exchanges. Identical failure
details and identical tally to round 4's re-drive of this scene (44/3), so nothing
this delta touched moved. `ux5r3wide` is the one run in five where `6a` also
fired in `ux5r3wide` — see the section below.

⁴ `b02`'s "the new conversation is on screen and published in the sidebar": at the
step's own read the send was **still in flight** (the frame shows the composer
saying `Sending…`), so the check was asking the app to have already marked as
current something it was still doing. The conversation IS published (the frame
reads `All chats 2`, `Showing 2 of 2 chats`) and the send is visibly in the
transcript, which is what a reader needs; the expectation was the rig's, not the
app's. Every other fold check passes — see `frames/ux5fold4/`.

## Why one band state in `frames/ux5r3wide/` matters

`frames/ux5r3wide/…14-u12-busy-line-at-the-press.png` is the one run in five at
this head where the composer band also raised the **held-message lane** at a press
the busy aside refuses: the aside's own line ("The aside is still answering. Press
Enter again once the answer is in.") *plus* "A message is still being held, so a
different message cannot be sent yet. Whether it reached the agent is not knowable
- its copy is in the transcript above - so restore it and send again only if no
reply arrives." with `Restore message` / `Stop holding it`, while the draft is
plainly still in the composer below. `frames/ux5r3wide3/` is the **same step in a
clean run** — the aside's line alone — which is what round 4 read at
`f105c9953` too.

**The wire says the held claim was false:** in the fired run,
`logs/ux5r3wide-proxy-stats.json` has **0** message posts and **0** aside posts
carrying that text (1 message post and 20 aside posts in the whole run), so the
follow-up never left the client. The lane's copy nevertheless asserts an uncertain
delivery and invites the reader to wait for a reply that cannot come. It persisted
through the rest of that run's scene (steps 8b and 9b).

The composer/band files (`message-input.tsx`, `use-message-input.ts`) are **byte
identical** at `f105c9953` and at this head — the fold changed neither — and the
store's own claim-code assignment (`heldClaimCode: _claimCode` and its
surrounding decision) is byte-identical too. So this is a timing-dependent reach of
a pre-existing state, not a code path this delta introduced; the report grades it
as a follow-up and says what it would take to attribute a rate properly (many
more samples per head).

## What these frames canNOT prove

- **A real model's pacing.** Every shape here is the scripted stub's; the held-lane
  fire is timing-dependent, which is exactly the kind of state a real model's
  pacing may reach more or less often.
- **A frame rate** for the held lane: 1 of 5 evaluable runs at this head, and one
  clean run at round 4's head is not a rate for that head.
- **The mechanism** behind the held lane's occasional appearance: the state was
  read from the DOM and the wire, not instrumented in the store.
- **Off macOS** (⌘ chords, and any platform whose scrollbar takes layout width),
  the light theme, and the second viewer's adopt.
- **Focus rings**: a headless window is never focused, so focus is read from
  `document.activeElement` while the keys are driven for real.

## Rig notes worth carrying forward

- `FRAME_LABEL` in `src/main/dev-driver-ipc.ts` is
  `/^[a-z0-9][a-z0-9_-]{0,63}$/` — **64 characters including the harness's scene
  prefix**, so a long `take` label throws mid-scene rather than truncating.
- `aria-current="page"` is on the row's own BUTTON (`[data-chat-row]`), not on the
  `[data-session-row]` wrapper: read the current conversation with
  `document.querySelector('[data-chat-row][aria-current="page"]').closest('[data-session-row]')`.
- The app is served from `out/renderer/index.html` over `file://`, so
  `location.pathname` is the built file's path, not the app's route.
- A conversation created **out of band** (straight on the backend) is not in the
  app's catalogue until something refreshes it: the fold's spot-check creates its
  second conversation the way a reader does (the `New chat` row, then a send).
- The `ux5r3wide` log carries a duplicated `6a the band's own structure` line: the
  probe script inserts its log line on every run and was applied twice. Harmless,
  and stated here so a reader does not read it as two probes.
