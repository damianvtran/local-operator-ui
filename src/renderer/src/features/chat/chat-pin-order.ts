import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";

/**
 * The `Pinned chats` section's DESKTOP-LOCAL manual order, as a decision rather
 * than a JSX condition.
 *
 * WHY A MODULE, and it is the reason `chat-sections.ts` beside it gives: this
 * repository's `node:test` suite cannot render the sidebar (it reads the router,
 * the canonical-sessions store and the desktop capability hooks), so an order
 * computed inline in the component is one no test can reach.
 * `scripts/sidebar-pin-order.test.mjs` drives THIS file.
 *
 * WHAT IT IS, in one sentence: a permutation of the pinned conversation ids the
 * client knows, stored with the other view preferences
 * (`ui-preferences-store.ts`'s `ui-preferences-storage`, validated on read by
 * `parseSidebarView`), applied to the Pinned section's rows and to nothing else.
 *
 * WHY THERE IS NO WIRE FIELD, and it is the whole reason this is a CLIENT
 * preference rather than a backend one: `sessions.pin` is a boolean. The TUI's
 * `★ Pinned` section and this panel read the same store, so a rank on the wire
 * would have to be written, validated and rendered by both surfaces or the two
 * would disagree about the order of one list; a rank this app keeps to itself
 * cannot disagree with anything, and it is what makes the order survive a
 * relaunch without a migration on the daemon.
 *
 * WHAT IT IS NOT: a re-sort. Nothing here orders by pin recency, by title or by
 * activity - the only order it can produce is the catalogue's own (before the
 * reader's first move) or the reader's own (after it), and rule 1 below is the
 * statement that those two are the same list when the second does not exist yet.
 *
 * THE SIX RULES, each one pinned by a test rather than described here
 * (`scripts/sidebar-pin-order.test.mjs` names them by number, so the brief, these
 * sentences and the tests cannot drift):
 *
 *   1. **No stored order, no change.** A fresh profile, or a set of pins none of
 *      which has been ranked, draws the catalogue's own order passed through.
 *      `order` therefore defaults to `[]`, and `[]` is not a state the reader can
 *      see: it is the absence of an arrangement.
 *   2. **A move moves one SHOWN place.** The move is taken over the rows on
 *      screen, so under a search filter "down" means the pinned row below the one
 *      they can see - and the stored order stays a permutation of the FULL list,
 *      because the move swaps two positions in it and never rebuilds it from the
 *      visible subset (`moveSection`'s own rule and its comment, one axis over).
 *   3. **A new pin arrives at the TOP.** An id the stored order does not know is
 *      drawn above every id it does: a pin made here a second ago, or one made in
 *      the terminal between two renders, is the most recent statement of intent
 *      the reader has made about this section, and burying it under an order
 *      written before it existed would be the panel overruling them.
 *   4. **Unpinning forgets.** An id leaves the stored order when it leaves the
 *      pinned set (`forgetPinnedOrder`), so re-pinning is a NEW pin and arrives at
 *      the top: the alternative is a slot the reader freed by unpinning, which
 *      would be invisible state they never asked to keep.
 *   5. **A boundary is a sentence, not a silence.** The two controls are drawn
 *      inapplicable at the ends (`canMovePinnedRow` is the one predicate the
 *      control's state and the press both read) and the CHORD answers with
 *      `pinMoveBoundaryNote` - "already the first pinned chat", "already the last",
 *      or "the only pinned chat" when a single row is both ends at once. A key
 *      that does nothing reads as a broken key (`project-board.tsx`'s own rule for
 *      its grip).
 *   6. **It survives a relaunch.** Not this module's to implement, and stated here
 *      because it is a rule of the change: the order is a field of the sidebar's
 *      view preference (`SidebarView.pins`), so it is written by the store's own
 *      persist middleware and re-validated on read by `parseSidebarView` -
 *      `scripts/sidebar-pin-order.test.mjs` drives that round trip through the
 *      shipped store rather than asserting it from the shape of the field.
 *
 * WHY THE ORDER IS MATERIALIZED ON THE FIRST MOVE rather than seeded when a pin
 * appears: the panel cannot know the order of pins it has not drawn yet (a pin
 * made in the terminal arrives with the next catalogue read, in whatever slot the
 * catalogue gives it), so seeding early would record an arrangement the reader
 * never made. Materializing at the press records exactly what they were looking
 * at, with their move applied.
 */

/** One step of a move: up (towards the top of the section) or down. */
export type PinMoveStep = -1 | 1;

/**
 * The order the Pinned section draws `ids` in.
 *
 * `ids` is the pinned set in the order the CALLER has it - the catalogue's own,
 * which is the order the section draws today - and the return value is that list
 * permuted by the stored order: the ids the order does not know first, each
 * unknown keeping the catalogue's position relative to the other unknowns, then
 * the ids it does know in the stored order.
 *
 * AN EMPTY OR ABSENT ORDER IS THE IDENTITY, not a special case bolted on: with
 * nothing stored every id is unknown, so the loop below returns the input
 * untouched. That is rule 1 as an arithmetic consequence rather than as a branch
 * somebody has to remember to keep.
 *
 * AN ORDER ENTRY THE CALLER DOES NOT HAVE IS DROPPED, which is what bounds the
 * stored array: an id unpinned here is removed at the press
 * (`forgetPinnedOrder`), and one unpinned in the terminal or deleted outright is
 * dropped by the first materialization after the client notices. An absent id is
 * not a claim about a row.
 */
export function pinnedOrder(
	ids: readonly string[],
	order: readonly string[],
): string[] {
	const known = new Set(ids);
	const placed = new Set<string>();
	const out: string[] = [];
	for (const id of ids) {
		if (order.includes(id) || placed.has(id)) continue;
		out.push(id);
		placed.add(id);
	}
	for (const id of order) {
		if (!known.has(id) || placed.has(id)) continue;
		out.push(id);
		placed.add(id);
	}
	return out;
}

/**
 * The rows in that order - the section's own call, so the render and the model
 * cannot disagree about which ids are drawn (`pinnedOrder` is the one rule both
 * read).
 */
export function orderPinnedRows<T extends CanonicalSessionRow>(
	rows: readonly T[],
	order: readonly string[],
): T[] {
	const byId = new Map(rows.map((row) => [row.session_id, row]));
	const out: T[] = [];
	for (const id of pinnedOrder(
		rows.map((row) => row.session_id),
		order,
	)) {
		const row = byId.get(id);
		if (row !== undefined) out.push(row);
	}
	return out;
}

/**
 * Whether a move of `id` by one place would land on a row.
 *
 * The predicate the two controls are drawn from and the one the move itself is
 * taken under, so a control that is not offered and a press that does nothing are
 * the same fact (`canMoveSection`'s shape, one axis over: a move that cannot
 * happen is a press with nothing to describe).
 */
export function canMovePinnedRow(
	shownIds: readonly string[],
	id: string,
	direction: PinMoveStep,
): boolean {
	const at = shownIds.indexOf(id);
	if (at < 0) return false;
	return shownIds[at + direction] !== undefined;
}

/**
 * The stored order a move writes, or null when the press cannot move anything.
 *
 * `shownIds` is the DRAWN order (the caller's `pinnedOrder` output), because "up"
 * has to mean the row above the one on screen; `knownIds` is every pinned id the
 * client can address, which is what keeps a hidden id's slot in the stored list
 * when a filter is in force. The two are unioned rather than trusted to nest, and
 * that is not defensive padding: a search answer can carry a pinned row this
 * client's page does not (`chat-search.ts`'s synthesised hits), so an id the
 * panel is drawing but `knownIds` has never heard of must still be addressable -
 * otherwise the first move under a search would drop the row being moved.
 *
 * THE EXTRAS GO FIRST IN THAT UNION, and that is the drawn order rather than a
 * convention: an id `knownIds` does not hold is an id the stored `order` does not
 * hold either, and rule 3 draws those at the TOP of the section. So the union
 * reads `[...extras, ...knownIds]`, the extras keeping the order the caller drew
 * them in - seeding them last would put the row the reader is looking at at the
 * BOTTOM of the first materialized arrangement, and the first move would then
 * splice the arrangement with itself (measured: `a` moved up by one and landed
 * last).
 *
 * THE MOVE IS A SWAP OF TWO POSITIONS in that materialized permutation, never a
 * splice: everything the move did not name keeps the array index it had, which is
 * what "the stored order stays a permutation of the full list" means concretely.
 * A splice would shift every entry between the two rows, so a hidden id would
 * drift one place per press in the state (a search) where the reader cannot see
 * it happen.
 */
export function movePinnedOrder(
	knownIds: readonly string[],
	order: readonly string[],
	shownIds: readonly string[],
	id: string,
	direction: PinMoveStep,
): string[] | null {
	const at = shownIds.indexOf(id);
	if (at < 0) return null;
	const target = shownIds[at + direction];
	if (target === undefined) return null;
	const addressable = [
		...shownIds.filter((entry) => !knownIds.includes(entry)),
		...knownIds,
	];
	const base = pinnedOrder(addressable, order);
	const from = base.indexOf(id);
	const to = base.indexOf(target);
	/*
	 * The two indexes cannot be -1 - `base` is a permutation of `addressable`, and
	 * both ids come from `shownIds`, which is part of it - but the guard is the
	 * difference between returning null and writing an array property at index -1,
	 * which is a silent change to an object that is not a list. A caller that
	 * cannot address a row is told so.
	 */
	if (from < 0 || to < 0) return null;
	const next = [...base];
	next[from] = target;
	next[to] = id;
	return next;
}

/**
 * The order after an id leaves the pinned set (rule 4).
 *
 * A no-op when the id was never ranked, so the common unpin (of a pin nobody has
 * moved) writes no preference at all: the caller compares the lengths and skips
 * the store write it would otherwise make on every unpin.
 */
export function forgetPinnedOrder(
	order: readonly string[],
	id: string,
): string[] {
	return order.includes(id)
		? order.filter((entry) => entry !== id)
		: [...order];
}

/**
 * What the live region says after a move landed.
 *
 * `position` is zero-based and said one-based, the way `project-board.tsx` says
 * its own move ("Moved QA column to position 2 of 3."): the reader counts rows,
 * not array indices. The count is the SHOWN pinned rows, because the position the
 * reader can check by looking is the one they see.
 */
export function pinMoveNote(
	label: string,
	position: number,
	total: number,
): string {
	return `Moved “${label}” to position ${position + 1} of ${total}.`;
}

/**
 * What the live region says when the press could not land.
 *
 * The chord is answerable at a boundary where the control is drawn inapplicable,
 * and silence there is the failure `project-board.tsx` calls out for its own
 * grip: a key that does nothing reads as a broken key rather than as a row that
 * is already where the reader asked it to go. `position` therefore decides WHICH
 * boundary is being described, and the caller only reaches this when the move
 * cannot happen - a single pinned row is both boundaries at once, which is why
 * "the only pinned chat" is its own sentence rather than "the first" or "the
 * last".
 */
export function pinMoveBoundaryNote(
	label: string,
	position: number,
	total: number,
): string {
	if (total <= 1) return `“${label}” is the only pinned chat.`;
	if (position <= 0) return `“${label}” is already the first pinned chat.`;
	return `“${label}” is already the last pinned chat.`;
}

/**
 * The attribute each move control carries, so a scene can find them and so the
 * pair cannot be spelled twice.
 *
 * THEY ARE DELIBERATELY NOT `data-chat-row`, and that is the row's own rule
 * rather than a new one: the arrow walk collects that attribute and focuses what
 * it finds, so a control wearing it would join the ring the rows share and become
 * a second Tab stop per row - the regression §C4's chord exists to avoid.
 */
export const CHAT_PIN_MOVE_ATTR = {
	up: "data-session-move-up",
	down: "data-session-move-down",
} as const;

/**
 * The chord: `⌘⇧↑` / `⌘⇧↓` on macOS, `Ctrl+Shift+↑` / `Ctrl+Shift+↓` elsewhere.
 *
 * WHY IT IS SHARED WITH THE PIN'S SHAPE (`chatRowAct`'s modifier set exactly): a
 * modified key is somebody's chord rather than a character, so it passes through
 * the list's type-to-filter branch untouched, and the sidebar's own arrow walk
 * refuses it because that walk reads a BARE arrow key. WHAT IT MUST NOT COLLIDE
 * WITH, checked in the two places the free keys are declared: the region walk
 * (`chat-regions.ts`) takes `⌘⌥↓`/`⌘⌥↑` and is refused here by `altKey`, the row's
 * acts (`⌘⇧P`/`⌘⇧A`) are letters, the transcript's paging keys are bare, and the
 * app's own document chords are `⌘N`, `⌘B`, `⌘P`/`⌘K` and `⌘O` - none is a
 * shifted arrow. The arrow is what makes the pair readable as "move this row",
 * which is the whole of what it does.
 */
export const chatPinMoveChord = (event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): PinMoveStep | null => {
	if (!(event.metaKey || event.ctrlKey)) return null;
	if (!event.shiftKey || event.altKey) return null;
	if (event.key === "ArrowUp") return -1;
	if (event.key === "ArrowDown") return 1;
	return null;
};

/**
 * The chord's own spelling, so the cap a control prints and the handler that
 * answers it cannot drift (`chatRowActCap`'s reason).
 */
export const chatPinMoveCap = (step: PinMoveStep, isMac: boolean): string => {
	const key = step === -1 ? "↑" : "↓";
	return isMac ? `⌘⇧${key}` : `Ctrl+Shift+${key}`;
};

/** The attribute one step's control carries. */
export const chatPinMoveAttr = (step: PinMoveStep): string =>
	step === -1 ? CHAT_PIN_MOVE_ATTR.up : CHAT_PIN_MOVE_ATTR.down;

/**
 * The control a chord should press, or null when the row does not offer it.
 *
 * THE CHORD PRESSES THE CONTROL rather than calling the move itself, which is
 * `chatRowActControl`'s rule for the row's two acts and for the same reason: the
 * press the keyboard makes then takes the SAME path a press on the control takes
 * - the repeat-press guard, the boundary announcement and the caret correction
 * all included - and the two paths cannot drift.
 *
 * The search starts at the row's BOX (`[data-session-row]`) rather than at the
 * element the press landed on, because the controls are siblings of the row's
 * button and the reader's focus is usually on that button: `closest` is what
 * makes a press anywhere inside the row find them.
 *
 * A row that offers no move (an unpinned row, or one drawn by the grouped
 * arrangement) answers null, and the caller then leaves the press alone - which is
 * what a chord with no target on this row should do.
 */
export const chatPinMoveControl = (
	target: EventTarget | null,
	step: PinMoveStep,
): HTMLElement | null => {
	const element = target as {
		closest?: (selector: string) => Element | null;
	} | null;
	if (typeof element?.closest !== "function") return null;
	const row = element.closest("[data-session-row]");
	return row?.querySelector<HTMLElement>(`[${chatPinMoveAttr(step)}]`) ?? null;
};
