# The approval badges, photographed at three points: the operator's base, round 1, and this head

Forty-eight frames from `scripts/renderer-driver.mjs`'s `approval-badges` scene — the
scene the R1/R2/R3 asks are written against — photographed through the app's own
`capturePage()` in the `headless` window mode, against one isolated stub backend, at
1380x900, in both brand palettes. They are here rather than attached to the PR because
a committed frame is the one a later round can still read: the PR's attachments go with
the PR, and `gh gist create` refuses binaries.

## Three sides, and why each is here

| Directory | Tree | What it is |
| --- | --- | --- |
| `base/` | `origin/main` = `86295d056` | the state the operator reported from, and the tree the PR is reviewed against. **No rail badge exists at all**, the header's badge is `null` with the pane open, and the header keeps its title because the trigger has left with the pane |
| `round-1/` | this branch's first head = `c75e83e51` | the head review round 1 read. The rail and header badges exist; the pane-open header has lost the conversation title entirely (design D1), the collapsed rail's badge sits on the rail's own border (D2) and only fits one digit (D3) |
| `after/` | round 1's head = `c75e83e51`'s remediation = the head round 1 was closed on | the round-1 fixes. The title keeps a floor, the collapsed badge clears the rail's edge and carries its own ring at two digits, and the states round 1 could only infer (the tooltip, the current row, a two-digit count) are photographed |
| `round-2/` | this head | QA round 2's Q-1: the pane-open header at four window widths, so the SHED ORDER is a photographed fact rather than a claim. The same frames answer design round 2's D1/D2/D3 (unchanged) and D6 (the collapsed two-digit mark) |

The `base` and `round-1` halves exist because D1/D2/D3 are defects of ROUND 1 rather
than of the base: a two-way comparison against `base` alone would show the badges
appearing where there were none, and say nothing about the geometry the round-1 review
measured.

## The run, exactly

The backend is one this run owns: the repo's committed stub daemon on a port verified
free before the build, with the builder's own `.env` pointing at it.

```
# 1. the stub backend, on a port this run picked and verified free
node docs/evidence/session-archive/harness/stub-daemon.mjs \
  --port 7391 --records "$LOCAL_OPERATOR_SCRATCHPAD/stub-records2"

# 2. one build per tree, with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:7391
pnpm build

# 3. the scene, once per tree (the driver, `--scene approval-badges`)
node scripts/renderer-driver.mjs --scene approval-badges \
  --backend http://127.0.0.1:7391 --backend-records "$LOCAL_OPERATOR_SCRATCHPAD/stub-records2" \
  --out <this directory> --seed-onboarding-complete
```

The three trees, with the tree each half came from:

| Directory | Worktree | Commit |
| --- | --- | --- |
| `base/` | a `--detach` worktree of `origin/main`, `node_modules` symlinked to this branch's tree (same lockfile) | `86295d056` |
| `round-1/` | this branch's worktree at that head, captured during round 1 | `c75e83e51` |
| `after/` | `~/local-operator-ui-worktrees/approval-badges-9703` | this head |

The SAME driver file was used for all three: the scene is the instrument and the app is
the subject, so `base/` and `after/` were run with this branch's `renderer-driver.mjs`
copied into the base worktree. That is why the base run reports failures where this head
passes — those are the claims, not noise. Readings on this head:
`after: ALL CHECKS PASSED`; `base: 28 CHECK(S) FAILED` (14 per theme); both exit
non-zero only for the failed claims.

## The states, and what the numbers are

Sixteen frames per side (`after/` and `base/`), ten for `round-1/` (round 1's scene had
fewer steps). Each is `<state>-<dark|light>.png`.

| State | What it exercises | Numbers measured at this head |
| --- | --- | --- |
| `none` | nothing pending: **no badge at all**, and the rail's row is unchanged | `railBadge: null`, header trigger named "Open browser" |
| `two-three` | three live requests, one of each attribution (this conversation's, another's, one no conversation owns) | rail "3", header "1"; row 32px, label at `x44` unmoved |
| `pane-open` | the pane up, the fourth control on the header, the title under pressure | title box **40x22** (`min-w-10`), `truncated: true`, text still "Invoice reconciliation"; cluster right 732 inside the header's 740; the canvas button shed |
| `collapsed` | the rail at 48px | badge `x25..43`, **5px** clear of the rail's outer edge (3px clear of the ring's own paint, which ends at 45) |
| `collapsed-tooltip` | the collapsed row FOCUSED, so its tooltip is open | tooltip `x45..109` — it starts where the badge's ring ends, so the mark is not under it |
| `collapsed-two-digits` | thirteen live requests, the queue's own cap being 16 | expanded rail reads the true **"13"**; collapsed reads "13" too, `x18..43`, ring 3px inside the rail's edge. **It DOES cross the Globe's crown**, and the row used to claim it did not (design round 2, D6): diffed against the badge-free frame of the same state, the pill's ring paints over a 52px2 band of the icon's stroke (x19.5..29.5, y208.5..212). The pill's own box stops at the glyph's top edge; the 2px of outward ring is what enters it, which is the header's arrangement rather than a shortfall of this one — a 32px-pitch list cannot fit 16px of badge plus 2px of ring per side between two glyphs 16px apart (addendum 7) |
| `rail-current` | `/browser` as the current route, so the row paints `row-selected` | `railCurrent: true` with the badge drawn — the ground code review F2 measured at 2.77:1 for the old edge role |
| `cleared` | every request answered | both surfaces draw nothing |

## The width set (`round-2/`), and what it settles

Six frames, one per window width and palette, all of the `pane-open` state — the state
QA's Q-1 failed in. Every one of them is from a run that reported `ALL CHECKS PASSED`,
including the reading that failed before the fix, which asks of EVERY control the row
paints (not of the cluster's right edge) that it lies inside the row.

| Frame | Header | Title | What the row sheds | Numbers |
| --- | --- | --- | --- | --- |
| `pane-open-1600-dark` | 460px | `208x22`, `truncated: false` | nothing | the browser trigger ends at 856 and the console trigger is PAINTED (~896) inside the 960 row — the shed is a threshold, not a removal |
| `pane-open-1380-dark` | 240px | `76x22`, `truncated: true` | the console and the canvas | last painted control 724 inside 740; the canvas needs 320px of row, the console 280, and 240 is below both |
| `pane-open-900-dark` | 220px | `56x22`, `truncated: true` | the same two | last painted control 704 inside 720 |
| `pane-open-800-dark` | 220px | `56x22`, `truncated: true` | the same two | identical to 900: the app's declared minimum window (`WINDOW_MIN_WIDTH = 800`) floors the pane's layout at the same 220px header, and the row still holds the badge with 16px to spare |
| `pane-open-900-light` | 220px | `56x22` | the same two | the light brand palette, same geometry |
| `pane-open-800-light` | 220px | `56x22` | the same two | the light brand palette at the floor |

The failure Q-1 recorded, for the record: at 900 on the pre-fix head the console trigger
painted at `692..724` in a row that ended at 720 — 4px under the browser pane, invisible
and unpressable, because the row's own `overflow-x` is `visible`. The base tree passes
the same reading at the same width only because it has one control fewer in that row.

## What this set cannot show

- **A page inside the pane's rectangle.** The browser view is a native
  `WebContentsView`, so it is absent from `capturePage()` in every frame — the same
  limit `docs/evidence/browser-pane-live/` records.
- **The OS banner itself, and a click on it.** A banner is raised only when the launch
  plan would have focused the window (`show === "focus"`), and every mode this rig may
  use is `headless`. R3's click is covered in-process
  (`scripts/browser-host.test.mjs`) and by the round-1 QA matrix, not here.
- **A real pointer.** The driver has no pointer verb by design, so a hover-only state
  (the rail row's `row-hover` ground) is asserted by the contrast contract rather than
  photographed; the tooltip above is reached by FOCUS, which is what a keyboard user
  gets.
- **Keyboard focus rings.** A `headless` window is never shown, so `:focus-visible`
  does not paint.
- **The Storybook side of the same subject.** `browser-pane--composed-with-pane`
  (the pane-open cluster) and the consent card's attribution copy are Storybook frames;
  `docs/evidence/manifest.json` records them as owed rather than re-shot, and the reason
  is in `partialCapture.approvalBadgesRoundTwoEvidence`.
