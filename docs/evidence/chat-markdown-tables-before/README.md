# Markdown tables in the chat answer - the BEFORE half

The pair to [`../chat-markdown-tables/`](../chat-markdown-tables/) - the fix's
own capture, taken in a later task - and the half that makes the claim: these
are the frames of the unfixed tree, where a table the agent wrote into an answer
had its short columns squeezed until they wrapped mid-token. The operator's
report (2026-09-30), in its own cells: `#684 (1a)` and `MERGED f11952f1d2`
wrapped while the long "What it fixes" column took the width.

**What reproduces, and what does not** (all at the set's own 810px measure; the
numbers behind each read are in [`MEASUREMENTS.md`](./MEASUREMENTS.md)):

- `operator-shape` - the reported shape, and it reproduces: at a 48px and a
  71px column the two cells render `#6|84|(1a|)` and `MERG|ED|f11952|f1d2`,
  four lines each, while the title column takes 690px.
- `long-prose` - reproduces: `Loa|der|cont|inuit|y 1a` at a 55.1px column, and
  the header cell renders `Cha|nge`.
- `long-tokens` - reproduces: the `Kind` header renders `Kin|d` at a 51px
  column; the full-sha rows take the width instead.
- `many-columns` - does NOT reproduce, deliberately: seven columns fit at their
  max-content (94.1 / 197.9 / 83.4 / 173.4 / 65.2 / 105.2 / 89.8, sum 809.0px
  of the 810px table, every cell single-line). Kept as the no-regression
  control, because a fix for the squeeze must leave a table that already fits
  alone.
- `few-rows` - does not reproduce: the smallest table, single-line cells; the
  second control.

**Both widths resolve the same 810px measure.** The state pairs captured at
1280x900 and 920x900 (`operator-shape`, `long-tokens`, `many-columns`) differ in
margins rather than in the table's own box - at 920 the container is still
888px, above the 750px gate the cap needs, so the cap binds exactly as it does
at 1280. The pair is on the record because the question "does a narrow window
change the squeeze" answered itself once measured: it does not; the squeeze is
in the table's content, not in the pane. `MEASUREMENTS.md` carries the chain.

**How they were taken.** With the fix not yet written, the story file's title
temporarily suffixed `before` (so the ids land in this directory) and the
matching temporary STORIES rows added for the run - then both restored to the
committed head, which is the state the after half re-uses (same story, title
without the suffix; the committed rows write `docs/evidence/chat-markdown-tables/`).
The capture command:

```sh
node scripts/capture-evidence.mjs http://localhost:6157 \
  --only=chat-markdown-tables-before \
  --themes=localOperatorDark,localOperatorLight,obsidian,githubLight \
  --allow-backend --theme-settle-ms=180000
```

`--allow-backend` because the operator's live daemon answers on :1111 and must
not be stopped for a capture, and this story is a static fixture
(`frontend={null} gate={null}`) that never contacts the backend - so the
guard's concern, surfaces that render a server's replies, does not apply; the
rig's own theme and paint guards still ran over every frame.
`--theme-settle-ms=180000` because this host is loaded and the guard's default
10 s does not fit it. 32 frames in all: 8 entries (five states at 1280x900,
three of them also at 920x900) x 4 themes. The multi-width states write
`leaf@1280/` and `leaf@920/` per the rig's own convention; `long-prose` and
`few-rows` are single-width and keep the plain leaf. Captured at head `fb565e2b8`
(the branch's base) with the temporary edits uncommitted in the working tree -
the run records that capture as dirty, as it was.

**The four themes.** `localOperatorDark` and `localOperatorLight` are the brand
palettes; `obsidian` (a near-black dark) and `githubLight` (a neutral light)
are two contrasting palettes from the registry on either side of them. The
claim in this set is GEOMETRY, which no palette moves - the two extra themes
hold the reading to the registry beyond the brand pair rather than to taste.

**Stamps this pass read.** `git rev-parse HEAD:src` =
`d69c9b2635c0aa838a612b518cc2cd9d0baf2370`; `git rev-parse HEAD:scripts` =
`6f453ba3f2fcda3359ae063866e33ad81b32215d`.

**Not here.** The fix's own frames (`../chat-markdown-tables/`) and the
manifest's `supplementary` declaration for this set belong to the lane's later
steps; this set is the reproduction and its numbers.
