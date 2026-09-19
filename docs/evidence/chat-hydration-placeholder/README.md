# The wait state: what the pane says while a conversation hydrates

Two frames of the transcript region a click lands on before any row has painted.
The story existed before this change and was in **no** capture set, so the second
half of the operator's report — "you click in and it takes forever to load" — had
no picture anywhere in the review set.

## The two states

- **`hydrating/`** — the unknown case. Its words are **unchanged** by this branch
  (`Loading conversation…`), which is what makes it the regression half of the
  pair rather than an illustration: the ground, the ink role, the pulse and the
  visible caption are the ones the region already shipped.
- **`reasons/`** — the same region with the reason known, all four codes the read
  path can publish in one frame: `no-runtime`, `owner-silent` (the operator's
  quiet owner), `owner-leaving`, and `attaching`. The mapping is the claim, so it
  is checked in one look rather than across four stories.

## What the frames can and cannot show

They show the SENTENCE and the region's geometry. They cannot show that the
backend really publishes the token: that is the contract
(`DesktopColdReason` / `SnapshotPayload`), and the renderer's read of it is
`use-canonical-session.ts` — a snapshot's `cold_reason` and `attaching`, and the
`frontend.replace` rollover that clears them when an owner comes back. The frames
are Storybook, so the handler below them is stubbed; what they photograph is the
surface a person reads once that value arrives.

The native `aria-label` on the region follows the visible caption (and is the
original `Loading conversation` when nothing is known), so the name a screen
reader hears cannot claim a wait the screen is not describing. The pane's
switch rigs select the placeholder by that name and stage no cold read, which is
why they meet it unchanged.
