# The aside panel BEFORE the #763 role marker

Two states × twelve themes = **24 frames**: `settled/` and `settled-small-view/`,
1024×700 and 440×700 — the same story states `../chat-aside-panel/` carries,
photographed on the pre-fix `aside-panel.tsx` (its `origin/main` bytes,
`9b4822d`).

## What the frames show

Both halves of the exchange paint in one prose register. The question is quieter
(13px muted against the answer's 14px ink) but there is nothing that says whose
words are whose at reading distance — the question line is simply "what does the
retry budget actually cap?" with nothing in front of it.

The pair with `../chat-aside-panel/` is the claim: the fixed frames add the
visible `You:` marker beside the question (the sr-only `Question:` prefix stays
for assistive tech), and a reader can see it arrive across the two sets.

## How these were taken

`scripts/capture-evidence.mjs` in a scratch worktree checked out at `8240edf0b`
with `aside-panel.tsx`'s bytes taken from `origin/main`:

```sh
node scripts/capture-evidence.mjs http://localhost:6021 \
  --only=chat-aside-panel --allow-backend
```

then the twenty-four frames were copied under this set's name. Declared as a
`supplementary` set in `../../evidence/manifest.json` for the same reason as its
sibling: a sweep photographs the current tree.
