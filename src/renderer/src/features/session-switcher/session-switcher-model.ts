/**
 * The Ctrl+Tab recent-session switcher, as decisions rather than a component.
 *
 * WHY THE RULES LIVE HERE AND NOT IN THE HOOK. The switcher is the only surface
 * in the app whose selection advances on a KEYDOWN and commits on the KEYUP of a
 * modifier, whose overlay is withheld for `SESSION_SWITCHER_REVEAL_MS` and is
 * cancelable three ways (Escape, window blur, the document going hidden). None of
 * that is reachable from this repository's node harness while it sits inside a
 * React effect, so the parts that can be decided from values are decided here and
 * `scripts/session-switcher.test.mjs` drives them for real. What stays in
 * `use-session-switcher-keys.ts` is the listener wiring and the timer.
 *
 * Design: docs/session-switcher.md. The rows are the command palette's Recents
 * ring, so the two surfaces cannot disagree about what "recent" means: the ring
 * is written by `use-conversation-recents.ts` alone, and this module only reads
 * it through `chatRecentsOfRow`, the same join the palette's pin uses.
 */

import { chatRecentsOfRow } from "@features/command-palette/use-conversation-recents";

/**
 * How many rows the overlay offers, the current conversation included.
 *
 * Five for the reason `RECENTS_PIN_CAP` (`palette-search.ts`) is five: this is
 * the same ring, the same "conversations you were just in", and a cap that
 * differed between the two doors would make the keyboard and the palette
 * remember different amounts of the same history. It is deliberately ONE number
 * per surface rather than a shared constant: the palette's cap is a statement
 * about a 384px list box, and this overlay's box is its own.
 */
export const SESSION_SWITCHER_ROW_CAP = 5;

/**
 * How long the chord has to be held before the overlay paints.
 *
 * It is measured from the CHORD's own keydown, not from the bare Control key:
 * Control alone is held for longer than 180 ms every time somebody types Ctrl+C,
 * and a switcher that appeared over that press would be a bug reported as one.
 * A tap-and-release inside the window commits the row the press already moved to
 * without ever painting, which is the whole point of the delay.
 */
export const SESSION_SWITCHER_REVEAL_MS = 180;

/** The minimum of a catalogue row this module reads. */
export type SwitcherSessionRow = {
	session_id: string;
	title?: string | null;
	archived?: boolean;
};

/**
 * One overlay row. `row` is the catalogue row when the catalogue still has one -
 * the current conversation is a row even before its row arrives (a just-created
 * session), which is what keeps "release on the current row is a no-op" true in
 * the window between the switch and the catalogue read.
 */
export type SwitcherRow<T extends SwitcherSessionRow = SwitcherSessionRow> = {
	sessionId: string;
	/** The catalogue's title, or null for "this row has none yet" - the copy is
	 * the component's, because the model does not localize. */
	title: string | null;
	row: T | null;
};

/**
 * The rows the overlay offers, in the order it draws them.
 *
 * THE CURRENT CONVERSATION IS ROW 0 AND IS NEVER FILTERED. It is on screen, so
 * it is not a candidate the archive rule is about: dropping it would make the
 * overlay start on somebody else's conversation and turn the first Ctrl+Tab into
 * a switch away from where the reader already is. The ring's ids are then walked
 * in visit order (most recent first) and each one may be skipped for the reasons
 * the palette's pin skips it - no live row (deleted, forgotten, or a ring entry
 * that outlived its conversation), or archived out of view - so the next
 * eligible id fills the slot. `chatRecentsOfRow` is the join rather than a second
 * copy of it: it is the one place a ring entry meets a catalogue row, and it
 * already owns the answered-archive-fact rule.
 */
export function buildSwitcherRows<T extends SwitcherSessionRow>(input: {
	sessions: readonly T[];
	recents: readonly string[];
	displayedSessionId: string | null | undefined;
	archiveEnabled: boolean;
	archiveFacts: Record<string, { archived: boolean; answered: boolean }>;
}): SwitcherRow<T>[] {
	const byId = new Map(input.sessions.map((row) => [row.session_id, row]));
	const displayed = input.displayedSessionId ?? null;
	const rows: SwitcherRow<T>[] = [];
	if (displayed !== null && displayed !== "") {
		const row = byId.get(displayed) ?? null;
		rows.push({ sessionId: displayed, title: titleOf(row), row });
	}
	for (const id of input.recents) {
		if (rows.length >= SESSION_SWITCHER_ROW_CAP) break;
		if (id === displayed) continue;
		const row = byId.get(id);
		if (row === undefined) continue;
		const facts = chatRecentsOfRow(
			row,
			input.recents,
			displayed,
			input.archiveEnabled,
			input.archiveFacts,
		);
		if (facts.archived) continue;
		rows.push({ sessionId: id, title: titleOf(row), row });
	}
	return rows;
}

function titleOf(row: SwitcherSessionRow | null | undefined): string | null {
	const title = row?.title?.trim();
	return title ? title : null;
}

/**
 * Where the cursor stands the moment the chord opens the run.
 *
 * `null` is a real position: "before row 0", the state of a press made with no
 * conversation on screen (a new draft, Settings, the browser route). It is what
 * makes Ctrl+Tab open on the first row and Ctrl+Shift+Tab open on the last,
 * instead of the two keys both landing on a row the reader never chose.
 */
export function initialSwitcherCursor(
	hasCurrentSession: boolean,
): number | null {
	return hasCurrentSession ? 0 : null;
}

/**
 * One press, one step, wrapping at both ends - and the opening press counts.
 *
 * The first Ctrl+Tab therefore lands on row 1 (the previous session, which is
 * what a switcher is for) and the first Ctrl+Shift+Tab on the last row (the
 * oldest of the five). Both wrap identically, because a switcher that stops at
 * an end makes the key's meaning depend on where the reader already is.
 */
export function stepSwitcherCursor(
	cursor: number | null,
	delta: 1 | -1,
	rowCount: number,
): number | null {
	if (rowCount <= 0) return null;
	if (cursor === null) return delta === 1 ? 0 : rowCount - 1;
	return (cursor + delta + rowCount) % rowCount;
}

/**
 * What a commit does: the id to open, or null to close where we are.
 *
 * A commit on the CURRENT conversation is a no-op rather than a re-open: the
 * reader asked for the session they are already in, and re-opening would cost a
 * catalogue read and move the palette's ring for nothing.
 */
export function commitSessionId(
	rows: readonly { sessionId: string }[],
	cursor: number | null,
	currentSessionId: string | null,
): string | null {
	if (cursor === null) return null;
	const target = rows[cursor];
	if (target === undefined) return null;
	if (target.sessionId === currentSessionId) return null;
	return target.sessionId;
}

/** The subset of a `KeyboardEvent` the chord reads, so a test can build one. */
export type SwitcherPressInput = {
	key: string;
	/** The physical key, the fallback the browser's own tab digits use for
	 * layouts whose backtick is not `key === "`"`. */
	code?: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
	repeat: boolean;
	isComposing?: boolean;
};

/**
 * The chord, as a step and whether the press is an auto-repeat.
 *
 * THE PHYSICAL CONTROL KEY ON EVERY PLATFORM, macOS included. `metaKey` is
 * refused on purpose: Cmd+Tab belongs to the OS application switcher and never
 * reaches this window, and a chord that meant different keys per platform would
 * be a second rule beside the app's `primary` one.
 *
 * `repeat` is returned rather than dropped: the caller must SWALLOW the repeat
 * (Chromium would move focus on a held Tab) while refusing to step, and keeping
 * that decision here is what lets the test assert both halves.
 *
 * Ctrl+` is the "back" alias (Ben's call): the same step as Ctrl+Shift+Tab. It is
 * accepted only unshifted - with Shift the same physical key is `~`, which is a
 * different key and nobody's gesture - and only where nothing else claims it,
 * which was checked when it was added: no main-process accelerator, no browser
 * chord, and the assignable grammar cannot spell punctuation at all.
 */
export function switcherPress(
	input: SwitcherPressInput,
): { delta: 1 | -1; repeat: boolean } | null {
	if (input.isComposing) return null;
	if (!input.ctrlKey || input.metaKey || input.altKey) return null;
	if (input.key === "Tab") {
		return { delta: input.shiftKey ? -1 : 1, repeat: input.repeat };
	}
	if (!input.shiftKey && (input.key === "`" || input.code === "Backquote")) {
		return { delta: -1, repeat: input.repeat };
	}
	return null;
}
