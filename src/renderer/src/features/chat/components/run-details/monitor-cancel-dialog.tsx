/**
 * The monitor cancel's one confirmation, as the pane body renders it.
 *
 * The section no longer owns this dialog (see `use-monitor-cancel.ts` for the
 * churn that decided that), so the JSX lives here, next to the hook whose
 * state it takes as plain props - the body wires the two together and this
 * component decides nothing.
 *
 * Copy: the title names the act on the object ("Cancel this monitor?") and the
 * confirm names it precisely as an act ("Stop monitor") so `Cancel` is not
 * doing both jobs at once - the dismiss is `Keep`, which is what makes the safe
 * action the one the keyboard holds (UX review round 1, U7). A refusal renders
 * in the danger ink INSIDE this dialog, and the whole dialog is kept open with
 * focus handed back to Keep; the busy window (`busy`/`busyText`) belongs to the
 * shared modal - see `confirmation-modal.tsx`.
 */
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import type { MonitorCancelDialogProps } from "./use-monitor-cancel";

export const MonitorCancelDialog = ({
	open,
	name,
	refusal,
	refusalSeq,
	busy,
	onConfirm,
	onCancel,
}: MonitorCancelDialogProps) => (
	<ConfirmationModal
		open={open}
		title="Cancel this monitor?"
		message={
			<>
				<p>
					{name === null
						? ""
						: `“${name}” will not check again. The conversation stays.`}
				</p>
				{refusal !== null && <p className="pt-2 text-danger">{refusal}</p>}
			</>
		}
		confirmText="Stop monitor"
		busyText="Cancelling…"
		busy={busy}
		cancelText="Keep"
		isDangerous
		/*
		 * The refusal is the only thing this dialog can be told that makes the
		 * SAFE action the one the keyboard should hold: the cancel did not
		 * happen, and the next Enter must not repeat it.
		 */
		focusCancelSignal={refusalSeq}
		onConfirm={onConfirm}
		onCancel={onCancel}
	/>
);
