/**
 * The job cancel's one confirmation, as the pane body renders it.
 *
 * The section does not own this card (see `use-job-cancel.ts` for the churn
 * that decided that), so the JSX lives here, next to the hook whose state it
 * takes as plain props — the body wires the two together and this component
 * decides placement and copy, nothing else.
 *
 * ## The shape, and why it is the wakes' shape
 *
 * `wake-cancel-popover.tsx` argued the placed-portal approach at length (a
 * coordinate anchor fights the shared primitive's live re-measure model, and
 * the fight cost minutes in the jsdom harness); the geometry and the
 * outside-press classification now live once, in `cancel-card-placement.ts`,
 * and both per-item cancels mount the same card. The dismissal semantics are
 * written here explicitly, the same four: Escape closes, a pointer press
 * outside closes, the write's in-flight window blocks both, and the safe
 * action holds the keyboard. The card is deliberately NON-MODAL: no scrim, no
 * focus trap, the reader can keep reading the pane behind it. It wears the
 * panel classes (`elevated` ground, hairline edge, the one shadow) so it reads
 * as the same species of surface as its wake sibling.
 *
 * ## Copy
 *
 * The title names the act on the object ("Cancel this job?") and the sentence
 * states the act and the honesty rule in one breath: the runtime asks the
 * provider to stop the named job, and the row says `Cancelled` only when the
 * job SETTLES — a press is an acknowledgement, never the outcome (design spec
 * §2.1's clause; the engine's own refusal sentences arrive in the frozen
 * wording map and render where the refusal lands, below). Both buttons keep
 * the busy verb (`Cancelling…` under `Cancel`): the button the reader pressed
 * must not turn into a different act mid-press (the monitors' D3 rule). The
 * refusal renders in the danger ink INSIDE the card, which stays open with
 * the keyboard handed back to Keep.
 */
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
	CARD_WIDTH,
	cardPlacement,
	pressTargetTakesFocus,
} from "./cancel-card-placement";
import type { JobCancelPopoverProps } from "./use-job-cancel";

export const JobCancelPopover = ({
	open,
	label,
	anchor,
	refusal,
	refusalSeq,
	busy,
	onConfirm,
	onCancel,
}: JobCancelPopoverProps) => {
	useI18nLocale();
	const cardRef = useRef<HTMLDialogElement | null>(null);
	const keepRef = useRef<HTMLButtonElement | null>(null);
	/*
	 * THE OPENING FOCUS, AND THE REFUSAL'S HAND-BACK. The keyboard starts and
	 * returns on Keep — the safe action — so a refusal's next Enter cannot
	 * repeat the refused cancel. The signal is a COUNTER so a second refusal is
	 * a second change (the monitors' `focusCancelSignal` rule).
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
	 * The dismissal semantics Radix would have supplied, written out: Escape
	 * and an outside pointer press both close the card, and the write's
	 * in-flight window (`busy`) refuses both — a refusal must land in the card
	 * that asked, and a second press cannot re-send while the first is out.
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
			 * THE PRESS'S OWN INTENT IS KEPT WHERE IT HAS ONE. Cancelling a
			 * `pointerdown` also swallows the press's compatibility mouse events,
			 * so a press aimed at something that CAN take focus (the composer, a
			 * menu item) neither focuses it nor places a caret. So the cancel is
			 * reserved for a target that cannot hold focus (the chrome), where
			 * the default would only steal the landing; on a focusable target the
			 * default is left to land there, and the dismissal says so
			 * (`pressKeepsFocus`) — the landing stands down instead of stealing
			 * the keyboard first.
			 */
			if (pressTargetTakesFocus(target)) {
				onCancel({ pressKeepsFocus: true });
				return;
			}
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

	if (!open || anchor === null || label === null) return null;
	const placement = cardPlacement(anchor, {
		width: window.innerWidth,
		height: window.innerHeight,
	});
	const title = "Cancel this job?";
	return createPortal(
		/*
		 * A native `<dialog>` with `open` set: it carries the role the card
		 * needs (a non-modal question) and nothing else — no `showModal()`, so
		 * there is no top layer and no focus trap; the card is explicitly
		 * non-modal.
		 */
		<dialog
			open={true}
			data-job-confirm=""
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
				{`The runtime asks the provider to stop “${label}”. The row says “Cancelled” only when the job settles.`}
			</p>
			{refusal !== null && (
				/*
				 * The refusal is the only thing this card can be told that makes
				 * the SAFE action the one the keyboard should hold: the cancel did
				 * not happen, and the next Enter must not repeat it. `<output>` is
				 * the semantic element for a status (a polite live region), and
				 * the sentence is also visible, so nothing is sr-only here.
				 */
				<output
					data-job-confirm-refusal=""
					className={cn("block pt-1.5 text-danger")}
				>
					{refusal}
				</output>
			)}
			<div className={cn("flex items-center justify-end gap-2 pt-3")}>
				{/*
				 * Keep is FIRST in the DOM and takes the card's opening focus, so
				 * the safe action is the one the keyboard holds; the refusal hands
				 * it back here on every change (`refusalSeq`).
				 */}
				<Button
					ref={keepRef}
					variant="secondary"
					size="sm"
					data-job-confirm-keep=""
					disabled={busy}
					onClick={() => onCancel()}
				>
					{t("ui.chat.run_details.keep")}
				</Button>
				<Button
					variant="danger"
					size="sm"
					data-job-confirm-action=""
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? "Cancelling…" : "Cancel"}
				</Button>
			</div>
		</dialog>,
		document.body,
	);
};
