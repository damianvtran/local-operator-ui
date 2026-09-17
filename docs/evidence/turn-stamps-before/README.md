# The turn stamp — the BEFORE half of the pair

Six frames: the same two stories `docs/evidence/chat-tool-rows/` carries, captured from
the tree this branch is based on rather than from the branch.

| Frame | What it shows |
| --- | --- |
| [`expanded-detail`](expanded-detail/) | An expanded tool call with **no time at the foot of the pane**. The after half is [`../chat-tool-rows/expanded-detail/`](../chat-tool-rows/expanded-detail/), which carries the same three rows with the call's own date and clock under each expanded body. |
| [`prose-tool-alignment@1024`](prose-tool-alignment@1024/), [`@1440`](prose-tool-alignment@1440/) | A user turn with **no stamp under it**, at both of the widths that story is captured at. The after halves are [`../chat-tool-rows/prose-tool-alignment@1024/`](../chat-tool-rows/prose-tool-alignment@1024/) and [`@1440`](../chat-tool-rows/prose-tool-alignment@1440/). |

## Where these came from, and why they are a capture rather than a copy

`node scripts/capture-evidence.mjs http://127.0.0.1:6028 --only=chat-tool-rows--<story>
--themes=localOperatorDark,localOperatorLight --allow-backend`, run in a **second git
worktree checked out at `0c04cbb09`** — this branch's own base — with its own Storybook dev
server. The story ids, the fixtures and the viewports are main's, so the frames are a
picture of the state the change is being compared against.

A copy of the committed frames would have been cheaper and would have been an assumption:
nothing on this branch could then show that those bytes still match what the base tree
renders. Capturing them makes them evidence, and the comparison came back with a number in
both directions: **every frame in this set is byte-identical to the committed copy of the
same path** (AE 0 against `HEAD`'s file, for both themes of both stories at both widths,
measured with `magick compare -metric AE`). The one story whose fresh capture did NOT match
is the one left out below.

## The story that was captured and then left out

`turn-boundary-and-working-line` was captured too and is **not** in this set. Its frame
carries the working line, whose spinner and phase clock are live, so two consecutive
captures of the SAME unchanged tree differ: measured 10,735 pixels in the dark theme and
263 in the light between the fresh base capture and the committed copy. A before/after pair
there could not separate the stamp from the spinner, which is a misleading pair rather than
a merely noisy one. The stamp's own placement is judged on the two deterministic stories
and on `chat-tool-rows/turn-timestamps`, whose fixtures are relative to the capture and
whose ground is a transcript of its own.

## The footer's shape is not in this pair, and where it is

Converging the transcript footer on the turn stamp's own component (it renders `TurnTimestamp` now,
where it used to render the hover row's `MessageTimestamp`) moved 97 frames in the second round, and
**none of them is in this set**: these two stories' footers fall outside their own viewports, so the
pair does not carry the footer either way. The old shape is in the frames this branch committed
BEFORE that fix, and the pair is one `git show` away:

```console
$ git show 8226619b3:docs/evidence/chat-notification-feed-states/cached-paint/localOperatorDark.webp > /tmp/old.webp
$ magick /tmp/old.webp -gravity south -crop 100%x18%+0+0 +repage /tmp/old-foot.png
$ magick docs/evidence/chat-notification-feed-states/cached-paint/localOperatorDark.webp \
    -gravity south -crop 100%x18%+0+0 +repage /tmp/new-foot.png
$ magick /tmp/old-foot.png /tmp/new-foot.png -append /tmp/pair.png   # `2025-10-09` over `Oct 9, 2025, 4:53 AM`
```

The run panel's reader frames moved the same way (`reader-settled` by 2,991px, `reader-nested` by
25,714px); they were re-taken without a before set, so their old shape lives in that same commit.

## Both widths, because the narrow column is a different transcript

The stamp is right-aligned to the turn's own right edge, which for a user turn is the
bubble's, because a user row is `flex w-full justify-end` with no right inset
(`message-item/message-container.tsx`) — **the bubble's right edge and the row content
box's are the same line at every width**, measured at a 0.0px delta on 420/1024/1440 in
review round 1 (R2/D3). What `docs/branding.md` § 7 distinguishes on a user row is the
bubble's LEFT inset, which is what makes a turn read as an aside.

This section used to claim the pair was evidence of an edge distinction that "at 1440 the
two edges are far apart". It is not, and they are not: the 1440 frame's bubble right edge
and the ledger's own right rail are the same x (1170). Both widths are still in the set,
for the reason the after-frames are captured at both — the transcript is a different shape
in a narrow column, where the bubble is a larger fraction of the width, and a reader on a
narrow window is the one most likely to be reading a single long conversation. The stamp's
own line in that column is shown and measured in the AFTER set, which holds the 420px
frame (`chat-tool-rows/turn-timestamps-narrow`: ink ends at x 362 with the rest of the
line empty); this pair's two widths are 1024 and 1440, and nothing in either is close to
wrapping — an earlier sentence here claimed otherwise (design round 2, D2-3; review round
3, R3-4).

## Declared, not swept

A sweep captures the CURRENT tree, so it can never regenerate these — they need the base
tree's own component under the same stories. The set is declared in
`docs/evidence/manifest.json`'s `supplementary` list for that reason, which is what stops
`clearSweptFrames` deleting it and keeps the swept frame count honest.
