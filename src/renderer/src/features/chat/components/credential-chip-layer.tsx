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
 * rather than another class list. The chip's box IS the run's rect (the marker's
 * `getClientRects()` entry) and must stay it, or it drifts off the characters it
 * is lying on top of. The one floor under that is `min-width: min-content` (see
 * where the box is styled below): it only bites if a translation's face outgrows
 * the marker, and the shipped copy is written so that it does not. A
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
 *  - THE MEASUREMENT FOLLOWS THE FIELD, and what MOVES the chips is not the
 *    measurement. Which runs get a chip is re-decided on the field's `scroll`
 *    event, with the same subscription the mirror uses (the mirror's sync runs
 *    first on both mount and scroll — it is a sibling earlier in the DOM, so React
 *    runs its layout effect first and the browser runs its listener first — and
 *    this layer therefore reads a mirror that has already caught up with the
 *    field). WHERE a chip is drawn while the field scrolls is a different
 *    mechanism, set out in the next paragraph, because a main-thread listener is
 *    the wrong tool for it.
 *
 * WHY THE CHIPS RIDE A PLANE THE BROWSER SCROLLS FOR US (operator report
 * 2026-11-27: "it doesn't entirely sync with the text when scrolling ... it seems
 * to just be hovering over some token and is a frame behind"). A wheel or
 * trackpad scroll of a `<textarea>` is performed by the COMPOSITOR: the field's
 * glyphs move in the frame the gesture lands in, and the main thread hears about
 * it a frame later, through the `scroll` event. This layer used to answer that
 * event by re-measuring and re-positioning every chip from React state, so each
 * chip landed one presented frame behind the text it covers. Measured in a real
 * frame stream (a wheel gesture over CDP, `Page.startScreencast`, the field's
 * glyphs painted red and the chip's edge green) it trailed by a median 3px at
 * 240px/s and 10px at 480px/s: a frame's worth of scroll, which is why it grows
 * with speed. No main-thread update can close that, because the update IS the
 * thing that is late (and a `getBoundingClientRect` probe cannot even see it: the
 * main thread's own view of both boxes agrees, 0px, while the frame on screen
 * does not).
 *
 * So the chips stop being positioned from the scroll at all. They are placed in
 * the field's CONTENT coordinates, which do not change while it scrolls, on a
 * plane that is `translate`d by `-scrollTop`, and that translation is a scroll-
 * driven animation on the field's own scroll timeline (`styles/index.css`, the
 * `lo-credential-chips-scroll` block). A scroll-driven transform runs on the
 * compositor, off the same scroll offset as the glyphs, so the two move in the
 * same frame by construction rather than by racing. Where the engine has no scroll
 * timeline the `scroll` listener writes the same `translate` inline — the old
 * one-frame trail, never worse — which is also what keeps the rect arithmetic
 * below testable in a host with no animation engine.
 *
 * WHY THE RECTS GET THE SCROLL ADDED BACK EXACTLY ONCE (UX round 1, U1, the
 * round's BLOCKER, and the reason this is spelled out). `getClientRects()` is
 * VIEWPORT-relative, and this layer is `absolute inset-0` inside the same wrapper
 * the field sits in, so subtracting the layer's own frame turns a rect into the
 * VISIBLE position directly: the rect already has the mirror's scroll applied to
 * it. The first version of this measurement added the mirror's `scrollLeft`/
 * `scrollTop` on top of that, which applied the scroll TWICE — in any message
 * long enough to scroll, the chip sat exactly `fieldScrollTop` px from its marker
 * (measured `deltaTop` 0 / 60 / 117 for `scrollTop` 0 / 60 / 117, which is the
 * whole of the bug), an opaque ground over unrelated prose with a live `x` on it.
 * The plane changes the bookkeeping without changing that rule: a chip's `left`/
 * `top` are now CONTENT coordinates (the visible position plus the scroll the
 * mirror has applied), and the plane's `translate` takes exactly that scroll back
 * out. The scroll is applied once and removed once, and the sum a reader sees
 * (`chip.top + plane translate`) is the rect's own visible position, which is the
 * pair `credential-composer.test.mjs` pins. Adding the scroll WITHOUT the plane
 * (or the plane without the addition) re-creates the double application.
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
	/**
	 * CONTENT coordinates: the run's visible position PLUS the scroll the mirror has
	 * applied, so the value does not change while the field scrolls. The plane these
	 * are placed on takes that scroll back out (see the header), which is the whole
	 * reason a scroll no longer needs a re-render to move a chip.
	 */
	left: number;
	top: number;
	width: number;
	height: number;
};

/**
 * The custom property that carries the field's scrollable distance to the
 * stylesheet's scroll-driven animation (`lo-credential-chips-scroll`).
 *
 * A scroll timeline reports PROGRESS (0..1 of the scrollable distance), and the
 * plane has to move by PIXELS (`scrollTop`), so the keyframe needs the distance
 * to turn one into the other: `translateY = -progress * (scrollHeight -
 * clientHeight)` is exactly `-scrollTop`. It changes when the text or the box
 * does, never while scrolling, so it is written beside the measurement rather
 * than from the scroll path.
 */
const SCROLL_RANGE_VAR = "--lo-credential-scroll-range";

/**
 * Set on a mirror run while a chip covers it; `credential-overlay.tsx` styles the
 * attribute so the wash steps aside. Named once here so the writer and the
 * stylesheet's selector cannot drift apart.
 */
export const CHIPPED_ATTR = "data-credential-chipped";

/** Same boxes, same order: a re-measure that found nothing new renders nothing. */
const sameBoxes = (a: readonly ChipBox[], b: readonly ChipBox[]): boolean =>
	a.length === b.length &&
	a.every((box, i) => {
		const other = b[i];
		return (
			other !== undefined &&
			box.planIndex === other.planIndex &&
			box.left === other.left &&
			box.top === other.top &&
			box.width === other.width &&
			box.height === other.height
		);
	});

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
	/**
	 * The compact rung, whose field is one type step smaller than the wide one - the
	 * chip's own text has to follow it, because the box it covers is that field's line
	 * box (design round 8, D20).
	 */
	small?: boolean;
};

export const CredentialChipLayer = ({
	text,
	payloads,
	capture = IDLE_CAPTURE,
	mirrorRef,
	fieldRef,
	onClear,
	onControlUnmounted,
	small = false,
}: CredentialChipLayerProps) => {
	const plan = paintPlan(text, payloads.values(), capture);
	const [boxes, setBoxes] = useState<ChipBox[]>([]);
	/**
	 * The plane the chips sit on, which the field's scroll translates.
	 *
	 * Written imperatively rather than through props because the fallback path moves
	 * it from a `scroll` listener, and a render per scroll event is the cost this
	 * design exists to stop paying.
	 */
	const planeRef = useRef<HTMLDivElement | null>(null);
	/** The measure effect's `syncPlane`, so the commit that mounts the plane can prime it. */
	const syncPlaneRef = useRef<(() => void) | null>(null);
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
					// VIEWPORT-RELATIVE IN, CONTENT COORDINATES OUT: the rect is where the run
					// is on screen NOW, so the mirror's own scroll is added back to give the
					// place it sits in the text, and the plane's translation takes it out
					// again - once each, see this file's header for the blocker that applying
					// it twice caused. Taking the scroll from the MIRROR rather than the field
					// is deliberate: the rect was read from the mirror, so the mirror's own
					// offset is the one that belongs to it even if the two ever disagree for
					// a frame. The mirror's `offsetLeft`/`offsetTop` stay, so this remains
					// correct if the layer's frame and the mirror's box stop coinciding.
					left: mirror.offsetLeft + rect.left - frame.left + mirror.scrollLeft,
					top: mirror.offsetTop + rect.top - frame.top + mirror.scrollTop,
					width: rect.width,
					height: rect.height,
				});
			}
			// A scroll that moved no chip into or out of view leaves the content
			// coordinates untouched, so there is nothing to render: the compositor has
			// already moved the plane.
			setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
		};
		/*
		 * THE FALLBACK AND THE RANGE. `syncPlane` writes the scrollable distance the
		 * stylesheet's animation maps onto (it changes with the text and the box, so
		 * it is refreshed on every measure) and an inline `translate` for an engine
		 * without a scroll timeline. Where the timeline exists the animation's value
		 * wins over this inline one, so the two never fight: the inline value only
		 * ever shows when nothing else is moving the plane.
		 */
		const syncPlane = () => {
			const plane = planeRef.current;
			if (!plane) return;
			plane.style.setProperty(
				SCROLL_RANGE_VAR,
				`${Math.max(0, field.scrollHeight - field.clientHeight)}px`,
			);
			plane.style.translate = `${-field.scrollLeft}px ${-field.scrollTop}px`;
		};
		const onScroll = () => {
			syncPlane();
			measure();
		};
		syncPlaneRef.current = syncPlane;
		measure();
		/*
		 * THE RANGE IS REFRESHED ON EVERY MEASURE, not only on a scroll or a chip move
		 * (code review round 1, R1-1). This effect re-runs when the text, the payloads
		 * or the capture change, and an edit BELOW a visible chip while the field is
		 * scrolled changes `scrollHeight` and nothing else: the run keeps its rect, the
		 * field keeps its `scrollTop`, so no scroll event fires, no chip box changes and
		 * the prime effect below (keyed on `boxes`) never runs. Without this call the
		 * animation would keep mapping progress onto the OLD range and park the plane
		 * `scrollTop * (1 - oldRange / newRange)` px off the glyphs until the next scroll.
		 * A no-op where there is no plane yet; the prime effect covers that mount.
		 */
		syncPlane();
		field.addEventListener("scroll", onScroll);
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
		const observer = new ResizeObserver(onScroll);
		observer.observe(field);
		return () => {
			field.removeEventListener("scroll", onScroll);
			observer.disconnect();
			syncPlaneRef.current = null;
		};
	}, [fieldRef, mirrorRef, text, capture, payloads]);

	/*
	 * PRIME THE PLANE ON THE COMMIT THAT MOUNTS IT. The plane only exists while a
	 * chip does, so the measure that decided to draw one ran BEFORE there was a plane
	 * to write the scroll range and the starting translation onto. The first chip of a
	 * scrolled composer would otherwise sit at its content coordinates with no
	 * translation until the next scroll event - a chip a whole `scrollTop` off its
	 * marker, which is the U1 blocker again by a different road.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `boxes` is the trigger - this runs after the commit that mounts or replaces the plane - and the body reads only the ref the measure effect fills.
	useLayoutEffect(() => {
		syncPlaneRef.current?.();
	}, [boxes]);

	/*
	 * THE MIRROR STOPS PAINTING THE WASH UNDER A RUN THAT HAS A CHIP. The chip is
	 * opaque and covers its run exactly, so the wash under it adds nothing - except
	 * during a scroll, where the mirror (scrolled from a main-thread listener, like
	 * every layer in the composer) still trails the compositor by a frame while the
	 * chip no longer does: the wash would peek out past the chip's edge as a ghost
	 * of the same fill, trailing it. A run with no chip (wrapped, or clipped out of
	 * the field) keeps its wash, which is the documented fallback and the only job
	 * the wash has left on a chipped marker.
	 *
	 * It is an attribute written onto the mirror's spans rather than state in the
	 * overlay because the decision lives here (the same rect measurement that places
	 * the chip decides it), and it is written in a layout effect on the commit that
	 * draws the chip, so the wash never goes away a frame before the chip arrives.
	 * Every render re-applies it, because React replaces a span when the plan's kind
	 * at that position changes and a replaced span has no attribute.
	 */
	useLayoutEffect(() => {
		const mirror = mirrorRef.current;
		if (!mirror) return;
		const chipped = new Set(boxes.map((box) => box.planIndex));
		for (const run of mirror.querySelectorAll<HTMLElement>(
			"[data-credential-run]",
		)) {
			if (chipped.has(Number(run.dataset.credentialRun))) {
				run.setAttribute(CHIPPED_ATTR, "");
			} else {
				run.removeAttribute(CHIPPED_ATTR);
			}
		}
	});
	useLayoutEffect(
		() => () => {
			for (const run of mirrorRef.current?.querySelectorAll(
				`[${CHIPPED_ATTR}]`,
			) ?? []) {
				run.removeAttribute(CHIPPED_ATTR);
			}
		},
		[mirrorRef],
	);

	if (boxes.length === 0) return null;

	return (
		<div
			/*
			 * THE CLIP, AND THE ONLY THING IN THIS LAYER THAT IS NOT MOVED BY THE SCROLL.
			 * `overflow-clip` AND NOT `overflow-hidden` (UX round 2, U6 - a BLOCKER). The
			 * two look interchangeable and are not: `hidden` makes this layer a SCROLL
			 * CONTAINER, so when the control takes focus the browser scrolls its nearest
			 * scrollable ancestor - this layer - and the chip is painted `-219px` from its
			 * marker, over unrelated prose, with a live `x`. One real `Tab` from the field
			 * reached it (measured: `layer.scrollTop 0 -> 219`, `scrollHeight` 331 in a
			 * 112px box, `deltaTop -219`), and pressing Enter there destroyed a credential
			 * the operator could not see. `clip` clips exactly the same way and creates no
			 * scroll container, so focus cannot move it; the same `Tab` then leaves
			 * `scrollTop` at 0 and the chip on its run. The story that owns this is
			 * `credential-pill-scrolled`, whose play presses `Tab` and asserts the three
			 * numbers the reviewer measured against THIS element. The plane inside it is
			 * not a scroll container either - it is moved by `translate`, never by scroll.
			 */
			data-credential-chip-clip=""
			className="pointer-events-none absolute inset-0 overflow-clip"
		>
			<div
				ref={planeRef}
				/*
				 * The handle `scripts/credential-chip-geometry.mjs` measures through, and the
				 * ONLY reason it exists: the chip's box is a measurement, so the claim that it
				 * covers the run's box exactly is a pair of rects rather than a description,
				 * and a rig needs a stable way to ask the page for them. The stylesheet's
				 * scroll-driven animation also selects on it (`index.css`). It is the chips'
				 * parent, so `layer.children` is still the chips.
				 */
				data-credential-chips=""
				/*
				 * `will-change: translate` because this is the property the scroll timeline
				 * animates: the plane is promoted before the first scroll, so the first frame
				 * of a gesture does not pay for the layer.
				 */
				className="pointer-events-none absolute inset-0 will-change-[translate]"
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
							// `#N` is an identifier in both registers (R1-4): the not-stored chip
							// here is labelled by the same ordinal, unlike the transcript's
							// sentence.
							identifier
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
							small={small}
							className="absolute"
							style={{
								left: box.left,
								top: box.top,
								width: box.width,
								// THE BOX IS THE MARKER'S RECT; `min-content` IS A FLOOR UNDER IT, NOT A
								// LICENCE TO GROW (S18b design rounds 1 and 2, D1/D5/D7).
								// `width` is the raw marker's rect, which is minted in English and never
								// translates, while the chip's contents do: an unabbreviated fr/es/ru
								// count token (`shrink-0`) measured ~95.2px (ru ~92.6) against 62.25 in
								// en at the 19-char marker, and the label (`min-w-0 truncate`) absorbs
								// the whole deficit - it collapsed to 0px, so the pill lost its `#1`,
								// its only identifier in the composer. `min-width: min-content` keeps
								// the label from being the item that pays.
								//
								// THE FLOOR MUST NEVER BITE IN SHIPPED COPY. A chip whose face fits the
								// marker keeps the marker's width EXACTLY (English stays 157.33px at
								// 1024; its face is 143.28), but a face wider than the marker would
								// overhang it, and the chip's ground is OPAQUE: the overhang would paint
								// over the operator's own text beside the run. Design round 2 measured
								// that at 16.25-18.88px (19.30-21.77 compact) for the long fr/es/ru
								// words and rejected it (D5), the same trade `credentialMarker`'s record
								// rejects at 34px (`credential-capture.ts`, "THE LABEL IS THE INDEX
								// ALONE"). So the cure is in the copy, not here: the fr/es/ru count is
								// abbreviated (`car.`, `симв.`) so the translated face fits the English
								// marker box, and `scripts/i18n/approval-paydown-copy.test.mjs` pins
								// the length. A future locale whose count outgrows the marker would
								// still get a readable label rather than a collapsed one, at the cost
								// of that overhang; shorten its copy rather than relying on this.
								minWidth: "min-content",
								height: box.height,
							}}
						/>
					);
				})}
			</div>
		</div>
	);
};
