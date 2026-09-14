# The operator's TUI reference row

The designer's round-1 pass was made against `tool-row-spec.md` (a prose
derivation of the TUI) rather than the picture, because the screenshot the
operator sent lives in the chat, not in the repo. This file records what that
image actually shows, so a parity judgement has an artifact to work from.

## What the operator sent

A cropped TUI transcript, 1024x102: four settled tool rows and one working
line, on a dark ground, with no borders or card chrome anywhere.

**Scope limit, stated up front:** every row in the crop is a settled SUCCESS.
There is no running row, no failure and no interrupt in it, so the image is
evidence about the settled state only. In particular it cannot be read as
saying that a running or failed row carries no background fill — branding § 2
sanctions a lightness step for state, and the shipped build uses one on exactly
those two states. What the crop does establish is that a settled row has no
fill, which is what the shipped build does.

```
>_ bash    ls ~/ | head -50; echo ---; ls ~/local-operator* 2>/dev/null | head; echo ---; find ~ -maxdepth 3 -name "local-operator-ui" -type d 2>/dev/null | head   OK  2.9s
wrench team    list                                                                                    OK  0.0s
page   read    guide://teams                                                                           OK  0.0s
wrench team    lopdev                                                                                  OK  0.0s
braille thinking  6s
```

`OK` stands for the check glyph, which renders in a success ink. The leading
words name the per-tool glyph rather than reproducing it.

## What the picture shows that the prose does not

- **Extreme vertical density — ~20.4px per line, the density target.** Five
  lines (four rows plus the working line) occupy ~102px in a 1024px-wide crop:
  102 / 5 = **20.4px per line**. This is the number a parity claim about density
  is measured against, and the reason it is recorded here explicitly is that
  prose cannot carry it — the first design round judged density from a written
  spec and could not test the one thing the operator asked for by name. The rows
  are far tighter than a comfortable web list row, and that tightness IS what he
  meant by "more tightly packed".

  It is a target, not a pixel contract: this app has a larger type size and
  proportional text, so the question is whether a run reads as a dense ledger,
  not whether it measures 20.4px. Measured against it, the first shipped build
  was 28.0px (37% taller, and a quarter of the ledger pushed off a 900px
  screen); the fix brings a run of adjacent rows to **20.0px, constant**.
- **The summary column dominates the row.** The bash row's command runs nearly
  the full width before the status cluster begins. A long command is SHOWN, not
  hidden behind a disclosure: the argument is the row's identity.
- **A hard right-aligned status column.** The outcome glyph and the duration
  land in the same two columns on every row regardless of how long the summary
  is, so the eye scans straight down them.
- **The name column is narrow, left-aligned and lowercase** (`bash`, `team`,
  `read`, `team`), with the glyph immediately to its left.
- **The working line is quieter than the rows above it** — indented, carrying
  only the activity word and an elapsed clock.
- **No colour beyond the glyph and the ink hierarchy.** No badges, no pills, no
  per-row chrome, no fills.

## How to use this

The operator's ask was parity of INFORMATION and DENSITY in this app's smoother
idiom, explicitly "without the borderless chrome". This is therefore not a pixel
target. The question to answer is: does a run of the shipped rows scan as fast
as this crop does, carrying the same facts in the same reading order, at a
density that reads as a ledger rather than as a list of cards?
