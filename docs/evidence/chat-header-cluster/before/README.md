# The action cluster before the reservation became conditional

These are the same four stories as their parent directory, rendered by the
UNFIXED tree: the chat header from `origin/main` (3f1f4e5a3), whose browser
button carried an unconditional `mr-1`. They are the "before" half of the pair
the change is reviewed against, and the parent directory's frames are the "after".

What they show, measured rather than described (`scripts/header-cluster-geometry.mjs`):
`trigger -> browser` 8px against `browser -> canvas` 12px, in the badge-free state
AND in the badge state, because the reserve was paid by every render whether or
not a badge was drawn. That is the asymmetry the operator reported.

Reproduce it with this branch's story file and story entries against `main`'s
production source, which is the only combination that renders these stories on
the old header:

    git restore --source=origin/main --worktree -- \
      src/renderer/src/features/chat/components/chat-header.tsx
    node scripts/capture-evidence.mjs http://localhost:6017 \
      --only=chat-header-cluster \
      --themes=localOperatorDark,localOperatorLight --allow-backend
    mv docs/evidence/chat-header-cluster/{no-approval,one-approval,at-cap,trigger-dot} \
       docs/evidence/chat-header-cluster/before/
    git restore --worktree -- src/renderer/src/features/chat/components/chat-header.tsx

A sweep cannot re-derive them: a sweep captures the CURRENT tree, and these
frames need `main`'s `chat-header.tsx` under the same stories. That is why the
set is declared in `docs/evidence/manifest.json` - so `clearSweptFrames` leaves
it alone and the sweep's own count stays honest about what it can still take.
