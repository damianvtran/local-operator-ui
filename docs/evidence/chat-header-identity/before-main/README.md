# The header identity slot before it became the controls

These are three of the parent directory's stories, rendered by the UNFIXED
tree: the chat header from `origin/main` (`fe98692e8e`, this branch's base),
whose identity slot painted the joined identity as one plain string. They are
the "before" half of the pair this change is reviewed against, and the parent
directory's frames are the "after".

What they show: `team-bound` is the operator's own arrangement - the dim
`manager · lopdev` string under the title, saying who and offering nothing;
`no-team-no-agent` is the same slot with nothing to say at all; `wide` holds
the operator's 49-character title at the app's full width, where the after
frames put the two controls beside it. The press and hover states the parent
set carries (`team-menu-open`, `agent-menu-open`, `assign-team-menu`,
`title-hover`) have no before half by construction: there is no control to
press and no pencil to hover on this tree.

Reproduce it with this branch's story file and story entries against `main`'s
production source, which is the only combination that renders these stories on
the old header (`--dirs=` names the three states so the press and hover rows
are not driven at controls this tree does not draw):

    git restore --source=origin/main --worktree -- \
      src/renderer/src/features/chat/components/chat-header.tsx
    node scripts/capture-evidence.mjs http://localhost:6317 \
      --only=chat-header-identity --dirs=team-bound,no-team-no-agent,wide \
      --themes=localOperatorDark,localOperatorLight --allow-backend
    mv docs/evidence/chat-header-identity/{team-bound,no-team-no-agent,wide} \
       docs/evidence/chat-header-identity/before-main/
    git restore --worktree -- src/renderer/src/features/chat/components/chat-header.tsx

A sweep cannot re-derive them: a sweep captures the CURRENT tree, and these
frames need `main`'s `chat-header.tsx` under the same stories. That is why the
set is declared in `docs/evidence/manifest.json` - so `clearSweptFrames`
leaves it alone and the sweep's own count stays honest about what it can still
take.
