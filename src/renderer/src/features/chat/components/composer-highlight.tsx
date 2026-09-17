/**
 * The composer's syntax highlight: a clipped mirror behind a transparent
 * textarea.
 *
 * Why a mirror rather than a richer input. The composer is the app's busiest
 * surface and every one of its contracts is a native textarea's: `value` plus
 * `setSelectionRange` carets (`pendingCaret`), `rows={1}` with a `scrollHeight`
 * autosize, `onPaste`, `disabled`, `placeholder`, `role="combobox"` with
 * `aria-activedescendant`, and the whole `handleComposerKeyDown` path including
 * the IME guards. A `contenteditable` or a CodeMirror instance would each
 * re-implement that set, and CM's own keymap would have to be reconciled with
 * `slashKeyIntent` and the list-open Enter handling — a rewrite of the surface
 * under test, not a feature. So the textarea stays the input; the paints happen
 * in a layer behind it that never receives a pointer event or a keystroke.
 *
 * THE TECHNIQUE, and the two halves that must not drift:
 *
 *   - The textarea's own text is `text-transparent` (with an explicit
 *     `caret-ink`, because `caret-color: auto` would follow the transparent
 *     colour and the caret would vanish), and the mirror paints the glyphs.
 *   - The mirror is the textarea's BOX: `absolute inset-0`, the same padding and
 *     the same size classes, `whitespace-pre-wrap` with `break-words`, and
 *     `overflow: hidden`. It is translated by `-scrollTop` as the textarea
 *     scrolls, so the two layers show the same window of the same text.
 *   - The right padding is CORRECTED at runtime by the textarea's scrollbar
 *     width (`offsetWidth - clientWidth - borders`). With macOS overlay
 *     scrollbars that is 0 and this is a no-op; with "Always show scrollbars"
 *     it is ~15px of text width the textarea does not have, and without the
 *     correction the mirror wraps one character earlier than the textarea and
 *     every tint after the first wrap sits beside the glyph it names.
 *
 * WHY THE MIRROR PAINTS THE WHOLE DRAFT, and not `draft.slice(0,
 * endOfFirstContentLine)` as the first version of this design proposed. The
 * argument for the shorter payload was that a run can never appear on any line
 * after the first content line, which is true. It is also not enough: the
 * textarea's text is TRANSPARENT whenever a run exists, so the mirror is the
 * only ink there is, and a payload that stops at the end of the first content
 * line blanks every line the user typed AFTER it. That is not a corner — it is
 * `/team frontend-guild review the queue` plus the instruction set the operator
 * is writing on the next lines, which is the shape this whole change exists for.
 * Measured on the story that carries it (`chat-slash-highlight--
 * start-name-instruction`): with the first-line payload the body of the draft
 * rendered as empty rows. So the mirror carries the whole draft, and on a
 * single-content-line draft — the common case, and the one the geometry
 * readback measures row counts on — the payload is identical to the shorter
 * one. The metric risk the shorter payload was avoiding is the wrapping parity
 * of the rest of the draft, which the readback measures directly rather than
 * assuming (`scripts/renderer-driver.mjs --scene composer`).
 *
 * WHY THE TECHNIQUE IS GATED ON A RUN EXISTING, and why the gate is not a
 * compromise. `text-transparent` costs the composer its native text rendering
 * for as long as it is on, and a draft with nothing to tint has no reason to pay
 * that: Chromium draws the misspelling squiggle under a `color: transparent`
 * caret's text only in some versions, and the composer's spellcheck underline is
 * something the operator did not ask to lose. So a draft whose first line yields
 * no runs — `/tema` while the list is open, plain prose, a `/` mid-sentence —
 * keeps the ordinary text path and its squiggle, and the mirror is not rendered
 * at all. During an IME composition the same gate switches the technique off
 * entirely: the composition string is drawn by the browser and is not in the
 * mirror, so with transparent text it would be invisible while it is being
 * typed. Both are the same switch (`runs.length === 0`), which is why the caller
 * owns it (`highlightPaints` below) rather than this file guessing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it adds no ground, no shadow and no
 * transition (the tints are foreground-only, so they compose with the caret and
 * the selection ground instead of competing with them); it never touches the
 * textarea's layout (`absolute` removes it from the flow, so the textarea's own
 * `scrollHeight` autosize is untouched); and it binds no key of its own.
 */

import { cn } from "@shared/lib/utils";
import type { FC, ReactNode, RefObject } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { type SlashHighlightRun, runInkClass } from "./slash-highlight";

/**
 * Whether the transparent-text technique is in play for this draft.
 *
 * The ONE predicate, used by the caller to switch the textarea's own ink and by
 * this file to decide whether to render the mirror: two independent tests would
 * be two chances for a transparent textarea with no mirror behind it, which
 * renders the user's draft invisible.
 */
export const highlightPaints = (runs: readonly SlashHighlightRun[]): boolean =>
	runs.length > 0;

type Segment = {
	/** Offset into the draft, used as the React key: stable across renders. */
	start: number;
	text: string;
	kind: SlashHighlightRun["kind"] | "prose";
};

/**
 * The draft cut into alternating prose and painted segments.
 *
 * Defensive about the runs rather than trusting them, because this is the layer
 * that would silently DROP text: a run whose offsets are stale (a draft changed
 * by a keystroke between the derivation and this render) is clipped to the draft
 * and any overlap is skipped, so the worst case is a tint that does not paint
 * rather than characters that disappear.
 *
 * EXPORTED because that totality is the claim that most needs executing and least
 * can be seen: the mirror is the only painter of the draft whenever a run exists
 * (the textarea's own glyphs are transparent), so a segment that vanishes takes
 * the user's characters with it and no frame would show why. `segmentsOf` is pure
 * and DOM-free, so `scripts/slash-highlight.test.mjs` pins concatenation over a
 * matrix instead of leaving it asserted here (code review round 1 MINOR 2).
 */
export function segmentsOf(
	draft: string,
	runs: readonly SlashHighlightRun[],
): Segment[] {
	const ordered = [...runs]
		.map((run) => ({
			...run,
			start: Math.max(0, Math.min(run.start, draft.length)),
			end: Math.max(0, Math.min(run.end, draft.length)),
		}))
		.filter((run) => run.end > run.start)
		.sort((a, b) => a.start - b.start);
	const segments: Segment[] = [];
	let at = 0;
	for (const run of ordered) {
		if (run.start < at) continue;
		if (run.start > at)
			segments.push({
				start: at,
				text: draft.slice(at, run.start),
				kind: "prose",
			});
		segments.push({
			start: run.start,
			text: draft.slice(run.start, run.end),
			kind: run.kind,
		});
		at = run.end;
	}
	if (at < draft.length)
		segments.push({ start: at, text: draft.slice(at), kind: "prose" });
	return segments;
}

export type ComposerHighlightProps = {
	/** The draft the textarea holds. The mirror paints the same string. */
	draft: string;
	/** Runs from `slashHighlightRuns`, as offsets into `draft`. */
	runs: readonly SlashHighlightRun[];
	/** The textarea this mirror shadows: the scroll and geometry source. */
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	/**
	 * The textarea's OWN type and padding classes, handed to both layers from one
	 * expression. Font metrics drift is the failure this signature prevents: a
	 * wrapper that set its own type step, or a size class applied to one layer and
	 * not the other, would leave the mirror wrapping at a different character.
	 */
	fieldClassName?: string;
	/** The disabled ink step, mirrored — disabled changes colour, never opacity. */
	disabled?: boolean;
	/** The textarea itself. */
	children: ReactNode;
};

export const ComposerHighlight: FC<ComposerHighlightProps> = ({
	draft,
	runs,
	textareaRef,
	fieldClassName,
	disabled = false,
	children,
}) => {
	/*
	 * TWO nodes, and the split is the point rather than tidiness. `mirrorRef` is
	 * the GLYPH LAYER: the text column, scrolled by the transform. The element
	 * above it (`data-composer-mirror`) is the CLIP WINDOW, and it is the box the
	 * textarea's own viewport is. They used to be one node, and a transform moves
	 * the clipped box along with the paint: at `scrollTop S` the window sat `S` px
	 * above the field, so the field's bottom `S` px were never painted — the line
	 * the caret was on, i.e. the text the user was typing — while the mirror
	 * painted `S` px over the composer's top edge. Clipping therefore belongs to a
	 * node that does not move, and the paint to one that does.
	 */
	const mirrorRef = useRef<HTMLDivElement | null>(null);
	const paints = highlightPaints(runs);
	const segments = useMemo(
		() => (paints ? segmentsOf(draft, runs) : []),
		[draft, runs, paints],
	);

	/*
	 * The scroll writer and the geometry correction, both imperative for the
	 * reason the composer's own autosize is: they run per SCROLL FRAME, and a
	 * state update per event would re-render this box — and the popup above it —
	 * while the user is dragging a scrollbar. The transform is written straight to
	 * the node, exactly like `el.style.height` in `message-input.tsx`.
	 */
	// The deps below are RE-MEASURE TRIGGERS rather than values read in the body,
	// the same convention the composer's own autosize effect states: `paints` is
	// what mounts the mirror, and `fieldClassName` can change the type step under
	// it. Removing either leaves the mirror measured against a box that no longer
	// exists.
	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are re-measure triggers, not values read in the body
	useLayoutEffect(() => {
		const textarea = textareaRef.current;
		const mirror = mirrorRef.current;
		if (!textarea || !mirror) return;
		/*
		 * `mirror` is the GLYPH layer, not the clip window: the transform must move
		 * what is painted while the window stays the field's viewport. Writing it to
		 * the clip node is the round-2 Q1 defect (the caret's line unpainted, the
		 * mirror painting above the field), and the probes now assert the invariant
		 * directly — the clip box's top against the textarea's own.
		 */
		const sync = () => {
			mirror.style.transform = `translateY(-${textarea.scrollTop}px)`;
		};
		/*
		 * The gutter is the textarea's OWN scrollbar: the mirror is `w-full` of the
		 * same box and has none of its own, so without this its text column is wider
		 * by exactly that much and the wrap points diverge. Measured from the live
		 * box rather than assumed from a class, because whether a scrollbar exists
		 * depends on the platform's overlay setting as well as on the content.
		 */
		const measure = () => {
			const computed = getComputedStyle(textarea);
			const borders =
				(Number.parseFloat(computed.borderLeftWidth) || 0) +
				(Number.parseFloat(computed.borderRightWidth) || 0);
			const gutter = Math.max(
				0,
				textarea.offsetWidth - textarea.clientWidth - borders,
			);
			const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
			mirror.style.paddingRight = `${paddingRight + gutter}px`;
			sync();
		};
		measure();
		textarea.addEventListener("scroll", sync, { passive: true });
		/*
		 * A resize can change which scrollbar discipline applies (a window narrowed
		 * until the textarea scrolls, or a platform setting toggled live), so the
		 * measurement is re-taken rather than captured once at mount.
		 */
		window.addEventListener("resize", measure);
		return () => {
			textarea.removeEventListener("scroll", sync);
			window.removeEventListener("resize", measure);
		};
	}, [textareaRef, paints, fieldClassName]);

	return (
		/*
		 * `relative` and NOTHING else: the wrapper is the textarea's containing
		 * block, it takes the textarea's size from the textarea itself (the mirror
		 * is `absolute`, so it is out of the flow), and it inherits the composer
		 * box's flex behaviour exactly as the bare textarea did.
		 */
		<div className={cn("relative w-full")}>
			{paints && (
				/*
				 * `aria-hidden` because the textarea already carries the accessible
				 * text and a screen reader must not read the draft twice;
				 * `pointer-events-none` so a click lands in the textarea and therefore
				 * puts the caret where the user aimed. This node is the clip window and
				 * carries NO transform — see the two-node note above — and no text
				 * layout either, so the only box that decides what is visible is the
				 * field's own.
				 */
				<div
					aria-hidden="true"
					data-composer-mirror=""
					className={cn(
						"pointer-events-none absolute inset-0 select-none overflow-hidden",
						disabled ? "text-ink-disabled" : "text-ink",
					)}
				>
					{/*
					 * The glyph layer: `fieldClassName` sits here because it is what the
					 * text metrics and the text column come from, and the transform and
					 * the scrollbar gutter are written to this node by the effect.
					 */}
					<div
						ref={mirrorRef}
						data-composer-mirror-paint=""
						className={cn("whitespace-pre-wrap break-words", fieldClassName)}
					>
						{/*
						 * Keyed by the segment's OFFSET in the draft rather than by its
						 * index: the same character range keeps the same key across a
						 * keystroke, so React moves the span instead of re-creating it
						 * (the index key turned every edit into a full re-mount of the
						 * painted runs, which is what a caret inside a highlighted word
						 * would feel).
						 */}
						{segments.map((segment) =>
							segment.kind === "prose" ? (
								<span key={`prose:${segment.start}`}>{segment.text}</span>
							) : (
								<span
									key={`${segment.kind}:${segment.start}`}
									data-slash-run={segment.kind}
									/*
									 * The disabled step reaches the RUNS too: the mirror's container
									 * already steps to `text-ink-disabled`, but a descendant span wins,
									 * so a field that cannot accept input was painting an
									 * enabled-strength command word (design D2 — measured ΔE00 0.8-1.5
									 * against the enabled frame in five themes, i.e. no step at all).
									 * Branding's rule is "disabled changes colour, never opacity", so
									 * the run's colour becomes the disabled ink rather than fading.
									 */
									className={cn(runInkClass(segment.kind, disabled))}
								>
									{segment.text}
								</span>
							),
						)}
					</div>
				</div>
			)}
			{children}
		</div>
	);
};
