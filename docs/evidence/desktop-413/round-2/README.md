# Round-2 remediation evidence — the Q-7 slash-command trap

These four frames are the drive-through for Q-7, the round-2 merge blocker: the
character cap was enforced on `sessions.message` and NOT on `sessions.command`,
and the command path additionally DISCARDED the user's draft rather than
retaining it.

Captured by `../harness/capture-q7.mjs` against a real `local-operator serve`
**v0.53.3** on `127.0.0.1:8961` (my own port, started and stopped by me, with an
isolated `LOCAL_OPERATOR_CONFIG_DIR` so no session was written to the operator's
store), with the renderer served by `../harness/chat-413.vite.mjs` on port 5311
and driven over raw CDP — the same mechanism as `scripts/capture-evidence.mjs`.
No browser engine was installed; the browser tool was down session-wide.

| Frame | What it shows |
| --- | --- |
| `q7-session-open.png` | An ordinary message sent first, so a real conversation exists. Without it a slash command takes the earlier "needs an open conversation" branch and never reaches the budget check at all. |
| `q7-composed.png` | `/theme ` + 200,001 characters staged in the composer (200,008 including the command word). |
| `q7-refused.png` | The refusal: *"This command is 200,001 characters, more than the 200,000 one command can carry. Shorten it, or put the text in a message instead."* — it names CHARACTERS, and **the composer still holds all 200,008 characters**. |
| `q7-after-shortening.png` | The remedy the sentence asks for: shortened to `/theme dracula`, sent, and the command RAN — theme picker open with Dracula selected, composer cleared. The refusal is escapable. |

Before this commit the same input produced *"/theme could not run: Invalid
desktop operation."* with the composer emptied.

## Two things worth knowing about how these were taken

Both were caught because a reading that looked like a pass was checked rather
than trusted, and both would have produced a false PASS:

1. **The onboarding wizard.** A first-run profile raises a six-step "Connect a
   provider" dialog over the composer, with no skip control. With it up, every
   selector addresses nothing and the run reports a zero-length composer — which
   is indistinguishable from the draft-retention check passing. The harness now
   seeds the app's own persisted completion flags and then ASSERTS the dialog is
   gone before measuring anything.
2. **No open conversation.** A slash command with no session is refused by an
   earlier branch, correctly, and a run that stopped there photographed a clean
   composer while never reaching the code under test.

The harness also enables CDP `Emulation.setFocusEmulationEnabled` before
measuring: an unfocused window throttles timers, so anything time-driven (the
pending state on the send path here) reads as stuck when it is only starved.

## What these frames do NOT prove

- **Packaged Electron IPC.** The dev-server route calls the same
  `requestDesktop` in `src/main/desktop-transport.ts` that Electron's IPC
  handler calls, but the IPC channel itself and `electron-builder` packaging are
  unexercised — no packaged build was available.
- **The native base64 branch.** `Uint8Array.fromBase64`/`toBase64` do not exist
  in the shipping Electron 35 (Chromium 134), so the loop fallback is what runs.
  Both branches were proven by feature-deletion, not by running Chromium 140+.
- **A model reply.** This backend has no provider configured, so the banner
  visible in the frames is the provider notice. It is unrelated to the budget
  path: the Q-7 refusal is the transcript line, raised client-side before any
  request is made.
