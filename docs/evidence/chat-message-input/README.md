# Composer states for cold-send review

Eight inherited Storybook frames: four states at 1024 x 300, each in
`localOperatorDark` and `localOperatorLight`.

| State | Visible placeholder |
| --- | --- |
| `idle` | Ask me for help |
| `awaiting-reply` | Waiting for the agent |
| `awaiting-reply-transport-down` | Ask me for help (wait claim withdrawn) |
| `awaiting-answer` | Answer the question above |

These files were produced by the earlier interrupted coder's legacy repository
capture harness and were untracked at the handoff on `7550bf1ae`; the inherited
manifest records that narrowed pass. The finishing Astra coder preserved and
visually inspected all eight, but **did not produce these with the browser tool**
and does not re-label their provenance. The transport-down story is a controlled
presentation fixture, not a live disconnect test. Focus rings belong to the
focused, editable composer; Send remains unavailable when the fixture is busy.

The current code still contains these Storybook surfaces. The subsequent
completion-anchor fix does not change their non-failure inputs or styling.
New real-browser full-pane evidence (including the composer, pending question,
recovery and before/after failure) is in
[`../chat-cold-send-browser/README.md`](../chat-cold-send-browser/README.md).
That separate evidence, rather than these legacy images, carries the new live
validation claim. D3's previously missing committed state pictures are now here.

## The inline credential capture's five states

Sixty frames the eight above do not account for: five states of the composer's
inline `/credential` gesture (`docs/design/composer-credential-capture.md`), each
in all twelve themes, at the same 1024 width.

The exact command that wrote them, from the tree this branch commits:

```
npx storybook dev -p 6018 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input--credential \
  --allow-backend http://127.0.0.1:6018
```

6018 and not the default 6017: a sibling worktree's Storybook already held the
default. `--allow-backend`
is the flag a narrowed run needs because the operator's own app is listening on
1111, and no surface here talks to it. The run was narrowed to these five stories
and to this surface's directory; `manifest.json`'s `partialCapture` and the
branch's own `credentialCapture` record the pass.

### Round 1: the WHOLE surface, re-taken

A frame is evidence about a tree, and this branch's round-1 remediation changed
the composer's own layout in every state — the notice line now holds its space
whether or not it has a sentence (`docs/design/composer-credential-capture.md`
§7), so the textarea sits at the same `y` idle, armed, masked and minted. That is
a change to the ordinary composer as much as to the gesture, so all SEVENTEEN
states in this directory were re-taken rather than the five credential ones: 204
frames, twelve themes each.

```
npx storybook dev -p 6041 --host 127.0.0.1 --no-open --disable-telemetry
node scripts/capture-evidence.mjs --only=chat-message-input \
  --allow-backend http://127.0.0.1:6041
```

`--only` matches the story ID PREFIX, so one run covers the surface; the port is
again not the default because a sibling worktree held it. The pass is recorded in
`manifest.json` under `partialCapture` (`refreshedFrames`, `refreshedAtHead`),
which is what a reader follows to tell a narrowed re-take from a sweep.

| Frame (`<theme>.webp`) | State, and what the frame is for |
| --- | --- |
| `credential-armed/` | `/credential` typed and no space after it, so the next space opens the capture. The notice line says so — the TUI's own sentence — which is what makes the state legible instead of looking like ordinary prose. |
| `credential-masked/` | The space has opened the span and every character since is ONE MASK CELL. Nineteen cells against a nineteen-character value: the length is the receipt the pill will carry, and it is the operator's only integrity check once the value can never be displayed again. |
| `credential-pill-mid-prose/` | Enter minted the pill rather than sending, and the sentence continues after it — the gesture's whole shape ("hand over a secret, then describe it"). |
| `credential-pill-at-line-start/` | The same pill at the head of the line. The token was consumed at mint time, so this is prose and not a slash command: the leading-slash path cannot fire on it. |
| `credential-escaped/` | Esc cancelled and the characters came back as ORDINARY TEXT — the one exit that leaves a secret in the composer, with the warning sentence that says so. The canary reads `sk-live-CANARY-4417`. |

**These frames are driven by real keystrokes**, not by a prop that fakes the
state: each story's `play` types into the shipped composer with `userEvent.type`
and fails (taking no frame) if its state did not arrive. That matters here more
than for a colour change, because every rule this feature rests on lives in the
keyboard path — the mask, the positional mirror, the mint, the Escape restore.
The one frame where the canary is visible is `credential-escaped`, and it is
visible there because the operator asked for it with Esc; in the other four the
value is held outside the document and appears in no frame.

### What these frames do NOT prove

- **Not the store, and not the model's prompt.** The frames end at the composer.
  What reaches the session's credential store, what the citation says to the
  model, and the notice the operator hears are asserted by
  `scripts/credential-capture.test.mjs` (the pure module, 57 cases) and
  `scripts/credential-composer.test.mjs` (the shipped component's React wiring
  under jsdom, 13 cases), and are the QA round's business on the running app.
- **Not the paste route.** No frame here pastes; the paste capture, the
  append-into-a-span case and the blank-paste fall-through are the test file's.
- **Not the LAYOUT rule the re-take is about.** A still shows where the text
  sits; it cannot show that it sits in the same place in the state next to it.
  The reservation is pinned by geometry in the design round's own measurements
  (the textarea's `y` in idle, armed, masked and minted) and by
  `credential-composer.test.mjs`'s assertion that the notice SLOT is mounted in
  the idle composer, empty.
- **No focus ring and no caret.** A headless capture cannot show a caret, and the
  composer's `:focus-visible` ring belongs to the box, unchanged by this feature.
- **The pill's geometry is not restated here.** The pill is drawn by a
  background-only overlay behind the textarea, so a frame shows the pill and the
  marker text in their real positions; the box model that keeps the two aligned
  is shared by construction (`composerTextBox`) rather than measured in a still.
