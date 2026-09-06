/**
 * One line per completed action — the third tier of the § 7 hierarchy.
 *
 * Quiet, subdued ink; no card, no border, no icon tile. Enough to answer
 * "what is it doing?" at a glance and to audit afterwards. How it did it
 * (code, stdout, logs, diffs) sits behind the line itself: when `details` is
 * provided the whole line is the disclosure trigger, closed by default.
 *
 * The row is set in two faces, because it carries two voices. The verb and
 * its object are the machine's own label for the step — "Ran code",
 * "invoices/march.csv" — and § 4 gives monospace to exactly that: paths,
 * counts, trace labels, identifiers. The narration is the agent describing
 * the step in English, and § 4 forbids monospace for prose, so it sets in
 * `text-body-sm` beside the label rather than inside it.
 *
 * A colon joins them. Without one the two voices ran together into
 * "Ran code Summing the unpaid invoices by customer", which is not a sentence
 * in any register and does not become one by changing the font: a label
 * followed by the thing it labels needs the mark that says so, and a colon is
 * the one that also works when the row is read aloud.
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
import { TraceGlyph } from "./trace-rail";

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
	/**
	 * Explicit label, bypassing `getTraceLabel`. The canonical transcript's
	 * tool events already carry the verb in the user's terms and the object
	 * (a path, a URL, a command) as separate facts, so re-deriving them from a
	 * legacy `ActionType` would only lose information. Same row, same two
	 * faces, same disclosure — only the source of the words differs.
	 */
	verbOverride?: string;
	/** Machine-voice object for `verbOverride` rows. */
	object?: string;
	/** Glyph for `verbOverride` rows; defaults to the code glyph. */
	glyph?: ReactNode;
	/**
	 * Let the label WRAP instead of truncating.
	 *
	 * For a row whose text is the message itself -- a notice -- rather than the
	 * name of an action whose detail sits in the disclosure. A clipped action
	 * label is still identifiable; a clipped sentence loses its second half,
	 * which for the actionable cold-start reasons was the instruction (QA Q6).
	 */
	wrap?: boolean;
};

const TraceRow = ({
	icon,
	verb,
	object,
	narration,
	running,
	failed,
	wrap,
}: {
	icon: ReactNode;
	verb: string;
	object?: string;
	narration?: string;
	running?: boolean;
	failed?: boolean;
	wrap?: boolean;
}) => (
	<span
		className="flex min-w-0 items-center gap-2"
		// On the row rather than on a branch wrapper, so a step announces itself
		// as busy whether or not it has detail to disclose. It used to sit on the
		// no-detail container, which meant a running step with output — the
		// common case in the live stream — announced nothing.
		aria-busy={running || undefined}
	>
		<TraceGlyph className={failed ? "text-danger" : "text-ink-dim"}>
			{icon}
		</TraceGlyph>
		{/* One inline run, so the 12px monospace label and the 13px prose share
		 * a baseline rather than each being centred in its own box.
		 *
		 * `truncate` is right for a trace of an ACTION -- a long path or command
		 * is identified by its start and the whole value is in the disclosure.
		 * It is wrong for a line whose text IS the message, which is what `wrap`
		 * marks: clipping there costs the reader the end of a sentence, and for
		 * the cold-start notices that end was the instruction (QA Q6). */}
		<span
			className={cn(
				wrap ? "min-w-0 whitespace-pre-wrap break-words" : "truncate",
			)}
		>
			<span
				className={cn(
					"font-mono text-mono-sm",
					running ? "text-ink-muted" : "text-ink-dim",
					failed && "text-danger",
				)}
			>
				{verb}
				{narration ? ":" : null}
			</span>
			{object ? (
				<span className="font-mono text-ink-muted text-mono-sm"> {object}</span>
			) : null}
			{narration ? (
				<span className="text-body-sm text-ink-muted"> {narration}</span>
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
	verbOverride,
	object,
	glyph,
	wrap,
}: TraceLineProps) => {
	const label = getTraceLabel(action, filePath, files, narration);
	const verb = verbOverride ?? (running ? label.runningVerb : label.verb);
	const Icon = failed ? CircleAlert : label.icon;
	const icon = failed || !verbOverride || !glyph ? <Icon /> : glyph;

	const row = (
		<TraceRow
			icon={icon}
			verb={verb}
			object={verbOverride ? object : label.object}
			narration={verbOverride ? narration : label.narration}
			running={running}
			failed={failed}
			wrap={wrap}
		/>
	);

	// No detail: the line is complete information on its own, so it is a static
	// row rather than a button that reveals nothing. `disabled` is the same box
	// as the trigger — same height, same reserved chevron gutter — so a running
	// step does not slide sideways or change height when it finishes and gains
	// its disclosure.
	if (!details) {
		return <Disclosure disabled summary={row} className={className} />;
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
			triggerClassName="-mx-2 rounded-sm px-2 hover:bg-elevated"
		>
			{details}
		</Disclosure>
	);
};
