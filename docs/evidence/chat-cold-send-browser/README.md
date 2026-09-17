# Cold-send remediation: real-browser evidence

Nine supplementary, **not swept**, full-pane captures in `localOperatorDark`.
The coder (`openai/gpt-6-astra`) captured every original PNG through the Local
Operator **browser tool**, then viewed each image. These WebPs are lossless
conversions at the original 2880 x 1634 device pixels (1440 x 817 CSS viewport).
No capture-evidence/CDP/Playwright/Puppeteer driver was used in this pass.

**One frame has been re-shot since, and this is the only exception to the above.**
`admission-timeout/` was re-taken by PR #278's round-4 remediation, because it
was the set's only picture of the held-message card and it showed the copy that
PR retired. It was shot through the app's own failure path instead of the
browser tool: the worktree's own build launched headless as a real Electron app,
an isolated `local-operator serve` behind a tap that holds the first
session-`/messages` POST past the app's own 20 s control budget, captured by the
app's `capturePage` at the same 2880 x 1634 device pixels (1440 x 817 viewport).
Every other frame here is untouched.

**The user bubble's text measure moved under that frame afterwards, and that is
disclosed rather than re-shot.** `main`'s #290 (the user-bubble measure) landed
after the frame was re-taken: it removed the `.lo-measured .lo-markdown {
max-width: 62ch; margin-inline: auto }` rule and the `lo-measured` class from
both components that render a user bubble (`message-paper.tsx` and
`canonical/canonical-transcript.tsx`), and this frame contains one. What the
frame is evidence for is unchanged - the deadline sentence, `A message is still
being held...` and the `Restore message` / `Discard message` controls all still
render, and no copy commit is in that range - so only the bubble's measure is a
picture of the previous build. It was not re-shot because the rig that took it
is scratch under `/tmp` and was reclaimed with the rest of that round's scratch,
and its reconstruction (isolated daemon, a discovery record the app will attach
to, and the tap) is refused by the app's own attach check: the seeded daemon is
classified `heartbeat-stale` and the app waits rather than attaching, so the
deadline state is never reached. No sweep can catch this - the set is
`supplementary` and not swept - which is why it is written down here, and why
rebuilding that rig as a committed script is worth doing before the next pass.

## Provenance and scope

The worktree started at `7550bf1ae`, already containing the round-2 code and the
merge of main `142e86904` (`6e2a015da`). The first six states below were captured
on that inherited implementation. The last three were captured after the
frame-only completion fix in the accompanying commit, while that three-file
code/test delta was still uncommitted. Formatting-only changes followed; no
rendered code changed after those captures. The manifest source/script hashes
identify the resulting reviewed tree, **not a claim that every historical frame
in this repository was re-captured on it**.

| Directory | Actual state and result |
| --- | --- |
| `idle-before-send` | New draft, pre-send subtitle, normal composer. The pre-existing draft skeleton is visible; this is not proof of a greeting. |
| `admitted-echo` | Real message POST held by a test proxy: sent text visible, `waiting for the agent 9s`, matching composer hint, subtitle `Starting the session`. U1/U2 fixed. |
| `admission-timeout` | The tap's delay exceeds the desktop request deadline: wait withdrawn, held-message recovery offered, visible echo makes the transcript reference truthful. This is a failure frame, **not successful settle**. RE-SHOT by PR #278's round-4 remediation (`be66aa465`), so it renders the copy the app ships - the deadline sentence (`The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting...`), `A message is still being held, so a different message cannot be sent yet.`, and the controls `Restore message` / `Discard message`. The wording it replaced (`An unsent message is still being held`, `Restore unsent message` / `Discard unsent message`, and the transport's generic `The backend could not complete this request...` where an expired deadline now answers) is the D1/D9 copy this PR removed, which `send-error/README.md` records as `measured as ...; renamed by #278's design round 2`. The sidebar's `Not connected to the backend - showing the last known state.` line is this rig's own state - the tap fronts the daemon on another port - and is not part of what this frame is evidence for. |
| `restored-message` | Clicked Restore: exact sent text returns to the editable composer, recovery copy now refers to that composer. |
| `successful-resend` | Delay removed; clicked Send: real mock-provider answer arrives, echo coalesces, normal composer returns. |
| `refusal-before-fix` | **Reproduced Q4 on inherited `7550bf1ae`:** `[refuse]` ends the turn, yet `Stopped with an error` and `waiting for the agent 6s` coexist. The inherited raw-notice guard did not cover the real frame-only outcome. |
| `refusal-after-fix` | New `[refuse]` turn after the completion-anchor fix: incident present, no wait line, normal composer; remained retired when re-read minutes later. |
| `pending-question` | New `[bash:2]` turn: approval outranks the wait; composer says `Answer the question above`. |
| `question-answered` | Typed `yes` and clicked Send: actual benign `sleep 2` completes and mock answer arrives; composer returns to normal. |

The before/after Q4 pair is the regression evidence. An additional immediate
post-fix frame caught the normal hydrating skeleton before the incident arrived;
that transient was inspected, not passed off as proof that the incident cleared.
A retry on the already-failed session was also run, but its screenshot landed
after the second refusal; it is not claimed as a photographed pending-retry
window. The unit guard separately covers stale anchors and acknowledged outcomes.

## Real path and isolation

Renderer `http://127.0.0.1:5287` serves this worktree's actual React application.
A test-only HTML preload stand-in supplies non-transport Electron APIs; it does
**not** define `window.api.desktop`. The real browser-development transport is
therefore renderer → `/__desktop` → Node's real desktop proxy → isolated backend.
The bearer stays in Node, never in the browser. `/health` is a real same-origin
proxy, not a fabricated healthy response.

Owned proxy `11917` targets the prior UX run's isolated backend on `11911`, whose
HOME/config are under `/tmp/ux-155`; the operator's live backend is untouched.
The new Vite/proxy processes have fresh HOME/config and scrubbed `CMUX_*`, `LOP_*`
and `LOCAL_OPERATOR_*` inheritance before setting their own isolated variables.
Backend uses the test/mock provider; these are real HTTP/SSE flows, not live-model
or packaged-Electron validation.

The ignored harness is under `node_modules/.cache/cold-send-astra/` in this
worktree. `control.json` changes the next message POST only:

- `{"delay":0,"fail":false}`: normal forwarding (the handoff default).
- `{"delay":15000,"fail":false}`: a bounded pending window below the request deadline.
- `{"delay":30000,"fail":false}`: deliberate admission timeout/recovery.
- `{"delay":1000,"fail":true}`: explicit 500 refusal after 1 s.

Coordinate scenario windows when sharing this server; each reviewer owns a
separate browser-tool tab. Do not stop another reviewer's services or change the
operator's browser permissions. The implementing coder closed its owned tab.

## Required merge after capture

The final pre-push fetch found GitHub **DIRTY** against `8d019993e` (newly merged
composer tabs, #175). The merge preserved both sides; only manifest metadata
conflicted. The first nine images above **precede that merge** and are not
re-stamped as merged-composer screenshots.

A first attempt at post-merge verification hit two browser failures in sequence:
`cmux.sock: Connection refused`, then (after `lop browser status` reported the
extension connected again) repeated `chrome.debugger.sendCommand(Runtime.enable)`
stalls. Both are recorded as encountered, not hidden. The extension recovered on
its own and post-merge verification then **succeeded**, adding two frames:

| Directory | Actual state and result |
| --- | --- |
| `merged-idle-draft` | Merged tree, New draft: main's composer-status row and tab affordances render alongside the pre-send subtitle and normal composer. No regression from the fix. |
| `merged-refusal-after-fix` | Merged tree, new `[refuse]` turn: `Stopped with an error` with **no** rung and composer back to `Ask me for help`. The Q4 fix still holds on the merged composer. |

These two are the post-merge rendered proof. The renderer overlap was separately
exercised by the merged-tree scoped suites below, and the FULL evidence corpus
was not re-walked.

## Geometry and gates

Read-only DOM instrumentation was served by the test harness and collected with
browser-tool console logs; it never clicked, typed, navigated or captured a frame.
During the pending interval: working line x=564, y=626.203, width=852,
height=17.398 CSS px; its scroll container clientHeight=scrollHeight=577 with
`overflow-y:auto` (no scrolling needed). Consecutive samples at 14–18 s kept the
same geometry and an editable, non-read-only textarea with the busy placeholder.
On failure the line became null and placeholder returned to `Ask me for help`.
The before/after header keeps its two-line height; no subtitle-height collapse.

Final delta gates: `pnpm lint` exit 0 (34 existing warnings), `pnpm check-types`
exit 0, `pnpm check-themes` 2303 assertions/12 themes, and merged-tree scoped
tool-row, canonical-chat, echo-delivery, transcript-reducer, session-switch and
composer-tabs tests **234 passed, 0 failed**. Targeted `provenanceFailures`
**PASS (0)** and `assertFramePaints` **19/19** on the changed frames at the
merged head. Fresh isolated HOME/config; inherited LOP/CMUX scrubbed.

The full ImageMagick corpus walk remains **BLOCKED/not rerun** under the shared
host resource budget. The targeted provenance/paint result is recorded on the PR;
it is not a full-corpus claim. The legacy composer/rung frames in neighbouring
directories were inspected and retained with their original capture provenance,
not substituted for the browser-tool evidence in this directory.
