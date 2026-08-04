/**
 * A quiet block of consecutive trace lines.
 *
 * Per docs/branding.md § 7, N adjacent actions in one turn read as one quiet
 * block, not N separate cards: single spacing between lines, no chrome around
 * the group. In the live message list the rows are flat siblings rendered by
 * messages-view, so the tight coupling is achieved there by the
 * `data-lo-trace` sibling rule on MessageItem's trace root; this component is
 * the same block for contexts that compose traces directly (stories, future
 * surfaces).
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
