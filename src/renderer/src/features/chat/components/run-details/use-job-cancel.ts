/**
 * The Jobs section's cancel interaction: the confirmation, the write's
 * in-flight window, and where the keyboard lands after it.
 *
 * ## Why the state lives in the pane body and not in the section
 *
 * The section is gated on `details.openJobs > 0` (`run-details-panel.tsx`),
 * and every cancel — success or refusal — fires the canonical re-read
 * (`use-job-controls.ts`'s `finally`), which can re-render the pane with an
 * EMPTY jobs list for a moment. A card owned by the section unmounted with it
 * mid-refusal — the exact class the monitors' round measured (U2): refusals
 * lost their sentence 60-400 ms after it painted and the keyboard fell to
 * `<body>`. The pane BODY is above that gate and never unmounts on list churn,
 * so the whole interaction — the pending row, its frozen anchor, the refusal
 * and the in-flight flag — is owned there and the section stays presentational:
 * it renders rows from `details` and asks `request` on a press.
 *
 * ## What each piece of state is for
 *
 * - `pending` is the row whose CONFIRMATION is open, carried by VALUE (id +
 *   label) like the monitors' dialog carries its refusal by id: the question is
 *   about the row that was pressed, not about whatever the list holds later.
 * - `anchor` is the pressed control's viewport rect, captured at press time.
 *   The card is anchored to that FROZEN rect rather than to the button, because
 *   the row can unmount under the churn — a live element would take the card
 *   with it, and a zeroed rect from a detached node would paint it in the
 *   corner (`cancel-card-placement.ts` carries the geometry).
 * - `busy` spans the whole write — including the one retry the policy keeps —
 *   and the confirmation refuses every close path while it is set, so a refusal
 *   always lands where it was asked and a second press cannot re-send.
 * - `refusal` renders in the open card in the danger ink and is cleared on
 *   close AND on open, so reopening a refused row never shows a sentence about
 *   an attempt the reader has not made yet (the monitors' rule).
 *
 * ## No local `cancelled` mark, deliberately
 *
 * The wakes and monitors mark their row `Cancelled` the moment a receipt lands,
 * because their writes ARE the settle: the row is really gone. A job's cancel
 * is NOT the settle — the provider may still finish — and the honesty rule
 * every surface keeps (design spec §2.1) is that a press never paints
 * `cancelled`: only the job's own settled word does, through the wire. So this
 * interaction holds no mark set; the canonical re-read is the row's only
 * witness, and the busy window is the only local state a write leaves.
 *
 * ## Where the keyboard lands
 *
 * The monitors' rule, extended by one step: the card hands focus back to the
 * row's own control when it still exists (a refusal's row stays live as its own
 * next attempt), else to the pane (`[data-run-panel-pane]`) — so a write that
 * takes its row and its control away does not leave the keyboard on `<body>`. A
 * dismissal whose press points at something focusable keeps that press's own
 * landing (`pressKeepsFocus`). The wake interaction's MODULE-SCOPE hold (its
 * Q7) is deliberately not replicated: that ladder answers the wake list's
 * measured whole-panel churn, and this interaction's row-replacement case ends
 * on the pane. Everything resets when the SESSION changes — job ids are minted
 * per runtime, so a pending row from one conversation must not be read against
 * another conversation's list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CancelCardAnchor } from "./cancel-card-placement";
import type { JobCancelSection, JobControls } from "./job-controls-model";
import type { SubagentRow } from "./run-detail-model";

/** The pressed row's own control, by job id. */
const jobCancelControl = (id: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[data-job-cancel="${CSS.escape(id)}"]`);

/**
 * Where a closed question's keyboard lands when focus fell through: the row's
 * own control while it is still there, else the pane itself. A refused row is
 * still live — its control is the next attempt (the monitors' rule) — and a
 * landed cancel may have taken the row with it, which is the pane's case.
 */
const jobCancelLanding = (id: string): HTMLElement | null =>
	jobCancelControl(id) ??
	document.querySelector<HTMLElement>("[data-run-panel-pane]");

/**
 * Whether the keyboard fell through after a close, for the effect below; the
 * resolution itself decides where it lands.
 *
 * The arms are the monitors' own, minus their wake-specific disabled case (this
 * interaction marks no row, so the pressed control is never disabled by it):
 * nothing or the `<body>` — the browser dropped focus and nobody caught it; or
 * the CLOSING CARD's own element — the outside press resolves its focus default
 * AFTER the commit that closed the question, so the card can still hold it at
 * the instant this is asked, and a card about to unmount is not holding the
 * keyboard.
 */
const jobFocusFellThrough = (active: Element | null): boolean =>
	active === null ||
	active === document.body ||
	active.closest("[data-job-confirm]") !== null;

/** The confirmation's props, spread onto `JobCancelPopover`. */
export type JobCancelPopoverProps = {
	open: boolean;
	/** The pressed row's label, for the copy ("this job"). */
	label: string | null;
	anchor: CancelCardAnchor | null;
	refusal: string | null;
	refusalSeq: number;
	busy: boolean;
	onConfirm: () => void;
	/**
	 * `pressKeepsFocus` marks a dismissal whose press points at a focusable
	 * target: the default is landing the keyboard THERE, so the landing stands
	 * down (the popover's own rule).
	 */
	onCancel: (options?: { pressKeepsFocus?: boolean }) => void;
};

export type JobCancelInteraction = {
	section: JobCancelSection;
	popover: JobCancelPopoverProps;
};

export const useJobCancel = ({
	sessionId,
	controls,
}: {
	/** The conversation whose Jobs section this is, or `null` when none exists. */
	sessionId: string | null;
	controls: JobControls;
}): JobCancelInteraction => {
	const [pending, setPending] = useState<{
		id: string;
		label: string;
	} | null>(null);
	const [anchor, setAnchor] = useState<CancelCardAnchor | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);
	/*
	 * A COUNTER rather than a boolean, because the card takes the signal as a
	 * CHANGE: a second refusal has to move the keyboard back to Keep again, and
	 * a boolean already true would be no change at all (the monitors' rule).
	 */
	const [refusalSeq, setRefusalSeq] = useState(0);
	const [busy, setBusy] = useState(false);
	/*
	 * The latest `pending`, read by the write's continuation after its await: a
	 * session switch (or any other reset) replaces the state the closure was
	 * born with, and the outcome must then land nowhere rather than in a list
	 * that is no longer on screen.
	 */
	const pendingRef = useRef(pending);
	useEffect(() => {
		pendingRef.current = pending;
	});
	/*
	 * The last row a card was opened for, for the focus fallback below. The
	 * SESSION RESET nulls it: a stale id would otherwise be matched against the
	 * next conversation's list.
	 */
	const lastPressedIdRef = useRef<string | null>(null);
	/*
	 * THE PRESS'S OWN KEYBOARD, when the dismissing press points at something
	 * that can take focus: the press default is landing there, so the fallback
	 * stands down rather than stealing the keyboard first. Consumed by the
	 * fallback effect — one dismissal, one read — and reset with the rest of the
	 * interaction on a session switch.
	 */
	const pressKeepsFocusRef = useRef(false);

	/*
	 * A switch to another conversation closes everything this interaction holds.
	 * Declared before the fallback effect so a switch nulls the row id before the
	 * fallback can read it (effects run in declaration order).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the SESSION is the trigger, not a value the body reads - the reset must re-run when the conversation changes, which the analyser cannot infer from setters alone (the monitors' precedent).
	useEffect(() => {
		setPending(null);
		setAnchor(null);
		setRefusal(null);
		setBusy(false);
		pressKeepsFocusRef.current = false;
		lastPressedIdRef.current = null;
	}, [sessionId]);

	/*
	 * FOCUS FALLS BACK TO THE ROW'S OWN CONTROL (the header's rules). The card
	 * restores focus to the opener it captured while that opener is still
	 * connected; when it could not, the fallback resolution replaces it. Only
	 * when focus FELL THROUGH: a focus already restored, or moved somewhere
	 * real, is left exactly where it is.
	 */
	useEffect(() => {
		if (pending !== null) return;
		const id = lastPressedIdRef.current;
		const pressKeepsFocus = pressKeepsFocusRef.current;
		pressKeepsFocusRef.current = false;
		if (id === null) return;
		if (pressKeepsFocus) return;
		if (!jobFocusFellThrough(document.activeElement)) return;
		jobCancelLanding(id)?.focus();
	}, [pending]);

	const request = useCallback(
		(row: SubagentRow, pressedAnchor: CancelCardAnchor) => {
			if (busy) return;
			lastPressedIdRef.current = row.id;
			setPending({ id: row.id, label: row.label });
			setAnchor(pressedAnchor);
			/*
			 * A fresh open is a FRESH question: the previous refusal's sentence is
			 * cleared, so reopening a refused row never shows the old sentence about
			 * an attempt the reader has not made yet.
			 */
			setRefusal(null);
		},
		[busy],
	);

	const dismiss = useCallback(
		(options?: { pressKeepsFocus?: boolean }) => {
			/*
			 * Unreachable while a write is in flight - the card disables both
			 * buttons and refuses Escape and an outside press - and kept as the
			 * guard that makes that a rule rather than a coincidence.
			 */
			if (busy) return;
			if (options?.pressKeepsFocus === true) pressKeepsFocusRef.current = true;
			setPending(null);
			setRefusal(null);
		},
		[busy],
	);

	const confirm = useCallback(() => {
		if (!pending || busy) return;
		const pressed = pending;
		setBusy(true);
		void (async () => {
			const outcome = await controls.cancel(pressed.id);
			/*
			 * The card was reset under the continuation (a session switch): the
			 * outcome belongs to a list that is no longer on screen, and the write
			 * itself is already sent — the canonical re-read the controls fire
			 * reconciles the store either way.
			 */
			if (pendingRef.current?.id !== pressed.id) return;
			setBusy(false);
			if (outcome.ok) {
				/*
				 * The receipt is the acknowledgement, NOT the settle: the row
				 * paints `Cancelled` only when the wire delivers it (the honesty
				 * rule), so nothing local marks the row here — the canonical
				 * re-read is what ends it.
				 */
				setPending(null);
				setRefusal(null);
				return;
			}
			/*
			 * A refusal keeps the card OPEN with the engine's own sentence — the
			 * one surface that can still say what happened — and hands the
			 * keyboard back to Keep (`refusalSeq`).
			 */
			setRefusal(outcome.detail);
			setRefusalSeq((seq) => seq + 1);
		})();
	}, [pending, busy, controls]);

	return {
		section: { request },
		popover: {
			open: pending !== null,
			label: pending?.label ?? null,
			anchor,
			refusal,
			refusalSeq,
			busy,
			onConfirm: confirm,
			onCancel: dismiss,
		},
	};
};
