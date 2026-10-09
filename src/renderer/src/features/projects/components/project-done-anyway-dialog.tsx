/**
 * The deliberate close: "this project has open milestones - mark it done
 * anyway?".
 *
 * WHY A DIALOG, NOT A TOAST WITH A BUTTON. The daemon refuses `status: done`
 * while milestones are open (the done-gate) and offers exactly one escape,
 * `force_done`, which closes the project and LEAVES THE MILESTONES OPEN. That
 * is a decision about the plan's honesty, so it is asked as a question the
 * reader answers, with the names of what they are about to close over - not a
 * retry affordance on a notification that can time out under the pointer.
 *
 * WHY IT DOES NOT COMPLETE THE MILESTONES FOR THEM. Completing them would stamp
 * completion dates on work nobody did, which is a false statement in the
 * record. The agent tool's `force_done` deliberately leaves them open and says
 * so; this dialog does the same and its success toast says so too
 * (`forcedCloseToastText`). The way to a TRUE close is the secondary action:
 * go and complete the milestones.
 *
 * THREE EXITS, ONE WRITE. `Mark done anyway` is the only action that writes.
 * `Cancel` (also Escape, the corner X and a click on the scrim) and the
 * secondary action leave the project exactly as it was. Initial focus lands on
 * Cancel - the safe action - rather than on the primary, so Enter on a dialog
 * that just opened cannot close a project over open work.
 *
 * STATES, in the `project-form-dialog.tsx` shape: idle; submitting (the
 * primary is busy, every other exit is refused so the write is never
 * abandoned half-read, and a second press is ignored); error (the route's own
 * sentence under the question, dialog stays open, the press can be repeated);
 * success (the caller's `onConfirm` resolved, so the dialog closes and the
 * caller speaks the result).
 *
 * The component owns presentation and the write's lifecycle only. WHICH write
 * and WHAT happens to the page afterwards (toast, focus hand-off, closing an
 * inline editor) belong to the two callers - the board and the detail's status
 * field - which is what lets one dialog serve both.
 */

import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Spinner } from "@shared/components/common/spinner";
import { Disclosure } from "@shared/components/ui/disclosure";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
	DONE_GATE_NAMES_SHOWN,
	type DoneGateRefusal,
	doneGateQuestion,
} from "../project-model";
import { projectMoveErrorCopy } from "./project-editors";

export type ProjectDoneAnywayDialogProps = {
	open: boolean;
	/** The refusal being answered; null only while the dialog is closed. */
	refusal: DoneGateRefusal | null;
	/** The project's display name, for the line that says what moves. */
	projectLabel: string;
	/** Close with no write (Cancel, Escape, X, scrim). */
	onClose: () => void;
	/**
	 * Re-send the status change with `force_done`. Reject with the failure; the
	 * dialog shows its sentence and stays open. Resolve once the write landed -
	 * the caller has already spoken the result by then, so the dialog only closes.
	 */
	onConfirm: () => Promise<void>;
	/**
	 * The way to a TRUE close: "Open project" on the board, "Review milestones"
	 * on the detail (where the milestones are already on the page).
	 */
	secondaryLabel: string;
	onSecondary: () => void;
};

export const ProjectDoneAnywayDialog: FC<ProjectDoneAnywayDialogProps> = ({
	open,
	refusal,
	projectLabel,
	onClose,
	onConfirm,
	secondaryLabel,
	onSecondary,
}) => {
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/*
	 * A ref beside the state: two presses inside one render both read
	 * `submitting === false`, and the second would send a second write.
	 */
	const inFlight = useRef(false);
	const cancelRef = useRef<HTMLButtonElement>(null);

	// A fresh question on every open: the last project's failure must not stand
	// over this one's.
	useEffect(() => {
		if (!open) return;
		setSubmitting(false);
		setError(null);
		inFlight.current = false;
	}, [open]);

	const handleConfirm = async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await onConfirm();
			onClose();
		} catch (failure) {
			/*
			 * The route's own sentence through the app's copy (the same mapping
			 * the detail's inline editors use); a refusal with no words falls back
			 * to a sentence in the app's voice rather than an empty red line.
			 */
			setError(projectMoveErrorCopy(failure));
		} finally {
			inFlight.current = false;
			setSubmitting(false);
		}
	};

	const names = refusal?.names ?? [];

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title="Mark done with open milestones?"
			dataTourTag="project-done-anyway-dialog"
			maxWidth="xs"
			/*
			 * The pending window has ONE policy (the create sheet's): while the
			 * write is in flight Cancel is disabled and Escape, the scrim and the
			 * X are refused, because closing would abandon a write whose outcome
			 * the reader was about to see. `onOpenAutoFocus` sends the initial
			 * focus to Cancel; without it Radix focuses the first tabbable in
			 * DOM order, which is the disclosure (or, with none, the primary).
			 */
			dialogProps={{
				closeDisabled: submitting,
				onEscapeKeyDown: (event: KeyboardEvent) => {
					if (submitting) event.preventDefault();
				},
				onInteractOutside: (event: Event) => {
					if (submitting) event.preventDefault();
				},
				onOpenAutoFocus: (event: Event) => {
					event.preventDefault();
					cancelRef.current?.focus();
				},
			}}
			actions={
				<>
					<SecondaryButton
						ref={cancelRef}
						onClick={onClose}
						disabled={submitting}
					>
						Cancel
					</SecondaryButton>
					<SecondaryButton onClick={onSecondary} disabled={submitting}>
						{secondaryLabel}
					</SecondaryButton>
					<PrimaryButton
						data-project-force-done=""
						onClick={() => void handleConfirm()}
						disabled={submitting}
					>
						{submitting && <Spinner size="xs" />}
						Mark done anyway
					</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col gap-3">
				<p className="text-body-sm text-ink">
					{refusal ? doneGateQuestion(refusal) : ""}
				</p>
				{/*
				 * THE FULL LIST IS ONE PRESS AWAY, not in the sentence: the real
				 * case is a seven-milestone, all-overdue plan, and reciting it would
				 * bury the question. At or under the sentence's own cap the names are
				 * already all on screen, so no disclosure is drawn.
				 */}
				{names.length > DONE_GATE_NAMES_SHOWN && (
					<Disclosure summary={`Show all ${names.length} open milestones`}>
						<ul
							data-project-open-milestones=""
							className="flex flex-col gap-1 py-1 text-body-sm text-ink-muted"
						>
							{names.map((name, index) => (
								// Names are unique within a project (the store keys by name).
								<li key={`${index}-${name}`} className="break-words">
									{name}
								</li>
							))}
						</ul>
					</Disclosure>
				)}
				<p className="text-body-sm text-ink-muted">
					{projectLabel
						? `${projectLabel} moves to Done and its milestones stay open.`
						: "The project moves to Done and its milestones stay open."}
				</p>
				{error && (
					<p role="alert" className="text-body-sm text-danger">
						{error}
					</p>
				)}
			</div>
		</BaseDialog>
	);
};
