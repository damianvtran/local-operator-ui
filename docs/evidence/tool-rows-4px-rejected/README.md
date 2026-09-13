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

## What it shows, and what it does not

The honest reading, measured on block (a) of both frames over the same crop
(`x185–1000`, clean ground between consecutive text bands): **2px leaves 11px of
ground, 4px leaves 13px** — an 18% difference, on a pitch of 22 against 24
(+9%). The glyph tops confirm the pair is genuine and controlled: `114, 136,
158, 180` here against `114, 138, 162, 186` in the 4px frame, and the other two
blocks anchor at identical y in both.

So the two frames read as **the same block at two densities**. At 4px the seams
are wider and carry more of the separation; at 2px they are tighter and the row's
own leading carries more of it. The design round looked at both at 1×, 2× and 3×
and found no change of *register* — the 4px column still scans as one list, and
the 2px column is not fused — so this README no longer claims one. An earlier
draft said 4px "reads as a list of items… the eye stops at every boundary",
which invites a reviewer to look for a break that is not there and spends the
artifact's credibility to make a point the decision does not need.

What the decision does rest on, and what this pair supports: 2px is the
**smallest step that reinstates a boundary at all** (at `deviceScaleFactor: 1`,
1px is an antialiasing edge rather than a gap), it is the step `TraceGroup`
already composes with, and it is what the operator asked for — "a small amount
of padding like 2px between subsequent tool call lines". 4px is not wrong-looking
in this frame; it is simply looser than the request, and further from the density
the tightening before it was reaching for.

## How it was produced, and why a sweep cannot retake it

**Read the whole procedure before running any of it.** `capture-evidence.mjs`
derives its destination from the story id — `docs/evidence/<prefix>/<leaf>/
<theme>.webp` — and has no output-directory flag (`--only`, `--themes` and
`--allow-backend` are the entire CLI). So the capture step below writes to
`chat-tool-rows/operator-spacing-cases/localOperatorDark.webp`, **the shipped
2px frame**, and the file here arrived by being moved afterwards. Running step 2
on its own overwrites the shipped frame with a 4px one and leaves this directory
untouched, which is the opposite of what a reader reproducing this wants.

1. Set `GAP.trace` to `["mt-1", "mt-1"]` in
   `src/renderer/src/features/chat/canonical/transcript-rows.ts`, and start
   Storybook against that tree.
2. `node scripts/capture-evidence.mjs <storybook-origin>
   --only=chat-tool-rows--operator-spacing-cases --themes=localOperatorDark
   --allow-backend`
3. **Move** the frame it wrote into this directory:
   `mv docs/evidence/chat-tool-rows/operator-spacing-cases/localOperatorDark.webp
   docs/evidence/tool-rows-4px-rejected/localOperatorDark.webp`
4. Revert `GAP.trace` to `["mt-0.5", "mt-0.5"]`, then **re-capture** the shipped
   frame with the same command as step 2 to restore the 2px original that step 2
   overwrote. Confirm the tier is back (`git diff` on that file is empty) before
   trusting anything else in `chat-tool-rows/`.

Steps 3 and 4 are the whole reason this note is long: skipping either leaves the
evidence set holding a 4px frame under a path that claims to be the shipped one.

The result is a picture of a state the app **does not ship**, which is why it is
declared `supplementary` in `manifest.json` rather than counted as a swept
surface: a sweep runs against the committed tree and can only ever produce the
2px frame. Deleting this directory loses the only rendered record of the
rejected option.

One theme rather than twelve, deliberately: the subject is a distance, and a
distance does not vary by palette.
