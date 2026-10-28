import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * THE COMPOSER GROWS UPWARD, AND STOPS (operator, 2026-10-28).
 *
 * A one-row textarea that scrolls its own text is the wrong shape in a chat: the
 * reader loses sight of the sentence they are writing, and a pasted paragraph
 * disappears into a 24px window.
 *
 * WHY A LAYOUT EFFECT AND A WRITTEN PX HEIGHT. `height: auto` then reading
 * `scrollHeight` is the only way to measure wrapped text without a hidden mirror
 * element (a mirror has to be kept in sync with the real field's font, width,
 * padding and border, and drifts silently). Doing it in `useLayoutEffect` means
 * the new height is committed BEFORE the browser paints, so a keystroke or a
 * paste never shows an intermediate one-row frame - the "no layout jump on the
 * first keystroke" requirement.
 *
 * THE CAP IS THE SMALLER OF TWO TERMS, both of which have to be real:
 *
 * - ten LINES, measured from the field's own line height plus its vertical
 *   padding. Padding is part of `scrollHeight` and was not part of the old cap,
 *   so "ten lines" was really about 9.3 (review round 1, minor).
 * - 40% OF THE PANE the composer sits under - expressed as a fraction of the
 *   TIMELINE's height, because that is the number that is measurable without
 *   coupling this hook to markup: `c = f/(1-f) * t` is the height at which the
 *   composer is exactly `f` of the column it shares with the timeline. The old
 *   term was 40% of the WINDOW, which at the app's 572px viewport floor could
 *   never bind at all - a guard that is inert is not a guard (design round 1,
 *   D1). With no pane to measure (a story, the first frame) it falls back to the
 *   window, and says so.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: touch the caret, the selection, or the
 * timeline from here. Growth takes height from the timeline's viewport, so a
 * reader who scrolled up keeps the same content at the same offset; the page
 * decides whether to re-follow the bottom (`repin`, which follows only a reader
 * who was already there).
 */
export function useComposerAutoGrow(
	ref: RefObject<HTMLTextAreaElement | null>,
	value: string,
	{
		onGrow,
		paneRef,
		minPx = 40,
		maxLines = 10,
		paneFraction = 0.4,
	}: {
		/** Called after a change in height, so the timeline can stay pinned. */
		onGrow?: () => void;
		/** The scrolling area the composer shares its column with (the timeline). */
		paneRef?: RefObject<HTMLElement | null>;
		minPx?: number;
		maxLines?: number;
		paneFraction?: number;
	} = {},
): void {
	/** The node the last measurement applied to, so a REMOUNT re-measures. */
	const measuredNode = useRef<HTMLTextAreaElement | null>(null);
	/*
	 * A3: with a real `ResizeObserver`, the timeline's own viewport observation
	 * (useStickToBottom, D9) already re-pins a pinned reader when the composer
	 * takes height from it. Reporting growth as well wrote the same scroll
	 * position twice per growing keystroke, so the signal only goes out where the
	 * observer cannot exist.
	 */
	const reportGrowth = useCallback(() => {
		if (typeof ResizeObserver === "function") return;
		onGrow?.();
	}, [onGrow]);

	const measure = useCallback(() => {
		const field = ref.current;
		if (!field) return;
		/*
		 * AN EMPTY DRAFT SKIPS EVEN THE STYLE READ (review A2). Send clears the box
		 * and Return to draft can empty it; both want the resting height back, and
		 * neither needs a computed style, a `scrollHeight` or a reflow to know it.
		 * Precisely: this path skips ALL measurement, not just the scrollHeight.
		 */
		if (value === "") {
			if (
				field.style.height === `${minPx}px` &&
				field.style.overflowY === "hidden"
			)
				return;
			if (field.style.height !== `${minPx}px`) {
				field.style.height = `${minPx}px`;
				reportGrowth();
			}
			field.style.overflowY = "hidden";
			return;
		}
		const style = getComputedStyle(field);
		const line = Number.parseFloat(style.lineHeight);
		const lineHeight = Number.isFinite(line) && line > 0 ? line : 21.7;
		const padding =
			(Number.parseFloat(style.paddingTop) || 0) +
			(Number.parseFloat(style.paddingBottom) || 0);
		const pane = paneRef?.current?.getBoundingClientRect().height ?? 0;
		/*
		 * `c = f/(1-f) * t`: the composer is exactly `paneFraction` of the column
		 * once it reaches this height, since the column is the timeline plus the
		 * composer. Solving it here rather than measuring the column keeps the
		 * term honest without a new wrapper element - and it converges rather than
		 * oscillating, because each measurement moves the composer toward the
		 * fixed point instead of overshooting it.
		 */
		const paneCap =
			pane > 0
				? (pane * paneFraction) / (1 - paneFraction)
				: window.innerHeight * paneFraction;
		const cap = Math.max(
			minPx,
			Math.min(lineHeight * maxLines + padding, paneCap),
		);

		const previousHeight = field.style.height;
		/*
		 * SAVE THE READER'S PLACE, THEN PUT IT BACK (review A1 / design D4).
		 * `height: auto` lets the box fit its content, and the layout the
		 * `scrollHeight` read forces clamps `scrollTop` to that smaller box - so a
		 * reader who scrolled up inside a long draft loses their place on the next
		 * character even though the height is restored a line later. The selection
		 * is saved for the same reason: a collapse can move it, and a caret that
		 * jumps is indistinguishable from the field having lost focus.
		 */
		const scrollTop = field.scrollTop;
		const selection =
			field.selectionStart === null
				? null
				: [field.selectionStart, field.selectionEnd];
		field.style.height = "auto";
		const wanted = field.scrollHeight;
		const next = Math.max(minPx, Math.min(wanted, cap));
		field.style.height = `${next}px`;
		// `overflow-y` only AT the cap: a scrollbar inside a box that is still
		// growing reads as a wall the text hit for no reason.
		field.style.overflowY = wanted > cap ? "auto" : "hidden";
		if (field.scrollTop !== scrollTop) field.scrollTop = scrollTop;
		if (
			selection &&
			(field.selectionStart !== selection[0] ||
				field.selectionEnd !== selection[1])
		)
			field.setSelectionRange(selection[0] ?? 0, selection[1] ?? 0);
		if (field.style.height !== previousHeight) reportGrowth();
	}, [ref, value, minPx, maxLines, paneFraction, paneRef, reportGrowth]);

	/*
	 * ONE DECISION, ONCE PER COMMIT: measure when the VALUE changed, or when a
	 * DIFFERENT node is mounted. A remount with an unchanged draft is real - the
	 * composer is unmounted between archived/read-only/preview and writable
	 * (review round 1, F1) - and without the node check the restored draft sits in
	 * a one-row scrolling box until the next keystroke. Two separate effects both
	 * fired on mount and measured twice, which this avoids.
	 */
	const lastValue = useRef<string | null>(null);
	useLayoutEffect(() => {
		const field = ref.current;
		if (!field) return;
		if (field === measuredNode.current && lastValue.current === value) return;
		measuredNode.current = field;
		lastValue.current = value;
		measure();
	});

	/*
	 * A WIDTH CHANGE RE-WRAPS THE TEXT, and the cap is in `px`: a draft measured
	 * in a wide window is clipped, and clipped behind `overflow-y: hidden`, after
	 * the window narrows, the zoom changes or the thread pane opens (review round
	 * 1, F2). The observer only re-measures when the WIDTH moved, so the height
	 * this hook writes cannot feed back into it.
	 */
	useEffect(() => {
		const field = ref.current;
		if (!field || typeof ResizeObserver !== "function") return;
		let width = field.getBoundingClientRect().width;
		const observer = new ResizeObserver(() => {
			const next = field.getBoundingClientRect().width;
			if (Math.abs(next - width) < 1) return;
			width = next;
			measure();
		});
		observer.observe(field);
		return () => observer.disconnect();
	}, [ref, measure]);
}
