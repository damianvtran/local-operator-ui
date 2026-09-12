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
 * `gap-0.5` is 2px, which is deliberately the SAME step that tier carries — the
 * two spell one decision about how close consecutive actions sit, and a reader
 * comparing a story against the live transcript should not find two pitches.
 * Change one and change the other. (The line HEIGHT still differs: this group
 * composes `TraceLine` at its comfortable default, while the transcript opts
 * its rows into the dense 20px ledger height.)
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
