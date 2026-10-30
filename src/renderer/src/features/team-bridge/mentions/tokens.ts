/**
 * The composer's mention TOKENS: a range map over the plain draft text.
 *
 * WHY A RANGE MAP OVER A TEXTAREA, NOT A CONTENTEDITABLE. The composer's text
 * has one owner, `useMessageInput` (the draft register, the "retire only what
 * was sent" rule, the refused-send restore, dictation's append). A
 * contenteditable rewrite would make the DOM a second owner of "what the box
 * holds" and re-open every one of those rules, plus IME, undo and paste
 * normalisation the textarea already gets right. So the text stays plain
 * (`@Ben Tran` is literally in it, which is also the readable body the hub
 * receives), and a token is a SIDECAR record of where a picked mention sits.
 * The pill is drawn by a mirrored overlay behind the transparent-text field
 * (`MentionHighlightOverlay`), and every edit rebases the map
 * (`rebaseTokens`), dropping any token whose characters were touched, so a
 * pill can never claim text that no longer spells its name.
 *
 * All offsets are UTF-16 indices, the unit `selectionStart` speaks.
 */
import type { MentionCandidate, MentionKind } from "./matcher";

export type MentionToken = {
	/** Index of the `@`. */
	start: number;
	/** Exclusive end: `start + 1 + label.length`. */
	end: number;
	kind: MentionKind;
	accountId: string;
	endpointId?: string;
	label: string;
	/**
	 * False after "Mention without notifying": the pill still renders (as
	 * quiet text) but the token is dropped from the wire `mentions[]`.
	 */
	notify: boolean;
};

/** The wire row, exactly the backend's `MentionIn` (local-operator #3204). */
export type MentionWireRow = {
	kind: MentionKind;
	account_id: string;
	endpoint_id?: string;
};

/** The text after an insertion already starts with whitespace. */
const LEADS_WITH_SPACE = /^\s/;

export type MentionEdit = {
	text: string;
	caret: number;
	tokens: MentionToken[];
};

/**
 * Replace the `@query` at [start, end) with `@Label ` and record its token.
 * Tokens after the insertion shift by the length change.
 */
export function insertMention(
	text: string,
	tokens: readonly MentionToken[],
	range: { start: number; end: number },
	candidate: Pick<
		MentionCandidate,
		"kind" | "accountId" | "endpointId" | "label"
	>,
	notify = true,
): MentionEdit {
	const spelled = `@${candidate.label}`;
	// One trailing space so the next word does not glue onto the pill, but not
	// a second one when the text already continues with whitespace.
	const after = text.slice(range.end);
	const pad = LEADS_WITH_SPACE.test(after) ? "" : " ";
	const next = `${text.slice(0, range.start)}${spelled}${pad}${after}`;
	const token: MentionToken = {
		start: range.start,
		end: range.start + spelled.length,
		kind: candidate.kind,
		accountId: candidate.accountId,
		...(candidate.kind === "agent" && candidate.endpointId
			? { endpointId: candidate.endpointId }
			: {}),
		label: candidate.label,
		notify,
	};
	const rebased = rebaseTokens(text, next, tokens).filter(
		(existing) => existing.end <= range.start || existing.start >= token.end,
	);
	return {
		text: next,
		caret: token.end + 1,
		tokens: sortTokens([...rebased, token]),
	};
}

function sortTokens(tokens: MentionToken[]): MentionToken[] {
	return tokens.sort((a, b) => a.start - b.start);
}

/**
 * Carry the map across an arbitrary edit (typing, paste, cut, dictation).
 *
 * The edit is located by common prefix and suffix, the only thing an
 * `onChange` tells us. A token entirely before the changed span is kept, one
 * entirely after it shifts, and one that the span touches is DROPPED: a
 * half-edited name is plain text again, never a pill pointing at the wrong
 * characters. A final spelling check drops any token whose range no longer
 * reads `@label` (belt and braces for ambiguous diffs).
 */
export function rebaseTokens(
	before: string,
	after: string,
	tokens: readonly MentionToken[],
): MentionToken[] {
	if (tokens.length === 0) return [];
	if (before === after) return tokens.filter((t) => spells(after, t));
	let prefix = 0;
	const max = Math.min(before.length, after.length);
	while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	)
		suffix += 1;
	const changedEnd = before.length - suffix;
	const delta = after.length - before.length;
	const kept: MentionToken[] = [];
	for (const token of tokens) {
		if (token.end <= prefix) kept.push(token);
		else if (token.start >= changedEnd)
			kept.push({
				...token,
				start: token.start + delta,
				end: token.end + delta,
			});
		// else: the edit touched this token's characters; it becomes text.
	}
	return kept.filter((t) => spells(after, t));
}

function spells(text: string, token: MentionToken): boolean {
	return text.slice(token.start, token.end) === `@${token.label}`;
}

/**
 * Backspace / Delete as ONE token: the key handler calls this before the
 * textarea's default. Returns null when the key does not touch a token, so the
 * native edit (and its undo entry) runs unchanged in the common case.
 *
 * A non-collapsed selection that overlaps a token is widened to cover the
 * whole token, so a drag-select across half a pill deletes the pill.
 */
export function deleteAcrossToken(
	text: string,
	tokens: readonly MentionToken[],
	selection: { start: number; end: number },
	key: "Backspace" | "Delete",
): MentionEdit | null {
	let { start, end } = selection;
	if (start === end) {
		const hit = tokens.find((t) =>
			key === "Backspace"
				? start > t.start && start <= t.end
				: start >= t.start && start < t.end,
		);
		if (!hit) return null;
		start = hit.start;
		end = hit.end;
	} else {
		let widened = false;
		for (const t of tokens) {
			if (t.start < end && t.end > start) {
				if (t.start < start) {
					start = t.start;
					widened = true;
				}
				if (t.end > end) {
					end = t.end;
					widened = true;
				}
			}
		}
		if (!widened) return null;
	}
	const next = text.slice(0, start) + text.slice(end);
	return { text: next, caret: start, tokens: rebaseTokens(text, next, tokens) };
}

/**
 * Keep the caret out of a token. `direction` is where it was heading (from
 * the arrow key, or the previous caret), so ←/→ step OVER a pill instead of
 * bouncing back to the edge it came from.
 */
export function clampCaret(
	tokens: readonly MentionToken[],
	caret: number,
	direction: "backward" | "forward",
): number {
	const inside = tokens.find((t) => caret > t.start && caret < t.end);
	if (!inside) return caret;
	return direction === "backward" ? inside.start : inside.end;
}

/**
 * The wire `mentions[]`: notifying tokens only, deduplicated by member
 * (kind + account, and endpoint for an agent), in first-mention order. Humans
 * never carry `endpoint_id`; an agent without one is not addressable and is
 * left out rather than sent as a row the backend refuses with a 422.
 */
export function serializeMentions(
	tokens: readonly MentionToken[],
): MentionWireRow[] {
	const seen = new Set<string>();
	const rows: MentionWireRow[] = [];
	for (const token of tokens) {
		if (!token.notify) continue;
		if (token.kind === "agent" && !token.endpointId) continue;
		const key = `${token.kind}:${token.accountId}:${token.endpointId ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push(
			token.kind === "agent"
				? {
						kind: "agent",
						account_id: token.accountId,
						endpoint_id: token.endpointId,
					}
				: { kind: "human", account_id: token.accountId },
		);
	}
	return rows;
}

/** Segments for the mirrored highlight overlay: plain runs and token runs. */
export type MentionSegment =
	| { kind: "text"; text: string }
	| { kind: "token"; text: string; token: MentionToken };

export function segmentText(
	text: string,
	tokens: readonly MentionToken[],
): MentionSegment[] {
	const segments: MentionSegment[] = [];
	let at = 0;
	for (const token of tokens) {
		if (token.start < at || !spells(text, token)) continue;
		if (token.start > at)
			segments.push({ kind: "text", text: text.slice(at, token.start) });
		segments.push({
			kind: "token",
			text: text.slice(token.start, token.end),
			token,
		});
		at = token.end;
	}
	if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
	return segments;
}
