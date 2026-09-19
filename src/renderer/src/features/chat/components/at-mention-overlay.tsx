/**
 * The mention chip: a fill drawn BEHIND the composer's own text, measured from
 * the text itself.
 *
 * WHY THIS IS A DRAWING AND NOT A STYLED SPAN, in one paragraph, because it is
 * the whole design decision. The composer's field is a plain `<textarea>`: there
 * is no element to put a class on, and the previous two attempts to own that
 * element's identity are contracts (`COMPOSER_TEXTAREA_SELECTOR` is how the
 * escape ladder defers to the composer by name; the box's focus ring is
 * `has-[textarea:focus-visible]:…`, i.e. drawn FOR the field). A styled span
 * inside the mirror would be the cheap version and it is the one that fails: an
 * inline span's horizontal padding participates in layout, so a 6px overhang
 * would push every glyph after the first token and desync the mirror from the
 * field — in the app's primary input, silently. So the mirror's job is
 * MEASUREMENT (`Range`-free: the spans' own `getClientRects()`), and the fills
 * are out-of-flow rectangles in a layer that is not the field. The failure mode
 * is then a missing fill — quiet and local — instead of displaced text.
 *
 * WHY THE FILL IS `sunken`, AND WHY IT HAS NO EDGE. It is the app's existing
 * recessed-small-object ground (the neutral badge, the tabs track, the table
 * header, the skeleton bar), and the design's § 6 measures the step this feature
 * needs against the surface it sits on: `surface -> sunken` is ΔE00 3.75 at its
 * worst of the twelve themes, against an aim of 2. The fill IS the boundary, so
 * it takes no edge by default: a `border-control` rule would be a 3:1 edge behind
 * every mention in a sentence, which is the loudness the sibling direction spent
 * a whole round removing from the suggestion chips. `border-hairline` is the
 * costed fallback in the design record and is deliberately not taken: it needs a
 * frame that shows the fill failing first.
 *
 * WHAT THE CHIP MAY NOT DO: no pointer affordance (the pointer belongs to the
 * field — a control inside a text field would be a second interactive object
 * inside the first and would owe a 3:1 boundary), no tooltip, no stored chip
 * list (anything kept beside the text drifts from it on the first paste, undo or
 * IME commit, and the drift is invisible until submit), and no words. The field's
 * own `value` is the literal text, so a screen reader reads `@src/app.py` as the
 * characters it is — which is the correct announcement, because that IS the
 * message.
 */

import { cn } from "@shared/lib/utils";
import {
	type RefObject,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { atSpanKey } from "./at-contract";
import { atSegments } from "./at-token";
import type { AtSpan } from "./at-token";
import { composerTextBox } from "./credential-overlay";

/**
 * The two grounds a chip can take, and nothing else.
 *
 * `sunken` is the ordinary state; `warning-wash` is the OUTSIDE-WORKSPACE state,
 * and the name is the fact the fill actually encodes (design round 1, D8): the
 * renderer's condition is CONTAINMENT alone (`fill.outside`, the harness's
 * `_resolve_workspace_path`), so a deny-listed path inside the workspace takes
 * the ordinary fill while the gate still raises a card at submit. Calling this
 * "the needs-approval fill" would claim the pair is the approval prediction, and
 * it is not — the gate at submit is the approval decision, and this fill is the
 * half of it the composer can answer without re-spelling backend state.
 *
 * The step between the two states is a HUE step rather than a luminance one —
 * ΔE00 5.37 at its worst where the luminance ratio for the same pair is 1.06:1 —
 * which is why ΔE00 is the right instrument (`docs/branding.md` § 3) and why the
 * outside fill ALSO carries an edge (`border-warning-border`). The edge is not
 * decoration: measured over the shipped palettes, the pair (`warning-wash`
 * against `sunken`) is ΔE00 0.72 in `kanagawaLotus`, 1.44 in `sage` and 1.61 in
 * `paper`, i.e. in three of them hue alone is not a step a reader can see, and a
 * 1px rule is a second channel that does not depend on it. Two class strings
 * rather than one so the contrast contract can pin them at the call site
 * (`scripts/contrast-contract.mjs` pins this literal, and its `PERCEPTIBLE` rows
 * carry the palette half), so a later edit to either chip's ground fails a gate
 * instead of quietly flattening it.
 *
 * `box-border` is load-bearing on the second one: the fills' width and height are
 * written from a measurement, and a border that ADDED 2px per axis would move
 * every outside chip off the glyphs it sits under. Tailwind's preflight already
 * sets `border-box`, so this states the requirement where a reader meets the edge
 * rather than leaving it to a global.
 */
export const MENTION_CHIP_ROLE = "rounded-sm bg-sunken";
export const MENTION_CHIP_OUTSIDE_ROLE =
	"box-border rounded-sm border border-warning-border bg-warning-wash";

/**
 * How far the fill extends past the token's own glyphs, on each side.
 *
 * The overhang is what makes the fill read as a container rather than as
 * highlighting. 6px and not 8px is a measurement rather than a taste: the field's
 * own inset is `px-2` (8px) at a normal column and `px-1.5` (6px) in the small
 * view, so a mention at the very start of a draft paints inside the field at
 * every size, reaching the inset edge exactly in the small view and never
 * touching the box's own 16px padding.
 */
const CHIP_OVERHANG_PX = 6;

/**
 * The ground a side facing another mention must leave unpainted: one space's
 * advance in this field.
 *
 * A measurement, and the same one the design record's § 5 state 10 carries: an
 * `@a.py @b.py` pair measures the separator at **3.8px** at a normal column
 * (3.6px in the small view, where the field's own type step shrinks), against
 * the 4.5px the direction first budgeted for. It is a floor rather than an
 * equality, which is what makes it safe under that drift: a ground at or below
 * this value spends the WHOLE space as separator, and the fills still cannot
 * touch however far a font or a zoom moves the real advance — the separator is
 * never smaller than `min(ground, this)`, because the overhang it is taken out
 * of is capped at `CHIP_OVERHANG_PX` as well.
 */
const CHIP_SEPARATOR_MIN_PX = 3.8;

/**
 * The fill's height: the line box (21.7px at `text-body`'s 14px x 1.55) less 2px
 * at the top and bottom.
 *
 * The 2px insets are what keep two chips on consecutive lines 4px apart, so a
 * chip on line 2 cannot merge with one on line 1, while still covering the ~16.5px
 * glyph content box the measurement comes back with (the design's open item 4,
 * answered by the first frame this feature was rendered for).
 */
const CHIP_HEIGHT_PX = 17.7;

/**
 * A zero-width, unbreakable character appended to the mirror.
 *
 * A `<textarea>`'s value ending in a newline paints an empty last line; the same
 * string in a block collapses it. The mirror has to agree with the field about
 * where the lines are, and a no-break filler is what makes the empty line exist
 * without offering a wrap opportunity the field does not have.
 */
const MIRROR_TAIL = "\uFEFF";

/** One drawn fill, in the mirror's own content coordinates. */
type FillRect = {
	/** This fill's own identity: a token paints one per line fragment. */
	key: string;
	/** The token the fill belongs to, keyed as the resolved map keys it. */
	span: string;
	left: number;
	top: number;
	width: number;
	height: number;
	outside: boolean;
};

export type AtMentionOverlayProps = {
	/** The live draft: the text the field is painting. */
	text: string;
	/** The candidate tokens in that draft, from `atTokenSpans`. */
	spans: readonly AtSpan[];
	/** Which of those tokens are chips, from `useAtResolution`. */
	resolved: ReadonlyMap<string, { outside: boolean }>;
	/** The textarea this mirror aligns to, for width, height and scroll. */
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	isSmallView: boolean;
};

const sameFills = (a: readonly FillRect[], b: readonly FillRect[]): boolean =>
	a.length === b.length &&
	a.every((fill, index) => {
		const other = b[index];
		return (
			fill.key === other.key &&
			fill.span === other.span &&
			fill.left === other.left &&
			fill.top === other.top &&
			fill.width === other.width &&
			fill.height === other.height &&
			fill.outside === other.outside
		);
	});

export const AtMentionOverlay = ({
	text,
	spans,
	resolved,
	fieldRef,
	isSmallView,
}: AtMentionOverlayProps) => {
	const mirrorRef = useRef<HTMLDivElement | null>(null);
	const markers = useRef(new Map<string, HTMLSpanElement | null>());
	const [fills, setFills] = useState<FillRect[]>([]);
	const [scrollTop, setScrollTop] = useState(0);

	/*
	 * Geometry, re-measured on every change rather than assumed from the classes.
	 *
	 * Two numbers matter and neither is a constant. The CONTENT WIDTH is not the
	 * textarea's box width once the box is taller than `max-h-28` and its own
	 * scrollbar appears — the bar is inside the element, so the wrapping width
	 * shrinks and a mirror sized to the outer box would wrap at a different
	 * column. And the scroll offset moves the text up inside the box while the
	 * fills stay put, which is the same drift in the vertical direction. The
	 * second is handled by measuring in the mirror's CONTENT coordinates and
	 * subtracting the field's own `scrollTop` at render time, so a scroll costs a
	 * re-render and not a re-measure.
	 *
	 * The measurement itself is the spans' own `getClientRects()`, one rect per
	 * line fragment — so a token that wraps paints two fills with the line gap
	 * between them, which is the reading that catches a mirror styled by a
	 * different class string from the field.
	 */
	const sync = useCallback(() => {
		const field = fieldRef.current;
		const mirror = mirrorRef.current;
		if (!field || !mirror) return;
		mirror.style.width = `${field.clientWidth}px`;
		mirror.style.height = `${field.clientHeight}px`;
		setScrollTop((current) =>
			current === field.scrollTop ? current : field.scrollTop,
		);
		const box = mirror.getBoundingClientRect();
		/*
		 * THE RUNS FIRST, THE FILLS SECOND, because a fill's width depends on what is
		 * BESIDE it. Each token's runs are collected with their token's identity, and
		 * only then is each one turned into a rectangle — which is what lets an
		 * overhang shrink where a neighbour is close.
		 *
		 * WHAT THE OLDER SHAPE GOT WRONG, and it is a defect the direction predicted
		 * would be checked on a frame: a fixed 6px overhang on both sides of two
		 * adjacent mentions covers 12px of the GROUND BETWEEN them, and that ground is
		 * one space — measured in this field at 3.8px, not the 4.5px the direction
		 * budgeted for. `@a.py @b.py` therefore painted ONE rectangle spanning both
		 * tokens and the separator, which is the one thing the rule forbids: the fill
		 * covers the token and never the separator.
		 */
		const runs: {
			key: string;
			span: string;
			top: number;
			left: number;
			right: number;
			/** The measured box's own height, before the design's floor. */
			rectHeight: number;
			height: number;
			outside: boolean;
		}[] = [];
		for (const span of spans) {
			const key = atSpanKey(span);
			const fact = resolved.get(key);
			const element = markers.current.get(key);
			if (!fact || !element) continue;
			for (const rect of element.getClientRects()) {
				if (rect.width <= 0 || rect.height <= 0) continue;
				// The fill is centred on the measured box and never shorter than the
				// design's 17.7px: whichever of the two answers `getClientRects` gives
				// (the glyph content box or the line box), the drawn height covers the
				// glyphs and the 2px insets still leave the 4px gap between lines.
				runs.push({
					key: "",
					span: key,
					top: rect.top - box.top,
					left: rect.left - box.left,
					right: rect.right - box.left,
					rectHeight: rect.height,
					height: Math.max(rect.height, CHIP_HEIGHT_PX),
					outside: fact.outside,
				});
			}
		}
		/*
		 * THE OVERHANG IS TAKEN OUT OF THE GROUND, AND THE GROUND DECIDES HOW MUCH
		 * (design round 1's D2, re-scoped by design round 2's D9).
		 *
		 * WHAT D2 SETTLED, and the number it replaced. The clamp used to be half the
		 * clear ground less 0.5px, which left 1.00px of unpainted separator between two
		 * adjacent fills — a value that exists in the DOM and not in the pixels: read off
		 * the committed frames, no pixel in the seam came within 4/255 of the ground in
		 * `localOperatorLight`, and the dark themes never approached it at all. The fill
		 * is the boundary, so a one-pixel gap is not a separator, and the merge it hid
		 * was not merely quiet: the quoted form `@"my file.txt"` paints ONE fill over a
		 * space, so two merged chips were indistinguishable from a single token — a
		 * picture making a claim that is false.
		 *
		 * WHAT THE FIRST CORRECTION GOT WRONG (D9), and it is why this is a distance
		 * again: it dropped the term entirely and returned 0 for a run ANYWHERE on the
		 * line, so a side facing a mention 39px — or 149px — away lost the same 6px it
		 * loses at 3.8px. Two consequences the designer measured on the re-captured
		 * frames: `mentions-at-the-edges` lost 5-6px across 149px of prose, and in
		 * `chip-needs-approval` the outside chip's new 1px rule came to render in
		 * columns 441-442 against the token's own first ink column at 441 — the one
		 * state whose whole job is to be readable at a glance, with 6px of air on its
		 * free side and none on this one. A fill's silhouette may not depend on
		 * something 150px away, and reflowing a mention onto the next line may not
		 * reshape a chip the user is not touching.
		 *
		 * THE RULE, IN ONE SENTENCE: a facing side keeps a full space's advance of
		 * ground unpainted, and the two facing sides split whatever is left of the ground
		 * between them, never more than `CHIP_OVERHANG_PX` each. So a neighbour one space
		 * away spends the whole space as separator — D2's case, exactly, and the case its
		 * frames were written about — the overhang grows continuously with the room, and
		 * from a ground of `CHIP_SEPARATOR_MIN_PX + 2 x CHIP_OVERHANG_PX` (15.8px) out it
		 * is the full 6px again. A chip with nothing beside it is unchanged, which is
		 * where the container reading lives (a mention opening or closing a draft, or the
		 * two outer ends of a pair).
		 *
		 * WHAT IT CANNOT DO, stated where the next reader meets it rather than left to be
		 * inferred from the arithmetic: with THREE mentions on one line at one space each,
		 * the middle chip is flush at both ends. That is not the rule failing — the only
		 * alternative is painting the space, which is the one thing it forbids — and the
		 * design record's § 5 state 10 and § 3.1 now say so.
		 *
		 * The separator can never reach zero whatever the ground is, because the overhang
		 * is capped: it is at least `min(ground, CHIP_SEPARATOR_MIN_PX)`, so the "one
		 * fill over a space" misreading D2 was written for cannot come back.
		 *
		 * A neighbour is a run of a DIFFERENT token whose vertical band overlaps this
		 * one's, so a wrapped token's own fragments never clamp each other, and two
		 * mentions on different lines never see each other at all. The NEAREST such run
		 * on that side is the one that decides: the ground a side may spend is the ground
		 * to the closest fill it must not touch.
		 */
		const groundBeside = (
			run: (typeof runs)[number],
			side: "left" | "right",
		): number | null => {
			let ground: number | null = null;
			for (const other of runs) {
				if (other.span === run.span) continue;
				if (
					other.top >= run.top + run.height ||
					run.top >= other.top + other.height
				)
					continue;
				const gap =
					side === "left" ? run.left - other.right : other.left - run.right;
				if (gap < 0) continue;
				ground = ground === null ? gap : Math.min(ground, gap);
			}
			return ground;
		};
		const overhang = (run: (typeof runs)[number], side: "left" | "right") => {
			const ground = groundBeside(run, side);
			if (ground === null) return CHIP_OVERHANG_PX;
			return Math.min(
				CHIP_OVERHANG_PX,
				Math.max(0, (ground - CHIP_SEPARATOR_MIN_PX) / 2),
			);
		};
		const measured: FillRect[] = runs.map((run, index) => {
			const left = overhang(run, "left");
			const right = overhang(run, "right");
			return {
				key: `${run.span}:${index}`,
				span: run.span,
				left: run.left - left,
				top: run.top + (run.rectHeight - run.height) / 2,
				width: run.right - run.left + left + right,
				height: run.height,
				outside: run.outside,
			};
		});
		setFills((current) => (sameFills(current, measured) ? current : measured));
	}, [fieldRef, spans, resolved]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the sync must re-run after EVERY render that changes the text or the rung, because the field's own height (and therefore its clientWidth once its scrollbar appears) is a function of the text; the body reads only refs, which is why the list has to be carried by hand.
	useLayoutEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		sync();
		field.addEventListener("scroll", sync);
		/*
		 * A ResizeObserver on the field rather than a window `resize` listener: the
		 * field's width changes when the sidebar, the canvas or the run panel opens,
		 * at a window size nobody changes, and every one of those re-wraps the mirror
		 * — a stale fill is a rectangle beside the run it was measured from.
		 */
		const observer = new ResizeObserver(sync);
		observer.observe(field);
		return () => {
			field.removeEventListener("scroll", sync);
			observer.disconnect();
		};
	}, [fieldRef, text, isSmallView, sync]);

	/*
	 * MOUNTED ONLY WHILE THE DRAFT HOLDS A TOKEN. The ordinary composer — no `@`
	 * anywhere — keeps exactly the render path it had and pays nothing for this
	 * feature beyond one predicate over the text, which is the same rule
	 * `CredentialOverlay` follows for the pill.
	 */
	if (spans.length === 0) return null;

	const segments = atSegments(text, spans);

	return (
		<>
			{/*
			 * The mirror: invisible, `aria-hidden`, and styled by the SAME exported
			 * class string as the field (`composerTextBox`, shared with
			 * `CredentialOverlay`). That shared constant is the whole defence against
			 * the one failure this architecture can have — a type step changed on the
			 * field and not on the mirror puts every fill beside the run it belongs to.
			 */}
			<div
				ref={mirrorRef}
				aria-hidden="true"
				className={cn(
					composerTextBox(isSmallView),
					"invisible pointer-events-none absolute inset-0 -z-10 select-none overflow-hidden",
				)}
			>
				{segments.map((segment, index) => {
					if (!segment.span) {
						// biome-ignore lint/suspicious/noArrayIndexKey: the segments are positional by construction
						return <span key={index}>{segment.text}</span>;
					}
					const key = atSpanKey(segment.span);
					return (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: the segments are positional by construction
							key={index}
							/*
							 * The measured run, named for the harness that checks a fill against it:
							 * a frame can show a rectangle beside some glyphs, and only a readback of
							 * both boxes can say whether they are the SAME glyphs. `data-` rather than a
							 * class because this is a test handle, the same device
							 * `data-lo-suggestion-stack` and `data-tour-tag` are.
							 */
							data-mention-token={key}
							ref={(element) => {
								markers.current.set(key, element);
							}}
						>
							{segment.text}
						</span>
					);
				})}
				{MIRROR_TAIL}
			</div>
			{/*
			 * The fills, out of flow in a layer that is not the field, `-z-10` inside
			 * the composer's `isolate` wrapper so they paint UNDER the glyphs the
			 * textarea paints and OVER nothing else. Without that isolate a negative
			 * index would paint behind the composer box's own `bg-surface` — a chip
			 * that is simply absent, with nothing on screen to say why.
			 */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
			>
				{fills.map((fill) => (
					<div
						key={fill.key}
						/*
						 * The drawn fill, named so a test or a driving harness can read its box
						 * back: `data-mention-chip` says which of the two grounds it took, and
						 * `data-mention-span` names the token it belongs to, so the fill's rect and
						 * the token's own run can be compared without either side being guessed at.
						 *
						 * The two VALUES are this surface's names for the states (`plain`,
						 * `approval`) and are what the driver scene and the QA matrix read; the
						 * ground each one means is the fact `MENTION_CHIP_OUTSIDE_ROLE` states —
						 * CONTAINMENT, which is the question the approval gate will ask at submit
						 * and not the whole of its answer.
						 */
						data-mention-chip={fill.outside ? "approval" : "plain"}
						data-mention-span={fill.span}
						className={cn(
							"absolute",
							fill.outside ? MENTION_CHIP_OUTSIDE_ROLE : MENTION_CHIP_ROLE,
						)}
						style={{
							left: `${fill.left}px`,
							top: `${fill.top - scrollTop}px`,
							width: `${fill.width}px`,
							height: `${fill.height}px`,
						}}
					/>
				))}
			</div>
		</>
	);
};
