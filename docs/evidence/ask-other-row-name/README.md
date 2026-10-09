# ask-other-row-name

The round-2 micro-batch's stills and measurements for `feat/ask-other-option`
(PR #892): design D8 / UX U6's fused accessible name (`OtherType your answer`),
and the announced-readout re-measure design D9 and agent round 2 predicted.

- `r1/` - `96f68018d29`'s tree (the round-2 fix commit). `m1-row-pane` is the
  CLOSED `Other` row, 2x, with one real space now between the label and the
  hint; `m2-readout` is the answered-but-undelivered card the announced text
  was read in, `Canary (5% of traffic) · Other` on screen in both palettes.
- `run-r1.json` holds the measurements: `ax.m1Row` is Chrome's own computed
  name (`Other Type your answer`; round 2 measured `OtherType your answer`),
  and `announced.readoutAnnounced` vs `announced.readoutVisible` are the same
  node walked twice - once with `aria-hidden` subtrees skipped (the text runs
  AT receives) and once as `textContent`. AT receives
  `Canary (5% of traffic)Other` where the screen shows the dot (D9 stands,
  measured rather than predicted; the separator itself is unchanged here).

## Re-taking these frames

The base set's harness is the whole recipe
(`docs/evidence/ask-other/harness/`): one rig serving this tree, then the `m`
step, once per theme.

```sh
RIG_REPO=<this checkout> RIG_SCRATCH=<short tmp dir> ASKS_RIG_PORT=<port> \
  bash docs/evidence/ask-other/harness/rig-up.sh

node docs/evidence/ask-other/harness/drive-other.mjs docs/evidence/ask-other-row-name \
  "r1,http://localhost:<port>,<scratch>" --only=m --theme=localOperatorLight
mv docs/evidence/ask-other-row-name/run-r1.json \
   docs/evidence/ask-other-row-name/run-light-r1.json

node docs/evidence/ask-other/harness/drive-other.mjs docs/evidence/ask-other-row-name \
  "r1,http://localhost:<port>,<scratch>" --only=m

RIG_SCRATCH=<scratch> bash docs/evidence/ask-other/harness/rig-down.sh
```

THE RENAME IS NOT OPTIONAL if both passes' records are wanted: each pass writes
`run-r1.json` under the run's label, so the second pass overwrites the first's.
The committed `run-r1.json` is the DARK pass's record; the light pass ran the
same step and produced the light stills, and its record - which carried the
same theme-independent measures - was not kept.
