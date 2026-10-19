# Transcript copy affordances

Evidence for the fix that removed the reserved action line under every settled
response and replaced it with overlays: a trailing gutter control on message
rows, a right-click menu on every transcript line, and the shared selection
toolbar on the transcript column.

## The defect, measured on `main` (`bf24fa9e54`)

Story: `chat-canonical-message-actions--multi-answer` (1024 x 560 story frame,
2560 x 1440 capture).

| Surface | Before |
| --- | --- |
| Intermediate answer row height | **54.4px** — prose 22.4 + `mt-1` 4 + the 28px `h-8` action row |
| Next record's start below the invisible toolbar | **12px** (`GAP.item`) |
| Visible prose-to-next-block gap | **44–66px**, against the 12px step the rhythm asks for |
| Cost of the invisible row | 32px per settled response (28px row + 4px margin), present at rest and while shown |

The before frame is [`before-multi-answer.png`](./before-multi-answer.png).

## The after shape

The action row under an intermediate response is gone; the closing answer keeps
its footer-line actions, which already existed. Every message-level row gets an
**absolutely positioned** gutter control instead, and the selection/menu surfaces
are overlays.

| Surface | After | Mechanism |
| --- | --- | --- |
| Intermediate answer row height | **22.4px** — its prose height, no toolbar | `AnswerActionRow overlay` (`absolute`), zero flow height |
| Prose-to-next-block gap | **12px** (`GAP.item`) | no reserved line between the prose and the next record |
| Saved vertical space | **32px** per settled response | 4px margin + 28px row no longer in flow |
| User row control | **0px layout**, in the 32px turn boundary above the bubble | `overlay` + `-top-8`, revealed by the focusable row's `group` |
| Selection toolbar | **0px layout** | shared `TextSelectionControls`, absolute |
| Context menu | **0px layout** | Radix portal; mounted only while open |
| Focus indicator | ring around the **message block** | row wrapper draws no ring (`focus-visible:outline-none`); the bubble/answer box draws the 2px accent ring |

The after frame for the focus state is `after-focused-gutter.png`, captured
from `chat-canonical-transcript-copy--focused-gutter` in the running Storybook
(after the remediation round: the gutter is opaque, the row wrapper draws no
ring, and the bubble carries the ring). The other after frames are the
manager's captures from `transcript-copy-affordances.stories.tsx`. The numbers
above are the structural arithmetic of the implementation.

## What the automated tests cover

`scripts/transcript-copy-affordances.test.mjs` mounts the real
`CanonicalTranscript` (jsdom) and asserts:

- zero `[data-lo-response-actions]` and zero `mt-1 flex justify-end` wrappers on
  the multi-answer turn; the intermediate response's control is
  `[data-lo-gutter-actions]` and carries `absolute`;
- the user row's control is absolute, the row is focusable, named and reveals
  under `focus-within`;
- right-click opens the menu on prose, a tool row, a fold header and a receipt;
  Copy as Markdown writes the record's own source (a fence and a list survive);
- `Shift+F10` opens a focused message's menu; `Mod+Shift+C` copies the focused
  message, or the selection when no row is focused;
- a partial selection mounts the shared selection toolbar, and the menu's
  `Copy selection` writes exactly the highlight.

`scripts/message-actions.test.mjs` pins the pure rule:
`transcriptRowActions` is true only for `user` and `assistant` rows.
