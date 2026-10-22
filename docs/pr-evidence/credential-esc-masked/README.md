# A cancelled /credential capture stays masked (fix/credential-esc-masked)

These are rendered stills for the Esc fix in the composer's `/credential` capture.
Each frame shows the composer and, underneath it, the live
`localStorage["conversation-input-store"].state.inputByConversation["esc-evidence"]`
entry. That entry is the draft store `persistDraft` writes, and a 150 ms poll in the
frame reads it back.

## How they were taken

A throwaway story file, never committed, drives the shipped composer in Storybook:

1. A story `loader` clears the draft store before render, so a run never inherits
   the previous run's draft.
2. `userEvent.type` types `deploy with /credential dummy-not-a-secret-123`. The value
   is an obvious dummy.
3. The play presses the keys named in each frame's label.

Frames were captured in the operator's own browser through the harness `browser`
tool, at 1024 x 576 CSS px. The committed `CredentialEscape*` stories in
`message-input.stories.tsx` drive the same states and assert on them.

### `main-*`: `origin/main` at `705e0d34d7`, the bug

| Frame | Box | Persisted `currentInput` |
| --- | --- | --- |
| `main-before-esc` | masked | `"deploy with /credential "` |
| `main-after-one-esc` | **`dummy-not-a-secret-123` as plain text** | **`"deploy with /credential dummy-not-a-secret-123"`**, `unredactedChars: 22` |
| `main-after-two-esc` | same as above | same as above |

### `r2-*`: this branch after round-1 remediation

| Frame | Box and sentence | Persisted `currentInput` |
| --- | --- | --- |
| `r2-before-esc` | masked; `masked as you type — Enter makes a pill, Esc twice discards` | `"deploy with /credential "` |
| `r2-held-focused` | identical cells, span on the dashed not-stored edge, caret still in the box; `Esc again discards it — still masked, Enter makes a pill` | `"deploy with /credential "` |
| `r2-held-blurred` | same, after a blur | `"deploy with /credential "` |
| `r2-held-then-typed` | one more cell; typing sentence back, accent wash back | `"deploy with /credential "` |
| `r2-held-then-enter` | pill `#1 · 22 chars`, so the held value was never lost | `"deploy with [Credential #1, 22 chars] "` |
| `r2-discarded` | cells gone, inert token; `credential discarded — nothing was stored or sent` | `"deploy with /credential "` |
| `r2-typing-narrow` / `r2-held-narrow` | 440 px small-view column, before and after one Esc | `"deploy with /credential "` |

At the 440 px rung the two sentences occupy one line each. The textarea's top edge
measures 86.9 px in both frames, and the notice box measures 392 x 23.5 in both, so
the first Esc changes the words and nothing in the layout. With the earlier 70-character
typing sentence, the textarea sat at 106.4 px and the notice was 43 px tall: the press
moved the box by 19.5 px.

## `red-on-main.txt`

This file holds the branch's two test files run over a `git archive` export of
`705e0d34d7`. It keeps only the failure blocks and the totals.

- **Composer suite: 8 failures.** Seven are the new Esc cases. The blur leg fails
  with `blur writes nothing`, because the plaintext is already in `localStorage`. The
  eighth is the notice-copy pin.
  - This suite needs a copy shim on main's module to bundle: the two new notice
    strings and `escapeHolds = () => false`.
  - The shim changes no behaviour. Main's Esc logic is untouched, and that logic is
    what fails.
- **Capture-model suite: 4 failures.** These run without the shim.
