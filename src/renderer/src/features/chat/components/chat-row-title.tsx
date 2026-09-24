import { TOOLTIP_DELAY_MS } from "@shared/components/ui/tooltip";
import { useMediaQuery } from "@shared/hooks/use-media-query";
import { cn } from "@shared/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";

/*
 * The conversation row's title: the clip box, the pan, and the edge fade.
 *
 * WHY THIS IS ITS OWN COMPONENT. The row is built by a plain render function
 * (`sessionRow` in `chat-sidebar.tsx`), where a hook would run a different number
 * of times per render - the constraint `silentRemedyId` already records for the
 * remedy sentence. The pan needs refs, a media query and a `requestAnimationFrame`
 * loop, so it lives here, mounted once per row by the row's own button.
 *
 * WHAT IT DRAWS, and the two boxes are the whole design of it:
 *
 *   the CLIP box (`[data-session-title]`) keeps the shipped class and is what the
 *   row's flex layout sizes - `min-w-0 flex-1 truncate` at rest. It carries the
 *   `mask-image` while a pan runs, because a mask is positioned against the box it
 *   is declared on: a mask that moved with the text would fade the text rather than
 *   its clip.
 *
 *   the TEXT box inside it (`[data-session-title-text]`) is the element the pan
 *   translates, and it is `inline-block w-max` - `w-max` is load-bearing rather than
 *   cosmetic: an inline-block would otherwise shrink to the space available and the
 *   pan could never measure what overflows. IT EXISTS ONLY WHILE A PAN RUNS, and
 *   that is a correctness requirement rather than an optimisation: `text-overflow`
 *   is painted by the block container over its INLINE content, and a single atomic
 *   inline is not content it appends an ellipsis to. Measured on this build: with
 *   the wrapper always mounted, a truncated title at rest painted a HARD CUT where
 *   the shipped panel draws an ellipsis (`docs/evidence/sidebar-row-space/`
 *   `rest-280`, both palettes, against the before frame of the same state). So at
 *   rest the text is the clip box's own bare text - the shipped element, unchanged -
 *   and the wrapper is mounted by the pan's own first frame.
 *
 * WHAT THE PAN IS, in the operator's own words (the spec is
 * `docs/design/sidebar-row-space.md` § 5, and these are its numbers): pointer only,
 * armed against the ROW's hover - the acts take 56px of the title when the pointer
 * arrives, so the pan is what gives the rest of a title back. It waits out the
 * app's own dwell constant (the Radix `TooltipProvider` default the flyout beside
 * it uses, imported rather than restated: one number for "the pointer has decided
 * to stay"), so sweeping the pointer down the list starts no pan on any row. Then
 * it translates the text LEFT at 32px/s - reading speed, about five characters a
 * second on the fixture the spec measures - linear and one way, stops when it
 * reaches the overflow (`scrollWidth - clientWidth`, read at the moment the
 * pointer arrives, i.e. against the HOVERED box) and HOLDS there while the pointer
 * stays: no loop, no ping-pong, no rewind. Leaving the row clears the transform and
 * the mask in the same frame, from wherever it got to - a return animation is a
 * second thing moving on a row the reader has already left, and the instantaneous
 * reset also removes the mid-reset window in which a re-entering pointer would
 * inherit the previous pan's position.
 *
 * THE SPEED HAS A FLOOR AND A CAP: `max(32 px/s, overflow / 8s)`, so the reading
 * speed is the floor and a pathological title cannot take half a minute.
 *
 * FOCUS DOES NOT START IT. The keyboard's channel for a clipped title is the
 * flyout, which Radix opens on focus; a title that began scrolling as someone
 * Tabs down the list would move the very text they are reading.
 *
 * REDUCED MOTION SUPPRESSES IT ENTIRELY - no dwell, no transform, no mask - and
 * that is the only correct implementation here rather than a courtesy: the base
 * layer caps every `animation-duration`/`transition-duration` at `0.01ms` and pins
 * `animation-iteration-count` to 1 rather than cancelling animations, so a pan
 * written as a CSS keyframe animation would land on its END keyframe under the
 * setting, i.e. the title would jump to fully scrolled and stay there. So the pan
 * is javascript-driven and gated by the app's own `useMediaQuery` hook, the one
 * `working-line.tsx` and `composer-tip.tsx` gate their motion with. The flyout is
 * the complete fallback: it carries the full title and the row's facts on the same
 * dwell.
 *
 * The mask goes with the pan, for the same reason: a mask with no motion is a fade
 * over text that never moves, dimming the very characters the reader is on.
 */

/** Reading speed. Slow enough to read along, which is the whole point of a pan. */
const PAN_PX_PER_S = 32;
/** The cap: `overflow / 8s` beats the floor above roughly 256px of overflow. */
const PAN_MAX_MS = 8_000;
/** Each edge's fade, in px. */
const FADE_PX = 12;
/** The machine's own preference, read once per row by the app's shared hook. */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export function ChatRowTitle({ text }: { text: string }) {
	const boxRef = useRef<HTMLSpanElement | null>(null);
	const textRef = useRef<HTMLSpanElement | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const dwellRef = useRef<number | null>(null);
	const frameRef = useRef<number | null>(null);
	/*
	 * Whether a pan is RUNNING is React state, because it swaps two classes: the pan
	 * drops `truncate`'s ellipsis (a static ellipsis painted over moving text is a
	 * glyph that belongs to neither) and takes `overflow-hidden whitespace-nowrap`
	 * in its place. The transform and the mask are written straight to the two nodes
	 * by the frame loop instead of through state: this is a 60Hz write, and routing
	 * it through React would re-render the row sixty times a second to move one
	 * string. React is never handed a `style` prop on either node, so the two
	 * mechanisms cannot fight over the same attribute.
	 */
	const [panning, setPanning] = useState(false);
	const reduceMotion = useMediaQuery(REDUCED_MOTION);
	/*
	 * Read at EVENT time rather than closed over, so the listeners installed once by
	 * the ref callback below always see the current preference - the setting can be
	 * flipped while the panel is open, and the alternative is a pan that starts on a
	 * row mounted before the flip.
	 */
	const reduceMotionRef = useRef(reduceMotion);

	/** Stop whichever of the pan's two timers is live. */
	const stopTimers = useCallback(() => {
		if (dwellRef.current !== null) {
			window.clearTimeout(dwellRef.current);
			dwellRef.current = null;
		}
		if (frameRef.current !== null) {
			window.cancelAnimationFrame(frameRef.current);
			frameRef.current = null;
		}
	}, []);

	/**
	 * The rest state, restored in one frame: no timers, no transform, no mask.
	 *
	 * It is also the pointer's ENTRY path (`armPan` calls it first), which is what
	 * makes a re-entering pointer re-arm from rest and wait a fresh dwell rather
	 * than continue where the last pan stopped.
	 */
	const resetPan = useCallback(() => {
		stopTimers();
		const text = textRef.current;
		if (text) text.style.transform = "";
		const box = boxRef.current;
		if (box) {
			box.style.removeProperty("mask-image");
			box.style.removeProperty("-webkit-mask-image");
		}
		setPanning(false);
	}, [stopTimers]);

	/**
	 * The pan itself: constant speed, linear, one way, stopping at the overflow.
	 *
	 * `runPan` is a separate callback because `startPan`'s frame callback has to reach it
	 * `[runPan]` rather than inline: the loop's own writes are imperative and the only
	 * thing it closes over is the speed rule.
	 */
	const runPan = useCallback(
		(box: HTMLSpanElement, text: HTMLSpanElement, overflow: number) => {
			const speed = Math.max(PAN_PX_PER_S, overflow / (PAN_MAX_MS / 1000));
			const started = performance.now();
			const step = (now: number) => {
				const distance = Math.min(overflow, ((now - started) / 1000) * speed);
				text.style.transform = `translateX(${-distance}px)`;
				/*
				 * The LEFT ramp is `min(12px, offset)` and it is written in the same frame
				 * as the transform: at offset 0 there is no left fade at all, so the first
				 * character is not dimmed at the instant the pan begins, and by the time
				 * 12px of text has gone under the edge the full fade is in place. The right
				 * fade is fixed - it is the honest end of the clip.
				 */
				const mask = `linear-gradient(to right, transparent 0, black ${Math.min(FADE_PX, distance)}px, black calc(100% - ${FADE_PX}px), transparent 100%)`;
				box.style.setProperty("mask-image", mask);
				box.style.setProperty("-webkit-mask-image", mask);
				/*
				 * At the end the loop simply stops, leaving the transform where it is: the
				 * title HOLDS at its end while the pointer stays, which is the difference
				 * between a pan and a marquee that starts over.
				 */
				frameRef.current =
					distance < overflow ? window.requestAnimationFrame(step) : null;
			};
			frameRef.current = window.requestAnimationFrame(step);
		},
		[],
	);

	/**
	 * Start the pan, or decide there is nothing to pan.
	 *
	 * The overflow is read HERE, from the live box: by this point the pointer has
	 * dwelt on the row for a full interval, so the acts are drawn and this is the
	 * HOVERED box - the narrower one the pan exists to answer. A title that fits
	 * (overflow at or below half a pixel) does not move at all, which is a state
	 * `docs/evidence/sidebar-row-space/hover-short-280` photographs rather than
	 * asserts.
	 */
	const startPan = useCallback(() => {
		const box = boxRef.current;
		if (!box) return;
		/*
		 * THE CHEAP GATE FIRST, against the box the pointer has just arrived in: a title
		 * whose `scrollWidth` already fits has nothing to pan and needs no state change
		 * at all, so the rows that fit never mount the wrapper below.
		 */
		if (box.scrollWidth - box.clientWidth <= 0.5) return;
		/*
		 * THEN THE PAN'S OWN PAINT IS MOUNTED, and the overflow is measured from it on the
		 * NEXT frame - which is the only frame it exists in. Two things force that order:
		 *
		 *  - the wrapper is what the transform is applied to, and it is mounted only while
		 *    a pan runs (see the note at the top of this file: an always-mounted wrapper
		 *    costs the rest state its ellipsis);
		 *  - and the overflow must be read from the WRAPPER rather than from the clip
		 *    box's `scrollWidth`, because the clip's includes the ellipsis's own advance
		 *    (measured at 10px on the fixture the spec uses) while the pan's class swap
		 *    takes that ellipsis away. Reading the clip would travel 10px past the end of
		 *    the text and leave a gap under the right fade.
		 *
		 * A title that fits has already returned above, so the wrapper is not mounted for
		 * one frame and unmounted again on the rows that do not move.
		 */
		setPanning(true);
		frameRef.current = window.requestAnimationFrame(() => {
			frameRef.current = null;
			const text = textRef.current;
			if (!text) return;
			const overflow = text.getBoundingClientRect().width - box.clientWidth;
			if (overflow <= 0.5) {
				/* Mounted for nothing: back to the shipped rest state, unchanged. */
				setPanning(false);
				return;
			}
			runPan(box, text, overflow);
		});
	}, [runPan]);

	/** The pointer's entry: back to rest, then the dwell. */
	const armPan = useCallback(() => {
		resetPan();
		if (reduceMotionRef.current) return;
		dwellRef.current = window.setTimeout(startPan, TOOLTIP_DELAY_MS);
	}, [resetPan, startPan]);

	useEffect(() => {
		reduceMotionRef.current = reduceMotion;
		/* A pan already running when the setting is turned on stops with the mask. */
		if (reduceMotion) resetPan();
	}, [reduceMotion, resetPan]);

	/* Nothing may outlive the row: a frame loop onto a detached node never stops. */
	useEffect(() => resetPan, [resetPan]);

	/**
	 * Install the two listeners on the ROW, found from the title's own box.
	 *
	 * A ref CALLBACK rather than an effect, because the row's DOM ancestry is not
	 * stable across the row's life: `sessionRow` renders a different tree when a
	 * capability is withdrawn, so a row can be re-parented under a capabilities read
	 * that lands late - and an effect keyed on nothing would leave both listeners on
	 * a node that is no longer in the document, which is a pan that silently stops
	 * working. The callback re-attaches whenever React hands it a new node.
	 *
	 * The host is the row BOX when the row has one and the row's own button when it
	 * does not: the withdrawn branch (neither capability advertised) renders main's
	 * box with no `data-session-row` on it, and the button there IS the whole row -
	 * it has no sibling controls for the pointer to be on instead.
	 */
	const attach = useCallback(
		(node: HTMLSpanElement | null) => {
			boxRef.current = node;
			detachRef.current?.();
			detachRef.current = null;
			if (!node) return;
			const host =
				node.closest("[data-session-row]") ??
				node.closest("button[data-chat-row]");
			if (!host) return;
			const onEnter = () => armPan();
			const onLeave = () => resetPan();
			host.addEventListener("pointerenter", onEnter);
			host.addEventListener("pointerleave", onLeave);
			detachRef.current = () => {
				host.removeEventListener("pointerenter", onEnter);
				host.removeEventListener("pointerleave", onLeave);
				/* A row that lets go of the title mid-pan leaves nothing behind it. */
				resetPan();
			};
		},
		[armPan, resetPan],
	);

	return (
		<span
			ref={attach}
			data-session-title
			className={cn(
				"min-w-0 flex-1",
				/* The shipped rest state, ellipsis and all - and the pan's own clip, which
				   is the same box without the ellipsis over moving text. */
				panning ? "overflow-hidden whitespace-nowrap" : "truncate",
			)}
		>
			{panning ? (
				<span
					ref={textRef}
					data-session-title-text
					className="inline-block w-max whitespace-nowrap"
				>
					{text}
				</span>
			) : (
				text
			)}
		</span>
	);
}
