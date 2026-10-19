# LOH-11 capture harness (evidence-only)

This directory records the **evidence-only Storybook harness** the before/action
frames and their measurements were captured from. The patch is deliberately not
applied in this docs-only PR: the manager's sequencing keeps the story change
with the UI implementation PR. It is archived here so the capture is
reproducible from this head instead of being an unrecorded local surface.

## What the patch adds

`chat-sidebar-sections.evidence.patch.gz` (gzipped so the diff lines do not
trip whitespace checks in the repository) applies to
`src/renderer/src/features/chat/components/chat-sidebar-sections.stories.tsx` at
base `76dda0304bfa4b54ebd42cccd32bbd05841ca4a3`. It adds, and changes nothing
else:

- `EvidenceTags220`, `EvidenceTags260`, `EvidenceTags320` — the existing real
  `Page` at the three shipped sidebar widths.
- `EvidenceTagsActs220`, `EvidenceTagsActs260`, `EvidenceTagsActs320` — the same
  rows with the **archive capability** enabled and `pinned:false` published on
  unpinned rows (the production-shaped payload the action pair needs), plus the
  real hover-intent layout attribute seeded in the story host.
- `bridge(evidenceArchive = false)` — the opt-in feature/pin payload; every
  pre-existing story keeps its previous map.

The patch contains no production component change.

## Reproduce

From the repository root at the base above:

```sh
gunzip -c docs/evidence/loh-11-design/harness/chat-sidebar-sections.evidence.patch.gz | git apply --check  # dry run
gunzip -c docs/evidence/loh-11-design/harness/chat-sidebar-sections.evidence.patch.gz | git apply
pnpm storybook --ci --no-open            # http://localhost:6006
```

Then capture the iframe through the harness browser (one owned tab, closed
afterwards), 1280×720 CSS viewport, DPR 2:

```text
/iframe.html?id=chat-sidebar-sections--evidence-tags-220&viewMode=story&args=theme:localOperatorDark
/iframe.html?id=chat-sidebar-sections--evidence-tags-acts-320&viewMode=story&args=theme:localOperatorDark
```

The six width/theme frames and the three action frames in `../before/` use
these ids. `theme:localOperatorLight` is the light pair.

## Re-derive the numbers

`browser.styles` over these selectors produced `../before/measurements.json`
and `../before/action-measurements.json`:

- `nav`, `[data-session-row]`, `[data-session-title]`
- `[data-session-row] [data-chat-row] > span:nth-child(2)`
- `[data-session-control-pair]`, `[data-session-archive]`,
  `[data-session-pin]`, `[data-session-pin-grip]`

The action stories seed the layout attribute, not a pointer gesture; they prove
rendered layout state, not a successful mutation or a physical right-click.
`../before/README.md` states which readings are final and which historical
payload was rejected.

## Why it is not in this PR

This PR is docs-and-evidence only, and the project's sequencing keeps the
`chat-sidebar-sections.stories.tsx` change with the UI implementation PR. The
archived patch is the provenance record; applying it takes one command and does
not touch the sidebar source. The UI PR must land the same patch (or an
equivalent story set) and re-capture its own after frames against the
implemented code.
