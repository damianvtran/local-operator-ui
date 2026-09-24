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
| `reader-result-inline` before vs after | **322,520** px dark / **310,535** light. Before, the `Result` block has taken the pane: the conversation above it is squeezed to the brief and a date, and the block runs off the bottom edge. After, the result IS the conversation's last row, bottom-pinned, and the foot carries only the read-only line. |
| `reader-result-preview` before vs after | **321,921** / **305,110**. Before, the block is unbounded and unlabelled — `Result` — over a body with nothing left to push back with. After, a `Result preview` inside `max-h-40 overflow-auto`, under one quiet line saying the conversation the fuller copy is in is not on this page. |
| `reader-settled` before vs after | **185,402** / **165,074**. The smallest of the three, and correctly so: the same block, over a shorter fixture result. |
| `reader-live` before vs after | **11,246 px dark (0.98%) / 10,132 light (0.88%)** — the CONTROL, and it now moves a little instead of agreeing exactly. The reason is the same reason the other three moved: this round re-took the after half, and the running child's foot carries the **read-only line**, whose copy changed ("this is the subagent's conversation" -> "...page") in every reader state. What the control still measures is the MAGNITUDE: a foot whose only change is one sentence moves ~11k px, and the three pairs above move ~185k-322k, which is the outcome block rather than the run. Read the old byte-identical pairing in the paragraph below as the FIRST pass's reading, taken before the copy changed. |

These four numbers were re-measured after the round that re-took the after halves
(the reader group was re-shot on the folded tree; see the sibling README's own
note). Only the right-hand side moved — every frame in this set is still the
one photographed at `b7bed8d96`, and this set is still not re-taken by anything.

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
`#17130E`; on this head it is `#22201C`). That is why **the after halves in
`../chat-run-panel/` are not read from a diff against their committed
predecessors**, and why a before/after pair taken across that change would
measure the palette rather than the foot. This set holds the ground constant in
**its own** halves: both before frames of a pair are photographed on `b7bed8d96`
against that head's own fixed component, so within the before half the only
difference is the file named above. It is NOT a same-head pair any more, and was
not by the time the table above was written: the **after** halves in
`../chat-run-panel/` were RE-TAKEN on the folded tree by the round the sibling
README records, so the left column of that table is this set's frames from
`b7bed8d96` and the right column is the re-shot ones. What the pair still holds
constant is the ground, which is why the difference it measures is the component
rather than a palette that moved under both.

That is also why this set is still the instrument after the round that re-took
the reader group on the folded tree (see the sibling README): the after halves
now differ from their committed predecessors by the COMPONENT rather than by the
ground (all 40 of them, AE 2,481-29,166 px), and this pair still holds the ground
constant on both sides, with the component as its only variable. So the table
above is the measurement that separates the foot from the run, and the AE against
a committed predecessor is not.
