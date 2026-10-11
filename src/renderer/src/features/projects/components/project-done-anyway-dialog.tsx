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
	doneGateSentence,
} from "../project-model";
import { projectGoneError, projectMoveErrorCopy } from "../project-refusals";

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
	/*
	 * The failure keeps its two facts apart: the sentence to show, and whether
	 * the project is GONE underneath us (a 404). A gone project cannot be
	 * closed or opened, so the footer swaps its primary for Close rather than
	 * offering a press that cannot succeed (design round 1, D9).
	 */
	const [failure, setFailure] = useState<{
		copy: string;
		gone: boolean;
	} | null>(null);
	/*
	 * The primary stays FOCUSED while the write is in flight and after it
	 * fails. It used to take the real `disabled` attribute, and a disabled
	 * element cannot hold focus: the caret fell to `<body>` for the whole
	 * write, and after an in-dialog failure it rested on the dialog container,
	 * where the next Enter did nothing (QA round 1, Q2). `aria-disabled`
	 * states the same condition to assistive technology while leaving the
	 * control focusable, so the reader's next Enter retries; the press itself
	 * is refused by the in-flight latch, which is what actually prevents a
	 * double submit.
	 */

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
		setFailure(null);
		inFlight.current = false;
	}, [open]);

	const handleConfirm = async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		setSubmitting(true);
		setFailure(null);
		try {
			await onConfirm();
			onClose();
		} catch (failure) {
			/*
			 * The route's own sentence through the app's copy (the same mapping
			 * the detail's inline editors use); a refusal with no words falls back
			 * to a sentence in the app's voice rather than an empty red line.
			 */
			setFailure({
				copy: projectMoveErrorCopy(failure),
				gone: projectGoneError(failure),
			});
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
				/*
				 * THE FOOTER WRAPS RATHER THAN OVERFLOWING (design round 1, D1;
				 * QA round 1, Q1): three content-sized buttons can exceed the
				 * dialog's content box - the detail path's "Review milestones"
				 * plus the busy spinner measured 4-26px past the panel edge -
				 * and the overflow painted OUTSIDE the dialog border. The row
				 * wraps at the content edge instead, so the invariant holds for
				 * any label a future copy change ships.
				 */
				<div className="flex w-full min-w-0 flex-wrap justify-end gap-2">
					<SecondaryButton
						ref={cancelRef}
						onClick={onClose}
						disabled={submitting}
					>
						Cancel
					</SecondaryButton>
					{/*
					 * A GONE PROJECT HAS NOTHING TO OPEN: the secondary action
					 * navigates to a row that no longer exists, so the failure
					 * that says so removes it rather than leaving a second
					 * press that cannot succeed (design round 1, D9).
					 */}
					{!failure?.gone && (
						<SecondaryButton onClick={onSecondary} disabled={submitting}>
							{secondaryLabel}
						</SecondaryButton>
					)}
					{failure?.gone ? (
						<PrimaryButton data-project-force-close="" onClick={onClose}>
							Close
						</PrimaryButton>
					) : (
						<PrimaryButton
							data-project-force-done=""
							/* Focus retention, not a second disabled styling path: the
							 * roles are the primary's own `disabled:` roles, retargeted
							 * at `aria-disabled` (QA round 1, Q2). */
							aria-disabled={submitting}
							className="aria-disabled:pointer-events-none aria-disabled:bg-sunken aria-disabled:text-ink-disabled"
							onClick={() => void handleConfirm()}
						>
							{/*
							 * THE SPINNER'S SLOT IS RESERVED (design round 1, D4): the
							 * icon appearing used to widen the primary by 22px and shift
							 * its neighbours under a pointer that was still on them. An
							 * empty cell of the same measure holds the width steady in
							 * both states.
							 */}
							{submitting ? (
								<Spinner size="xs" />
							) : (
								<span aria-hidden="true" className="size-3.5 shrink-0" />
							)}
							Mark done anyway
						</PrimaryButton>
					)}
				</div>
			}
		>
			<div className="flex flex-col gap-3">
				{/*
				 * THE CONSEQUENCE LEADS, IN INK (design round 1, D6): this is the
				 * sentence that keeps the project's record honest - the milestones
				 * stay open - and it used to sit last, in the muted role, under the
				 * disclosure. It follows the title's question directly.
				 */}
				<p className="text-body-sm text-ink break-words">
					{projectLabel
						? `${projectLabel} moves to Done and its milestones stay open.`
						: "The project moves to Done and its milestones stay open."}
				</p>
				{/*
				 * WHAT IS OPEN, as a statement: the title asks the question, so
				 * this no longer repeats "Mark done anyway?" (design round 1, D6).
				 * `break-words` because a milestone name is free text up to 80
				 * characters and an unbroken one used to scroll the body sideways
				 * (design round 1, D7; agent review F6).
				 */}
				<p className="text-body-sm text-ink break-words">
					{refusal ? doneGateSentence(refusal) : ""}
				</p>
				{/*
				 * THE FULL LIST IS ONE PRESS AWAY, not in the sentence: the real
				 * case is a seven-milestone, all-overdue plan, and reciting it would
				 * bury the count and the remedy. The disclosure appears only when
				 * the sentence actually folded something (at four names the sentence
				 * lists all four - design round 1, D6), and its wrapper is inset so
				 * the 2px focus outline plus its 2px offset stays inside the body's
				 * scroll clip - full-bleed, the ring's left and right sides were cut
				 * off (design round 1, D3).
				 */}
				{names.length > DONE_GATE_NAMES_SHOWN + 1 && (
					<div className="px-1.5">
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
					</div>
				)}
				{/*
				 * THE FAILURE LINE IS A RESERVED SLOT, present whether or not
				 * something is showing (the inline editors' `min-h-[1lh]` rule):
				 * an error arriving used to move the footer 16px under a pointer
				 * that was still on the primary (design round 1, D4). One line is
				 * reserved; a sentence that wraps beyond one still grows, which is
				 * the honest trade for text we do not control.
				 */}
				<p
					role="alert"
					className="min-h-[1lh] text-body-sm text-danger break-words"
				>
					{failure?.copy ?? ""}
				</p>
			</div>
		</BaseDialog>
	);
};
