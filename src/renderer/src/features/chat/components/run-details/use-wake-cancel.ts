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
 * ## Where the keyboard lands after a write (UX round 1, U1-U3)
 *
 * A landed cancel takes its row off the canonical list, and the control that
 * was pressed with it — the browser drops focus to `<body>`, which is the one
 * outcome the pane's own standard forbids. Every close path therefore hands the
 * keyboard to a resolved LANDING STOP (`wakeCancelLanding`): the pressed row's
 * own control while it is still a control (a dismissal or a refusal — the next
 * attempt is itself, U2), otherwise the successor row's control, otherwise the
 * pane ([`data-run-panel-pane`] — a programmatic focus container,
 * `run-panel.tsx`), never `<body>`.
 *
 * The card's dismissal fires the same resolution from the effect watching
 * `pending`; the one-press path fires it from the effect watching `onePress`.
 * Both ask "did focus fall through?" first — a focus that is already somewhere
 * real is left exactly where it is. The card's own element counts as nowhere on
 * the outside-press path (U3): the press's focus default lands AFTER this
 * commit, so at the instant the question closes the keyboard is still on the
 * card's Keep, and a check against `<body>` alone missed the one dismissal that
 * left nobody holding it. The dismissal's own default is cancelled at the
 * press (`wake-cancel-popover.tsx`) so it cannot steal the same landing on a
 * target that cannot hold focus (Q6).
 *
 * THE LANDING IS HELD ACROSS THE CHURN — AND ACROSS THE PANEL'S OWN UNMOUNT
 * (F13, then Q7). The canonical re-read this interaction fires re-renders the
 * pane with an EMPTY wakes list for a moment; and its reconnect can push an
 * `open{gap}` whose commit nulls `frontend` for a beat, takes `runDetails` with
 * it, and unmounts the WHOLE run panel — the hook, its effects and the node the
 * keyboard was just on, all at once (QA round 4 measured it: 4/13 natural
 * presses settled on `<body>`, the panel back 13–700 ms later, nothing
 * re-resolving). The watch therefore lives at MODULE scope, outside React: see
 * `holdWakeLanding` below for the ladder that never ends on `<body>`.
 *
 * Everything resets when the SESSION changes: wake handles are per-session
 * (`w1`..), so a pending row or a mark from one conversation must not be read
 * against another conversation's list.
 */
import { wakePromptHead } from "@features/schedules/scheduled-task-model";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WakeRow } from "./run-detail-model";
import { type WakeControls, wakeRowKey } from "./wake-controls-model";

/*
 * THE LANDING STOPS, resolved from the DOM at the moment an outcome is known.
 * The pane's rows are the only surfaces that carry `[data-wake-cancel]` (the
 * Schedules page's lines do not), so a document query is pane-local, and the
 * same selector idiom the card path and the monitors' fallback already use.
 */

/** The pressed row's own control, by handle. */
const wakeCancelControl = (id: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(`[data-wake-cancel="${CSS.escape(id)}"]`);

/**
 * The NEXT wake row's control after the pressed one, when a later row exists.
 *
 * The section's DOM order is its list order, and the pressed control is
 * DISABLED by its own mark while the re-read is in flight, so the successor is
 * the next control that can still take the keyboard. A pressed control that the
 * re-read already dropped has no position to count from and answers `null` -
 * the caller falls back.
 */
const successorWakeCancelControl = (id: string): HTMLElement | null => {
	const pressed = wakeCancelControl(id);
	if (pressed === null) return null;
	const controls = [
		...document.querySelectorAll<HTMLElement>("[data-wake-cancel]"),
	];
	for (let i = controls.indexOf(pressed) + 1; i < controls.length; i += 1) {
		if (!controls[i].hasAttribute("disabled")) return controls[i];
	}
	return null;
};

/** The pane's own focus container (`run-panel.tsx`'s `[data-run-panel-pane]`). */
const wakePaneFocusTarget = (): HTMLElement | null =>
	document.querySelector<HTMLElement>("[data-run-panel-pane]");

/**
 * Where a closed question's keyboard lands, for every outcome.
 *
 * The row's own control while it is still a control: a dismissal hands the
 * keyboard back to where the question came from, and a refusal's row stays
 * live as its own next attempt (U2). Otherwise the act landed (or is landing) -
 * the control is disabled by its mark or gone with the row - and the same act's
 * successor is the next row's control, else the pane itself (U1's rule).
 */
const wakeCancelLanding = (id: string): HTMLElement | null => {
	const control = wakeCancelControl(id);
	if (control !== null && !control.hasAttribute("disabled")) return control;
	return successorWakeCancelControl(id) ?? wakePaneFocusTarget();
};

/**
 * Whether the keyboard fell through after a close or a write, for the effects
 * below; the resolution itself decides where it lands.
 *
 * The arms:
 * - nothing, or the `<body>` — the browser dropped focus and nobody caught it;
 * - the CLOSING CARD's own element — the outside press (U3) resolves its focus
 *   default AFTER the commit that closed the question, so the card still holds
 *   it at the instant this is asked; a press on a real control keeps that
 *   control's own focus and is left alone (U2's rule);
 * - the pressed row's own control — whether the browser has moved off it yet is
 *   the engine's timing, not the outcome (`wakeCancelLanding` hands a live
 *   control back to itself, a no-op), and the resolution must not depend on
 *   that timing: jsdom keeps focus on a disabled button where Chromium blurs
 *   it (measured 2026-10-09), and the keyboard must land the same way in both;
 * - a DISABLED control — a control that cannot act is not holding the keyboard.
 */
const wakeFocusFellThrough = (active: Element | null, id: string): boolean =>
	active === null ||
	active === document.body ||
	active.closest("[data-wake-confirm]") !== null ||
	active === wakeCancelControl(id) ||
	(active instanceof HTMLElement &&
		"disabled" in active &&
		(active as { disabled: boolean }).disabled);

/*
 * THE LANDING'S WATCH, AT MODULE SCOPE (Q7) — outside React on purpose. F13
 * held a landing from inside the hook, and QA round 4 measured the limit of
 * that placement: the resync's `open{gap}` commit unmounts the panel the hook
 * lives in, taking the watch with it, and the keyboard settles on `<body>`
 * with nothing left to re-resolve. This registry outlives every unmount: one
 * watch at a time, armed when a landing moves the keyboard, and ended on the
 * first resolution — a pane it can see, the pane's own opener (the close
 * destination `run-details-trigger.tsx` uses), or a brief HOLD until the pane
 * comes back (13–700 ms measured) rather than camping on a stale landing.
 */
let wakeLandingWatch: {
	id: string;
	node: HTMLElement;
	/** Set once the watch is holding for a home target to reappear. */
	holdUntil: number | null;
} | null = null;
let wakeLandingObserver: MutationObserver | null = null;
let wakeLandingHoldTimer: ReturnType<typeof setTimeout> | null = null;

/** How long a home-less landing waits for the pane (or its opener) to return. */
const WAKE_LANDING_HOLD_MS = 3000;

/**
 * The pane, else its own opener. NOT the composer: it never unmounted, so a
 * landing there is the yank U1 exists to prevent, not a fallback.
 */
const wakeLandingHome = (): HTMLElement | null =>
	document.querySelector<HTMLElement>("[data-run-panel-pane]") ??
	document.querySelector<HTMLElement>("[data-run-panel-trigger]");

const endWakeLandingWatch = (): void => {
	wakeLandingWatch = null;
	wakeLandingObserver?.disconnect();
	wakeLandingObserver = null;
	if (wakeLandingHoldTimer !== null) {
		clearTimeout(wakeLandingHoldTimer);
		wakeLandingHoldTimer = null;
	}
};

const checkWakeLandingWatch = (): void => {
	const watch = wakeLandingWatch;
	if (watch === null) return;
	if (watch.node.isConnected) return;
	if (!wakeFocusFellThrough(document.activeElement, watch.id)) {
		endWakeLandingWatch();
		return;
	}
	const home = wakeLandingHome();
	if (home !== null) {
		endWakeLandingWatch();
		home.focus();
		return;
	}
	/*
	 * NOWHERE TO LAND YET — the gate's gap, where the pane and its opener are
	 * both off screen. HOLD, bounded: the pane's return is itself a mutation,
	 * so this watcher sees it; past the bound it gives up rather than camping.
	 */
	if (watch.holdUntil === null) {
		watch.holdUntil = Date.now() + WAKE_LANDING_HOLD_MS;
		wakeLandingHoldTimer = setTimeout(
			endWakeLandingWatch,
			WAKE_LANDING_HOLD_MS,
		);
	}
};

/** Watch a landing's node from OUTSIDE the panel that just moved the keyboard. */
const holdWakeLanding = (id: string, node: HTMLElement): void => {
	endWakeLandingWatch();
	wakeLandingWatch = { id, node, holdUntil: null };
	wakeLandingObserver = new MutationObserver(checkWakeLandingWatch);
	wakeLandingObserver.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
};

/** A session switch closes the watch, as it closes everything else. */
const clearWakeLanding = (): void => endWakeLandingWatch();

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
	/**
	 * `pressKeepsFocus` marks a dismissal whose press points at a focusable
	 * target: the default is landing the keyboard THERE, so the landing stands
	 * down (F15).
	 */
	onCancel: (options?: { pressKeepsFocus?: boolean }) => void;
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
	 * The ONE-PRESS write's last settled attempt, as the trigger for the focus
	 * handoff below. A counter, not a boolean: a second attempt on the same row
	 * (a refused press, then another) has to be a second change, or the second
	 * landing never runs (the `refusalSeq` rule). Distinct from `pending`, which
	 * this path never sets.
	 */
	const [onePress, setOnePress] = useState<{ id: string; seq: number } | null>(
		null,
	);
	/** Focus a resolved landing, and hold it against every churn that can take it. */
	const landWake = useCallback((id: string) => {
		const target = wakeCancelLanding(id);
		if (target === null) return;
		target.focus();
		holdWakeLanding(id, target);
	}, []);

	/*
	 * THE PRESS'S OWN KEYBOARD, when the dismissing press points at something
	 * that can take focus (F15): the press default is landing there, so the
	 * landing stands down rather than stealing the keyboard first. Consumed by
	 * the fallback effect below — one dismissal, one read — and reset with the
	 * rest of the interaction on a session switch.
	 */
	const pressKeepsFocusRef = useRef(false);

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
		setOnePress(null);
		clearWakeLanding();
		pressKeepsFocusRef.current = false;
		lastPressedIdRef.current = null;
		lastPressedKeyRef.current = null;
	}, [sessionId]);

	/*
	 * FOCUS FALLS BACK TO THE RESOLVED LANDING STOP (the header's rules). The
	 * popover restores focus to the opener it captured while that opener is
	 * still connected; when it could not (the opener went away with its row, or
	 * the layer never held one), the landing resolution replaces it. Only when
	 * focus FELL THROUGH: a focus already restored, or moved somewhere real, is
	 * left exactly where it is.
	 */
	useEffect(() => {
		if (pending !== null) return;
		const id = lastPressedIdRef.current;
		const pressKeepsFocus = pressKeepsFocusRef.current;
		pressKeepsFocusRef.current = false;
		if (id === null) return;
		/*
		 * A PRESS THAT POINTS AT SOMETHING FOCUSABLE KEEPS ITS OWN KEYBOARD
		 * (F15): its default is landing there, so the landing stands down rather
		 * than stealing it first. Consumed above, before the guard, so a stale
		 * flag can never suppress a later landing.
		 */
		if (pressKeepsFocus) return;
		if (!wakeFocusFellThrough(document.activeElement, id)) return;
		landWake(id);
	}, [pending, landWake]);

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
					setOnePress((prev) => ({
						id: row.id,
						seq: (prev?.seq ?? 0) + 1,
					}));
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

	const dismiss = useCallback(
		(options?: { pressKeepsFocus?: boolean }) => {
			/*
			 * Unreachable while a write is in flight — the confirmation disables both
			 * buttons and refuses Escape, an outside click and the corner X — and kept
			 * as the guard that makes that a rule rather than a coincidence.
			 */
			if (busy) return;
			pressKeepsFocusRef.current = options?.pressKeepsFocus === true;
			setPending(null);
			setAnchor(null);
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

	/*
	 * THE ONE-PRESS WRITE'S OWN LANDING (U1). Its row may be marked and disabled,
	 * or already re-read away, by the time this runs — `wakeCancelLanding`
	 * resolves both to the successor, else the pane. A refused attempt's row is
	 * live again and its own control takes the keyboard back (U2).
	 */
	useEffect(() => {
		if (onePress === null) return;
		if (!wakeFocusFellThrough(document.activeElement, onePress.id)) return;
		landWake(onePress.id);
	}, [onePress, landWake]);

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
