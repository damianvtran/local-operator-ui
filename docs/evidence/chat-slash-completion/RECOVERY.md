# UX round 2 — evidence recovery

Recovered by coder (`openai/gpt-6-astra`) from the interrupted worktree at
`2a24d3fafbd7ab3ab4b7c3cc966c029b2b139883`. No routing change or old model resumed.

## Capture provenance

The predecessor's `/tmp/slash-parity-capture.log` reports 180 frames captured at
`2a24d3faf`; `/tmp/slash-parity-sb.log` identifies its private Storybook on
`http://localhost:6070`. The manifest's refresh timestamp is
`2026-09-14T18:26:08.132Z`. Of the 180 frames (15 stories × 12 themes), 144 in
12 stories differ from `8a4a50ea9`; 36 empty/loading/error-state frames remain
byte-identical. The images were preserved, not blindly re-captured.

The predecessor used `capture-evidence.mjs` browser-engine automation, contrary
to the operator's browser-tool-only instruction. These are explicitly attributed
predecessor artifacts, **not** browser-tool captures by recovery, and **not**
independent QA. The manifest's stale byte-identity narrative and double-count of
360 refreshed frames were corrected. Unrelated historical frames retain their
original provenance; no whole-tree image sweep or freshness claim was made.

Recovery visually read the old and new `command-phase/tokyoNight.webp`: the old
frame names Enter alone, while the new frame adds `Click completes /team.`.
Both are 768×460; the footer expands upward without moving the composer below
it. The prior frame is available directly at commit `8a4a50ea9`. Recovery also
read `argument-phase-narrow-composer/localOperatorLight.webp` (378×300): the
second footer line says `Click runs /model anthropic/claude-opus-5.` and fits
within the narrow popup. This is representative inspection, not a claim to
have visually read all 180 frames.

## Required rebase and targeted browser-tool validation

GitHub reported `mergeStateStatus: DIRTY`; recovery rebased once onto
`915928a18a1d55fbe501c41cf6f68e6b8daa60ad`, not repeatedly onto moving main.
`git range-diff 142e869045..675046261 915928a18a..e8e8b8ad1` reports 40 `=`
commits and two `!` commits: historical manifest stamps and the desktop test
script. The script resolution retains both upstream browser-host/vendoring tests
and the five slash suites. Final manifest bytes equal the pre-rebase recovered
manifest before the explicit provenance update below. Branch `src/` and
`scripts/` +/- line sequences are byte-identical across the rebase. Upstream and
branch overlap only in `package.json` and `docs/evidence/manifest.json`; there
are no overlapping application-source files requiring a semantic resolution.
The version remains 0.22.3, matching the new base.

The UX fix maps with `=` from `2a24d3faf` to `692b33fe5`. Esbuild's regenerated
story import closure, plus the served stylesheet, contains 52 paths, all
byte-identical to the retained capture input. The manifest's top-level stamps
now name the post-rebase verification tree, **not** a fresh whole-set capture;
`refreshedAtHead` points to the equivalent reachable fix, with the original
capture SHA and time preserved in the prose. This does not refresh other
historical evidence.

Recovery used the browser TOOL on the worktree's existing Storybook at :6070,
verified its process cwd, captured and actually viewed:

- `ux2-browser-command.png`: command story in the default `localOperatorDark`
  theme, visibly `Enter completes the command.` / `Click completes /team.`.
- `ux2-browser-narrow.png`: argument story at `args=theme:localOperatorLight`,
  330 CSS-pixel fixture width; both footer lines fit and the selected model and
  completed-click action remain readable. Unlike the predecessor's cropped
  narrow frame, this full browser viewport shows the entire popup.

These PNGs were captured at `e8e8b8ad1` via the browser tool; they are separate
from the attributed predecessor WebP set. Their source pixels are 2880×1634.
No aborted-press, keyboard, or live backend admission is proved by these stills.

## Sequential fast gates

Run at `e8e8b8ad1` (later changes are documentation and PNGs only):

| Command | Actual result |
| --- | --- |
| `pnpm lint` | exit 0; 506 files, 33 warnings, no fixes applied |
| `pnpm check-types` | exit 0; main and renderer TypeScript checks |
| `pnpm check-themes` | exit 0; 12 themes current, 2303 contrast assertions, no exceptions |
| `env -u NODE_TEST_CONTEXT node scripts/run-desktop-tests.mjs --test-concurrency=1 scripts/slash-token.test.mjs scripts/slash-rank.test.mjs scripts/slash-submit.test.mjs scripts/slash-contract.test.mjs scripts/slash-row-format.test.mjs scripts/canonical-chat.test.mjs` | exit 0; 93 tests passed, 0 failed/skipped; 772 ms |

Exact local logs are under `/tmp/pr143-recovery-gates/`. No whole-tree image
histogram sweep, full desktop suite, or new build was run in recovery; earlier
full-suite evidence remains attributed to its earlier head.

## Live discovery and final U13 correction

The initial 93/93 pass did not prove the rendered error. The browser's actual
`/usage\nrecovery U13 refusal probe` send reached `/messages`, returned 422, and
retained the full draft, but rendered `The request has invalid fields.` instead
of the store's actionable sentence. `chat-page.tsx` prioritizes the caller's
catch over `draft.error`; the initial fix changed only the latter.

`aad5accb134ab342cca952218f590d1f023f212a` fixes that exact boundary: the store
throws the classified `DesktopControlError` with the same 422 status and the
original transport error as its cause. The caller receives the same code/copy
as the persisted draft, so retention semantics remain unchanged. The regression
asserting the thrown code/message/status/cause failed before (`actual undefined`,
expected `leading_slash_message`, exit 1) and passed afterward. All four fast
gates above were then repeated sequentially: lint exit 0 (33 warnings), types
exit 0, themes 2303 assertions, and 93/93 tests in 625 ms. Exact logs:
`/tmp/pr143-recovery-gates/final-*.log`, plus `u13-before.log`.

After a full browser reload (the HMR pass retained old caller state), sending
`/usage\nrecovery U13 verified after reload` again produced **422** from the
isolated backend. The actual form text was:

> A message can't start with / — that is a command. Move it below your text,
> or send it on its own.

Both draft lines remained in the composer; `Send it again` was absent.
`ux2-live-refusal-after.png` was captured via the browser tool and visually read.
The attempted `ux2-live-refusal-before.png` is **not a valid comparison still**:
a delayed welcome-tour overlay obscured the form. It is retained and disclosed,
not represented as a clean before frame; the before state is evidenced by the
browser text read, the 422 log, and the failing regression above. The unrelated
conversation-history loading placeholder persisted throughout this inherited
QA harness; this is not evidence of a healthy transcript load or a model turn.

A subsequent actual row click was also exercised: typing `/usage` rendered
`Enter completes the command. Click runs /usage.`; a completed click on
`li[role=option]` posted `/commands` with `command: usage`, empty args, returned
**200**, and opened the `Provider usage` dialog (`Cached report, just now.`).
A press-drag-release-outside gesture cannot be produced by this browser tool's
current action schema, so aborted-pointer behaviour remains unobserved directly.

## Independent delta review setup

- Live renderer: `http://localhost:5317/#/chat/03f67bc884bc` (synthetic `plain
  probe` session). The browser tool accepted this origin without an approval
  blocker; onboarding was skipped through the real UI.
- Start/restart only this recovery renderer with
  `bash /tmp/pr143-recovery-gates/start-vite.sh`. Its Vite config is
  `/tmp/qa-vite2/vite.pr143-recovery.config.mjs`, rooted at this worktree. It
  uses the prior QA backend on :18762 through its logging proxy on :18763,
  `/tmp/qa-slash2/home` and `/tmp/qa-slash2/run`, and strips all CMUX_/LOP_
  inherited variables. It does not use the operator's backend or sessions.
- Prior approved origin :5311 can be reused by QA after identifying its listener;
  recovery did not stop or reconfigure that listener. Only this new :5317 Vite
  process was started. Existing QA backend/proxy processes were reused.
- Storybook: `http://localhost:6070/iframe.html?id=chat-slash-completion--command-phase&viewMode=story`
  and `...id=chat-slash-completion--argument-phase-narrow-composer&viewMode=story&args=theme:localOperatorLight`.
- Backend status log: `/tmp/qa-slash2/backend.log`; mapped request bodies:
  `/tmp/qa-slash2/desktop-ops.log`. No tokens belong in evidence or PR comments.
- Code delta: initial remediation `692b33fe5`, final propagation fix `aad5accb1`;
  one convergence pass for the required replay, scoped to its two overlap files.

## Scope and remaining validation

`2a24d3faf` (rebased as `692b33fe5`) implements U10 (click guidance from the
dispatch predicate), U11 (completed click; mousedown only preserves focus), and
the store half of U13. `aad5accb1` completes U13's caller-visible refusal copy.
The backend's leading-slash rejection policy is unchanged. U6/U9/U12 remain
previously deferred UX items, not silently marked fixed.

Previous code round 4, QA round 2 and design round 2 describe the previous head.
They are not automatically re-pinned to this remediation. Independent delta
review must cover the added footer, completed click, and refusal guidance.
The popup stories are fixture-based visual evidence; they do not prove live
message admission, backend side effects, or aborted-pointer behaviour.
