# The aside panel's settled exchange

Two states × twelve themes = **24 frames**: `settled/` (1024×700) and
`settled-small-view/` (440×700, the compact rung), both on the production
composer band — the panel mounts inside the shipped `MessageInput` in the column
the band's own container queries resolve against, the way `askAside` mounts it.

## What a frame proves, and what it does not

The stories seed the aside store directly (`aside-store.ts`), so a frame is
evidence about the panel's RENDERING of the settled exchange — the question with
its visible role marker (`You:`, #763) over the answer, and the adopt control
live with its chord — and not about the transport that fills the store. The
`aside_delta` semantics live in `scripts/btw-aside.test.mjs`.

The small rung is the story's own `isSmallView` prop, not a narrow viewport: the
app resolves the prop from the pane's width (`chat-content.tsx`), and a narrow
column alone would render the wide panel, which is not a state the app can be in.

## Where the before half lives

`../chat-aside-panel-before/` carries the same two states with the pre-#763
question side; the pair is the claim. The stories are
`chat-aside-panel--settled` and `chat-aside-panel--settled-small-view` in
`src/renderer/src/features/chat/components/btw-panel.stories.tsx`.
