# The 4px tier, rejected — the alternative, photographed

One frame: `chat-tool-rows--operator-spacing-cases` at 1024x860,
`localOperatorDark`, captured with `GAP.trace` set to `mt-1` (4px) instead of
the shipped `mt-0.5` (2px). Compare it against
[`../chat-tool-rows/operator-spacing-cases/localOperatorDark.webp`](../chat-tool-rows/operator-spacing-cases/localOperatorDark.webp)
— same story, same viewport, same theme, one value different.

## Why it is committed

The decision this directory exists to support is not "2px is enough air", it is
"2px and **not** 4px". Both halves are load-bearing, and the second half is the
one that was argued in prose and nowhere photographed: `transcript-rows.ts`, the
tool row's own comment and the tool-rows README all say some version of "at 4px
the rows float as separate items again", while the repository contained no frame
at 4px at all. Every other frame here is 20px (the gap-at-zero era, in
`spacing-uniformity` and `tool-rows-baseline`) or 22px (the shipped hairline).

So the comparison that decides the tier could not be checked by looking — in an
evidence set whose own standard is that a spacing claim is checked by looking.
A design round is entitled to ask "how do you know 4 was worse?" and get a
picture rather than a sentence.

## What it shows

At 4px the run reads as a **list of items**: each row carries visible air on
both sides, and the eye stops at every boundary instead of running down the
column. At 2px the same run reads as one block with legible seams, which is what
the operator asked for ("a small amount of padding like 2px between subsequent
tool call lines") and what the tightening before it had over-corrected to zero.
The numbers behind the frames: 4px gives a 24px pitch on a 20px row, 2px gives
22px, and the row's own text-to-text ground moves 8px → 12px (+50%) versus
8px → 10px (+25%).

## How it was produced, and why a sweep cannot retake it

`GAP.trace` in `src/renderer/src/features/chat/canonical/transcript-rows.ts` was
set to `["mt-1", "mt-1"]`, the frame captured with

```
node scripts/capture-evidence.mjs <storybook-origin> \
  --only=chat-tool-rows--operator-spacing-cases \
  --themes=localOperatorDark --allow-backend
```

and the tier immediately reverted — verified byte-identical to its reviewed
value afterwards. It is therefore a picture of a state the app **does not
ship**, which is exactly why it is declared `supplementary` in
`manifest.json` rather than counted as a swept surface: a sweep runs against the
committed tree and can only ever produce the 2px frame. Deleting this directory
loses the only rendered record of the rejected option.

One theme rather than twelve, deliberately: the subject is a distance, and a
distance does not vary by palette.
