/**
 * The wake cancel's one confirmation, as the pane body renders it.
 *
 * The section does not own this card (see `use-wake-cancel.ts` for the churn
 * that decided that), so the JSX lives here, next to the hook whose state it
 * takes as plain props — the body wires the two together and this component
 * decides placement and copy, nothing else.
 *
 * ## Why not the shared `Popover` primitive
 *
 * The brief for this slice said "existing `@shared/components/ui/popover`", and
 * that is what the first revision used. Two measurements sent it back:
 *
 * 1. **The anchor is a COORDINATE, not a live control.** The card must survive
 *    the row unmounting under the canonical re-read (`use-wake-cancel.ts`), so it
 *    is pinned to the rect captured at the press. Radix's Popper is built to
 *    track a live anchor and re-measure continuously — the opposite of a frozen
 *    point — and the fixed-coordinate anchor had to be fed either as a virtual
 *    element (`virtualRef`, a manufactured rect) or as an off-screen real box,
 *    both of which fight that model.
 * 2. **The measured cost of that fight.** In the jsdom harness
 *    (`scripts/wake-cancel-panel.test.mjs`) the Popper's re-measure loop against a
 *    coordinate anchor never settles: one press that opens the card went from
 *    ~0.2 s without an anchor to 15 s (virtual element) and 29-106 s (real box),
 *    growing as cases ran. The same card rendered as a placed portal is ~0.2 s.
 *    That loop is jsdom's lack of layout, but the harness is where this
 *    component's refusal/churn behaviour is provable at all, and a card whose
 *    own test costs minutes is a card whose behaviour does not get tested.
 *
 * So the card is a `createPortal` into the document body with ONE placement
 * calculation at open time, and the dismissal semantics Radix would have
 * supplied are written here explicitly: Escape closes, a pointer press outside
 * closes, the write's in-flight window blocks both, and the safe action keeps
 * the keyboard. It wears the primitive's own panel classes (`elevated` ground,
 * hairline edge, the one shadow, the panel radius) so it reads as the same
 * species of surface, and it is deliberately NON-MODAL: no scrim, no focus trap,
 * the reader can keep reading the pane behind it.
 *
 * ## The frozen placement, and what it gives up
 *
 * The card sits six pixels below the pressed control, aligned to its right edge,
 * clamped into the viewport; when there is no room below it sits above instead.
 * It does NOT follow the control afterwards — a card that jumped mid-question
 * (while a refusal rendered) would read as a second event, and the control it
 * points at may not exist any more. What that gives up is collision flipping
 * between those two positions; the pane is a scroll region and the measured
 * states all fit, so the placement is one decision rather than a middleware
 * stack.
 *
 * ## Copy
 *
 * The title names the act on the object. When the conversation is known to be
 * the chief of staff's it NAMES her and the confirm names the wake she owns
 * ("Cancel check-in" / `Cancel {name}'s check-in?`); when the identity is only
 * suspected (the fail-closed arm) it stays neutral — see
 * `wakeConfirmNamesChief` in `wake-controls-model.ts` for why a name is a claim
 * this component may only make when the identity resolved. Both buttons keep
 * the busy verb (`Cancelling…` under `Cancel …`, the monitors' D3 rule: the
 * button the reader pressed must not turn into a different act mid-press), and
 * the refusal renders in the danger ink INSIDE the card, which stays open with
 * the keyboard handed back to Keep.
 */
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { WakeCancelPopoverProps } from "./use-wake-cancel";
import {
	wakeConfirmActionLabel,
	wakeConfirmSentence,
	wakeConfirmTitle,
} from "./wake-controls-model";

/** The card's own width; the panel primitive's own `w-72`. */
const CARD_WIDTH = 288;
/** Gap between the pressed control and the card. */
const CARD_GAP = 6;
/** The room a card needs below the control before it flips above it. */
const CARD_MIN_ROOM = 168;

/**
 * Where the card goes, in viewport coordinates, from the frozen rect.
 *
 * One calculation, at render time, for the reason the header states: the card
 * keeps the place the press gave it. Right-aligned to the control (the pane's
 * rows put their controls at the column's right edge) and clamped into the
 * viewport so a narrow window cannot push it off-screen.
 */
const cardPlacement = (
	anchor: { left: number; top: number; bottom: number; right: number },
	viewport: { width: number; height: number },
) => {
	const left = Math.min(
		Math.max(anchor.right - CARD_WIDTH, 8),
		Math.max(viewport.width - CARD_WIDTH - 8, 8),
	);
	const below = anchor.bottom + CARD_GAP;
	if (below + CARD_MIN_ROOM <= viewport.height)
		return { left, top: below, bottom: undefined };
	return {
		left,
		top: undefined,
		bottom: Math.max(viewport.height - anchor.top + CARD_GAP, 8),
	};
};

export const WakeCancelPopover = ({
	open,
	named,
	name,
	head,
	anchor,
	refusal,
	refusalSeq,
	busy,
	onConfirm,
	onCancel,
}: WakeCancelPopoverProps) => {
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const keepRef = useRef<HTMLButtonElement | null>(null);
	/*
	 * THE OPENING FOCUS, AND THE REFUSAL'S HAND-BACK. The keyboard starts and
	 * returns on Keep — the safe action — so a refusal's next Enter cannot repeat
	 * the refused cancel. The signal is a COUNTER so a second refusal is a second
	 * change (the monitors' `focusCancelSignal` rule).
	 */
	useEffect(() => {
		if (!open) return;
		keepRef.current?.focus();
		/*
		 * `refusalSeq` is the TRIGGER and not a value this body reads: a second
		 * refusal has to move the keyboard back to Keep again, and a boolean
		 * already true would be no change at all. Read as a void so the
		 * dependency list states it rather than hiding it.
		 */
		void refusalSeq;
	}, [open, refusalSeq]);

	/*
	 * The dismissal semantics Radix would have supplied, written out: Escape and
	 * an outside pointer press both close the card, and the write's in-flight
	 * window (`busy`) refuses both — a refusal must land in the card that asked,
	 * and a second press cannot re-send while the first is out (U3).
	 */
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (busy) {
				event.preventDefault();
				return;
			}
			event.stopPropagation();
			onCancel();
		};
		const onPointerDown = (event: PointerEvent) => {
			if (busy) return;
			const target = event.target;
			if (target instanceof Node && cardRef.current?.contains(target)) return;
			/*
			 * THE DISMISSING PRESS'S OWN FOCUS DEFAULT IS CANCELLED (QA round 3,
			 * Q6 — measured live: the dismissal's landing focused the row's
			 * control and the press's default dropped it to `<body>` the same
			 * instant on a target that cannot hold focus). The default action of
			 * `pointerdown` is where that focus move comes from; cancelling it
			 * leaves the keyboard to the landing the dismissal fires. Only the
			 * dismissing press is touched: a press inside the card returned
			 * above, and a busy write returned before it.
			 */
			event.preventDefault();
			onCancel();
		};
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [open, busy, onCancel]);

	if (!open || anchor === null) return null;
	const placement = cardPlacement(anchor, {
		width: window.innerWidth,
		height: window.innerHeight,
	});
	const title = wakeConfirmTitle(named, name);
	return createPortal(
		/*
		 * A native `<dialog>` with `open` set: it carries the role the card needs
		 * (a non-modal question, not a `<div role="dialog">` the linter rightly
		 * prefers the element for) and nothing else — no `showModal()`, so there is
		 * no top layer and no focus trap; the card is explicitly non-modal.
		 */
		<dialog
			open={true}
			data-wake-confirm=""
			aria-label={title}
			ref={cardRef}
			style={{
				position: "fixed",
				left: placement.left,
				top: placement.top,
				bottom: placement.bottom,
				width: CARD_WIDTH,
			}}
			className={cn(
				"z-50 max-w-[calc(100vw-2rem)] rounded-md border border-hairline bg-elevated p-4",
				"text-body-sm text-ink shadow-overlay",
			)}
		>
			<p className={cn("text-ink")}>{title}</p>
			<p className={cn("pt-1.5 text-ink-muted")}>
				{wakeConfirmSentence({ named, name, head })}
			</p>
			{refusal !== null && (
				/*
				 * The refusal is the only thing this card can be told that makes the
				 * SAFE action the one the keyboard should hold: the cancel did not
				 * happen, and the next Enter must not repeat it. `<output>` is the
				 * semantic element for a status (a polite live region), and the
				 * sentence is also visible, so nothing is sr-only here.
				 */
				<output
					data-wake-confirm-refusal=""
					className={cn("block pt-1.5 text-danger")}
				>
					{refusal}
				</output>
			)}
			<div className={cn("flex items-center justify-end gap-2 pt-3")}>
				{/*
				 * Keep is FIRST in the DOM and takes the card's opening focus, so the
				 * safe action is the one the keyboard holds; the refusal hands it back
				 * here on every change (`refusalSeq`).
				 */}
				<Button
					ref={keepRef}
					variant="secondary"
					size="sm"
					data-wake-confirm-keep=""
					disabled={busy}
					onClick={onCancel}
				>
					Keep
				</Button>
				<Button
					variant="danger"
					size="sm"
					data-wake-confirm-action=""
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? "Cancelling…" : wakeConfirmActionLabel(named)}
				</Button>
			</div>
		</dialog>,
		document.body,
	);
};
