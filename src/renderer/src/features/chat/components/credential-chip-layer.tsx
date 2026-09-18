import {
	type MutableRefObject,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type Capture,
	type CredentialPayload,
	IDLE_CAPTURE,
	clearControlLabel,
	markerChip,
	markerChipTitle,
	paintPlan,
} from "./credential-capture";
import { CredentialChip } from "./credential-chip";

/**
 * The composer's credential CHIPS: one opaque chip painted over each marker run
 * the textarea is drawing.
 *
 * WHY A SECOND LAYER, when `CredentialOverlay` already paints these runs. The
 * overlay is a background-only mirror behind the textarea: its spans carry the
 * chip's wash and NO VISIBLE TEXT, because the glyphs are the textarea's own and
 * the design keeps them there so that a failure of this feature can never hide
 * what the operator typed (that file states the divergence as §7.1). What the
 * operator reported on 2026-09-17 is what that technique cannot fix: a wash
 * behind the literal characters `[Credential #1, 73 chars]` still reads as a
 * TUI-style square-bracketed marker, because it IS those characters. A chip with
 * a glyph, a name, a count and a clear control needs content the mirror must not
 * have — so the chip is painted OVER the run, opaque, by this layer.
 *
 * THE MEASUREMENT IS THE HARD PART, and it is why this is a measured layer
 * rather than another class list. The chip must cover EXACTLY the box of the run
 * it stands for, or it drifts off the characters it is lying on top of. A
 * textarea exposes no per-run geometry — there is no DOM node per word in a text
 * control — so the only honest source is the mirror: it is already box-,
 * typography- and scroll-synced to the field, and its spans ARE the runs. Each
 * live run's spans carry `data-credential-run`, and this layer measures them by
 * `getClientRects()` in a layout effect.
 *
 * THREE PROPERTIES THAT FOLLOW FROM MEASURING, each stated because each is a
 * decision:
 *
 *  - ONLY AN UNWRAPPED RUN GETS A CHIP. A marker long enough to wrap reports more
 *    than one rect, and there is no single box to cover; such a run keeps
 *    today's wash — the mirror paints it and this layer draws nothing. The count
 *    of rects is the whole test: one rect, one chip.
 *  - THE LAYER IS `pointer-events-none` AND THE CONTROL IS NOT. Every part of the
 *    chip except the `x` must let the pointer through to the textarea underneath,
 *    so that clicking the marker still places the caret where the operator
 *    clicked. That is also why the chip carries no handler of its own.
 *  - THE MEASUREMENT FOLLOWS THE SCROLL, with the same subscription the mirror
 *    uses. The mirror's sync runs first on both mount and scroll — it is a
 *    sibling earlier in the DOM, so React runs its layout effect first and the
 *    browser runs its listener first — and this layer therefore reads a mirror
 *    that has already caught up with the field.
 *
 * WHY THE RECTS NEED NO SCROLL ADDED TO THEM (UX round 1, U1, the round's
 * BLOCKER). `getClientRects()` is VIEWPORT-relative, and this layer is
 * `absolute inset-0` inside the same wrapper the field sits in, so subtracting
 * the layer's own frame turns a rect into this layer's coordinates directly: the
 * subtree around a scrolling box is not scrolled, and a rect read out of it is
 * already in that box's own space. This measured contribution used to add the
 * mirror's own `scrollLeft`/`scrollTop` on top, which re-applied the scroll the
 * rect had already accounted for — so in any message long enough to scroll, the
 * chip sat exactly `fieldScrollTop` px from its marker (measured `deltaTop` 0 /
 * 60 / 117 for `scrollTop` 0 / 60 / 117, which is the whole of the bug), an
 * opaque ground over unrelated prose with a live `x` on it. The subscription
 * above is what makes the rects track the scroll; the offset was cancelling it.
 *
 * WHAT THIS INHERITS FROM THE MIRROR, named rather than discovered: the mirror
 * re-syncs on a text or rung change and on the field's own scroll events, which
 * is every event except a resize of the composer's box (a window resize, a pane
 * resize). CODE REVIEW round 1, R1-3 filed that same gap against the CHIP rather
 * than the wash, and it matters more here: the mirror sizes its box with an
 * inline `width = field.clientWidth` px (`credential-overlay.tsx`), the textarea
 * is `w-full` and re-wraps on a resize with no React render at all, so an
 * opaque chip would cover glyphs it does not stand for until the next keystroke.
 * A `ResizeObserver` on the field closes it for both layers — the overlay
 * registers its own, beside its scroll listener, and this one re-measures — and
 * `scripts/credential-chip-geometry.mjs` proves it by re-measuring after a
 * viewport change.
 */
/**
 * The least visible strip of a run that earns a chip, in CSS pixels.
 *
 * SIX, AND IT IS TWO MEASUREMENTS RATHER THAN TASTE (code review round 4, R4-1; UX
 * round 5, U2).
 *
 * The first is arithmetic: the chip's control is `16px` tall inside a `17px` run box, so
 * its top edge sits `0.5px` below the chip's top, and a strip thinner than that leaves the
 * control outside the clip with its hit-testing (`elementFromPoint` answered `0/64` points
 * for a `0.375px` strip, against `8/64` at `3px`).
 *
 * The second is what the operator can SEE, and it is why the floor is six and not two: at
 * a two-pixel strip the control is reachable and live while nothing identifies it - the UX
 * round landed on exactly that band by hand (`scrollTop 202`, a `2.38px` strip, the
 * control `1.88px` of `16` inside the clip), found no `times` glyph on screen, and measured a
 * real `Tab` reaching it and a real press in the band clearing the credential. The control's
 * glyph is centred in its 16px box, so the run has to be visible by about half the control
 * plus the glyph's own top inset before any of it can be read: six pixels is the measured
 * strip at which the `times` is on screen. A chip whose control cannot be identified is a
 * chip whose marker should keep the wash instead.
 */
const CHIP_MIN_VISIBLE_STRIP_PX = 6;

type ChipBox = {
	/** The position of the run in the plan `paintPlan` produced. */
	planIndex: number;
	left: number;
	top: number;
	width: number;
	height: number;
};

export type CredentialChipLayerProps = {
	/** The live buffer, which is the same string the textarea is painting. */
	text: string;
	/** The credentials this composer holds, keyed by their marker index. */
	payloads: ReadonlyMap<number, CredentialPayload>;
	/** The open capture; the mask and the armed token keep their own treatment. */
	capture?: Capture;
	/** The mirror, whose spans are the geometry this layer paints onto. */
	mirrorRef: MutableRefObject<HTMLDivElement | null>;
	/** The field the mirror is synced to, whose scroll moves the text. */
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	/**
	 * The layer dropped the chip whose control held focus, so the composer owes the
	 * keyboard a home (code review round 4, R4-5).
	 *
	 * A callback rather than a focus call here: this layer paints geometry and knows
	 * nothing about the textarea, the panel's own focus rules or the pointer gate, and the
	 * composer already has one place that gives focus back (`focusInput`).
	 */
	onControlUnmounted?: () => void;
	/**
	 * Throw one reference away, or `null` when the composer is not taking edits.
	 *
	 * Receives the marker's own index, which is what the payload map is keyed by,
	 * and is only ever called for a run a payload backs. NULL is the composer
	 * REFUSING input (`isInputDisabled` on the rebased base: a missing session, or
	 * a turn running), and it is passed in rather than derived here so the layer
	 * cannot disagree with the composer about when input is taken: the same
	 * predicate gates every other writer, and a control rendered over a box that
	 * takes nothing must not offer a verb the box will refuse (see the `x` below).
	 */
	onClear: ((index: number) => void) | null;
};

export const CredentialChipLayer = ({
	text,
	payloads,
	capture = IDLE_CAPTURE,
	mirrorRef,
	fieldRef,
	onClear,
	onControlUnmounted,
}: CredentialChipLayerProps) => {
	const plan = paintPlan(text, payloads.values(), capture);
	const [boxes, setBoxes] = useState<ChipBox[]>([]);
	/**
	 * The chip control that held focus when the boxes were last measured.
	 *
	 * Held across the commit so the drop can be detected where it actually happens - see
	 * the layout effect below, and R5-1 for why the measure cannot see it.
	 */
	const heldControlRef = useRef<HTMLElement | null>(null);
	/*
	 * AND THE DROP IS REPORTED HERE, AT THE COMMIT THAT REMOVES IT (code review round 5,
	 * R5-1). `boxes` is the layer's own record of what it draws: when it changes, React has
	 * committed the removal, the focused control is out of the document, and the composer
	 * can be told to take the keyboard back. A control that is still connected (a re-measure
	 * that kept it) reports nothing, and one that lost focus to something outside the layer
	 * was never remembered.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `boxes` IS the dependency this effect exists for - it is the commit that removes a control, and the body reads it only through the ref the measure filled. Dropping it (as the rule suggests, since the body never mentions it) would leave the effect running on `onControlUnmounted` alone, which is R5-1 again in a new shape.
	useLayoutEffect(() => {
		const held = heldControlRef.current;
		if (held === null) return;
		if (held.isConnected) return;
		heldControlRef.current = null;
		onControlUnmounted?.();
	}, [boxes, onControlUnmounted]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the measure must re-run after EVERY render that changes the text or the rung — the mirror's own wrapping is a function of the text and of the rung's padding and type step — and the body reads only refs, which is why the list is carried by hand (the same reason the mirror carries its own).
	useLayoutEffect(() => {
		const mirror = mirrorRef.current;
		const field = fieldRef.current;
		if (!mirror || !field) {
			setBoxes([]);
			return;
		}
		const measure = () => {
			const frame = mirror.getBoundingClientRect();
			/*
			 * WHO IS HOLDING FOCUS, BEFORE THE BOXES CHANGE (code review round 4, R4-5). The
			 * clip rule can drop the chip whose control the keyboard is standing on, and a
			 * removed focused element sends focus to `<body>`: measured, five real keystrokes
			 * then went nowhere (no caret, no ring) until the operator clicked back in. The
			 * composer is the only place that knows how to give focus back, so this layer
			 * reports the drop rather than reaching for it.
			 */
			const held = document.activeElement;
			/*
			 * THE FOCUSED CONTROL IS REMEMBERED, NOT JUDGED HERE (code review round 5, R5-1).
			 * Round 4 read `document.activeElement` and tested `!held.isConnected` inside this
			 * same synchronous call - before React has committed the `setBoxes` that drops the
			 * chip - so `isConnected` was still true and the guard never fired; by the next
			 * commit focus was already `BODY` and the element was no longer recognisable as
			 * ours, so the report had no route at all. What the measure can honestly do is
			 * record which control held focus; the commit below is what knows it is gone.
			 */
			heldControlRef.current =
				held instanceof HTMLElement &&
				held.closest("[data-credential-chips]") !== null
					? held
					: null;
			const next: ChipBox[] = [];
			for (const run of mirror.querySelectorAll<HTMLElement>(
				"[data-credential-run]",
			)) {
				const rects = run.getClientRects();
				// One rect or no chip: a wrapped run has no single box to cover, and the
				// wash the mirror already painted is its documented fallback.
				if (rects.length !== 1) continue;
				const rect = rects[0];
				/*
				 * AND A RUN THE LAYER CLIPS AWAY GETS NO CHIP AT ALL (code review round 3,
				 * R3-1; UX round 3, U14). `overflow-clip` stopped the chip from MOVING; it
				 * did not stop the browser from REACHING a chip whose run sits outside the
				 * field's box, and there the control was focusable while painted nowhere -
				 * measured: one real `Tab` from the field landed on `Remove credential #1`
				 * with the chip at `top 391` against a clip box of `78..190`, the focus ring
				 * clipped with it, five typed characters swallowed by the focused button,
				 * and `Enter` clearing a credential the operator could not see. So the
				 * invariant this rule establishes, and the one to hold onto: NO CONTROL IS
				 * REACHABLE IN A STATE WHERE NOTHING OF ITS CHIP IS VISIBLE, and typing in
				 * the composer is never swallowed by a control the operator did not aim at.
				 *
				 * AND THE STRIP HAS TO CARRY THE CONTROL, NOT MERELY TOUCH THE FRAME (code
				 * review round 4, R4-1). The first version of this rule tested the RUN's rect
				 * for any overlap, which states an invariant it does not establish: the
				 * control is NOT co-extensive with the run's box - it sits half a pixel below
				 * the chip's top and is 16px tall - so a run whose visible strip is anywhere
				 * in `(0, 0.5]px` kept a chip whose control was WHOLLY outside the clip.
				 * Reproduced in the shipped story at `scrollTop 200` (`chips 1`, control
				 * `0/64` hit-testable points, a real Tab landing on it, five characters
				 * swallowed, `Enter` clearing an unseen credential). The rule therefore
				 * requires a strip thick enough to carry the control: the control's own half
				 * pixel of top inset plus a pixel of its own box, so a chip is drawn only
				 * where at least a pixel of its control is inside the clip and can be hit.
				 * The invariant, unchanged and now actually established: NO CONTROL IS
				 * REACHABLE IN A STATE WHERE NOTHING OF ITS CHIP IS VISIBLE, and typing in the
				 * composer is never swallowed by a control the operator did not aim at.
				 *
				 * A run that fails it takes the same "no box to cover, keep the wash" fallback
				 * a wrapped run already takes: the marker's own glyphs are painted by the
				 * textarea, so an unseen run loses only its chip, and scrolling it back into
				 * view re-draws it on the next measure (the field's own scroll listener).
				 */
				const visibleStrip =
					Math.min(rect.bottom, frame.bottom) - Math.max(rect.top, frame.top);
				if (
					rect.right < frame.left ||
					rect.left > frame.right ||
					visibleStrip < CHIP_MIN_VISIBLE_STRIP_PX
				)
					continue;
				next.push({
					planIndex: Number(run.dataset.credentialRun),
					// VIEWPORT-RELATIVE IN, LAYER-LOCAL OUT, and nothing else added: see this
					// file's header for the blocker that the mirror's own scroll offset used
					// to cause here. The mirror's own `offsetLeft`/`offsetTop` stay, so this
					// remains correct if the layer's frame and the mirror's box stop
					// coinciding.
					left: mirror.offsetLeft + rect.left - frame.left,
					top: mirror.offsetTop + rect.top - frame.top,
					width: rect.width,
					height: rect.height,
				});
			}
			setBoxes(next);
		};
		measure();
		field.addEventListener("scroll", measure);
		/*
		 * AND ON A RESIZE (code review round 1, R1-3), which the scroll listener
		 * cannot see: a window or pane resize re-wraps the `w-full` textarea with no
		 * React render, so the mirror's inline width and every rect this layer cached
		 * go stale while the chip stays put - an opaque box over the wrong glyphs.
		 * The observer is on the FIELD because that is what is actually resized (the
		 * wrapper's box follows it), and the overlay registers its own for the same
		 * reason; both halves of the treatment are then re-derived from the new
		 * wrapping rather than from the old one.
		 */
		const observer = new ResizeObserver(measure);
		observer.observe(field);
		return () => {
			field.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [fieldRef, mirrorRef, text, capture, payloads]);

	if (boxes.length === 0) return null;

	return (
		<div
			/*
			 * The handle `scripts/credential-chip-geometry.mjs` measures through, and the
			 * ONLY reason it exists: the chip's box is a measurement, so the claim that it
			 * covers the run's box exactly is a pair of rects rather than a description,
			 * and a rig needs a stable way to ask the page for them. Nothing in the app
			 * reads it.
			 */
			data-credential-chips=""
			/*
			 * `overflow-clip` AND NOT `overflow-hidden` (UX round 2, U6 - a BLOCKER). The
			 * two look interchangeable and are not: `hidden` makes this layer a SCROLL
			 * CONTAINER, so when the control takes focus the browser scrolls its nearest
			 * scrollable ancestor - this layer - and the chip is painted `-219px` from its
			 * marker, over unrelated prose, with a live `x`. One real `Tab` from the field
			 * reached it (measured: `layer.scrollTop 0 -> 219`, `scrollHeight` 331 in a
			 * 112px box, `deltaTop -219`), and pressing Enter there destroyed a credential
			 * the operator could not see. `clip` clips exactly the same way and creates no
			 * scroll container, so focus cannot move it; the same `Tab` then leaves
			 * `layer.scrollTop` at 0 and the chip on its run. The story that owns this is
			 * `credential-pill-scrolled`, whose play presses `Tab` and asserts the three
			 * numbers the reviewer measured.
			 */
			className="pointer-events-none absolute inset-0 overflow-clip"
		>
			{boxes.map((box) => {
				const segment = plan[box.planIndex];
				if (!segment) return null;
				const chip = markerChip(segment.text);
				// A run the marker grammar does not parse cannot be labelled, and a chip
				// with the wrong label is worse than the wash it replaces: it is skipped,
				// which is the same fallback a wrapped run takes.
				if (chip === null) return null;
				const unbacked = segment.kind === "unbacked";
				return (
					<CredentialChip
						key={box.planIndex}
						// The composer's chip names the reference the way the buffer does:
						// `#N` is the composer-local label the citation is built from, and the
						// count is the operator's own integrity check (§4).
						label={chip.label}
						chars={chip.chars}
						tone={unbacked ? "warning" : "live"}
						// Only a run a payload backs has a value to throw away. An unbacked
						// marker is a citation of a value this composer cannot reach any more,
						// so there is nothing behind its control to clear and it gets none —
						// and neither does a chip on a composer that is refusing input, where
						// `onClear` is null: the same rule, stated once, that a control whose
						// verb cannot run is not drawn.
						onClear={
							unbacked || onClear === null ? null : () => onClear(chip.index)
						}
						clearLabel={
							unbacked || onClear === null
								? undefined
								: clearControlLabel(chip.index)
						}
						// The composer's chip explains itself on hover (UX round 1, U3): `#1`
						// is composer-local and means nothing to a reader who has looked away,
						// where the transcript's chip is self-describing (`LOP_SECRET_…`). The
						// sentence is the marker's own, from the copy authority in
						// `credential-capture.ts`, and it is also what the chip puts in the
						// accessibility tree.
						title={markerChipTitle(chip.index, chip.chars)}
						className="absolute"
						style={{
							left: box.left,
							top: box.top,
							width: box.width,
							height: box.height,
						}}
					/>
				);
			})}
		</div>
	);
};
