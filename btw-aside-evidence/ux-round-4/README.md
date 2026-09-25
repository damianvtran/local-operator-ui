# UX round 4 frames: PR #482 at f105c9953

A **delta-confirmation** pass, not a new round. UX round 3 was TERMINAL on
`ba98e4fdc`; three of that round's own findings have since been fixed and a
fourth's commit changed the panel's geometry, so the same flows were walked
again on this head.

- **Reviewer:** `ux-reviewer` subagent (Local Operator). The session began on
  `anthropic/claude-opus-5-5` and the provider ran out (0% remaining) before the
  app was built and before any reading was taken: **every number and frame here
  is `deepseek/deepseek-flash`'s**, and none was taken on the primary. I authored
  no commit on the PR branch, edited nothing in it, pushed nothing to it, added
  no reviewers and @-tagged nobody.
- **App:** the renderer built at the head in a session-unique detached worktree
  (`ux482-r4-d41bf2`), `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`, the
  four OAuth build variables set to non-credential placeholders
  (`ux4-placeholder-not-a-credential`), and `VITE_PUBLIC_POSTHOG_HOST` set to a
  non-resolving placeholder host — the renderer validates that one as a URL and
  refuses to boot with it empty. It ran `--window-mode=headless` through a COPY
  of `scripts/renderer-driver.mjs` (`rig/patch-driver-ux4.sh`) with rounds 1-5's
  helper layer, **UX round 3's own scene** (re-driven as the regression) and this
  round's two scenes appended. The app source is unmodified; the driver copy is
  untracked.
- **Backend:** the REAL daemon from local-operator `origin/main`
  (`2e89f8643`, version 0.62.31) in its own worktree with its own `uv` venv;
  `local_operator.__file__` asserted inside that worktree.
- **Stub:** the scripted OpenAI-compatible provider, unchanged, with round 3's
  `MERMAIDANS` and the `TOOLCALL2` marker that makes a declined aside.
- **Isolation:** `env -i`, scratch `HOME`/`TMPDIR`/`LOCAL_OPERATOR_CONFIG_DIR`,
  `GIT_CONFIG_SYSTEM=/dev/null`, no `CMUX_*`/`LOP_*`; every listener reaped by
  exact pid inside the capture script; the run asserts the app holds a connection
  to this run's backend and **no** connection to the operator's own at 1111.
  **1111 was never bound.** Each pass held the shared 8080 under the shared lock
  and printed `8080 released before this command returned` /
  `port8080.lock released`.

## Ports

8080 is the one port `src/renderer/index.html`'s `connect-src` already pins beside
1111, so no CSP surgery was needed and no `src/` file was touched (`[build] csp
for this run's backend — already widened for http://127.0.0.1:8080`). The stub
and the daemon bound OS-chosen ports.

## Passes

| pass | width | scene | result |
| --- | --- | --- | --- |
| `ux4wide` | 1380x900 | `btw-ux4` — U19's three arms, U17's floor, U18's copy on both arms | 25 PASS / 0 FAIL |
| `ux4narrow` | 800x900 | `btw-ux4b` — the same U18 copy and U19 refused arm with the clip measured, U16/U17's two presses | 14 PASS / 1 FAIL¹ |
| `ux4c` | 1380x900 | `btw-ux4c` — U21 three ways: the late diagram, the long stream, the hand-scroll | 16 PASS / 1 FAIL² |
| `ux4d` | 800x900 | `btw-ux4d` — the narrow settle path and the reader-wins arm on a window the rig can catch | 14 PASS / 0 FAIL |
| `ux3wide` | 1380x900 | UX round 3's own scene, re-driven | 44 PASS / 3 FAIL³ |
| `ux3narrow` | 800x900 | UX round 3's own scene, re-driven | 13 PASS / 1 FAIL¹ |
| `ux3c` | 1380x900 | UX round 3's ⌘+F scene, re-driven | 11 PASS / 0 FAIL |
| `ux3d` | 1380x900 | UX round 3's late-diagram scene, re-driven | 11 PASS / 0 FAIL |
| `bisect5ee` | 800x900 | `btw-ux3b` at **`5ee9c68f6`** (the cap commit alone) | 13 PASS / 1 FAIL¹ |
| `bisect88c` | 800x900 | `btw-ux3b` at **`88c528137`** (cap + floor + copy, no observer) | 13 PASS / 1 FAIL¹ |

¹ the same check: at 800px the refused follow-up's refusal is not inside the
region's clip (see U22 below). It is the check UX round 3 passed at `ba98e4fdc`.
² the hand-scroll arm never reached its own state (the mermaid module is cached
by then, so on its second use in a run the SVG arrives inside one 40 ms poll);
`btw-ux4d` re-tests the same property on a streamed growth instead.
³ UX round 3's scene presses the second adopt chord as soon as the confirm paints
(~60-100 ms), which the new floor now swallows by design: its 5a arm and the two
checks that read the same state fail, and the later steps re-derive their own
exchanges. The same property is re-tested by this round's own `btw-ux4` arm 5
(a deliberate press, 1.1 s later) and by `btw-ux4b` b04/b05 at narrow.

## What the delta verifies

- **U19 (close names the entry that holds the exchange).** After a REFUSED
  follow-up, Esc's DELETE names the entry the ASK path continues
  (`b30ec786…`, answered **200**) and not the refused turn's id (`d8c29826…`),
  and the entry really goes (GET **404**). Wide, narrow and the answered arm all
  the same. After an ADOPT the entry is still held (200, `adoptable: false`) and
  an Esc with no panel sends **no** close and takes nothing back; the adopted rows
  survive leaving and re-entering the conversation, once each.
- **U17 (the floor).** A reflex double-tap 66-75 ms apart sends **0** adopt
  requests, the panel stays, the confirm stays, and nothing red appears; the next
  press after the floor adopts, once; a deliberate press 1.1 s after the confirm
  adopts first time. Re-driven by UX round 3's own scene too (`keys` 23987/24054,
  `adoptOps: 0`).
- **U18 (the remedy stated once).** The composed refusal now reads *"…No answer was
  produced: Ask again here to keep this exchange, or press Esc to close the aside
  and discard it."* — one occurrence of the remedy, both options named, at both
  widths; a FRESH refused ask still states the owner's sentence alone with its own
  trailing `ask again.` intact.
- **U21 (the move follows a box that grows after the settle).** Where the move had
  stopped short, the panel now follows it: `contentHeight` 795 → 1377 with the
  region moving **547 → 752.5** and the newest question's top coming to the
  region's top (205.3 → -0.2 px). It still does not follow every chunk (the move
  latched at 3022 ms; 426 px of growth after that, 0 px of movement, and the
  question never passed). The reader still wins (a mid-stream hand-scroll, then
  1601 px of further growth, the region unmoved).

## Frames

`frames/<pass>/` — 30 frames, each named `<scene>-<pass>-<step>-<what>.png`.
Passes `bisect5ee` and `bisect88c` are the bisect and were taken at those commits,
not at the head; every other frame is the head.
