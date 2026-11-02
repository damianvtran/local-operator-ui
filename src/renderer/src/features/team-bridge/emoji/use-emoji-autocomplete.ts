import type { KeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import data from "../data/emoji.json";
import {
	autocompleteOwner,
	emojiOptionId,
	isEmojiTyping,
} from "./emoji-autocomplete-controller";
import {
	type EmojiCandidate,
	type EmojiQueryInput,
	createEmojiSearch,
	findEmojiQuery,
	insertEmoji,
} from "./emoji-autocomplete-model";

// Local, synchronous and shared across all Bridge hosts. There is no directory
// query or network request on a keystroke, and no per-render corpus rebuilding.
const searchCorpus = createEmojiSearch(
	data.entries.map(([emoji, name, , keywords]) => ({
		emoji: emoji as string,
		name: name as string,
		keywords: keywords as string[],
	})),
);
/** Supplied by the sole field event owner; this hook installs no native listeners. */
export type EmojiInputIntent = {
	draftKey: string;
	sequence: number;
	text: string;
	selectionStart: number;
	selectionEnd: number;
	kind: "typing" | "paste" | "restore" | "dictation";
	inputType: string;
	composing: boolean;
};

/**
 * This hook owns query intent and selection, NOT text/history/mention sidecars.
 * The shared Bridge seam must route `onEdit` through its existing applyEdit and
 * route keys with the returned owner; never invoke both autocomplete handlers.
 * The field owner supplies monotonically sequenced native-input intent and clears
 * it on blur, selection navigation, composition and draft restoration. This
 * component deliberately does not add a competing listener or history owner.
 */
export function useEmojiAutocomplete(input: {
	draftKey: string;
	text: string;
	enabled: boolean;
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	listboxId: string;
	mentionQueryStart: number | null;
	mentionRanges: EmojiQueryInput["mentionRanges"];
	intent: EmojiInputIntent | null;
	onEdit: (edit: NonNullable<ReturnType<typeof insertEmoji>>) => void;
	/** A locale-aware cached corpus can replace the bundled names when available. */
	search?: ReturnType<typeof createEmojiSearch>;
}) {
	const {
		draftKey,
		text,
		enabled,
		fieldRef,
		listboxId,
		mentionQueryStart,
		mentionRanges,
		intent,
		onEdit,
		search = searchCorpus,
	} = input;
	const [consumed, setConsumed] = useState("");
	const [dismissedAt, setDismissedAt] = useState<string | null>(null);
	const [selection, setSelection] = useState({ key: "", index: 0 });

	const intentKey = intent ? `${intent.draftKey}:${intent.sequence}` : "";
	const query = useMemo(
		() =>
			enabled &&
			intent &&
			intent.draftKey === draftKey &&
			intentKey !== consumed &&
			intent.kind === "typing" &&
			isEmojiTyping(intent.inputType, intent.composing)
				? findEmojiQuery({
						text,
						selectionStart: intent.selectionStart,
						selectionEnd: intent.selectionEnd,
						interaction: { text: intent.text, kind: intent.kind },
						composing: intent.composing,
						mentionRanges,
					})
				: null,
		[enabled, intent, draftKey, intentKey, consumed, text, mentionRanges],
	);
	useEffect(() => {
		// During the text commit the field owner has not adopted its ref-only
		// native intent yet. That transient null query must not undo Escape.
		if (intent && intent.text !== text) return;
		if (query === null || `${draftKey}:${query.start}` !== dismissedAt)
			setDismissedAt(null);
	}, [query, draftKey, dismissedAt, intent, text]);
	const eligible =
		query !== null && `${draftKey}:${query.start}` !== dismissedAt;
	const owner = autocompleteOwner(
		mentionQueryStart,
		eligible ? query.start : null,
	);
	const open = owner === "emoji";
	const rows = useMemo(
		() => (open && query ? search(query.query, query.query ? 32 : 8) : []),
		[open, query, search],
	);
	const queryKey = query ? `${draftKey}:${query.start}:${query.query}` : "";
	const active =
		selection.key === queryKey
			? Math.min(selection.index, Math.max(0, rows.length - 1))
			: 0;
	const setActive = useCallback(
		(index: number) => {
			if (Number.isInteger(index) && index >= 0 && index < rows.length)
				setSelection({ key: queryKey, index });
		},
		[queryKey, rows.length],
	);
	const close = useCallback(() => {
		if (query) setDismissedAt(`${draftKey}:${query.start}`);
	}, [draftKey, query]);
	const pick = useCallback(
		(row: EmojiCandidate) => {
			const field = fieldRef.current;
			if (
				!open ||
				!query ||
				!rows.includes(row) ||
				!field ||
				field.value !== text ||
				field.selectionStart !== query.end ||
				field.selectionEnd !== query.end
			)
				return;
			const edit = insertEmoji(text, query, row.emoji);
			if (!edit) return;
			onEdit(edit);
			setConsumed(intentKey);
			setDismissedAt(`${draftKey}:${query.start}`);
		},
		[open, query, rows, fieldRef, text, onEdit, intentKey, draftKey],
	);
	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!open || event.nativeEvent.isComposing || event.key === "Process")
				return false;
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
				return true;
			}
			if (
				rows.length &&
				(event.key === "ArrowUp" || event.key === "ArrowDown")
			) {
				event.preventDefault();
				setActive(
					(active + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
						rows.length,
				);
				return true;
			}
			if (event.key === "Enter" && !event.shiftKey && rows[active]) {
				// Even a stale pick must not fall through to send the unfinished shortcode.
				event.preventDefault();
				pick(rows[active]);
				return true;
			}
			return false;
		},
		[open, close, rows, active, setActive, pick],
	);
	return {
		owner,
		open,
		query,
		rows,
		active,
		setActive,
		close,
		pick,
		onKeyDown,
		listboxId,
		aria:
			owner === "emoji"
				? {
						role: "combobox" as const,
						"aria-expanded": open,
						"aria-controls": open ? listboxId : undefined,
						"aria-autocomplete": "list" as const,
						"aria-activedescendant":
							open && rows.length
								? emojiOptionId(listboxId, active)
								: undefined,
					}
				: {},
	};
}
