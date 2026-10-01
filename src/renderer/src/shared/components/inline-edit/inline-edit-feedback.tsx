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
export const INLINE_EDIT_CONFLICT_SENTENCE = "Changed elsewhere.";
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
			data-inline-edit-feedback={error && conflict ? "error+conflict" : error ? "error" : "conflict"}
			className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}
		>
			{error && <p className="text-meta text-danger">{error}</p>}
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
