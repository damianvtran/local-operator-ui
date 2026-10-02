import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import type { FC } from "react";

/**
 * The question a RUNNING console surface's close asks first (issue #754).
 *
 * WHY A RUNNING CLOSE ASKS AND AN ENDED ONE DOES NOT, because the asymmetry is the
 * point rather than an oversight. A running surface has a live process behind it,
 * and `host.close` refuses a kill-less close of one rather than orphaning a pty —
 * so the honest control is "end it, behind a question", and the question defaults
 * to the SAFE answer: `ConfirmationModal` focuses Cancel, and Enter therefore
 * cancels while Tab-then-Enter confirms. An ended surface has no process left to
 * end; dismissing it is the act the strip's own X names, and the retained history
 * it removes is exactly what issue #754 asked to be able to let go of.
 *
 * WHY THE COPY DOES NOT PROMISE ANYTHING ABOUT HISTORY: whether the record
 * survives a close is the SURFACE's retention policy, not this dialog's (design
 * 7.2 — on for a user's surface, off for an agent's), and a sentence that named
 * one of the two would be false for the other. What the dialog says is the half
 * that is true either way: the program ends, the tab goes.
 */
export interface ConsoleCloseDialogProps {
	open: boolean;
	/** A close is in flight. The host signals the process and waits out its bounded
	 * grace (§6.7), so the dialog owns the window between the press and the answer;
	 * `busy` blocks every close path so one press is one request. */
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export const ConsoleCloseDialog: FC<ConsoleCloseDialogProps> = ({
	open,
	busy,
	onConfirm,
	onCancel,
}) => (
	<ConfirmationModal
		open={open}
		title="Close this terminal?"
		message="This ends the program running here and removes its tab."
		confirmText="Close terminal"
		busyText="Closing…"
		busy={busy}
		isDangerous
		onConfirm={onConfirm}
		onCancel={onCancel}
	/>
);
