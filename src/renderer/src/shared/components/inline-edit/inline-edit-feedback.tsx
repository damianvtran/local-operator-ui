/**
 * The feedback row: the sentences a field has to say while it is not simply
 * resting - the transient "saved" caption, a refusal beside the control that
 * caused it, and the "changed elsewhere" choice a held commit waits on.
 *
 * WHY BESIDE THE FIELD AND NOT A BANNER (the #704 rule the note cites): a
 * refusal a reader cannot connect to the field it is about is a refusal they
 * have to go looking for. This component is rendered by the consumer in the
 * field's own layout (under a header, in a property row, under a textarea),
 * so it inherits that layout's spacing instead of inventing one; the module
 * keeps the copy, the roles and the aria wiring.
 *
 * THE ID IS THE EDITOR'S `aria-describedby` TARGET (`api.feedbackId`): while
 * there is feedback, the editor points at this row, so a screen reader reads
 * the refusal with the field; with no feedback the attribute is absent (the
 * hook decides), because a description pointing at an absent node is noise.
 */

import { cn } from "@shared/lib/utils";
import type { FC } from "react";
import type { InlineEditPhase } from "./inline-edit-model";

/** The conflict row's fixed interaction words: a choice, not a status. */
export const INLINE_EDIT_CONFLICT_SENTENCE =
	"This changed while you were editing";
export const INLINE_EDIT_KEEP_MINE = "Keep mine";
export const INLINE_EDIT_USE_THEIRS = "Use theirs";

/** The structural subset of the hook's API the row needs. */
export type InlineEditFeedbackHandle = {
	phase: InlineEditPhase;
	error: string | null;
	conflict: unknown | null;
	labels: { saved: string };
	feedbackId: string;
	keepMine: () => void;
	useTheirs: () => void;
	/** The refusal's own door: re-issue the same write (§ 2.6). */
	accept: () => void;
};

export type InlineEditFeedbackProps = {
	api: InlineEditFeedbackHandle;
	className?: string;
};

export const InlineEditFeedback: FC<InlineEditFeedbackProps> = ({
	api,
	className,
}) => {
	const { phase, error, conflict } = api;
	if (phase === "saved") {
		/*
		 * The transient acknowledgement: text, not a glyph, so its colour is
		 * the only channel it needs and reduced motion has nothing to cap. The
		 * same words go to the pane's one live region (the hook announces), so
		 * this copy is the sighted half of one message rather than a second.
		 */
		return (
			<p
				data-inline-edit-feedback="saved"
				className={cn("text-meta text-success", className)}
			>
				{api.labels.saved}
			</p>
		);
	}
	if (!error && !conflict) return null;
	return (
		<div
			id={api.feedbackId}
			data-inline-edit-feedback={
				error && conflict ? "error+conflict" : error ? "error" : "conflict"
			}
			/*
			 * `role="alert"` so a refusal or a held conflict REACHES a screen
			 * reader: focus stays in the editor while these appear, and
			 * `aria-describedby` is only read on re-focus, so without this the
			 * 409/done-gate sentences and the hold were silent (review round 1,
			 * m3). The row only renders when there is something to say, so the
			 * announcement coincides with its arrival.
			 */
			role="alert"
			className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}
		>
			{error && <p className="text-meta text-danger">{error}</p>}
			{error && conflict === null && (
				/*
				 * The visible Retry § 2.6 settled - re-issuing the SAME write, which
				 * is what the slot's check does in `error` (its label says so). The
				 * copy is given a door of its own because the sentence reads as a
				 * dead end otherwise; both controls call the same `accept`.
				 */
				<button
					type="button"
					data-inline-edit-control="retry"
					/*
					 * THE PRESS'S EVENT IS NOT THE VALUE (QA round 1, Q2): the button
					 * used to hand `api.accept` straight to onClick, so the machine
					 * received the MouseEvent as its `next` and every downstream
					 * layer believed it was a value - the status arm's payload
					 * carried the event object to the IPC boundary, died at
					 * structured clone, and surfaced as "could not reach the
					 * backend" with the daemon never seeing a request (4/4 runs).
					 * The empty-call arrow is the whole fix; do not regress it to a
					 * bare reference.
					 */
					onClick={() => api.accept()}
					className="cursor-pointer text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink"
				>
					Retry
				</button>
			)}
			{conflict !== null && (
				<span className="flex flex-wrap items-center gap-2">
					<span className="text-meta text-warning">
						{INLINE_EDIT_CONFLICT_SENTENCE}
					</span>
					{/* Real buttons, labelled, in the tab order - the same rule as
					 * the slot's check and x. They are deliberately NOT
					 * `preventDefault`ing their mousedown: the press may take
					 * focus, and the field is already held open by the conflict,
					 * so there is no blur for one to race. */}
					<button
						type="button"
						data-inline-edit-control="keep-mine"
						onClick={api.keepMine}
						className="cursor-pointer text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink"
					>
						{INLINE_EDIT_KEEP_MINE}
					</button>
					<button
						type="button"
						data-inline-edit-control="use-theirs"
						onClick={api.useTheirs}
						className="cursor-pointer text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink"
					>
						{INLINE_EDIT_USE_THEIRS}
					</button>
				</span>
			)}
		</div>
	);
};
