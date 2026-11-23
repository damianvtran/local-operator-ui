# Jump to latest: the label's before and after

Rendered frames for the desktop jump-to-latest chip. The chip's behaviour changed
(the control now learns that output arrived while the reader is scrolled up, and
stays put while the transcript grows), and its label now names the action:
`Jump to latest` where it used to read `New activity`.

## What produced these frames

Storybook, through `scripts/capture-evidence.mjs` at two themes
(`localOperatorLight`, `localOperatorDark`), 900x620 CSS px, device pixel ratio 2,
with the frame timezone pinned to `America/New_York`. The story is
`Chat/Scroll to bottom` (`scroll-to-bottom-button.stories.tsx`), which mounts the
SHIPPED `ScrollToBottomButton` at the composer's top edge - the placement
`message-input.tsx` gives it - over skeleton rows.

```
# after half (branch head)
node scripts/with-storybook.mjs -- sh -c \
  'node scripts/capture-evidence.mjs "$STORYBOOK_ORIGIN" \
     --only=chat-scroll-to-bottom --themes=localOperatorLight,localOperatorDark \
     --allow-backend --theme-settle-ms=60000'

# before half: the same command in a detached worktree at the PR's base
# (a6358e47bc), with this story file and the capture script's two registered
# entries copied in unchanged
```

`--allow-backend` is the rig's own opt-in for a narrowed run whose stories never
call the backend; this story mounts no query and no transport, so no reply can
appear in a frame. The longer `--theme-settle-ms` is the documented knob for a
cold Storybook compile on a loaded machine (the first attempt failed the 10 s
theme guard with the iframe still compiling).

## The frames

| file | what it shows |
| --- | --- |
| `before-new-activity-{light,dark}.webp` | the base component with the new-activity state on: disc plus the old label, "New activity" |
| `after-new-activity-{light,dark}.webp` | the same state on this branch: disc plus "Jump to latest" |
| `before-idle-*.webp`, `after-idle-*.webp` | the quiet disc, which the change does not touch |

`before-idle-*` and `after-idle-*` are BYTE-IDENTICAL in both themes: the
resting control did not move, so the pair is a control for the label-only claim.
The new-activity pair differs only in the label's text.

## What these frames do NOT claim

- They are not live-app frames. They render the shipped control in its real
  anchor, not the chat page, which needs a daemon-backed conversation.
- The register that drives the label (new records appended, or the streaming
  tail growing, never an older page) and the snap-on-send are proven by
  `scripts/new-activity.test.mjs` and `scripts/jump-to-latest-wiring.test.mjs`
  at the source and in memory; the flow itself is for QA/UX to walk on the app.
- The new-activity state here is `args`-driven. It proves what the control looks
  like when that state is true, not that the state was reached by streaming;
  that half is the wiring pins and QA.
