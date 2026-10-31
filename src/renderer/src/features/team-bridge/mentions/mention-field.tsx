import type {
	KeyboardEvent as ReactKeyboardEvent,
	ReactNode,
	RefObject,
} from "react";
import { useId, useLayoutEffect, useState } from "react";
import { caretRect } from "./caret-coordinates";
import { MentionHighlightOverlay } from "./mention-highlight-overlay";
import { MentionNotice } from "./mention-notice";
import { stageMentions } from "./mention-outbox";
import { MentionPopover, mentionOptionId } from "./mention-popover";
import {
	type MentionAutocomplete,
	useMentionAutocomplete,
} from "./use-mention-autocomplete";

/**
 * THE COMPOSER MOUNT, kept to one hook and two wrappers.
 *
 * `useComposerMentions` gives a composer everything it spreads onto its
 * textarea (`bindField`), so its own diff is: call the hook, spread the props,
 * wrap the field in `MentionField`, render `MentionNotice` above the bar, and
 * pass `mentions.payload()` to its send. With no `MentionSourceContext`
 * provider the hook is inert and `bindField` hands the composer's own handler
 * straight back, so the composer behaves exactly as before.
 */
export function useComposerMentions(input: {
	draftKey: string;
	text: string;
	setText: (next: string) => void;
	fieldRef: RefObject<HTMLTextAreaElement | null>;
}): MentionAutocomplete & {
	/**
	 * Call with the body just before submitting: stages this draft's
	 * `mentions[]` for the send of exactly that text (`mention-outbox`).
	 * A no-op without a source or without the backend capability.
	 */
	stage: (body: string) => void;
	bindField: (own: {
		onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	}) => {
		onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
		onSelect?: MentionAutocomplete["onSelect"];
		role?: "combobox";
		"aria-expanded"?: boolean;
		"aria-controls"?: string;
		"aria-autocomplete"?: "list";
		"aria-activedescendant"?: string;
	};
} {
	const listboxId = useId().replace(/:/g, "");
	const mentions = useMentionAutocomplete({ ...input, listboxId });
	return {
		...mentions,
		stage: (body) => {
			if (mentions.source)
				stageMentions(mentions.source.conversationId, body, mentions.payload());
		},
		bindField: (own) => ({
			onKeyDown: (event) => {
				if (mentions.onKeyDown(event)) return;
				own.onKeyDown?.(event);
			},
			...(mentions.enabled
				? {
						onSelect: mentions.onSelect,
						role: "combobox" as const,
						"aria-expanded": mentions.open,
						"aria-controls": mentions.open ? listboxId : undefined,
						"aria-autocomplete": "list" as const,
						"aria-activedescendant":
							mentions.open && mentions.flat.length > 0
								? mentionOptionId(listboxId, mentions.active)
								: undefined,
					}
				: {}),
		}),
	};
}

/**
 * Wraps the textarea: the pill overlay behind it and the popover at the caret.
 * The wrapper is `relative` so the overlay can sit exactly under the field;
 * the field itself must be `relative` too (positioned elements paint above
 * static ones, and the field's glyphs must be above the wash).
 */
/** `w-[min(22rem,…)]` on the popover, in px, and the viewport margin. */
const POPOVER_WIDTH_PX = 352;
const EDGE_PX = 8;

export function MentionField({
	mentions,
	fieldRef,
	text,
	children,
}: {
	mentions: MentionAutocomplete;
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	text: string;
	children: ReactNode;
}) {
	const [position, setPosition] = useState<{
		left: number;
		bottom: number;
	} | null>(null);
	const { open, anchorIndex } = mentions;
	/*
	 * ANCHORED AT THE `@`, CLAMPED TO BOTH EDGES, MIRRORED IN RTL (design D5).
	 * In LTR the popover's left edge meets the `@`; in RTL its RIGHT edge does,
	 * because the name grows leftward from there. Either way it is clamped
	 * into the viewport on both sides, so an `@` near the far edge of a wide
	 * line or a narrow thread pane does not push the list off-screen.
	 *
	 * RE-MEASURED WHILE OPEN (review R1-03): the field scrolling (a tall
	 * draft), the window resizing and the field itself resizing (the thread
	 * pane, autogrow) all move the `@`, and a `position: fixed` list would
	 * otherwise stay where it was first drawn.
	 */
	useLayoutEffect(() => {
		const field = fieldRef.current;
		if (!open || anchorIndex === null || !field) {
			setPosition(null);
			return;
		}
		const view = field.ownerDocument.defaultView;
		const measure = () => {
			const rect = caretRect(field, anchorIndex);
			const viewportW = view?.innerWidth ?? 0;
			const viewportH = view?.innerHeight ?? 0;
			const width = Math.min(POPOVER_WIDTH_PX, viewportW - 2 * EDGE_PX);
			const rtl = view?.getComputedStyle(field).direction === "rtl";
			const preferred = rtl ? rect.right + 8 - width : rect.left - 8;
			const left = Math.min(
				Math.max(EDGE_PX, preferred),
				Math.max(EDGE_PX, viewportW - EDGE_PX - width),
			);
			// Above the `@`: the composer sits at the foot of the pane, so the
			// list opens upward and never covers what is being typed.
			setPosition({ left, bottom: viewportH - rect.top + 6 });
		};
		measure();
		field.addEventListener("scroll", measure);
		view?.addEventListener("resize", measure);
		const observer =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(measure);
		observer?.observe(field);
		return () => {
			field.removeEventListener("scroll", measure);
			view?.removeEventListener("resize", measure);
			observer?.disconnect();
		};
	}, [open, anchorIndex, fieldRef]);
	if (!mentions.enabled) return <>{children}</>;
	return (
		<div className="relative flex min-w-0 flex-1">
			<MentionHighlightOverlay
				fieldRef={fieldRef}
				text={text}
				tokens={mentions.tokens}
			/>
			{children}
			{open && position && (
				<MentionPopover
					listboxId={mentions.listboxId}
					sections={mentions.sections}
					active={mentions.active}
					query={
						anchorIndex === null
							? ""
							: text.slice(anchorIndex + 1, fieldRef.current?.selectionStart)
					}
					onActive={mentions.setActive}
					onPick={mentions.pick}
					position={position}
				/>
			)}
		</div>
	);
}

export { MentionNotice };
