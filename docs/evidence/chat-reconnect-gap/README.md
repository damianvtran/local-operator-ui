# The rows written while the reader was on another conversation

The report was "I only start getting new messages past that point": in a
conversation A, the user steered a turn in flight, switched to B, and came back
to A — and every row written after the steering message (the assistant rows and
the tool calls between the steer and the return) was missing until new frames
arrived.

The pair here is the transcript itself, in the two states the fix is about:

- **`gap/`** — the transcript the client ended up with. The re-subscribe
  snapshot's history page is read `through_id=<the owner's published
  history_cursor>`, so the page's newest entry IS that cursor by construction,
  and a cursor refreshed at the steer bounds the page at the steering row. The
  rows after it are in neither the page nor the live seed, so the conversation
  jumps from the steer straight to the live tail.
- **`restored/`** — the same transcript once the reconcile reads the unbounded
  durable tail back and merges it by id.

## What produced these frames

Storybook, through the repo's own `scripts/capture-evidence.mjs`:

```
npx storybook dev -p 6017 --ci --quiet
node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-reconnect-gap --allow-backend
```

The stories (`Chat/Reconnect gap`, `reconnect-gap.stories.tsx`) render the
production `CanonicalTranscript` from transcripts built by the PRODUCTION
reducer (`applyHistoryPage` then `applyEvent`, the flush loop's own order) out of
wire-shaped frames — the way `chat-tool-rows--joined-mid-turn` builds its rows.
Nothing is hand-drawn, and the two frames differ only by the merge the fix
adds. What the pair is here to catch is the SEAM that a merge can introduce: a
duplicated row, a row out of order, or a row painted unlabelled. The id-set
assertions in `scripts/reconnect-page-gap.test.mjs` cannot see any of those.

`--allow-backend` is stated rather than implicit: the operator's own backend is
listening on `127.0.0.1:1111`, and this story never talks to it — it renders
fixture records and calls nothing. The flag exists for exactly this case and is
opt-in per narrowed run.

## Local scaffolding these frames needed, and why it is not committed

Two things on this head stop Storybook rendering anything, both pre-existing and
outside this change:

- **`react-docgen-typescript` crashes on TypeScript 7** (`Cannot read
  properties of undefined (reading 'React')`), so the preview never builds. The
  frames were captured with `typescript.reactDocgen: false` set locally in
  `.storybook/main.ts`, and that edit is **reverted before this commit** — it is
  a workaround for a broken dev-tooling default, not part of the fix.
- **`.env` copied from `.env.template`** — with `VITE_PUBLIC_POSTHOG_HOST`
  given the schema's own default, because the template ships it EMPTY and the
  app's own zod schema rejects `""` for a URL field, which fails the story with
  "Configuration validation failed".

Because the docgen patch touches a file outside `src/` and `scripts/`, the
manifest's `dirtyWorkingTree` records a dirty tree; the stamped `srcTree` and
`scriptsTree` are the committed ones and are unaffected by it.

## Known limit

The reconcile reads back at most `RECONCILE_WALK_MAX_ROWS` (500) durable rows,
walking backwards a page at a time until a fetched page overlaps a row the
snapshot painted. An absence wider than that cannot be closed through this
route, which has no forward cursor — the complete answer for a very wide
absence is a snapshot whose page is not bounded by a stale cursor, which is the
backend half of this defect and is being fixed separately.
