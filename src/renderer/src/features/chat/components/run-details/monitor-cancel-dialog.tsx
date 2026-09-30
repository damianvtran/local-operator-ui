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
 * action the one the keyboard holds (UX review round 1, U7). The busy window
 * keeps the SAME verb as the confirm - `Stopping…` for `Stop monitor` (design
 * round 1, D3): the button the reader pressed must not turn into a different
 * act mid-press, which is what `Cancelling…` did under `Stop monitor`. A refusal
 * renders in the danger ink INSIDE this dialog, and the whole dialog is kept
 * open with focus handed back to Keep; the busy window (`busy`/`busyText`)
 * belongs to the shared modal - see `confirmation-modal.tsx`.
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
		busyText="Stopping…"
		busy={busy}
		cancelText="Keep"
		isDangerous
		/*
		 * D4: the panel's width is PINNED so the refusal cannot resize the card -
		 * between the first press and the retry it grew ~332 -> ~357 CSS px and
		 * re-centred, moving the buttons under the pointer. 26rem is the card's own
		 * confirm-state width at the capture viewport; the viewport cap keeps a
		 * narrow window from overflowing it.
		 */
		panelClassName="w-[26rem] max-w-[calc(100vw-4rem)]"
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
