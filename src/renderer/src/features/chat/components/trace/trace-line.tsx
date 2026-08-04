/**
 * One line per completed action — the third tier of the § 7 hierarchy.
 *
 * Quiet, monospace, subdued ink; no card, no border, no icon tile. Enough to
 * answer "what is it doing?" at a glance and to audit afterwards. How it did
 * it (code, stdout, logs, diffs) sits behind the line itself: when `details`
 * is provided the whole line is the disclosure trigger, closed by default.
 *
 * The line carries its own running state — present-tense verb at a brighter
 * ink — because § 7 forbids showing a spinner and a trace line for the same
 * action.
 */

import type { ActionType } from "@shared/api/local-operator/types";
import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { getTraceLabel } from "./trace-labels";

export type TraceLineProps = {
	/** The record's action. Absent for a bare `action` execution record. */
	action?: ActionType;
	/** The record's `file_path`. */
	filePath?: string;
	/** The record's attached files, used when there is no `file_path`. */
	files?: string[];
	/** The record's message text, used only when no file object exists. */
	narration?: string;
	/** Present-tense verb at a brighter ink while the action runs. */
	running?: boolean;
	/** Marks the line as failed (non-empty stderr): the glyph turns danger. */
	failed?: boolean;
	/** Open the disclosure initially (story and measurement surfaces). */
	defaultOpen?: boolean;
	/**
	 * Detail revealed behind the line. Its presence makes the line a
	 * disclosure trigger; absent, the line is static text.
	 */
	details?: ReactNode;
	/** Extra classes on the row. */
	className?: string;
};

const TraceRow = ({
	icon,
	verb,
	object,
	running,
	failed,
}: {
	icon: ReactNode;
	verb: string;
	object?: string;
	running?: boolean;
	failed?: boolean;
}) => (
	<span className="flex min-w-0 items-center gap-2 font-mono text-mono-sm">
		<span
			className={cn(
				"flex shrink-0 [&_svg]:size-3.5",
				failed ? "text-danger" : "text-ink-dim",
			)}
		>
			{icon}
		</span>
		<span
			className={cn(
				"truncate",
				running ? "text-ink-muted" : "text-ink-dim",
				failed && "text-danger",
			)}
		>
			{verb}
			{object ? (
				<>
					{" "}
					<span className="text-ink-muted">{object}</span>
				</>
			) : null}
		</span>
	</span>
);

export const TraceLine = ({
	action,
	filePath,
	files,
	narration,
	running = false,
	failed = false,
	defaultOpen = false,
	details,
	className,
}: TraceLineProps) => {
	const label = getTraceLabel(action, filePath, files, narration);
	const verb = running ? label.runningVerb : label.verb;
	const Icon = failed ? CircleAlert : label.icon;

	const row = (
		<TraceRow
			icon={<Icon aria-hidden={true} />}
			verb={verb}
			object={label.object}
			running={running}
			failed={failed}
		/>
	);

	// No detail and not running: the line is complete information on its own,
	// so it renders as text rather than as a button that reveals nothing.
	if (!details) {
		return (
			<div
				className={cn("flex min-h-6 items-center py-0.5", className)}
				aria-busy={running || undefined}
			>
				{row}
			</div>
		);
	}

	return (
		<Disclosure
			summary={row}
			chevron="leading"
			defaultOpen={defaultOpen}
			className={className}
			// The whole row is the target, so it gets a row-shaped hover ground
			// the way a list row does in Warp, Zed and VS Code: the negative
			// margin lets the ground bleed 8px past the text on both sides while
			// the text stays on the rail. Elevation by colour step, per § 2 —
			// nothing moves, nothing lifts.
			triggerClassName="-mx-2 min-h-6 rounded-sm px-2 py-0.5 hover:bg-elevated"
			contentClassName="mt-1 ml-5 flex flex-col gap-2 border-hairline border-l pb-1 pl-3"
		>
			{details}
		</Disclosure>
	);
};
