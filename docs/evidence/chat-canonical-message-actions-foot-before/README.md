# The foot line BEFORE the caption took the rail (operator direction, 2026-10-01)

The BEFORE half of the pair whose AFTER half is
[`../chat-canonical-message-actions/`](../chat-canonical-message-actions/), for the
one thing that set's 2026-10-01 pass changes on this line. The operator's own
sentence is the report:

> "now that the action buttons only show up on hover, the Worked for and action
> count looks a bit weird — rearrange so those are on the leftmost extent and the
> action buttons are to the right."

**What these frames show.** The same story file, the same sweep rows and the same
`scripts/capture-evidence.mjs`, run against the tree before this change: the
caption (`Worked for 12s · 2 actions`) starts at **175px** — indented by the
at-rest-invisible buttons' own 60px box plus the line's 8px gap — with the buttons
at the rail (107) and the stamp rightmost at 794.5. That is the state the report
describes; the after half paints the caption at 107 and the buttons at 726.6.

**Why only four states have a half here.** The arrangement moves the same two
clusters in every state, so this pair photographs the two shapes the report is
judged on, in both pointer states:

- `compacted-run/` and `compacted-run-hover/` — the caption shape: idle, and with
  a real pointer parked on the answer (which is what reveals the buttons);
- `rest/` and `hover-copy/` — the no-caption shape: idle, and with the pointer on
  the Copy button itself.

The after set's other eleven states carry no before half: their arrangement claim
is the same claim, and these two shapes in both pointer states show it. The
argument for the discovery of the reveal itself is round 1's, and lives in the
after set's README where it was made.

**The base is `af6fffa899`**, this branch's cut point — the same base
[`../chat-turn-collapse-before/`](../chat-turn-collapse-before/) names for its own
pair.

**How they were taken.** The story file's title was suffixed ` foot before` for
that one run (with matching temporary `STORIES` rows, both removed before the
after frames were taken), so the ids land in this directory rather than beside the
after frames:

```sh
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-foot-before \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000
```

24 frames: four states × six themes. `--allow-backend` for the same reason the
after run takes it (the operator's live daemon must not be stopped for a capture,
and these fixtures never contact it).

| state | what it shows |
| --- | --- |
| `compacted-run/` | the operator's state: `Worked for 12s · 2 actions` indented to 175px, the hidden buttons' box at the rail (107), the stamp at 794.5 |
| `compacted-run-hover/` | the same state with the pointer on the answer: the two buttons REVEALED at the rail, the caption unmoved — the reveal was opacity-only before this change too, which is what the pair's idle/hover boxes prove |
| `rest/` | the no-caption line: the buttons at the rail (107), the stamp rightmost (794.7) |
| `hover-copy/` | the same, with the pointer on Copy: the buttons revealed at the rail |

**What this set is NOT.** Component-level frames from Storybook, not the whole
app. These frames contain no data from any machine.
