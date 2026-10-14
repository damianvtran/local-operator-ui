import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { t } from "@shared/i18n";
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
 * WHY THE REASSURANCE IS CONDITIONAL (UX round 1, U6): whether the record survives
 * a close is the SURFACE's retention policy, not this dialog's (design 7.2 — on for
 * a user's surface, off for an agent's), so "Its output is kept." is said only when
 * the pending row's own `retain` flag says it is true — the agent-owned case would
 * make the sentence a lie. What holds either way stays in the first sentence: the
 * program ends, the tab goes.
 *
 * WHY A REFUSAL IS RENDERED HERE (UX round 1, U3): the confirmed press can be
 * refused (a race with an agent that ended the surface, a transport failure), and
 * the dialog used to clear in `.finally` as if every outcome had succeeded — "I
 * pressed Close and nothing happened". The pane keeps this dialog open on a
 * refusal and passes the handler's own sentence in; `refusalSeq` moves the keyboard
 * back to Cancel through the shared modal's `focusCancelSignal`, because the safe
 * action is the one that must not repeat a refused act.
 */
export interface ConsoleCloseDialogProps {
	open: boolean;
	/** A close is in flight. The host signals the process and waits out its bounded
	 * grace (§6.7), so the dialog owns the window between the press and the answer;
	 * `busy` blocks every close path so one press is one request. */
	busy: boolean;
	/** Whether the pending surface's history is persisted (§7.2), straight off the
	 * row: only then does the question promise the output is kept. */
	keepsOutput: boolean;
	/**
	 * Which question this is (design round 1, D6). The running close and the
	 * retained dismissal share the modal but not the copy: a close says what ends,
	 * a dismissal says what is deleted. Defaulted to `close` so the existing call
	 * sites are unchanged.
	 */
	kind?: "close" | "dismiss";
	/** The refusal of the last confirmed press, in the handler's own words; `null`
	 * while nothing was refused. */
	refusal: string | null;
	/** A COUNTER, because the modal takes `focusCancelSignal` as a CHANGE: a second
	 * refusal has to move the keyboard back to Cancel again. */
	refusalSeq: number;
	onConfirm: () => void;
	onCancel: () => void;
}

export const ConsoleCloseDialog: FC<ConsoleCloseDialogProps> = ({
	open,
	busy,
	keepsOutput,
	kind = "close",
	refusal,
	refusalSeq,
	onConfirm,
	onCancel,
}) => (
	<ConfirmationModal
		open={open}
		title={t(
			kind === "dismiss"
				? "ui.console.dismiss.title"
				: "ui.console.close.title",
		)}
		message={
			<>
				<p>
					{t(
						kind === "dismiss"
							? "ui.console.dismiss.body"
							: "ui.console.close.body",
					)}
				</p>
				{keepsOutput ? (
					<p className="pt-2">{t("ui.console.close.kept")}</p>
				) : null}
				{refusal !== null ? (
					<p className="pt-2 text-danger">{refusal}</p>
				) : null}
			</>
		}
		confirmText={t(
			kind === "dismiss"
				? "ui.console.dismiss.confirm"
				: "ui.console.close.confirm",
		)}
		busyText={t("ui.console.close.busy")}
		busy={busy}
		isDangerous
		focusCancelSignal={refusalSeq}
		onConfirm={onConfirm}
		onCancel={onCancel}
	/>
);
