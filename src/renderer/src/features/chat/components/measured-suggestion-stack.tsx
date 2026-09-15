import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { useLayoutEffect, useRef, useState } from "react";
import { suggestionStackCapFor } from "./suggestion-stack";

type Props = {
	band: HTMLDivElement | null;
	splash: HTMLDivElement | null;
	suggestions: readonly string[];
	disabled: boolean;
	onSelect: (suggestion: string) => void;
	focusComposer: () => void;
};

/**
 * Bound only the growing suggestions, never the composer/popup ancestors.
 * Hidden rows keep their flex boxes for measuring future wraps, but are neither
 * painted nor accessible nor actionable. Removing them from layout would make
 * the next measurement claim the stack fits and oscillate on every resize.
 *
 * This component owns the conditional stack node. Its ancestor nodes are callback
 * ref state in MessageInput, not ref.current snapshots: hydration/small-view/send
 * can replace those nodes without changing the suggestion sample. Each mount or
 * ancestor replacement must install a fresh observer and retire the old one.
 */
export const MeasuredSuggestionStack = ({
	band,
	splash,
	suggestions,
	disabled,
	onSelect,
	focusComposer,
}: Props) => {
	const stackRef = useRef<HTMLDivElement>(null);
	const [layout, setLayout] = useState<{
		cap: number | null;
		hidden: boolean[];
	}>({ cap: null, hidden: [] });
	// Focus recovery reads the latest composer without reconnecting observers on
	// each keystroke (the caller intentionally supplies an event-time closure).
	const focusComposerRef = useRef(focusComposer);
	focusComposerRef.current = focusComposer;

	useLayoutEffect(() => {
		const stack = stackRef.current;
		if (!band || !splash || !stack || suggestions.length === 0) return;
		let disposed = false;
		const measure = () => {
			if (disposed) return;
			const style = window.getComputedStyle(band);
			const room =
				window.innerHeight -
				band.getBoundingClientRect().top -
				Number.parseFloat(style.paddingTop) -
				Number.parseFloat(style.paddingBottom);
			// Subtracting the current stack box cancels its current cap. The budget
			// depends on fixed composer content, not on the answer being measured.
			const fixed =
				splash.getBoundingClientRect().height -
				stack.getBoundingClientRect().height;
			const top = stack.getBoundingClientRect().top;
			const buttons = Array.from(stack.children) as HTMLButtonElement[];
			const boxes = buttons.map((button) => button.getBoundingClientRect());
			const cap = suggestionStackCapFor(boxes, top, room - fixed);
			// Use the same tenth-pixel rounding as the row cap; subpixel noise must
			// not hide the final complete row that the cap deliberately preserves.
			const hidden = boxes.map(
				(box) => cap !== null && Math.round((box.bottom - top) * 10) / 10 > cap,
			);
			if (
				buttons.some(
					(button, index) => hidden[index] && button === document.activeElement,
				)
			) {
				// Do this before disabling/hiding the focused chip, while focus still
				// identifies it. Otherwise resize silently drops keyboard users to body.
				focusComposerRef.current();
			}
			setLayout((previous) =>
				previous.cap === cap &&
				previous.hidden.length === hidden.length &&
				previous.hidden.every((value, index) => value === hidden[index])
					? previous
					: { cap, hidden },
			);
		};
		measure();
		window.addEventListener("resize", measure);
		const observer = new ResizeObserver(measure);
		observer.observe(splash);
		void document.fonts?.ready.then(measure).catch(() => undefined);
		return () => {
			disposed = true;
			window.removeEventListener("resize", measure);
			observer.disconnect();
		};
	}, [band, splash, suggestions]);

	return (
		<div
			ref={stackRef}
			data-lo-suggestion-stack={true}
			className={cn(
				/*
				 * Left-aligned on the measure, not centred. With the chips' boundaries
				 * gone, a centred ragged block is the only thing left making the set look
				 * deliberate, and that reads as a first-run menu rather than as a list of
				 * examples. It also introduces no new axis: the group already has one left
				 * edge, drawn by the composer box above it, and the tip row between them
				 * takes the same one.
				 */
				"flex flex-wrap justify-start gap-2",
				// No scrollbar (which re-wraps labels). The margin preserves the last
				// visible chip's outline in the gap before the first omitted row.
				layout.cap !== null && "overflow-clip [overflow-clip-margin:4px]",
			)}
			style={layout.cap === null ? undefined : { maxHeight: layout.cap }}
		>
			{suggestions.map((suggestion, index) => {
				const hidden = layout.hidden[index] ?? false;
				return (
					/*
					 * The chip is the app's existing borderless-control pattern, not a new one:
					 * `ghost` is defined as having neither fill nor edge at rest, which is the
					 * same thing the attach button beside the composer already takes. The
					 * `outline` variant's `border border-control` was the loudness - on an
					 * empty chat it drew seven edges at the 3:1 floor that exists for the sole
					 * boundary of a CONTROL, on the one screen with nothing to compete with
					 * them. `hairline` is the tempting wrong answer: it is the decorative role
					 * and measures 1.25:1 at its worst, which is a boundary nobody can see.
					 *
					 * The hover pair steps the ground to `elevated` and the ink to `ink`,
					 * overriding `ghost`'s own `accent-wash` hover: the accent is spent on the
					 * primary action and the focus ring, and a hovered suggestion is neither.
					 * This is the pair the attach button uses, and the pair the contrast
					 * contract's `ask option button (hover)` row already asserts.
					 *
					 * `px-2` rather than `px-3`: 12px existed to keep a label off its own
					 * border, and there is no longer a border to keep it off. Separation
					 * between chips is `gap-2` plus both paddings, i.e. 24px edge to edge.
					 */
					<Button
						key={suggestion}
						variant="ghost"
						size="sm"
						className="h-auto max-w-full whitespace-normal break-words rounded-sm px-2 py-1 text-body-sm text-ink-muted hover:bg-elevated hover:text-ink"
						style={hidden ? { visibility: "hidden" } : undefined}
						aria-hidden={hidden || undefined}
						disabled={disabled || hidden}
						onClick={() => {
							if (!hidden && !disabled) onSelect(suggestion);
						}}
					>
						{suggestion}
					</Button>
				);
			})}
		</div>
	);
};
