/**
 * The Monitors section's cancel interaction: the confirmation, the write's
 * in-flight window, and the per-row record of what an attempt did.
 *
 * ## Why the state lives in the pane body and not in the section (U2)
 *
 * The section is gated on `details.monitors.length` (`run-details-panel.tsx`),
 * and every cancel - success or refusal - fires the canonical re-read
 * (`use-monitor-controls.ts`'s `finally`), which for a moment re-renders the
 * pane with an EMPTY monitors list. A dialog owned by the section unmounted
 * with it mid-refusal: measured, ~8 of 34 refusals lost their sentence 60-400 ms
 * after it painted and the keyboard fell to `<body>` (UX review round 1, U2).
 * The pane BODY is above that gate and never unmounts on list churn, so the
 * whole interaction - the pending row, the refusal, the in-flight flag and the
 * per-row records - is owned there and the section stays presentational: it
 * renders rows from `details` and asks `request` on a press. This is the
 * `use-mcp-remedy.ts` arrangement, one level down: the memory lives where the
 * churn cannot reach it.
 *
 * ## What each piece of state is for, finding for finding
 *
 * - `pending` is the pressed row, carried by VALUE (id + name) like the delete
 *   dialog carries its refusal by id: the dialog's sentence is about the row
 *   that was pressed, not about whatever the list holds later.
 * - `busy` spans the whole write - including the one retry the model keeps -
 *   and the confirmation refuses every close path while it is set, so a
 *   refusal always lands in the dialog that asked and a second press cannot
 *   re-send (U3; one request per press against an answering writer).
 * - `refusal` renders in the dialog in the danger ink and is cleared on close
 *   AND on open, so reopening a refused row never shows a sentence about an
 *   attempt the reader has not made yet (U5).
 * - `cancelledIds` is the settling acknowledgement: a receipt of `ok` marks
 *   the row `Cancelled` immediately, and the re-read that drops the row is
 *   what ends the mark - during the measured 2.5-13 s lag the row used to say
 *   nothing at all (U4).
 * - `refusedIds` is the quiet record a refused attempt leaves on its row
 *   (`Cancel refused`, the whole sentence on `title`), cleared on the next
 *   attempt against that row (U8's "cleared on the next change").
 *
 * Everything resets when the SESSION changes: monitor handles are per-session
 * (`m1`..), so a pending row or a mark from one conversation must not be read
 * against another conversation's list.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MonitorRow } from "./run-detail-model";
import type { MonitorControls } from "./use-monitor-controls";

/** What one row's control column shows instead of the plain control. */
export type MonitorRowCancelState =
	/** The receipt landed; the row awaits the re-read that drops it (U4). */
	| { kind: "cancelled" }
	/** A refused attempt, its sentence dismissed; quiet until the next change (U8). */
	| { kind: "refused"; detail: string };

/** What the section consumes from the pane body. */
export type MonitorCancelSection = {
	/** Ask to cancel this watch; the pane body owns the confirmation and the write. */
	request: (row: MonitorRow) => void;
	/** The row's cancel state now, or `undefined` for the plain control. */
	stateFor: (row: MonitorRow) => MonitorRowCancelState | undefined;
};

/** The confirmation's props, spread onto `MonitorCancelDialog`. */
export type MonitorCancelDialogProps = {
	open: boolean;
	name: string | null;
	refusal: string | null;
	refusalSeq: number;
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export type MonitorCancelInteraction = {
	section: MonitorCancelSection;
	dialog: MonitorCancelDialogProps;
};

const cancelControl = (id: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[data-monitor-cancel="${id}"]`);

/**
 * The focus chain after `id`'s control (U1): every later Cancel in the same
 * section, in document order, and that section's fallback heading. Scoped to
 * the pressed control's `<section>` so a second list elsewhere in the document
 * is never a target; the document is the scope only when there is no section.
 */
const focusSuccessors = (
	id: string,
): { ids: string[]; fallback: HTMLElement | null } => {
	const pressed = cancelControl(id);
	const scope: ParentNode = pressed?.closest("section") ?? document;
	const controls = Array.from(
		scope.querySelectorAll<HTMLElement>("[data-monitor-cancel]"),
	);
	const at = controls.findIndex(
		(control) => control.getAttribute("data-monitor-cancel") === id,
	);
	return {
		ids:
			at < 0
				? []
				: controls
						.slice(at + 1)
						.map((control) => control.getAttribute("data-monitor-cancel") ?? "")
						.filter((successor) => successor !== ""),
		fallback: scope.querySelector<HTMLElement>("[data-monitor-focus-fallback]"),
	};
};

/** Focus the first candidate control that is still there and enabled, else the fallback. */
const focusFirstAvailable = (
	candidates: string[],
	fallback: HTMLElement | null,
): void => {
	for (const id of candidates) {
		const control = cancelControl(id);
		if (!control || control.hasAttribute("disabled")) continue;
		control.focus();
		if (document.activeElement === control) return;
	}
	if (fallback?.isConnected) fallback.focus();
};

export const useMonitorCancel = ({
	sessionId,
	controls,
}: {
	sessionId: string | null;
	controls: MonitorControls;
}): MonitorCancelInteraction => {
	const [pending, setPending] = useState<{ id: string; name: string } | null>(
		null,
	);
	const [refusal, setRefusal] = useState<string | null>(null);
	/*
	 * A COUNTER rather than a boolean, because the modal takes the signal as a
	 * CHANGE (`focusCancelSignal`): a second refusal has to move the keyboard
	 * back to Keep again, and a boolean already true would be no change at all.
	 */
	const [refusalSeq, setRefusalSeq] = useState(0);
	const [busy, setBusy] = useState(false);
	const [cancelledIds, setCancelledIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [refusedIds, setRefusedIds] = useState<ReadonlyMap<string, string>>(
		new Map(),
	);
	/*
	 * The latest `pending`, read by the write's continuation after its await:
	 * a session switch (or any other reset) replaces the state the closure was
	 * born with, and the outcome must then land nowhere rather than in a list
	 * that is no longer on screen. Synced by effect rather than assigned during
	 * render, so a concurrent render cannot observe a half-written value.
	 */
	const pendingRef = useRef(pending);
	useEffect(() => {
		pendingRef.current = pending;
	});
	/*
	 * The last row a dialog was opened for, for the focus fallback below. The
	 * SESSION RESET nulls it: a stale id would otherwise be matched against the
	 * next conversation's list, whose handles collide by construction (`m1`..).
	 */
	const lastPressedIdRef = useRef<string | null>(null);
	/*
	 * Where focus goes when the pressed control cannot take it back (UX round 1,
	 * U1, PR #1930): the Cancel controls that FOLLOW the pressed one, in document
	 * order, and the section's `[data-monitor-focus-fallback]` heading. Captured
	 * at press time because by the time the dialog closes the pressed row is a
	 * disabled `Cancelled` mark and, once the re-read lands, gone.
	 */
	const successorIdsRef = useRef<string[]>([]);
	const fallbackRef = useRef<HTMLElement | null>(null);

	/*
	 * A switch to another conversation closes everything this interaction holds.
	 * Declared before the fallback effect so a switch nulls the row id before
	 * the fallback can read it (effects run in declaration order).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the SESSION is the trigger, not a value the body reads - the reset must re-run when the conversation changes, which the analyser cannot infer from setters alone (the `use-scroll-paging.ts` precedent).
	useEffect(() => {
		setPending(null);
		setRefusal(null);
		setBusy(false);
		setCancelledIds(new Set());
		setRefusedIds(new Map());
		lastPressedIdRef.current = null;
	}, [sessionId]);

	/*
	 * FOCUS FALLS BACK TO THE ROW'S OWN CONTROL, THEN FORWARD. The dialog primitive
	 * restores focus to the opener it captured while the opener is still
	 * connected and enabled; when it could not, the row's control is the
	 * successor of the same act - the rule the delete dialog's fallback records.
	 * After a SUCCESSFUL cancel that control is the disabled `Cancelled` mark (and
	 * soon not there at all), so focus used to fall to `<body>` and a keyboard
	 * user cancelling several watches re-Tabbed from the top every time (U1). The
	 * chain is therefore: the pressed control if it can take focus (a refusal),
	 * else the next line's Cancel, else the next row's (both are "the next
	 * `[data-monitor-cancel]` in document order"), else the section heading.
	 *
	 * Only when focus went NOWHERE: a focus the primitive already restored is
	 * left exactly where it is. The dialog may still hold focus for its exit
	 * animation, and the primitive restores on a `setTimeout(0)` after unmount,
	 * so the check re-runs per frame (bounded, ~1 s) until focus has left the
	 * dialog, rather than deciding once before the primitive has had its turn.
	 */
	useEffect(() => {
		if (pending !== null) return;
		const id = lastPressedIdRef.current;
		if (id === null) return;
		const candidates = [id, ...successorIdsRef.current];
		const fallback = fallbackRef.current;
		let frame = 0;
		let tries = 0;
		const settle = () => {
			const active = document.activeElement;
			if (active === null || active === document.body) {
				focusFirstAvailable(candidates, fallback);
				return;
			}
			if (!active.closest('[role="dialog"]')) return;
			tries += 1;
			if (tries < 60) frame = requestAnimationFrame(settle);
		};
		settle();
		return () => cancelAnimationFrame(frame);
	}, [pending]);

	const request = useCallback(
		(row: MonitorRow) => {
			if (busy) return;
			lastPressedIdRef.current = row.id;
			const successors = focusSuccessors(row.id);
			successorIdsRef.current = successors.ids;
			fallbackRef.current = successors.fallback;
			setPending({ id: row.id, name: row.name });
			/*
			 * A fresh open is a FRESH question: the previous refusal's sentence is
			 * cleared (U5: reopening a refused row showed the old sentence before
			 * any press) and so is that row's record of it - U8's "cleared on the
			 * next change", where the next change is the next attempt.
			 */
			setRefusal(null);
			setRefusedIds((map) => {
				if (!map.has(row.id)) return map;
				const next = new Map(map);
				next.delete(row.id);
				return next;
			});
		},
		[busy],
	);

	const dismiss = useCallback(() => {
		/*
		 * Unreachable while a write is in flight - the modal disables both
		 * buttons and refuses Escape, an outside click and the corner X - and
		 * kept as the guard that makes that a rule rather than a coincidence.
		 */
		if (busy) return;
		setPending(null);
		setRefusal(null);
	}, [busy]);

	const confirm = useCallback(() => {
		if (!pending || busy) return;
		const pressed = pending;
		setBusy(true);
		void (async () => {
			const outcome = await controls.cancel(pressed.id);
			/*
			 * The dialog was reset under the continuation (a session switch):
			 * the outcome belongs to a list that is no longer on screen, and
			 * the write itself is already sent - the canonical re-read the
			 * controls fire reconciles the store either way.
			 */
			if (pendingRef.current?.id !== pressed.id) return;
			setBusy(false);
			if (outcome.ok) {
				/*
				 * The receipt IS the acknowledgement (U4): mark the row now, and
				 * let the re-read that drops it be what ends the mark. The record
				 * of a previous refusal goes with the success.
				 */
				setCancelledIds((ids) => new Set(ids).add(pressed.id));
				setRefusedIds((map) => {
					if (!map.has(pressed.id)) return map;
					const next = new Map(map);
					next.delete(pressed.id);
					return next;
				});
				setPending(null);
				setRefusal(null);
				return;
			}
			/*
			 * A refusal keeps the dialog OPEN with the backend's own sentence -
			 * the one surface that can still say what happened - and hands the
			 * keyboard back to Keep (`refusalSeq`). The row also records it
			 * (U8): invisible behind the scrim now, read after a dismissal.
			 */
			setRefusedIds((map) => new Map(map).set(pressed.id, outcome.detail));
			setRefusal(outcome.detail);
			setRefusalSeq((seq) => seq + 1);
		})();
	}, [pending, busy, controls]);

	const stateFor = useCallback(
		(row: MonitorRow): MonitorRowCancelState | undefined => {
			if (cancelledIds.has(row.id)) return { kind: "cancelled" };
			const detail = refusedIds.get(row.id);
			return detail === undefined ? undefined : { kind: "refused", detail };
		},
		[cancelledIds, refusedIds],
	);

	return {
		section: { request, stateFor },
		dialog: {
			open: pending !== null,
			name: pending?.name ?? null,
			refusal,
			refusalSeq,
			busy,
			onConfirm: confirm,
			onCancel: dismiss,
		},
	};
};
