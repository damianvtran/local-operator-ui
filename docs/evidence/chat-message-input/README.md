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
