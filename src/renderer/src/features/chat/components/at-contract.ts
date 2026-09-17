import type { AtSpan } from "./at-token";

/**
 * The `@` list's contract, pure and I/O-free: what a key means, the row budget,
 * the copy, where an atomic delete cuts, and which tokens are chips.
 *
 * WHY this is a module rather than three closures inside the component, in the
 * words `slash-contract.ts` used for its own: the browser harness cannot dispatch
 * key events, so "Enter applies the row", the row budget's arithmetic and the
 * atomic Backspace were all unverifiable when they lived inside a component — a
 * decision stated as a pure function of the state can be bundled and executed as
 * the code the app ships, which is what `scripts/at-mentions.test.mjs` does.
 *
 * The row type is structural on purpose, exactly as `RoutableRow` is: `AtRow`
 * lives in `at-rank.ts`, which this module imports for nothing, so anything with
 * the same shape satisfies it.
 */

/**
 * The row pitch, in px: `py-2` (16) plus the row's `text-body-sm` line box.
 *
 * 35.5 AND NOT 36, and the difference is a live measurement rather than
 * arithmetic (QA round 1, Q-1). `text-body-sm` is `0.8125rem` (13px) at
 * `line-height: 1.5`, i.e. a **19.5px** line box, so a row measures 16 + 19.5 =
 * 35.5 at every window size — measured on the region's own rows in the built app
 * at both 1380x872 and 800x600 (`distinctRowHeights: [35.5]`, every row, both
 * sizes). The constant used to say 36 on the belief that the line box was 20px,
 * and the region's cap is `budget * AT_ROW_PITCH`: eight rows were capped at
 * 288px over rows that occupy 284px, so the region painted **4.0px** of a ninth
 * row — `budget x 0.5px`, i.e. the constant rather than the layout, which is what
 * made it a single-number fix. The sliver was the clipped row's own top padding,
 * so no glyph was cut at these budgets; it is the failure mode the constant
 * exists to prevent all the same, and it is worse when the clipped row is the
 * highlighted one, whose 2px accent bar then starts below the last whole row.
 */
export const AT_ROW_PITCH = 35.5;

/**
 * The picker's header and footer strips, both `py-1` + `text-meta`, plus the
 * shell's two 1px edges: 25.4 + 25.4 + 2. Named because the row budget below is
 * an arithmetic property of it, and a strip that grew would otherwise be a
 * budget that silently overflows.
 */
export const AT_CHROME_PX = 25.4 + 25.4 + 2;

/** The popup's own `mb-1`: the gap it keeps from the box it anchors above. */
export const AT_ANCHOR_GAP_PX = 4;

/**
 * The floor and ceiling of the visible row count.
 *
 * 8 because the harness's own `@` picker uses `MAX_VISIBLE_ROWS = 8`, so the two
 * surfaces agree; 3 so the picker is never a stub that shows fewer rows than the
 * space obviously allows. Both are the design direction's numbers rather than a
 * taste call: the ceiling is the cross-surface agreement, the floor is the
 * smallest list that still reads as a list.
 */
export const AT_ROWS_MIN = 3;
export const AT_ROWS_MAX = 8;

/**
 * How many rows the region may show, MEASURED rather than stated.
 *
 * The popup is `absolute bottom-full` and unportaled, so its height is spent out
 * of the space between its anchor and whatever clips — least on an empty chat at
 * the app's minimum window. A cap in px cannot be aligned to a row by
 * construction (`suggestion-stack.ts` states the argument and the measured
 * defect it fixed), so the region's max-height is a whole multiple of
 * `AT_ROW_PITCH` computed from the two numbers the caller measured.
 *
 * `anchorTop` is the popup's own anchoring wrapper's viewport top (`bottom-full`
 * puts the shell's bottom edge `AT_ANCHOR_GAP_PX` above it), and `clipTop` is the
 * top edge of the nearest vertical clipping ancestor. A `clipTop` that cannot be
 * found is the viewport's top, which is the honest answer rather than a guess at
 * a bound nobody measured.
 */
export function atRowBudget(anchorTop: number, clipTop: number): number {
	const room = anchorTop - AT_ANCHOR_GAP_PX - clipTop - AT_CHROME_PX;
	const rows = Math.floor(room / AT_ROW_PITCH);
	return Math.max(AT_ROWS_MIN, Math.min(AT_ROWS_MAX, rows));
}

/** What a key does to the list. `pass` hands the event back to the composer. */
export type AtKeyIntent =
	/**
	 * Move the marker to `index`. `moved` is false when the key clamped onto the
	 * row the marker was already on — the same distinction `slashKeyIntent` keeps,
	 * because "the marker moved" is a choice and "the key asked to move and could
	 * not" is not.
	 */
	| { kind: "move"; index: number; moved: boolean }
	/** Apply `rows[index]`. */
	| { kind: "apply"; index: number }
	/**
	 * The list is open and holds no row, and this key must not reach the composer.
	 *
	 * WHY IT IS A THIRD ANSWER rather than a `pass`. Enter over an open list is the
	 * user saying "take this row", and the composer's own Enter SUBMITS the draft.
	 * With no row to take, `pass` handed the key straight to the submit path: on any
	 * listing that failed or matched nothing — which is every `@` on the picker's
	 * own failed state — the first `@…`+Enter a new user presses SENT their message
	 * instead of referencing a file, with `esc closes` as the only thing on screen
	 * saying otherwise. Swallowing it is the honest answer: the sentence is still
	 * being written, the list is visibly up, and Escape is the way back to the
	 * composer's own meaning for the key.
	 */
	| { kind: "hold" }
	| { kind: "close" }
	| { kind: "pass" };

export type AtKeyInput = {
	key: string;
	/** IME composition in flight: Enter belongs to the composition, not the list. */
	composing: boolean;
	open: boolean;
	active: number;
	count: number;
};

/**
 * Route one key press over the `@` list.
 *
 * WHAT IT COPIES FROM `slashKeyIntent`, and what it deliberately does NOT:
 *
 *   - Copied: arrows clamp rather than wrap, Enter and Escape are the two acting
 *     keys, an IME composition owns its own Enter, and a closed list passes
 *     every key through.
 *   - NOT copied: the ambiguity gate and the extend-to-common-prefix gesture. Both
 *     exist because Enter on a COMMAND row may RUN it, so a reflex second
 *     keystroke could start work — `/lo` highlights `loop` while `login` and
 *     `logout` also match. Writing a path has no blast radius at all: the token
 *     is text, and the worst an unambiguous-free Enter can do is insert a path the
 *     user is looking at. So Enter and Tab both apply the highlighted row,
 *     unconditionally, and there is nothing to extend to.
 *   - NOT copied: `run`. There is no second meaning for the key here — the
 *     composer's own Enter submits, and this list only ever writes a token.
 *
 * Tab is included with Enter for the same reason it is the completion key in both
 * slash phases (`editor.py:3259`): it takes the highlighted row and never runs.
 * Here "never runs" is not a distinction from Enter, so the two are one case.
 *
 * WHAT THEY DO NOT SHARE is the empty list. Enter is the composer's SUBMIT, so an
 * Enter with no row to take must be held (see `hold`); Tab's own meaning is a
 * focus move, which claims nothing about a file, so it still passes through and
 * the composer's Tab ladder is untouched.
 */
export function atKeyIntent(input: AtKeyInput): AtKeyIntent {
	if (!input.open) return { kind: "pass" };
	if (input.composing) return { kind: "pass" };
	switch (input.key) {
		case "ArrowDown": {
			const index = Math.min(input.active + 1, input.count - 1);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "ArrowUp": {
			const index = Math.max(input.active - 1, 0);
			return { kind: "move", index, moved: index !== input.active };
		}
		case "Enter":
			return input.count > 0 && input.active < input.count
				? { kind: "apply", index: input.active }
				: { kind: "hold" };
		case "Tab":
			return input.count > 0 && input.active < input.count
				? { kind: "apply", index: input.active }
				: { kind: "pass" };
		case "Escape":
			return { kind: "close" };
		default:
			return { kind: "pass" };
	}
}

/**
 * A row's DOM identity, for the listbox ids and `aria-activedescendant`.
 *
 * One definition, used both by the ids the popup renders and by the candidate-set
 * key below, because two derivations is how the reviewed helper and the shipped
 * component came to disagree about a row's identity in the slash popup's own
 * round 2 (`slash-contract.ts:rowId`). A path carries `/` and `.`; the first is
 * not legal in an id without escaping, so everything outside `[\w.-]` becomes
 * `_`.
 */
export function atRowId(row: { path: string }): string {
	return `at-${row.path.replace(/[^\w.-]/g, "_")}`;
}

/** Identity of a candidate SET: the rows, in order, by rendered id. */
export function atCandidateKey(rows: readonly { path: string }[]): string {
	return rows.map(atRowId).join("\n");
}

/**
 * The footer's left line, read off the ACTIVE ROW.
 *
 * The slash popup reads its footer off the active row so the key and the row
 * cannot describe different things, and this list has the same need in a
 * stronger form: Enter means two different things depending on whether the row is
 * a file or a directory, and the ONLY place that difference is visible is the
 * line naming what will be written. The token it names is the token the pick
 * writes (`atReference`), so the sentence cannot promise a different string from
 * the one Enter inserts.
 *
 * With no active row — a listing that failed, or a query that matched nothing —
 * the Escape clause stands alone. The line is there to say what a key will do,
 * and there is no row for Enter to act on; promising "inserts" over a notice row
 * is exactly the class of lie this repository's copy tables exist to prevent.
 * Enter is HELD in that state rather than passed to the submit
 * (`atKeyIntent`), so the clause is also the whole truth about the key: nothing
 * will be sent, and Escape is the way back to the composer's own Enter.
 *
 * "Enter"/"Esc" are capitalised because they name KEYS. The slash popup in the
 * same slot over the same field reads `Enter needs a row you pick: ↓ then Enter`,
 * and two lists over one caret disagreeing about how a key is spelled is one
 * register too many (design round 1, D5).
 */
export function atFooter(
	row: { path: string; directory: boolean } | undefined,
): string {
	if (!row) return "Esc closes";
	const verb = row.directory
		? `Enter opens ${row.path}`
		: `Enter inserts ${atFooterToken(row.path)}`;
	return `${verb} · Esc closes`;
}

/** The token a footer line names: the write minus the space that closes it. */
function atFooterToken(path: string): string {
	return path.includes(" ") ? `@"${path}"` : `@${path}`;
}

/**
 * The footer's right column: how much of the listing the reader can see.
 *
 * The one fact a scrolled list cannot show, which is why it takes the reference's
 * right-aligned column. `m` is the number of ENTRIES the listing holds rather
 * than the number of rows drawn, so the pair answers the question the reader
 * actually has — "am I looking at everything?" — including when a query has
 * filtered most of a directory away. `undefined` when the two agree, because a
 * column that says `37 of 37` on every listing is chrome.
 *
 * `shown` IS THE ROWS THE REGION DRAWS, NOT THE ROWS THE QUERY MATCHED, and the
 * difference is the whole of design round 1's D3. It used to be handed the
 * matched count, which is the same number until the region SCROLLS — and there it
 * is the wrong one: a ten-entry listing capped at seven rows drew seven and
 * reported `undefined`, because `matched (10) >= entries (10)`. The column was
 * therefore absent in exactly the two long-list states § 3.2 wrote it for, with
 * no scrollbar at rest in this shell either, so the reader had no signal at all
 * that anything sat below the fold.
 */
export function atCount(shown: number, entries: number): string | undefined {
	if (entries <= 0 || shown >= entries) return undefined;
	return `${shown} of ${entries}`;
}

/**
 * The honest sentence for a list with no rows, from the four different facts that
 * produce one.
 *
 * The order is the slash popup's (`argumentEmptyCopy`): a failure first, then the
 * wait, then the two empty states — and the last two are DIFFERENT FACTS, which
 * is the whole reason this function exists. An empty folder and a query that
 * matched nothing are not the same event, and the harness's own review asks for
 * exactly that split ("the fix is to hold a notice row, which would also let the
 * copy distinguish 'this directory is empty' from 'nothing here matches zz'").
 * The query is quoted because a bare `No files match zz.` reads as a statement
 * about files rather than about what was typed, and the SCOPE is named for the
 * same reason one step further out (UX round 1, U6): a user who knows the file
 * name and not the directory it lives in was told only that nothing matched, with
 * no statement of WHERE the search looked — while the header above said `./` and
 * said nothing about it being the thing searched. `in ./` ties the two together.
 *
 * WHY IT NAMES THE SCOPE AND NOT THE GESTURE. "type / to look inside a folder"
 * was the other half of that finding, and it does not fit: the notice is a
 * ONE-ROW region (36px, a measured number in § 3.2), so a sentence long enough to
 * wrap turns the picker's own height into a function of the copy — and the row
 * that holds this one is the row that keeps the band still.
 *
 * AN UNREADABLE FOLDER IS TRANSLATED, not quoted (design round 1's D4 and UX
 * round 1's U5). The row used to read `Could not read this folder. EACCES:
 * permission denied, scandir '/private/…/secret-dir/'` — an errno, a syscall and
 * an absolute internal path in the one sentence a user reads when something is
 * wrong, and no next step. § 8 asks an error to say what happened, what it means
 * and what to do; the sibling popup's own error row in this same slot reads
 * `Could not read the model catalogue.`, which is the register. The raw detail is
 * NOT lost: it is what the caller logs (`use-at-picker.ts`), because a console is
 * where a syscall belongs.
 */
export function atEmptyCopy(state: {
	error?: string | null;
	loading: boolean;
	entries: number;
	matched: number;
	query: string;
	/** The directory being listed, as the header spells it (`./`, `src/`). */
	scope: string;
}): string {
	if (state.error) return unreadableCopy(state.error);
	if (state.loading && state.entries === 0) return "Reading this folder…";
	if (state.entries === 0) return "This folder is empty.";
	if (state.matched === 0)
		return `No files match "${state.query}" in ${state.scope}.`;
	// Unreachable while the caller renders a notice only when it has no rows, and
	// stated rather than left undefined so a future caller that asks anyway gets a
	// sentence instead of an empty div.
	return "This folder is empty.";
}

/*
 * The two errno families the listing can produce, at module scope because a
 * regex literal inside a function is allocated on every call and this one runs on
 * the picker's keystroke path (biome's `useTopLevelRegex`).
 */
const PERMISSION_ERRNO = /\bEACCES\b|\bEPERM\b/;

/**
 * The user's terms for a failure the IPC reported in its own.
 *
 * Two sentences rather than one, because the two causes have different next
 * steps: a permission this app does not have is not something the user can fix by
 * checking a path, and a folder that vanished while the picker was open is not
 * something a permission change would reach. `EACCES`/`EPERM` and the
 * missing-entry family are the two the listing can actually produce; anything
 * else gets the sentence that asks the user to look at the path, which is the
 * only advice that is true of an unknown failure.
 */
export function unreadableCopy(error: string): string {
	if (PERMISSION_ERRNO.test(error))
		return "Could not read this folder. It may need a permission this app does not have.";
	return "Could not read this folder. Check that it exists and that you can open it.";
}

/**
 * The chip span an atomic Backspace or Delete removes, or `null`.
 *
 * The design's promise, and the place it stops, both fall out of the chip having
 * no state of its own: the decoration is derived from the field's value, so the
 * only thing an atomic delete needs is to know which derived span the caret is
 * sitting on the edge of.
 *
 *   - `back` requires the caret exactly at the span's END; `forward` requires it
 *     exactly at the START. A caret one cell inside is a caret inside the token,
 *     which edits ordinary characters by the browser's own rules and stops being
 *     a chip the moment the remainder stops resolving.
 *   - `resolved` is the map of spans that ARE chips, because the atomic gesture is
 *     a property of the chip and not of the grammar: a hand-typed `@src/ap.py`
 *     that names nothing is prose, and Backspace at its end must delete one
 *     character like any other text.
 *   - A caret on the SEPARATOR is not on the token: with `@a.py ` typed the token
 *     is closed, the caret is after the space, and Backspace deletes the space.
 *     Two keystrokes rather than one, and neither deletes anything invisible.
 */
export function atDeleteSpan(
	caret: number,
	direction: "back" | "forward",
	spans: readonly { start: number; end: number }[],
	resolved: ReadonlyMap<string, unknown>,
): { start: number; end: number } | null {
	for (const span of spans) {
		if (!resolved.has(atSpanKey(span))) continue;
		if (direction === "back" && span.end === caret) return span;
		if (direction === "forward" && span.start === caret) return span;
	}
	return null;
}

/** A span's key in the resolved set: `start:end`, the span itself. */
export function atSpanKey(span: { start: number; end: number }): string {
	return `${span.start}:${span.end}`;
}

/** One token's fact, as the two consumers need it. */
export type AtResolved = { outside: boolean };

/**
 * The token spans that ARE chips, from the probe's answers.
 *
 * Pure and exported so the rule can be executed by `scripts/at-mentions.test.mjs`
 * rather than read: a token is a chip when the path it names EXISTS — a bare `@`,
 * a path with a typo and a token that is prose all stay plain text, which is the
 * one place this surface can close a gap the terminal cannot, since the harness
 * sends an unresolved token verbatim and silently.
 */
export function atChipSpans(
	spans: readonly AtSpan[],
	facts: ReadonlyMap<string, { exists: boolean; outside: boolean }>,
): Map<string, AtResolved> {
	const chips = new Map<string, AtResolved>();
	for (const span of spans) {
		const fact = facts.get(span.path);
		if (!fact?.exists) continue;
		chips.set(atSpanKey(span), { outside: fact.outside });
	}
	return chips;
}
