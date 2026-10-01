/**
 * The field slot: the one small control cluster that carries every phase of an
 * inline edit - the pencil that begins it, the x and the check that end it, the
 * spinner that reports a write in flight, and the transient acknowledgement.
 *
 * LOOK AND FEEL, AND WHERE IT COMES FROM: this generalises the session-title
 * inline rename in `chat-header.tsx` (the operator's reference for the whole
 * interaction), which the projects detail's fields reuse rather than
 * re-invent. The slot reads as ONE control that changes role: pencil -> (x,
 * check) -> spinner -> pencil. `size-5` box, `rounded-xs`, `text-ink-dim`
 * stepping to `text-ink-muted` on hover, lucide at `size-3`, the reveal through
 * `group-hover`/`group-focus-within` on a `group/inline-edit` wrapper the
 * consumer puts on its field. Nothing lifts, scales or translates: the reveal
 * is an opacity transition, the hover is a colour step (`docs/branding.md`
 * § 5).
 *
 * WHY THE PHASES ARE RENDERED HERE rather than by each consumer: the note's
 * § 2 contract is one editing language, and a second surface that drew its own
 * check/x would drift from this one the first time either changed. The
 * consumer supplies the WORDS (a label per phase, naming its field) and its
 * editor control; everything else is this file's.
 *
 * THE PRESS GUARDS, all measured on the chat-header precedent and kept here:
 * `preventDefault` on `mousedown` while the editor is open, so the press never
 * blurs the editor into a save before the button's own click runs; the
 * `event.detail > 1` guard, so a double-click cannot fire a control twice; and
 * the `phase === "saving"` early return, because a submitted save is
 * committed - the spinner is not a cancel door (§ 2.3, U1).
 */

import { Spinner } from "@shared/components/common/spinner";
import { cn } from "@shared/lib/utils";
import { Check, Pencil, X } from "lucide-react";
import type { FC, RefObject } from "react";
import type { InlineEditPhase } from "./inline-edit-model";

/**
 * The wrapper class that arms the reveal gates, exported so a consumer cannot
 * misspell it: the utilities that answer it (`group-hover/inline-edit:*` and
 * `group-focus-within/inline-edit:*`) are compiled from this module, and both
 * sides have to name the same group for the pencil to appear at all.
 */
export const INLINE_EDIT_GROUP = "group/inline-edit";

/** The structural subset of the hook's API the slot needs - nothing generic. */
export type InlineEditSlotHandle = {
	phase: InlineEditPhase;
	labels: {
		begin: string;
		accept: string;
		cancel: string;
		busy: string;
		retry?: string;
	};
	begin: () => void;
	accept: () => void;
	cancel: () => void;
	slotRef: RefObject<HTMLButtonElement>;
};

export type InlineEditControlsProps = {
	api: InlineEditSlotHandle;
	/**
	 * What the resting state shows. `affordance` (default) is the pencil;
	 * `none` is for a field whose own content is the door (the empty
	 * description's "Add description" button), so the slot does not draw a
	 * second one.
	 */
	idle?: "affordance" | "none";
	className?: string;
};

/** The shared box of every glyph in the slot. */
const SLOT_BUTTON =
	"inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs text-ink-dim transition-colors duration-fast ease-out-quart hover:text-ink-muted";

/**
 * § 2.2's SETTLED 32x32 hit area, as a hit area rather than a box: the
 * pseudo-element extends the pointer target to 32x32 while the visible box
 * stays `size-5` - so the affordance keeps the glyph-and-colour-only rule
 * (`docs/branding.md`; nothing grows, lifts or reflows when a row enters
 * edit) and a pointer still gets the composer's target size (review round 1,
 * m4).
 */
const SLOT_HIT_AREA =
	"relative before:absolute before:-inset-1.5 before:content-['']";

export const InlineEditControls: FC<InlineEditControlsProps> = ({
	api,
	idle = "affordance",
	className,
}) => {
	const { phase, labels } = api;
	const editing =
		phase === "editing" || phase === "saving" || phase === "error";
	return (
		<span
			data-inline-edit-slot={phase}
			className={cn("inline-flex shrink-0 items-center gap-0.5", className)}
		>
			{editing ? (
				<>
					{/*
					 * The x. While the write is in flight it is present but
					 * inert - `aria-disabled`, never `disabled`, so it does not
					 * steal focus from the editor - and its label states that,
					 * because a "cancel" name over a no-op is the same lie the
					 * U1 rule exists to avoid.
					 */}
					<button
						type="button"
						data-inline-edit-control="cancel"
						aria-label={phase === "saving" ? labels.busy : labels.cancel}
						title={phase === "saving" ? labels.busy : labels.cancel}
						aria-disabled={phase === "saving" || undefined}
						onMouseDown={(event) => event.preventDefault()}
						onClick={(event) => {
							if (event.detail > 1) return;
							if (phase === "saving") return;
							api.cancel();
						}}
						className={cn(
							SLOT_BUTTON,
							SLOT_HIT_AREA,
							phase === "saving" && "cursor-default text-ink-disabled",
						)}
					>
						<X className="size-3" aria-hidden="true" />
					</button>
					{phase === "saving" ? (
						/* The spinner takes the check's slot, the identity
						 * trigger's busy pattern: geometry never moves. */
						<span
							data-inline-edit-control="busy"
							className="inline-flex size-5 shrink-0 items-center justify-center"
						>
							<Spinner size="xs" />
						</span>
					) : (
						<button
							type="button"
							data-inline-edit-control="accept"
							/* In `error` the check re-attempts the write, and its
							 * name says so; the slot's own door out of error. */
							aria-label={
								phase === "error"
									? (labels.retry ?? labels.accept)
									: labels.accept
							}
							title={
								phase === "error"
									? (labels.retry ?? labels.accept)
									: labels.accept
							}
							onMouseDown={(event) => event.preventDefault()}
							onClick={(event) => {
								if (event.detail > 1) return;
								api.accept();
							}}
							className={cn(SLOT_BUTTON, SLOT_HIT_AREA)}
						>
							<Check className="size-3" aria-hidden="true" />
						</button>
					)}
				</>
			) : idle === "affordance" ? (
				/*
				 * The pencil. Its reveal is the module's own contract: hidden
				 * until the pointer is over the field or focus is within it, and
				 * VISIBLE while `saved`, where it is the control focus returns
				 * to and the only thing in the slot.
				 */
				<button
					ref={api.slotRef}
					type="button"
					data-inline-edit-control="begin"
					aria-label={labels.begin}
					title={labels.begin}
					onClick={(event) => {
						if (event.detail > 1) return;
						api.begin();
					}}
					className={cn(
						SLOT_BUTTON,
						/* The reveal, gated on the field's own group. */
						"opacity-0 transition-opacity duration-base ease-out-quart",
						"group-hover/inline-edit:opacity-100 group-hover/inline-edit:duration-fast",
						"group-focus-within/inline-edit:opacity-100 group-focus-within/inline-edit:duration-fast",
						/* Focused directly (the return after a commit, a keyboard
						 * walk), the button must be visible: `focus` is its own
						 * gate, not something the wrapper's focus-within alone
						 * guarantees under every browser's focus timing. */
						"focus-visible:opacity-100",
					)}
				>
					<Pencil className="size-3" aria-hidden="true" />
				</button>
			) : null}
		</span>
	);
};
