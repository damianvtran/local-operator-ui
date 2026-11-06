# Owner-audit read fence — before and after, in a browser

Frames of the shipped owner-audit rail, captured from the proof story in
`src/renderer/src/features/team-bridge/team-bridge-owner-audit-fence.stories.tsx`
(`Team Bridge/Owner audit fence`), driven in the local Storybook dev server
through the harness browser.

| Frame | What it shows |
| --- | --- |
| `content-only-refetch-before-fix.png` | The SAME story, with `team-bridge-owner.ts` at the commit before this fix. The status query is refetched mid-read with identical authority (same account, `state`, `read_only` and `local.enabled`; only a non-authority field differs), and the identity fence throws — so the rail renders "Audited messages could not be loaded." with its Try again action. |
| `content-only-refetch.png` | The same story at this head. Same mid-read refetch, same payload: the rail renders the two audited conversations. |
| `genuine-authority-change.png` | The same story at this head, except the refetch moves `state` from `ready` to `unavailable`. The fence still refuses: the error state, not rows. Byte-identical to the before-fix frame, which is the point — a false refusal was indistinguishable from a real one. |

- Captured at **2560 × 1440** device pixels (the browser host's window) in the
  preview's default (dark) theme.
- The before/after pair differs in ONE tracked file,
  `src/renderer/src/features/team-bridge/team-bridge-owner.ts`; the story, the
  seeded status, and the mid-read timing are identical, so the frames isolate
  the fence and nothing else.
- WHAT THESE ARE NOT: the story answers the audit route from a stand-in
  `window.api.desktop` transport and seeds the two authority rows into its own
  query client. No hub, runtime or Electron main is involved, so these frames
  are not evidence that the route answers — the BEHAVIOUR is pinned by
  `scripts/team-bridge-owner-fence.test.mjs` and
  `scripts/team-bridge-owner-audit-render.test.mjs`, and these frames are what
  that behaviour looks like.
