# A cancelled /credential capture stays masked (fix/credential-esc-masked)

Rendered stills for the Esc fix in the composer's `/credential` capture. Each frame
shows the composer and, underneath, the live
`localStorage["conversation-input-store"].state.inputByConversation["esc-evidence"]`
entry. That entry is the draft store `persistDraft` writes, read back by a 150 ms poll
in the frame itself.

## What these frames are

`main-` is `origin/main` at `705e0d34d7`. `fix-` is this branch. Each side ran in its
own Storybook (ports 6120 and 6119), with the same throwaway story file in both trees.
The file was never committed. The play function does the following:

1. Clears the draft store in a story `loader`, before render, so no run inherits the
   previous one's draft.
2. Types `deploy with /credential dummy-not-a-secret-123` into the shipped composer
   with `userEvent.type`. That is a real keydown path, not a prop.
3. Presses Esc 0, 1 or 2 times.
4. Clicks the store readout, which blurs the composer.

The value is an obvious dummy. Frames were taken in the operator's own browser, through
the harness's `browser` tool, at 1024 x 576 CSS px.

| Pair | main (`705e0d34d7`) | this branch |
| --- | --- | --- |
| before Esc | box masked, draft `"deploy with /credential "` | identical |
| after one Esc | box shows `dummy-not-a-secret-123` as text; draft `currentInput` holds it, `unredactedChars: 22` | box still masked, notice `still masked — Esc again discards it, Enter turns it into a pill`; draft `"deploy with /credential "`, `unredactedChars: 0` |
| after a second Esc | unchanged from one Esc: plaintext still persisted | cells and value gone, inert token left; draft `"deploy with /credential "` |

`red-on-main.log` is the four new composer cases run against `origin/main` before the
fix. All four fail, and the blur case fails because the plaintext is already in
`localStorage`.
