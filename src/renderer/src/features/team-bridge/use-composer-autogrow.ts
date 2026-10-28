import { useLayoutEffect } from "react";
import type { RefObject } from "react";

/**
 * THE COMPOSER GROWS UPWARD, AND STOPS (operator, 2026-10-28).
 *
 * A one-row textarea that scrolls its own text is the wrong shape in a chat: the
 * reader loses sight of the sentence they are writing, and a pasted paragraph
 * disappears into a 24px window. This makes the field as tall as what is in it,
 * up to a cap, and scrolls only past that cap.
 *
 * WHY A LAYOUT EFFECT AND A WRITTEN PX HEIGHT. `height: auto` then reading
 * `scrollHeight` is the only way to measure wrapped text without a hidden mirror
 * element (a mirror has to be kept in sync with the real field's font, width,
 * padding and border, and drifts silently). Doing it in `useLayoutEffect` means
 * the new height is committed BEFORE the browser paints, so a keystroke or a
 * paste never shows an intermediate one-row frame - the "no layout jump on the
 * first keystroke" requirement.
 *
 * THE CAP IS TWO TERMS, WHICHEVER IS SMALLER: ten lines, and 40% of the window.
 * Ten lines is where a message stops being a message; 40% is where the composer
 * starts to eat the conversation it belongs to. The window is the honest proxy
 * for the pane: Team Bridge's thread column fills the window's height, and
 * measuring an ancestor instead would couple this hook to a class name that the
 * next layout change may move.
 *
 * `overflow-y` is only `auto` AT the cap: a scrollbar inside a field that is
 * still growing reads as a wall the text hits for no reason.
 */
export function useComposerAutoGrow(
	ref: RefObject<HTMLTextAreaElement | null>,
	value: string,
	{
		onGrow,
		minPx = 40,
		maxLines = 10,
		maxWindowFraction = 0.4,
	}: {
		/** Called after a growth that changed the height, so the timeline can stay pinned. */
		onGrow?: () => void;
		minPx?: number;
		maxLines?: number;
		maxWindowFraction?: number;
	} = {},
): void {
	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		const line = Number.parseFloat(getComputedStyle(field).lineHeight);
		const lineHeight = Number.isFinite(line) && line > 0 ? line : 21.7;
		const cap = Math.max(
			minPx,
			Math.min(lineHeight * maxLines, window.innerHeight * maxWindowFraction),
		);
		const previous = field.style.height;
		/*
		 * AN EMPTY DRAFT IS THE COMMON CASE and needs no measurement at all: send
		 * clears the box, Return to draft can empty it, and both want the resting
		 * height back. Reading `scrollHeight` there would force a reflow per send
		 * for a number we already know.
		 */
		if (value === "") {
			field.style.height = `${minPx}px`;
			field.style.overflowY = "hidden";
			if (field.style.height !== previous) onGrow?.();
			return;
		}
		// Measure with the box free, then write the height the content wants.
		field.style.height = "auto";
		const wanted = field.scrollHeight;
		const next = Math.max(minPx, Math.min(wanted, cap));
		field.style.height = `${next}px`;
		field.style.overflowY = wanted > cap ? "auto" : "hidden";
		// Only a change in height can move the timeline; a text edit that does not
		// grow the box must not re-pin a reader who has scrolled up.
		if (field.style.height !== previous) onGrow?.();
	}, [ref, value, minPx, maxLines, maxWindowFraction, onGrow]);
}
