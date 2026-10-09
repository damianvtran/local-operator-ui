/**
 * The Wakes section's cancel interaction: the one-press write, the chief of
 * staff's confirmation, and the per-row record of what an attempt did.
 *
 * ## Why the state lives in the pane body and not in the section (U2, monitors)
 *
 * The section is gated on `details.wakes.length` (`run-details-panel.tsx`),
 * and every cancel — success or refusal — fires the canonical re-read
 * (`use-wake-controls.ts`'s `resync`), which for a moment re-renders the pane
 * with an EMPTY wakes list. A surface owned by the section unmounted with it
 * mid-refusal: measured for monitors, ~8 of 34 refusals lost their sentence
 * 60-400 ms after it painted and the keyboard fell to `<body>` (UX review round
 * 1, U2), and nothing about wakes makes them different — the two lists are
 * published on the same canonical frame. The pane BODY is above that gate and
 * never unmounts on list churn, so the whole interaction — the pending row, the
 * refusal, the in-flight flag and the per-row records — is owned there and the
 * section stays presentational: it renders rows from `details` and asks
 * `request` on a press.
 *
 * ## What each piece of state is for
 *
 * - `pending` is the row whose CONFIRMATION is open, carried by VALUE (id,
 *   head, named) like the monitors' dialog carries its refusal by id: the
 *   question is about the row that was pressed, not about whatever the list
 *   holds later. One-click rows never set it — their write starts at the press.
 * - `anchor` is the pressed control's viewport rect, captured at press time.
 *   The popover is anchored to a FROZEN rect rather than to the button, because
 *   the row unmounts under the churn: a live element would take the floating
 *   card with it, and a zeroed rect from a detached node would paint it in the
 *   corner. The pair is what lets the question outlive its row.
 * - `busy` spans the whole write — including the one retry the policy keeps —
 *   and the confirmation refuses every close path while it is set, so a
 *   refusal always lands where it was asked and a second press cannot re-send
 *   (U3; one request per press against an answering writer). A press on any
 *   other row is ignored while it is set: one writer, one attempt.
 * - `refusal` renders in the open confirmation in the danger ink and is cleared
 *   on close AND on open, so reopening a refused row never shows a sentence
 *   about an attempt the reader has not made yet (U5).
 * - `cancelledKeys` is the settling acknowledgement: a receipt of `ok` marks the
 *   row `Cancelled` immediately, and the re-read that drops the row is what
 *   ends the mark (U4's rule, monitors'). A row whose cancel is refused keeps
 *   its place and its own record instead. The key is the handle PLUS the
 *   schedule's `created_at` (`wakeRowKey`), because the backend re-mints the
 *   lowest free handle: a successor `w1` must not inherit its predecessor's
 *   mark (F2 / Q1).
 * - `refusedKeys` is the record a refused attempt leaves on its row — the whole
 *   sentence, drawn as the row's own note line — cleared on the next attempt
 *   against that row (U8's "cleared on the next change"). A ONE-CLICK refusal
 *   has no dialog to hold the sentence, which is why it renders on the row; the
 *   short `Cancel refused` tag that used to sit beside it is retired (design
 *   round 1, D5: one statement, and the control beside it is still the next
 *   attempt).
 *
 * Everything resets when the SESSION changes: wake handles are per-session
 * (`w1`..), so a pending row or a mark from one conversation must not be read
 * against another conversation's list.
 */
import { wakePromptHead } from "@features/schedules/scheduled-task-model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WakeRow } from "./run-detail-model";
import { type WakeControls, wakeRowKey } from "./wake-controls-model";

/** The pressed control's viewport box, frozen at press time. */
export type WakeAnchorRect = {
	left: number;
	top: number;
	bottom: number;
	right: number;
};

/** How a press was classified by the section's model. */
export type WakeCancelIntent =
	/** Ordinary row: one press, one write, no question (see the header). */
	| { mode: "one-click" }
	/** The chief of staff's: open the confirmation instead of writing. */
	| { mode: "confirm"; named: boolean; anchor: WakeAnchorRect };

/** What one row's control column shows instead of the plain control. */
export type WakeRowCancelState =
	/** The receipt landed; the row awaits the re-read that drops it. */
	| { kind: "cancelled" }
	/** The one-press write is in flight (`Cancelling…`, disabled). */
	| { kind: "writing" }
	/** A refused attempt, its sentence dismissed; quiet until the next change. */
	| { kind: "refused"; detail: string };

/** What the section consumes from the pane body. */
export type WakeCancelSection = {
	/** Ask to cancel this wake; the pane body owns the confirmation and the write. */
	request: (row: WakeRow, intent: WakeCancelIntent) => void;
	/** The row's cancel state now, or `undefined` for the plain control. */
	stateFor: (row: WakeRow) => WakeRowCancelState | undefined;
};

/** The confirmation's props, spread onto `WakeCancelPopover`. */
export type WakeCancelPopoverProps = {
	open: boolean;
	named: boolean;
	name: string;
	/** The pressed wake's prompt head, by value (`“…” will not fire again.`). */
	head: string;
	anchor: WakeAnchorRect | null;
	refusal: string | null;
	refusalSeq: number;
	busy: boolean;
	onConfirm: () => void;
	onCancel: () => void;
};

export type WakeCancelInteraction = {
	section: WakeCancelSection;
	popover: WakeCancelPopoverProps;
};

export const useWakeCancel = ({
	sessionId,
	controls,
	name,
}: {
	sessionId: string | null;
	controls: WakeControls;
	/** The chief of staff's display name, for the confirmation's copy. */
	name: string;
}): WakeCancelInteraction => {
	const [pending, setPending] = useState<{
		id: string;
		/** The row's identity beyond its handle, for the marks (`wakeRowKey`). */
		key: string;
		head: string;
		named: boolean;
	} | null>(null);
	const [anchor, setAnchor] = useState<WakeAnchorRect | null>(null);
	const [refusal, setRefusal] = useState<string | null>(null);
	/*
	 * A COUNTER rather than a boolean, because the confirmation takes the signal
	 * as a CHANGE: a second refusal has to move the keyboard back to Keep again,
	 * and a boolean already true would be no change at all (the monitors' rule).
	 */
	const [refusalSeq, setRefusalSeq] = useState(0);
	const [busy, setBusy] = useState(false);
	/*
	 * The marks are keyed by `wakeRowKey` — the handle PLUS the schedule's
	 * `created_at` — and not by the bare id. The backend mints the LOWEST FREE
	 * handle, so a wake cancelled and re-armed in the same conversation comes
	 * back as the same `w1`; keyed by the handle alone, the successor wore its
	 * predecessor's `Cancelled` and could not be cancelled (F2 / Q1). The key
	 * also survives the canonical re-read's churn: the row's key does not move
	 * while the list is momentarily empty.
	 */
	const [cancelledKeys, setCancelledKeys] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [refusedKeys, setRefusedKeys] = useState<ReadonlyMap<string, string>>(
		new Map(),
	);
	/*
	 * The latest `pending`, read by the write's continuation after its await:
	 * a session switch (or any other reset) replaces the state the closure was
	 * born with, and the outcome must then land nowhere rather than in a list
	 * that is no longer on screen (the monitors' own note).
	 */
	const pendingRef = useRef(pending);
	useEffect(() => {
		pendingRef.current = pending;
	});
	/*
	 * The last row a confirmation was opened for, for the focus fallback below.
	 * The SESSION RESET nulls it: a stale id would otherwise be matched against
	 * the next conversation's list, whose handles collide by construction
	 * (`w1`..).
	 */
	const lastPressedIdRef = useRef<string | null>(null);
	/*
	 * The same press's KEY (see the marks above): the writing window's predicate
	 * must not match a re-minted row that inherited the pressed handle.
	 */
	const lastPressedKeyRef = useRef<string | null>(null);

	/*
	 * A switch to another conversation closes everything this interaction holds.
	 * Declared before the fallback effect so a switch nulls the row id before
	 * the fallback can read it (effects run in declaration order).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the SESSION is the trigger, not a value the body reads - the reset must re-run when the conversation changes (the `use-scroll-paging.ts` precedent).
	useEffect(() => {
		setPending(null);
		setAnchor(null);
		setRefusal(null);
		setBusy(false);
		setCancelledKeys(new Set());
		setRefusedKeys(new Map());
		lastPressedIdRef.current = null;
		lastPressedKeyRef.current = null;
	}, [sessionId]);

	/*
	 * FOCUS FALLS BACK TO THE ROW'S OWN CONTROL. The popover restores focus to
	 * the opener its layer captured while that opener is still connected; when
	 * it could not (the opener went away with its row, or the layer never held
	 * one), the row's control is the successor of the same act. Only when focus
	 * went NOWHERE: a focus already restored is left exactly where it is.
	 */
	useEffect(() => {
		if (pending !== null) return;
		const id = lastPressedIdRef.current;
		if (id === null) return;
		if (document.activeElement !== document.body) return;
		/*
		 * The id goes into a SELECTOR, so it is escaped: the client schema admits
		 * any string up to 64 characters, and a handle that is not selector-safe
		 * must not make this effect throw (N2; `CSS.escape` is the pane's own
		 * idiom).
		 */
		document
			.querySelector<HTMLElement>(`[data-wake-cancel="${CSS.escape(id)}"]`)
			?.focus();
	}, [pending]);

	/** Drop a row's refusal record, if it has one. */
	const clearRefused = useCallback((key: string) => {
		setRefusedKeys((map) => {
			if (!map.has(key)) return map;
			const next = new Map(map);
			next.delete(key);
			return next;
		});
	}, []);

	/** One attempt's shared tail: mark the row, or record its refusal. */
	const settle = useCallback(
		(key: string, ok: boolean, detail: string) => {
			if (ok) {
				setCancelledKeys((keys) => new Set(keys).add(key));
				clearRefused(key);
				return;
			}
			setRefusedKeys((map) => new Map(map).set(key, detail));
		},
		[clearRefused],
	);

	const request = useCallback(
		(row: WakeRow, intent: WakeCancelIntent) => {
			if (busy) return;
			const key = wakeRowKey(row);
			lastPressedIdRef.current = row.id;
			lastPressedKeyRef.current = key;
			/*
			 * A fresh press is a FRESH question: the previous refusal's sentence
			 * is cleared (U5) and so is that row's record of it — U8's "cleared on
			 * the next change", where the next change is the next attempt.
			 */
			setRefusal(null);
			clearRefused(key);
			if (intent.mode === "one-click") {
				/*
				 * THE OPERATOR'S ONE PRESS: no question, one write. The row's own
				 * state is what reports it — `Cancelling…` while in flight, then
				 * `Cancelled` or `Cancel refused`.
				 */
				setBusy(true);
				void (async () => {
					const outcome = await controls.cancel(row.id);
					setBusy(false);
					settle(key, outcome.ok, outcome.ok ? "" : outcome.detail);
				})();
				return;
			}
			setPending({
				id: row.id,
				key,
				head: wakePromptHead(row.message),
				named: intent.named,
			});
			setAnchor(intent.anchor);
		},
		[busy, clearRefused, controls, settle],
	);

	const dismiss = useCallback(() => {
		/*
		 * Unreachable while a write is in flight — the confirmation disables both
		 * buttons and refuses Escape, an outside click and the corner X — and kept
		 * as the guard that makes that a rule rather than a coincidence.
		 */
		if (busy) return;
		setPending(null);
		setAnchor(null);
		setRefusal(null);
	}, [busy]);

	const confirm = useCallback(() => {
		if (!pending || busy) return;
		const pressed = pending;
		setBusy(true);
		void (async () => {
			const outcome = await controls.cancel(pressed.id);
			/*
			 * The confirmation was reset under the continuation (a session
			 * switch): the outcome belongs to a list that is no longer on screen,
			 * and the write itself is already sent — the re-read the controls fire
			 * reconciles the store either way.
			 */
			if (pendingRef.current?.id !== pressed.id) return;
			setBusy(false);
			if (outcome.ok) {
				setCancelledKeys((keys) => new Set(keys).add(pressed.key));
				clearRefused(pressed.key);
				setPending(null);
				setAnchor(null);
				setRefusal(null);
				return;
			}
			/*
			 * A refusal keeps the confirmation OPEN with the backend's own
			 * sentence — the one surface that can still say what happened — and
			 * hands the keyboard back to Keep (`refusalSeq`). The row also records
			 * it, invisible behind the card now, read after a dismissal.
			 */
			setRefusedKeys((map) => new Map(map).set(pressed.key, outcome.detail));
			setRefusal(outcome.detail);
			setRefusalSeq((seq) => seq + 1);
		})();
	}, [pending, busy, controls, clearRefused]);

	const stateFor = useCallback(
		(row: WakeRow): WakeRowCancelState | undefined => {
			const key = wakeRowKey(row);
			if (cancelledKeys.has(key)) return { kind: "cancelled" };
			/*
			 * The ONE-PRESS write's in-flight window, which only the row it was
			 * pressed on shows: a confirmation's in-flight window is the card's (both
			 * its buttons disable), so `pending !== null` is excluded here.
			 */
			if (busy && pending === null && lastPressedKeyRef.current === key)
				return { kind: "writing" };
			const detail = refusedKeys.get(key);
			return detail === undefined ? undefined : { kind: "refused", detail };
		},
		[busy, cancelledKeys, pending, refusedKeys],
	);

	return {
		section: { request, stateFor },
		popover: {
			open: pending !== null && anchor !== null,
			named: pending?.named ?? false,
			name,
			head: pending?.head ?? "",
			anchor,
			refusal,
			refusalSeq,
			busy,
			onConfirm: confirm,
			onCancel: dismiss,
		},
	};
};
