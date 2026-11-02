export type AutocompleteOwner = "none" | "mention" | "emoji";

/** One Bridge field has one keyboard/ARIA owner, never two competing handlers. */
export function autocompleteOwner(
	mentionStart: number | null,
	emojiStart: number | null,
): AutocompleteOwner {
	if (mentionStart === null) return emojiStart === null ? "none" : "emoji";
	if (emojiStart === null) return "mention";
	return emojiStart > mentionStart ? "emoji" : "mention";
}

export function routeAutocompleteKey<Event>(
	owner: AutocompleteOwner,
	event: Event,
	handlers: {
		mention: (event: Event) => boolean;
		emoji: (event: Event) => boolean;
		composer: (event: Event) => void;
	},
): boolean {
	// A refusal belongs to the composer, not the OTHER autocomplete handler.
	if (owner !== "none" && handlers[owner](event)) return true;
	handlers.composer(event);
	return false;
}

/** Paste, undo, dictation and composition are value changes, not query intent. */
export function isEmojiTyping(inputType: string, composing: boolean): boolean {
	return (
		!composing &&
		["insertText", "deleteContentBackward", "deleteContentForward"].includes(
			inputType,
		)
	);
}

export function emojiOptionId(listboxId: string, index: number): string {
	return `${listboxId}-emoji-option-${index}`;
}

export const EMOJI_ROW_HEIGHT = 36;
export const EMOJI_VISIBLE_ROWS = 8;

/** Geometry is pure so even tiny viewports can be checked without a fake browser. */
export function emojiPopoverPosition(input: {
	caret: { left: number; right: number; top: number; height: number };
	viewportWidth: number;
	viewportHeight: number;
	rows: number;
	rtl: boolean;
}) {
	const viewportWidth = Math.max(0, input.viewportWidth);
	const viewportHeight = Math.max(0, input.viewportHeight);
	const edge = Math.min(8, viewportWidth / 2, viewportHeight / 2);
	const gap = 6;
	const width = Math.min(320, Math.max(0, viewportWidth - edge * 2));
	const desiredHeight =
		Math.max(1, Math.min(EMOJI_VISIBLE_ROWS, input.rows)) * EMOJI_ROW_HEIGHT + 8;
	const above = Math.max(0, input.caret.top - gap - edge);
	const below = Math.max(
		0,
		viewportHeight - input.caret.top - input.caret.height - gap - edge,
	);
	const flipBelow = above < desiredHeight && below > above;
	const maxHeight = Math.min(
		desiredHeight,
		flipBelow ? below : above,
		Math.max(0, viewportHeight - edge * 2),
	);
	const preferredLeft = input.rtl ? input.caret.right - width : input.caret.left;
	return {
		left: Math.max(edge, Math.min(preferredLeft, viewportWidth - edge - width)),
		top: Math.max(
			edge,
			Math.min(
				flipBelow
					? input.caret.top + input.caret.height + gap
					: input.caret.top - gap - maxHeight,
				viewportHeight - edge - maxHeight,
			),
		),
		width,
		maxHeight,
	};
}
