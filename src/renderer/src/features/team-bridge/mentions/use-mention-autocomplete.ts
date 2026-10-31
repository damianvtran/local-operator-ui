import type {
	KeyboardEvent as ReactKeyboardEvent,
	RefObject,
	SyntheticEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { MentionCandidateRow } from "./candidates";
import {
	type MentionSection,
	findMentionQuery,
	mentionKey,
	rankMentionCandidates,
} from "./matcher";
import { useMentionSource } from "./mention-context";
import { useMentionDraftStore } from "./mention-draft-store";
import {
	type MentionToken,
	type MentionWireRow,
	clampCaret,
	deleteAcrossToken,
	insertMention,
	rebaseTokens,
	serializeMentions,
} from "./tokens";

/**
 * The composer's @-mention controller: popover state, the token map, the key
 * handling and the send payload, behind one hook so the composer's own diff is
 * a mount and not a rewrite (another lane owns that file).
 *
 * THE TEXT STAYS THE COMPOSER'S. The hook never holds a second copy of the
 * draft: it reads `text` and writes through `setText`, the same setter the
 * field's `onChange` uses (`useMessageInput`'s register). The token map is
 * rebased against every text value it observes, so typing, paste, dictation
 * and the composer's own clear-on-send all keep it honest without being told.
 *
 * KEYS. `onKeyDown` must run BEFORE the composer's own handler and returns
 * true when it consumed the event: while the popover is open ↑/↓, Enter, Tab
 * and Esc belong to it, otherwise Enter would send a half-typed `@Be`.
 * Backspace/Delete into a pill removes the whole pill. Nothing happens during
 * IME composition (`isComposing`), so a CJK reader's candidate window keeps
 * its keys.
 */
export type MentionNotice = {
	candidate: MentionCandidateRow;
	token: MentionToken;
	/** The invite went through: they are invited, not yet able to be notified. */
	invited?: boolean;
};

export type MentionAutocomplete = {
	enabled: boolean;
	open: boolean;
	sections: MentionSection[];
	flat: MentionCandidateRow[];
	active: number;
	setActive: (index: number) => void;
	pick: (candidate: MentionCandidateRow) => void;
	close: () => void;
	/** Index of the `@` the popover is anchored to. */
	anchorIndex: number | null;
	tokens: MentionToken[];
	onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean;
	onSelect: (event: SyntheticEvent<HTMLTextAreaElement>) => void;
	/** The wire rows for a send now, or undefined when none may be sent. */
	payload: () => MentionWireRow[] | undefined;
	notice: MentionNotice | null;
	dismissNotice: () => void;
	/** Keep the pill, drop it from `mentions[]` ("Mention without notifying"). */
	silenceNotice: () => void;
	/** The candidate became a member: the token now notifies as usual. */
	resolveNotice: () => void;
	source: ReturnType<typeof useMentionSource>;
	listboxId: string;
};

const NO_TOKENS: MentionToken[] = [];

export function useMentionAutocomplete(input: {
	draftKey: string;
	text: string;
	setText: (next: string) => void;
	fieldRef: RefObject<HTMLTextAreaElement | null>;
	listboxId: string;
}): MentionAutocomplete {
	const { draftKey, text, setText, fieldRef, listboxId } = input;
	const source = useMentionSource();
	const enabled = source !== null;

	/*
	 * THE TOKEN MAP. Seeded from the persisted sidecar for this draft key (a
	 * restored draft gets its pills back), then carried across every text value
	 * by `rebaseTokens`. `lastText` is the text the map was last true for.
	 */
	const stored = useMentionDraftStore((state) => state.drafts[draftKey]);
	const writeStored = useMentionDraftStore((state) => state.write);
	const [tokens, setTokens] = useState<MentionToken[]>(() =>
		stored ? rebaseTokens(stored.text, text, stored.tokens) : NO_TOKENS,
	);
	const lastText = useRef(text);
	const keyRef = useRef(draftKey);
	if (keyRef.current !== draftKey) {
		// A different draft: its own sidecar, never the previous draft's pills.
		keyRef.current = draftKey;
		lastText.current = text;
		const next = stored
			? rebaseTokens(stored.text, text, stored.tokens)
			: NO_TOKENS;
		if (next !== tokens) setTokens(next);
	} else if (lastText.current !== text) {
		const next = rebaseTokens(lastText.current, text, tokens);
		lastText.current = text;
		setTokens(next);
	}
	useEffect(() => {
		writeStored(draftKey, text, tokens);
	}, [draftKey, text, tokens, writeStored]);

	const [caret, setCaret] = useState<number | null>(null);
	const [dismissedAt, setDismissedAt] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const [notice, setNotice] = useState<MentionNotice | null>(null);
	const composing = useRef(false);

	const query = useMemo(() => {
		if (!enabled || caret === null) return null;
		const found = findMentionQuery(text, caret);
		if (!found) return null;
		// Inside an existing pill is not a new query.
		if (tokens.some((t) => found.start >= t.start && found.start < t.end))
			return null;
		return found;
	}, [enabled, caret, text, tokens]);

	const ranked = useMemo(
		() =>
			query
				? rankMentionCandidates(query.query, source?.candidates ?? [])
				: { sections: [], flat: [] },
		[query, source?.candidates],
	);
	const flat = ranked.flat as MentionCandidateRow[];

	/*
	 * ESC KEEPS THE TEXT AND STAYS CLOSED for this `@`: the popover reopens
	 * only for a different `@` (a new start index), not on the next letter.
	 * A trailing space that leaves zero matches closes it the same way, so
	 * "email @ 5pm" style prose stops offering names.
	 */
	const zeroAfterSpace =
		query !== null && flat.length === 0 && query.query.endsWith(" ");
	/*
	 * A SPACE WITH ZERO MATCHES IS A DISMISSAL, REMEMBERED (review R1-02). It
	 * used to be a property of the current query only, so the next letter
	 * ("@ops t") reopened an empty popover over the thread until a newline.
	 * Recording the `@` like Esc does keeps prose prose.
	 */
	const zeroStart = zeroAfterSpace ? query.start : null;
	useEffect(() => {
		if (zeroStart !== null) setDismissedAt(zeroStart);
	}, [zeroStart]);
	const open =
		query !== null &&
		dismissedAt !== query.start &&
		!zeroAfterSpace &&
		!composing.current;

	const queryText = query?.query;
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new query string is the trigger to reset the active row to the top.
	useEffect(() => {
		setActive(0);
	}, [queryText]);

	const syncCaret = useCallback(
		(direction: "backward" | "forward" = "forward") => {
			const field = fieldRef.current;
			if (!field) return;
			if (field.selectionStart !== field.selectionEnd) {
				setCaret(null);
				return;
			}
			const at = field.selectionStart;
			// The caret may not rest inside a pill.
			const clamped = clampCaret(tokens, at, direction);
			if (clamped !== at) field.setSelectionRange(clamped, clamped);
			setCaret(clamped);
		},
		[fieldRef, tokens],
	);

	/*
	 * THE CARET FOLLOWS EVERY TEXT CHANGE, not only `onSelect`. React derives
	 * `onSelect` from `selectionchange`, which not every host fires on typing
	 * (jsdom never does; a programmatic `setInputValue` from dictation fires
	 * none). Re-reading the field after each committed value keeps the query
	 * in step with what was actually typed.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger; the caret is read from the field.
	useLayoutEffect(() => {
		if (
			enabled &&
			fieldRef.current === fieldRef.current?.ownerDocument.activeElement
		)
			syncCaret();
	}, [text, enabled]);

	/*
	 * EDITS GO THROUGH THE FIELD'S OWN EDITING PATH WHEN IT CAN (review R1-04).
	 * Setting `value` programmatically wipes Chromium's undo stack for the
	 * field, so Cmd+Z could not bring back a deleted pill or the typed `@que`.
	 * `execCommand("insertText")` over the replaced range is a real user edit:
	 * it lands on the undo stack and fires `input`, so the composer's own
	 * `onChange` writes the text and `rebaseTokens` runs as for typing; the
	 * token map is then replaced with the edit's own (which knows the new
	 * token). It is deprecated but still the only API that edits a textarea
	 * with undo in Chromium. Where it is unavailable or refuses (jsdom, a
	 * disabled field), the value is written directly and undo is lost for
	 * that one edit - the text and tokens are correct either way.
	 */
	const applyEdit = useCallback(
		(
			next: { text: string; caret: number; tokens: MentionToken[] },
			range?: { start: number; end: number; insert: string },
		) => {
			const field = fieldRef.current;
			let native = false;
			if (field && range) {
				field.focus();
				field.setSelectionRange(range.start, range.end);
				try {
					native =
						field.ownerDocument.execCommand?.(
							range.insert === "" ? "delete" : "insertText",
							false,
							range.insert,
						) === true && field.value === next.text;
				} catch {
					native = false;
				}
			}
			lastText.current = next.text;
			setTokens(next.tokens);
			if (!native) setText(next.text);
			setCaret(next.caret);
			// The caret is placed after React writes the value.
			requestAnimationFrame(() => {
				const current = fieldRef.current;
				if (!current) return;
				current.setSelectionRange(next.caret, next.caret);
			});
		},
		[fieldRef, setText],
	);

	/** Back to the field with the caret where it was (design D4). */
	const refocus = useCallback(
		(at?: number) => {
			requestAnimationFrame(() => {
				const field = fieldRef.current;
				if (!field) return;
				field.focus();
				if (at !== undefined) field.setSelectionRange(at, at);
			});
		},
		[fieldRef],
	);

	const pick = useCallback(
		(candidate: MentionCandidateRow) => {
			if (!query) return;
			/*
			 * ONLY AN ACTIVE MEMBER GETS A NOTIFYING TOKEN (review R1-01). The hub
			 * refuses the whole send for a row naming anyone else, so a
			 * non-member or invited pick starts as non-notifying text, and the
			 * notice says so and offers the invite. It is never dropped silently:
			 * the pill stays, visibly quiet.
			 */
			const edit = insertMention(
				text,
				tokens,
				query,
				candidate,
				candidate.member,
			);
			const insertedText = edit.text.slice(query.start, edit.caret);
			applyEdit(edit, {
				start: query.start,
				end: query.end,
				insert: insertedText,
			});
			setDismissedAt(null);
			const token = edit.tokens.find((t) => t.start === query.start);
			if (token && !candidate.member) setNotice({ candidate, token });
			refocus(edit.caret);
		},
		[query, text, tokens, applyEdit, refocus],
	);

	const close = useCallback(() => {
		if (query) setDismissedAt(query.start);
	}, [query]);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
			if (!enabled) return false;
			if (event.nativeEvent.isComposing || event.key === "Process")
				return false;
			const field = event.currentTarget;
			if (open && flat.length > 0) {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					const step = event.key === "ArrowDown" ? 1 : -1;
					setActive((index) => (index + step + flat.length) % flat.length);
					return true;
				}
				if (
					(event.key === "Enter" && !event.shiftKey) ||
					(event.key === "Tab" && !event.shiftKey)
				) {
					event.preventDefault();
					pick(flat[Math.min(active, flat.length - 1)]);
					return true;
				}
			}
			if (open && event.key === "Escape") {
				event.preventDefault();
				// Esc closes the popover only; the thread pane must not close too.
				event.stopPropagation();
				close();
				return true;
			}
			if (event.key === "Backspace" || event.key === "Delete") {
				const edit = deleteAcrossToken(
					text,
					tokens,
					{ start: field.selectionStart, end: field.selectionEnd },
					event.key,
				);
				if (edit) {
					event.preventDefault();
					applyEdit(edit, {
						start: edit.caret,
						end: edit.caret + (text.length - edit.text.length),
						insert: "",
					});
					return true;
				}
			}
			if (
				(event.key === "ArrowLeft" || event.key === "ArrowRight") &&
				!event.shiftKey &&
				field.selectionStart === field.selectionEnd
			) {
				// Step OVER a pill in one keypress rather than through its letters.
				const at = field.selectionStart;
				const rtl =
					field.ownerDocument.defaultView?.getComputedStyle(field).direction ===
					"rtl";
				const forward = (event.key === "ArrowRight") !== rtl;
				const hit = tokens.find((t) =>
					forward ? at === t.start : at === t.end,
				);
				if (hit) {
					event.preventDefault();
					const to = forward ? hit.end : hit.start;
					field.setSelectionRange(to, to);
					setCaret(to);
					return true;
				}
			}
			return false;
		},
		[enabled, open, flat, active, pick, close, text, tokens, applyEdit],
	);

	const onSelect = useCallback(
		(event: SyntheticEvent<HTMLTextAreaElement>) => {
			const native = event.nativeEvent as Event & { isComposing?: boolean };
			composing.current = Boolean(native.isComposing);
			const field = event.currentTarget;
			const previous = caret ?? field.selectionStart;
			syncCaret(field.selectionStart < previous ? "backward" : "forward");
		},
		[caret, syncCaret],
	);

	// Composition events do not all reach `onSelect`; track them directly.
	useEffect(() => {
		const field = fieldRef.current;
		if (!field || !enabled) return;
		const start = () => {
			composing.current = true;
		};
		const end = () => {
			composing.current = false;
			syncCaret();
		};
		field.addEventListener("compositionstart", start);
		field.addEventListener("compositionend", end);
		return () => {
			field.removeEventListener("compositionstart", start);
			field.removeEventListener("compositionend", end);
		};
	}, [fieldRef, enabled, syncCaret]);

	const activeKeys = useMemo(
		() =>
			new Set(
				(source?.candidates ?? [])
					.filter((c) => c.member)
					.map((c) => mentionKey(c)),
			),
		[source?.candidates],
	);
	/*
	 * A token waiting on an invite becomes notifying once a refetch shows the
	 * person ACTIVE - accepting is theirs, so the pill upgrades itself rather
	 * than asking the author to pick again.
	 */
	const awaitingKeys = useRef(new Set<string>());
	useEffect(() => {
		if (awaitingKeys.current.size === 0) return;
		const ready = [...awaitingKeys.current].filter((key) =>
			activeKeys.has(key),
		);
		if (ready.length === 0) return;
		for (const key of ready) awaitingKeys.current.delete(key);
		setTokens((current) =>
			current.map((t) =>
				ready.includes(mentionKey(t)) ? { ...t, notify: true } : t,
			),
		);
	}, [activeKeys]);

	const payload = useCallback((): MentionWireRow[] | undefined => {
		if (!source?.sendMentions) return undefined;
		const rows = serializeMentions(
			rebaseTokens(lastText.current, text, tokens),
			activeKeys,
		);
		return rows.length > 0 ? rows : undefined;
	}, [source?.sendMentions, text, tokens, activeKeys]);

	const updateNoticeToken = useCallback(
		(patch: Partial<MentionToken> | null, close = true) => {
			if (!notice) return;
			if (patch)
				setTokens((current) =>
					current.map((t) =>
						t.start === notice.token.start &&
						mentionKey(t) === mentionKey(notice.candidate)
							? { ...t, ...patch }
							: t,
					),
				);
			if (close) setNotice(null);
			// Focus back in the field, caret after the pill (design D4).
			refocus(notice.token.end + 1);
		},
		[notice, refocus],
	);

	// The notice goes with its pill: delete the mention and the question is moot.
	useEffect(() => {
		if (
			notice &&
			!tokens.some(
				(t) =>
					t.start === notice.token.start &&
					mentionKey(t) === mentionKey(notice.candidate),
			)
		)
			setNotice(null);
	}, [notice, tokens]);

	return {
		enabled,
		open,
		sections: ranked.sections,
		flat,
		active,
		setActive,
		pick,
		close,
		anchorIndex: query?.start ?? null,
		tokens,
		onKeyDown,
		onSelect,
		payload,
		notice,
		/*
		 * Every choice keeps the pill and NONE notifies a non-member, because
		 * the hub would refuse the whole message (review R1-01): Dismiss and
		 * "Mention without notifying" both leave readable, non-notifying text;
		 * Invite leaves it non-notifying until the person is active, when it
		 * upgrades itself (`awaitingKeys`).
		 */
		dismissNotice: () => updateNoticeToken({ notify: false }),
		silenceNotice: () => updateNoticeToken({ notify: false }),
		resolveNotice: () => {
			if (!notice) return;
			awaitingKeys.current.add(mentionKey(notice.candidate));
			setNotice({ ...notice, invited: true });
			refocus(notice.token.end + 1);
		},
		source,
		listboxId,
	};
}
