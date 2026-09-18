import { cn } from "@shared/lib/utils";
import {
	type MutableRefObject,
	type RefObject,
	useLayoutEffect,
	useRef,
} from "react";
import {
	type Capture,
	type CredentialPayload,
	IDLE_CAPTURE,
	type PaintSegment,
	paintPlan,
	planPaintsAnything,
} from "./credential-capture";
import {
	CREDENTIAL_CHIP_ROLE,
	CREDENTIAL_NOT_STORED_ROLE,
} from "./credential-chip";

/*
 * The credential wash, drawn under the marker text.
 *
 * THE DELIBERATE DIVERGENCE (design §7.1). The TUI hangs a styled chip on the
 * marker because its document is a widget tree; the composer is a plain
 * `<textarea>` over a plain string, so there is nothing to hang a node on. What
 * the operator wants to SEE is the chip, and that is `credential-chip-layer.tsx`
 * — an opaque chip painted OVER the run. This element is the half that stays
 * behind the textarea's glyphs and paints the chip's GROUND there, so that:
 *
 *  - the textarea keeps painting every glyph, and a failure of the resting layer
 *    can never make the user's text invisible;
 *  - a run the chip layer cannot cover — one that WRAPS, so it has no single box —
 *    still reads as a marked region rather than as raw marker text, which is its
 *    documented fallback;
 *  - the MASK span and the ARMED token, which are never chipped, keep the wash
 *    treatment they had (`CREDENTIAL_ARMED_ROLE` below, and the mask's use of the
 *    chip's own fill).
 *
 * WHY THE EDGE IS AN OUTLINE AND NOT A BORDER, which is the same pixel reason the
 * chip carries it: this element's text must sit at EXACTLY the offsets the
 * textarea's text does, or the run walks out of step with the characters it is
 * under. A 1px border adds 2px to every line box after it and the mirror's run
 * walks out of step with the real one; an outline is painted without
 * participating in layout, which is the same property the branding contract
 * relies on for focus rings (and why it forbids box-shadow rings in this app).
 * `outline-solid` is required: `outline-width` alone leaves `outline-style: none`
 * and paints nothing — the trap the composer's own focus ring documents.
 *
 * WHY THE MIRROR'S TEXT IS TRANSPARENT. The layout has to match, so the text has
 * to be there; the ink has to come from the textarea, so the text has to be
 * invisible. `text-transparent` is the mechanism, and it is the whole reason a
 * failure here is cosmetic rather than a blank composer.
 *
 * THE WASH IS NOW OPAQUE AND THAT IS A REQUIREMENT, not a property of the role.
 * `infoWash` and `warningWash` are flat palette values with no alpha, which is
 * what lets the chip layer hide the marker's glyphs completely: a translucent
 * wash would leave the marker text showing THROUGH the chip. A palette change
 * that gave a wash an alpha channel would break the chip rather than tint it,
 * which is why both washes are asserted against a ground in the contrast
 * contract rather than against each other.
 */

/**
 * The ARMED token's treatment: the warning wash, and no edge.
 *
 * Design round 1, D2. The armed state had one cue — a muted sentence — while the
 * TUI marks the same state twice (`local_operator.tui.local_operator.tcss:624`:
 * the amber token run and the chevron glyph swap, "the glyph is the one that
 * survives `NO_COLOR`, a monochrome terminal and red-green colour vision
 * deficiency"). A `<textarea>` carries neither of those: no per-run colour and
 * no glyph to swap. What it has is this mirror, so the token the capture is
 * latched to takes the wash — the same technique the chip's own ground uses, on
 * the same element, at no layout cost.
 *
 * No edge, deliberately, where the chip has one. The chip's outline is the
 * boundary of a thing the operator is being handed (a reference, with a count
 * and a control); the armed token is the ordinary word they just typed, marked.
 * Adding a second outlined box beside the chip would read as a second credential.
 *
 * IT IS ALSO NEVER CHIPPED: the chip layer paints only the two marker runs
 * (`pill` and `unbacked`), so an armed token and a masked span keep the wash as
 * their whole treatment.
 */
export const CREDENTIAL_ARMED_ROLE = cn("rounded-xs bg-warning-wash");

/**
 * The composer's text box model, shared by the textarea and the mirror.
 *
 * ONE definition because the two MUST agree: the pill is painted at the offsets
 * this box produces, and any drift (a padding step, a type step, a line height)
 * moves the pill off the characters it sits under. `font-family`, size and
 * line-height all reach both elements by inheritance — the textarea takes
 * Tailwind's preflight `font: inherit` — so the classes below are the whole
 * difference between them.
 */
export const composerTextBox = (isSmallView: boolean): string =>
	cn(
		// `whitespace-pre-wrap` + `break-words`: the textarea's own wrapping model,
		// restated for an element that is not a text control.
		"w-full whitespace-pre-wrap break-words",
		isSmallView ? "px-1.5 py-1 text-body-sm" : "px-2 py-1.5 text-body",
	);

type CredentialOverlayProps = {
	/** The live buffer: the marker text the textarea is painting. */
	text: string;
	/** The credentials this composer holds, keyed by their marker index. */
	payloads: ReadonlyMap<number, CredentialPayload>;
	/** The open capture, so the masked span paints with the pill's own role. */
	capture?: Capture;
	/** The textarea this mirror aligns to, for width and scroll synchronisation. */
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	/**
	 * The mirror element, when the caller owns it.
	 *
	 * The composer passes its own ref because a SECOND element needs to measure
	 * these same spans: the chip layer paints over them, and the mirror is the only
	 * source of a run's geometry that also knows where the field's text has been
	 * scrolled to. The ref is the seam between the two, so the chip layer never
	 * grows a second mirror to keep in step with this one.
	 */
	mirrorRef?: MutableRefObject<HTMLDivElement | null>;
	isSmallView: boolean;
};

const pillClassName = (kind: PaintSegment["kind"]) => {
	if (kind === "plain") return "text-transparent";
	if (kind === "armed") return cn("text-transparent", CREDENTIAL_ARMED_ROLE);
	if (kind === "unbacked")
		return cn("text-transparent", CREDENTIAL_NOT_STORED_ROLE);
	return cn("text-transparent", CREDENTIAL_CHIP_ROLE);
};

export const CredentialOverlay = ({
	text,
	payloads,
	capture = IDLE_CAPTURE,
	fieldRef,
	mirrorRef,
	isSmallView,
}: CredentialOverlayProps) => {
	const ownRef = useRef<HTMLDivElement | null>(null);
	const overlayRef = mirrorRef ?? ownRef;
	const plan = paintPlan(text, payloads.values(), capture);

	/*
	 * Geometry, re-measured on every change rather than assumed from the classes.
	 *
	 * Two numbers matter and neither is a constant. The CONTENT WIDTH is not the
	 * textarea's box width once the box is taller than `max-h` and its own
	 * scrollbar appears — the bar is inside the element, so the wrapping width
	 * shrinks and a mirror sized to the outer box would wrap at a different
	 * column. And the SCROLL OFFSET moves the text up inside that box while the
	 * overlay stays put, which is the same drift in the vertical direction.
	 * Reading both from the real element is what keeps them in step; the
	 * `scroll` listener is the only subscription for the SCROLL, and it is removed
	 * with the element because the textarea unmounts with this component.
	 *
	 * AND A `ResizeObserver` FOR THE RESIZE (code review round 1, R1-3). A window or
	 * pane resize re-wraps the `w-full` textarea with no React render at all, so
	 * neither of the numbers above changes as far as this component knows: the
	 * inline width this effect wrote stays at the old `clientWidth` and the mirror
	 * (and with it the wash, and the chip measured off the same spans) goes on
	 * wrapping at a column the field no longer uses. The chip is what makes the
	 * consequence visible — it is opaque and defined to cover the run exactly — so
	 * the same subscription is registered here, beside the scroll listener, rather
	 * than left as a property the chip layer inherits.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the sync must re-run after EVERY render that changes the text or the rung, because the textarea's own height (and therefore its clientWidth once its scrollbar appears) is a function of the text; the body reads only refs, which is why the list has to be carried by hand.
	useLayoutEffect(() => {
		const field = fieldRef.current;
		const overlay = overlayRef.current;
		if (!field || !overlay) return;
		const sync = () => {
			overlay.style.width = `${field.clientWidth}px`;
			overlay.style.height = `${field.clientHeight}px`;
			overlay.scrollTop = field.scrollTop;
			overlay.scrollLeft = field.scrollLeft;
		};
		sync();
		field.addEventListener("scroll", sync);
		const observer = new ResizeObserver(sync);
		observer.observe(field);
		return () => {
			field.removeEventListener("scroll", sync);
			observer.disconnect();
		};
	}, [fieldRef, text, isSmallView]);

	/*
	 * MOUNTED ONLY WHILE IT HAS SOMETHING TO PAINT (§7.1). The ordinary composer —
	 * no marker, no open capture — keeps exactly the render path it had, and pays
	 * nothing for this feature beyond one predicate. See `planPaintsAnything`.
	 */
	if (!planPaintsAnything(plan)) return null;

	return (
		<div
			ref={overlayRef}
			aria-hidden="true"
			className={cn(
				composerTextBox(isSmallView),
				// `-z-10` inside an `isolate` wrapper: the pill paints UNDER the
				// textarea's glyphs and OVER nothing else. Without the isolate the
				// negative index would paint behind the composer box's own background
				// and the pill would disappear entirely (CSS 2.1 appendix E, step 3
				// before step 4) — which looks exactly like a pill that was never
				// drawn.
				"-z-10 pointer-events-none absolute inset-0 select-none overflow-hidden",
			)}
		>
			{plan.map((segment, index) => (
				<span
					// A segment's identity is its position and its kind: the plan is a
					// fresh array on every keystroke and the text inside a span changes
					// with the buffer, so a content-keyed React key would remount the
					// pills on every character typed.
					// biome-ignore lint/suspicious/noArrayIndexKey: the plan is positional by construction
					key={index}
					/*
					 * THE HANDLE THE CHIP LAYER MEASURES. Only the two runs that get a chip
					 * carry it — a marker a payload backs, and a marker nothing backs — so the
					 * measured set is `paintPlan`'s own answer about what is chipped rather
					 * than a second predicate free to disagree with it. The value is the
					 * segment's position in this array, which is how the chip finds the text it
					 * is labelling.
					 */
					{...(segment.kind === "pill" || segment.kind === "unbacked"
						? { "data-credential-run": index }
						: {})}
					className={pillClassName(segment.kind)}
				>
					{segment.text}
				</span>
			))}
		</div>
	);
};
