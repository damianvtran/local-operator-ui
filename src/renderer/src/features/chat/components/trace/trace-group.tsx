/**
 * A quiet block of consecutive trace lines.
 *
 * Per docs/branding.md § 7, N adjacent actions in one turn read as one quiet
 * block, not N separate cards: single spacing between lines, no chrome around
 * the group. In the canonical transcript the rows are flat siblings rather than
 * children of this component, so the same coupling is achieved there by
 * `transcript-rows.ts`'s `trace` tier; this component is the same block for
 * contexts that compose traces directly (stories, future surfaces).
 *
 * `gap-0.5` is 2px, deliberately the same step that tier carries, so a reader
 * comparing a story composed of these against the canonical transcript finds one
 * distance rather than two. Change one and change the other. (The line HEIGHT
 * still differs: this group composes `TraceLine` at its comfortable default,
 * while the transcript opts its rows into the dense 20px ledger height.)
 *
 * That agreement is between THESE TWO and is not a claim about the repository.
 * A third definition of the same tier lives in `utils/message-grouping.ts`
 * (`boundarySpacing`: `trace` ⇒ `mt-1`, 4px, in the comfortable view). It is not
 * dead code, but it is not on a live conversation either: the legacy
 * `messages-view.tsx` that reads it is UNREACHABLE in a shipped state —
 * `chat-content.tsx` chooses it only when no canonical session exists, and every
 * mount site passes a freshly built `canonical` object (`chat-page.tsx`), which
 * `message-item/index.tsx` records at length. What still renders through it is
 * the swept `chat-trace--conversation*` stories, so `docs/evidence/chat-trace/`
 * and `docs/evidence/chat-tool-rows/` genuinely show two different distances
 * side by side. That is a real inconsistency and it is deliberately NOT resolved
 * here: converging a rendering path that only stories drive would be a change to
 * story fixtures with their own frames to re-take, and folding it into a tier
 * adjustment for the canonical transcript would be a
 * second, unreviewed change riding along. Whoever converges them should move
 * `boundarySpacing`'s `trace` arm and re-capture `chat-trace/*`.
 */

import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";

export type TraceGroupProps = {
	children: ReactNode;
	className?: string;
};

export const TraceGroup = ({ children, className }: TraceGroupProps) => (
	<div
		data-lo-trace-group={true}
		className={cn("flex flex-col gap-0.5", className)}
	>
		{children}
	</div>
);
