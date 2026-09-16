import { cn } from "@shared/lib/utils";
import { type RefObject, useLayoutEffect, useRef } from "react";
import {
	type Capture,
	type CredentialPayload,
	IDLE_CAPTURE,
	type PaintSegment,
	paintPlan,
	planPaintsAnything,
} from "./credential-capture";

/*
 * The pill, drawn under the marker text.
 *
 * THE DELIBERATE DIVERGENCE (design §7.1). The TUI hangs a styled chip on the
 * marker because its document is a widget tree; the composer is a plain
 * `<textarea>` over a plain string, so there is nothing to hang a node on. The
 * pill is therefore a BACKGROUND-ONLY overlay: a mirror element behind the
 * textarea, with the same box model and typography, that paints a pill behind
 * each marker span and NO VISIBLE TEXT AT ALL. The textarea keeps painting every
 * glyph, so a failure of this overlay can never make the user's text invisible,
 * and the marker text and the pill can never disagree — they are the same
 * characters.
 *
 * WHAT THE PILL IS FOR, in the branding contract's terms: it is a role, not a
 * colour. `bg-info-wash` with `info-border` as the edge, because the pill states
 * a FACT ("a credential is referenced here") rather than a success or a failure —
 * and because the wash/edge pair is the one the contrast contract already
 * asserts on the composer's own ground. `scripts/contrast-contract.mjs` carries
 * the row ("credential pill"), which is what makes the claim checkable rather
 * than asserted: ink clears 8.15:1 against the wash and the edge clears 3.14:1
 * against `surface` in the weakest of the twelve themes.
 *
 * WHY THE EDGE IS AN OUTLINE AND NOT A BORDER, which is a pixel requirement
 * rather than a style choice: this element's text must sit at EXACTLY the offsets
 * the textarea's text does, or the pill drifts away from the characters it is
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
 */

/**
 * The pill's ground and edge, and the mask span's too.
 *
 * One treatment for both states on purpose: the region means "a credential is
 * here", and *which* state it is in — armed, masked, sealed — is what the
 * composer's notice line says, exactly as the TUI's notice row carries it. A
 * second colour for the in-progress span would spend the accent budget on a
 * distinction the sentence already makes.
 */
export const CREDENTIAL_PILL_ROLE = cn(
	"rounded-xs bg-info-wash",
	"outline-1 outline-solid outline-info-border",
	// A marker that wraps draws a pill on each line rather than one stretched box
	// across the break, which is how an inline chip behaves everywhere else.
	"box-decoration-clone",
);

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
	isSmallView: boolean;
};

const pillClassName = (kind: PaintSegment["kind"]) =>
	kind === "plain"
		? "text-transparent"
		: cn("text-transparent", CREDENTIAL_PILL_ROLE);

export const CredentialOverlay = ({
	text,
	payloads,
	capture = IDLE_CAPTURE,
	fieldRef,
	isSmallView,
}: CredentialOverlayProps) => {
	const overlayRef = useRef<HTMLDivElement | null>(null);
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
	 * `scroll` listener is the only subscription, and it is removed with the
	 * element because the textarea unmounts with this component.
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
		return () => field.removeEventListener("scroll", sync);
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
					className={pillClassName(segment.kind)}
				>
					{segment.text}
				</span>
			))}
		</div>
	);
};
