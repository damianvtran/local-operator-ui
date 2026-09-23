# The reader's foot, before the fix — the result as a block, and what it displaced

Eight frames, four surfaces, the two brand themes: the same stories the
`../chat-run-panel/` set holds after the fix, photographed against
`origin/main`'s own `run-child-reader.tsx`.

```
reader-result-inline/   2 frames    the same long result, as a `Result` BLOCK at the foot
reader-result-preview/  2 frames    the same result with the conversation gone: unbounded, no copy
reader-settled/         2 frames    the settled reader, block present
reader-live/            2 frames    the CONTROL: a running child, which paints no outcome block at all
```

## Why this set exists

The defect was an unbounded block at the foot of the page, and **the fixed frame
alone cannot show it**: a reader of `../chat-run-panel/reader-result-inline/` sees
a settled child whose result is its conversation's last message and whose foot
says nothing, and nothing in that frame records that the result used to be
painted twice — once as the conversation, and once as a clipped block under it.
These are the other half of the pair, and the pair is the claim:

| comparison | measurement (of 1,152,000 px) |
| --- | --- |
| `reader-result-inline` before vs after | **321,597** px dark / **309,163** light. Before, the `Result` block has taken the pane: the conversation above it is squeezed to the brief and a date, and the block runs off the bottom edge. After, the result IS the conversation's last row, bottom-pinned, and the foot carries only the read-only line. |
| `reader-result-preview` before vs after | **321,991** / **306,536**. Before, the block is unbounded and unlabelled — `Result` — over a body with nothing left to push back with. After, a `Result preview` inside `max-h-40 overflow-auto`, under one quiet line saying the full copy is in a conversation this page does not have. |
| `reader-settled` before vs after | **184,496** / **160,702**. The smallest of the three, and correctly so: the same block, over a shorter fixture result. |
| `reader-live` before vs after | **0 px in dark — byte-identical** — and **9,134 px (0.79%) in light**, which is this rig's own capture-to-capture noise (the sibling README measures ~0.65% of the column between two consecutive captures of ONE head). The CONTROL: a running child has neither a result nor an error on the wire, so no outcome block exists to remove, and its pair agreeing is what says the three pairs above moved because of the foot rather than because of the run. |

## How it was taken

1. The fix, the two stories and the fixture pair were committed first
   (`b7bed8d96`), so the story file and the rig are the tree under review and only
   the component differs between the halves.
2. In that checkout, the reader was replaced with
   `git show origin/main:src/renderer/src/features/chat/components/run-details/run-child-reader.tsx`
   — a working-tree edit that was never committed, and that was restored (with
   `git checkout`) before the frames were committed. The fixed frames of the same
   four stories were saved aside before the swap and put back afterwards, so the
   after half in `../chat-run-panel/` is the fixed tree's own capture and not a
   copy of anything.
3. The rig, one narrowed run per story, `--only=` appending into the set:

   ```sh
   node scripts/capture-evidence.mjs http://localhost:6087 \
     --only=chat-run-panel--reader-result-inline \
     --themes=localOperatorDark,localOperatorLight --allow-backend
   ```

   The frames the rig wrote into `../chat-run-panel/<story>/` were then moved
   here, and the saved fixed frames restored into that set.
4. `--allow-backend` because this machine has a backend listening on the app's
   configured port and every story here mounts the production `ChatHeader`, whose
   health poll reaches for it. The frames come from the fixtures and the reader's
   `previewPage` seam rather than from that backend, so declaring it is the honest
   option rather than a workaround for one.

**Two brand themes, not twelve, and that is this set's own scope.** The claim is
about what the foot holds, which no palette can change; the twelve-theme sweeps
belong to the surfaces a design round judges for contrast and spacing. Every
before frame here is the same theme as the after frame it is compared against, so
each comparison above is like for like.

These are **supplementary** frames in `../manifest.json`'s sense: the script
cannot re-derive them from the tree under review, because the tree under review
is the fixed one. A sweep therefore preserves them (`clearSweptFrames`), and the
swept count excludes them.

## One thing a reader of the wider set needs to know

The committed frames this set replaces were taken before main's 2026-09-18/19
theme commits, so they carry the older ground (`localOperatorDark`'s canvas was
`#17130E`; on this head it is `#22201C`). That is why **no** re-captured frame in
`../chat-run-panel/` is byte-identical to its committed predecessor, and why a
before/after pair taken across that change would measure the palette rather than
the foot. This set is the same-head pair that avoids it: both halves are
photographed on `b7bed8d96`, and the only difference between them is the file
named above.
