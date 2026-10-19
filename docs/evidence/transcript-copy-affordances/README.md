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

### Rendered-frame index

All after frames were captured from the branch head in the running Storybook
(`http://127.0.0.1:6013`), through the production `CanonicalTranscript`; the
menu, selection and focus states are driven by the stories' own play steps
(real `contextmenu`, focus and selection events), not by a CSS class.

| Frame | Story | What it shows |
| --- | --- | --- |
| [`before-multi-answer.png`](./before-multi-answer.png) | `chat-canonical-message-actions--multi-answer` (main `bf24fa9e54`) | The invisible 28px row under the intermediate answer; the 44-66px prose-to-next-block gap |
| [`after-multi-answer.png`](./after-multi-answer.png) | `chat-canonical-message-actions--multi-answer` (branch) | The same turn at the same position with the row gone and the 12px `GAP.item` gap |
| [`after-focused-gutter.png`](./after-focused-gutter.png) | `chat-canonical-transcript-copy--focused-gutter` | The user message focused: Copy/Speak in the 32px turn boundary above the bubble, ring on the bubble only |
| [`after-response-gutter.png`](./after-response-gutter.png) | `chat-canonical-transcript-copy--resting`, `a1` clicked | An intermediate response focused: Copy-only gutter at the trailing edge, zero flow height |
| [`after-context-menu-prose.png`](./after-context-menu-prose.png) | `chat-canonical-transcript-copy--context-menu-on-prose` | Right-click on prose: Copy text / Copy as Markdown / Copy selection (disabled) |
| [`after-context-menu-tool.png`](./after-context-menu-tool.png) | `chat-canonical-transcript-copy--context-menu-on-tool-row` | Right-click on an expanded ledger row |
| [`after-selection-toolbar.png`](./after-selection-toolbar.png) | `chat-canonical-transcript-copy--selection-toolbar` | A partial selection raises the shared Copy/Speak strip |

### Measured in the browser (same run that produced the frames)

| Reading | Value |
| --- | --- |
| Intermediate answer row (`[data-record-id="a1"]`) | **22.4px** high; no `[data-lo-response-actions]` |
| Next record's top (`a2`) | 12px below `a1` — the `GAP.item` step |
| Response gutter (`[data-lo-gutter-actions]`) | `position: absolute`, **38x32px**, `opacity: 0` at rest, `1` once the row holds focus |
| User gutter (`[data-lo-user-actions]`) | `position: absolute`, **70x32px**, sits at y=44 while the bubble starts at y=76 (fully inside the 32px turn boundary) |
| Context menu | 224x104.5px portal, opened on the pointed line |
| Focus ring | `outline: none` on the row; 2px accent ring on the bubble/answer box |

The pixel readings are from this Storybook run; jsdom has no layout engine. The
native app was not driven for these frames; the stories mount the production
component and the interactions are real events, and QA's report states the same
limitation.

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
