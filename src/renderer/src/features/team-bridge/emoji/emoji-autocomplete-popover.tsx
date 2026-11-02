import { cn } from "@shared/lib/utils";
import type { RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { caretRect } from "../mentions/caret-coordinates";
import {
	emojiOptionId,
	emojiPopoverPosition,
} from "./emoji-autocomplete-controller";
import type { EmojiCandidate } from "./emoji-autocomplete-model";

type Position = ReturnType<typeof emojiPopoverPosition>;

/**
 * A non-focus-taking combobox popup, like mentions. Copy is supplied by the
 * eventual mount through t(); corpus names are labels, not translation keys.
 * Nothing mounts this component until the baseline and input-owner handoff.
 */
export function EmojiAutocompletePopover({
	fieldRef,
	anchorIndex,
	listboxId,
	rows,
	active,
	label,
	emptyLabel,
	onActive,
	onPick,
	labelFor = (row) => row.name,
}: {
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	anchorIndex: number;
	listboxId: string;
	rows: readonly EmojiCandidate[];
	active: number;
	label: string;
	emptyLabel: string;
	onActive: (index: number) => void;
	onPick: (row: EmojiCandidate) => void;
	labelFor?: (row: EmojiCandidate) => string;
}) {
	const [position, setPosition] = useState<Position | null>(null);
	const list = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const field = fieldRef.current;
		const view = field?.ownerDocument.defaultView;
		if (!field || !view) return;
		const measure = () => {
			setPosition(emojiPopoverPosition({
				caret: caretRect(field, anchorIndex),
				viewportWidth: view.innerWidth,
				viewportHeight: view.innerHeight,
				rows: rows.length,
				rtl: view.getComputedStyle(field).direction === "rtl",
			}));
		};
		measure();
		// Capture ancestor scroll as well as textarea scroll: a fixed portal does
		// not follow its anchor when a containing pane moves beneath it.
		view.addEventListener("scroll", measure, true);
		view.addEventListener("resize", measure);
		const observer = typeof ResizeObserver === "undefined"
			? null
			: new ResizeObserver(measure);
		observer?.observe(field);
		return () => {
			view.removeEventListener("scroll", measure, true);
			view.removeEventListener("resize", measure);
			observer?.disconnect();
		};
	}, [fieldRef, anchorIndex, rows.length]);
	useLayoutEffect(() => {
		list.current?.querySelector<HTMLElement>(
			`[data-emoji-index="${active}"]`,
		)?.scrollIntoView?.({ block: "nearest" });
	}, [active, rows, position?.maxHeight]);
	const doc = fieldRef.current?.ownerDocument;
	if (!doc || !position || position.maxHeight <= 0) return null;
	return createPortal(
		<div
			data-emoji-popover=""
			className={cn("fixed z-50 overflow-hidden rounded-md bg-elevated shadow-lg")}
			style={{
				left: position.left,
				top: position.top,
				width: position.width,
			}}
		>
			<div
				ref={list}
				id={listboxId}
				/* biome-ignore lint/a11y/useSemanticElements: field-owned ARIA combobox options retain textarea focus. */
				role="listbox"
				tabIndex={-1}
				aria-label={label}
				className="overflow-y-auto py-1"
				style={{ maxHeight: position.maxHeight }}
			>
				{rows.length === 0 ? (
					<div role="status" className="min-h-9 px-3 py-2 text-body-sm text-ink-muted">
						{emptyLabel}
					</div>
				) : rows.map((row, index) => (
					/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents lint/a11y/useSemanticElements: field owns focus and keyboard selection via aria-activedescendant. */
					<div
						key={row.emoji}
						id={emojiOptionId(listboxId, index)}
						role="option"
						aria-selected={index === active}
						data-emoji-index={index}
						className={cn(
							"relative flex h-9 min-h-9 cursor-pointer items-center gap-2 px-3 text-body-sm text-ink",
							index === active && "bg-accent-wash before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent",
						)}
						onMouseMove={() => onActive(index)}
						onMouseDown={(event) => {
							event.preventDefault();
						}}
						onClick={() => onPick(row)}
					>
						<span aria-hidden="true" className="shrink-0 text-lg">{row.emoji}</span>
						<span className="truncate">{labelFor(row)}</span>
					</div>
				))}
			</div>
		</div>,
		doc.body,
	);
}
