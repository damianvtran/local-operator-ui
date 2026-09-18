import {
	type MutableRefObject,
	type RefObject,
	useLayoutEffect,
	useState,
} from "react";
import {
	type Capture,
	type CredentialPayload,
	IDLE_CAPTURE,
	markerChip,
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
 * WHAT THIS INHERITS FROM THE MIRROR, named rather than discovered: the mirror
 * re-syncs on a text or rung change and on the field's own scroll events, which
 * is every event except a resize of the composer's box (a window resize, a pane
 * resize). On those, the mirror's own wrapping width goes stale and the wash
 * drifts off the glyphs — a pre-existing property of the overlay that this
 * change does not touch. The chips drift WITH the wash, because they are
 * measured from the same element; they cannot come apart from each other.
 */
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
}: CredentialChipLayerProps) => {
	const plan = paintPlan(text, payloads.values(), capture);
	const [boxes, setBoxes] = useState<ChipBox[]>([]);

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
			const next: ChipBox[] = [];
			for (const run of mirror.querySelectorAll<HTMLElement>(
				"[data-credential-run]",
			)) {
				const rects = run.getClientRects();
				// One rect or no chip: a wrapped run has no single box to cover, and the
				// wash the mirror already painted is its documented fallback.
				if (rects.length !== 1) continue;
				const rect = rects[0];
				next.push({
					planIndex: Number(run.dataset.credentialRun),
					// The mirror's own offset is added in, so this stays correct if the
					// layer's frame and the mirror's box ever stop coinciding.
					left: mirror.offsetLeft + rect.left - frame.left + mirror.scrollLeft,
					top: mirror.offsetTop + rect.top - frame.top + mirror.scrollTop,
					width: rect.width,
					height: rect.height,
				});
			}
			setBoxes(next);
		};
		measure();
		field.addEventListener("scroll", measure);
		return () => field.removeEventListener("scroll", measure);
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
			className="pointer-events-none absolute inset-0 overflow-hidden"
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
							unbacked || onClear === null ? undefined : "Remove credential"
						}
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
