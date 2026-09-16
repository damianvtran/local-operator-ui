# The slash popup's states

Frames of the composer's slash list: the command list, the argument list, and the
two positions a command word can be typed in.

These are **Storybook frames of the production `SlashSuggestionsPopup`**, driven
by a completion state the stories hand it, and the state each one carries is the
state the real hook derives for that draft (the fixture cannot invent a phase the
hook would not produce — where it could, the story says so).

Two of them belong to `/compact`, and both exist because a review round asked for
the picture rather than the argument:

| set | what it is |
| --- | --- |
| [`compact-row`](compact-row/) | The row the operator's own gesture lands on, with the description the shipped catalogue carries (`Compact the context now`) and its click footer. The footer reads `Click completes /compact.` because `pointerPickRuns` is false for `session.compact` — a stray click must not spend a pass — so the click completes the word and a second Enter runs it. |
| [`inline-mid-draft-pair`](inline-mid-draft-pair/) | Two cases, because the pair is the finding. Case 1 is `fix this /team` with the roster open above it: real behaviour before round 1's fix, when the list opened on the tokenizer alone while the submit planner read that word as prose — a footer promising a run that never happened, and a first Enter that mutated the draft instead of sending it. Case 2 is the same draft on this head: no list, because `caretPhase` now asks the planner's own positional question (`commandWordOpensDraft`). |

The rule behind case 2 is pinned in `scripts/slash-token.test.mjs`; a lone
composer story cannot be captured on its own (the rig's element floor is nine
elements and a bare composer counts five), which is why the after-state is the
second case of a board rather than a frame of its own.

`RECOVERY.md`, `MERGE-175.md` and `ROUND3-U14.md` are the notes this set carried
before this change, kept as they were written.
