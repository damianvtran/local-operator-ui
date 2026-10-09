/**
 * The right slot's per-conversation memory (issue #894), as pure data.
 *
 * WHY THIS IS A MODULE OF ITS OWN. The store's four durable flags used to be the
 * window's: one global boolean each, so a canvas opened for one conversation
 * followed the user into the next one. The inversion makes each conversation
 * remember its own occupant, and the remembering is a small algebra — put an
 * entry, drop one, carry one across an identity flip, project the active
 * conversation's entry onto the flags, keep the list bounded and clean. That
 * algebra is inert, DOM-free and therefore exercisable without React or a
 * browser, which is why it lives here rather than inline in the store's
 * `set()` callbacks: a rule that only exists inside a `set()` can be exercised
 * only by mounting the whole store (the same argument `persistedUiPreferences`
 * and `pushProfileRecent` make for their own extraction).
 *
 * THE SHAPE, stated once because three modules agree on it:
 *
 * - an entry is a `[key, pane]` PAIR, and the key is a conversation identity —
 *   a session id, or a `draft:<uuid>` key for a draft that has no session yet;
 * - there is at most ONE entry per key, newest LAST (the array is an LRU by
 *   last write, and the cap drops from the front);
 * - a CLOSED pane is the ABSENCE of an entry. There is deliberately no stored
 *   "closed" value: a conversation with no entry opens with no panel, and a
 *   stored "closed" would be a second way to say the same thing that the two
 *   writers (a close, and the cap's eviction) could disagree about;
 * - `draft:` entries live in the in-memory list only — see `isDraftMemoryKey`
 *   and `memorySanitize` — because a draft is a launch's own row (the canonical
 *   store re-mints a fresh draft key per launch), so persisting one would
 *   restore a panel onto a row that no longer exists.
 */

/**
 * The four DURABLE occupants of the right slot, by their short name.
 *
 * `"ask"` is deliberately NOT a member: the asks drawer is a transient overlay
 * that BORROWS the slot and gives it back (see `isAskDrawerOpen` in the store),
 * so it is never remembered and never written to a conversation's entry.
 */
export type MemoryPane = "canvas" | "run" | "browser" | "console";

/** One remembered occupant: the conversation's key, and the pane it holds. */
export type RightSlotMemoryEntry = readonly [string, MemoryPane];

/** The memory list, newest last. See the module note for the shape's rules. */
export type RightSlotMemory = ReadonlyArray<RightSlotMemoryEntry>;

/**
 * How many conversations a profile remembers.
 *
 * A bound the profile cannot grow past, the way `turn-collapse-open.ts` bounds
 * the reader's expanded turn summaries (`MAX_SESSIONS`). 64 pairs serialise to
 * well under a kilobyte of a session id plus a pane name each — the reason the
 * number is generous rather than tight is that the cost is bytes while the
 * failure of a too-tight cap is a panel the user remembers opening and the app
 * has forgotten.
 */
export const RIGHT_SLOT_MEMORY_CAP = 64;

/**
 * The slot's precedence order — canvas, run, browser, console — as the migration
 * and the projections read it.
 *
 * ONE SPELLING OF THE ORDER, shared with `activeRightSlotPane`'s reading of the
 * flags: two orders would be two answers to "which pane is up?" for a blob that
 * somehow carries two, which is exactly the drift the store's single derivation
 * exists to prevent.
 */
export const MEMORY_PANES: ReadonlyArray<MemoryPane> = [
	"canvas",
	"run",
	"browser",
	"console",
];

/**
 * Which flag each pane's claim owns, keyed by the short name this module uses.
 *
 * The store's own `DURABLE_PANE_FLAG` holds the same correspondence from the
 * flag side; this map is what lets the projection below be written without the
 * store's vocabulary, so the pure module stays free of the store's types.
 */
const PANE_FLAG: Record<MemoryPane, string> = {
	canvas: "isCanvasOpen",
	run: "isRunPanelOpen",
	browser: "isBrowserPaneOpen",
	console: "isConsolePaneOpen",
};

/** Whether a value is one of the four remembered panes. */
export function isMemoryPane(value: unknown): value is MemoryPane {
	return (
		typeof value === "string" &&
		(MEMORY_PANES as ReadonlyArray<string>).includes(value)
	);
}

/**
 * Whether a key names a DRAFT rather than a conversation.
 *
 * The canonical store mints drafts as `draft:<uuid>` (and `draft:<kind>:<name>`
 * for an agent/team-keyed row), and a fresh launch re-mints them, so a
 * `draft:` entry is a fact about this launch only. That is why the persistence
 * filter drops them (`persistedUiPreferences`) and why the hydrating sanitizer
 * drops them too: a restored draft key names a row the next launch does not
 * have.
 */
export function isDraftMemoryKey(key: string): boolean {
	return key.startsWith("draft:");
}

/**
 * The pane a conversation remembers, or undefined when it remembers nothing.
 *
 * The last entry for the key wins, which cannot matter for a list the writers
 * keep deduped (`memoryPut`) and the reader keeps deduped (`memorySanitize`) —
 * but reading back-to-front is what makes "newest last" the rule even for a
 * list that reached this function by some other route.
 */
export function memoryRead(
	memory: RightSlotMemory,
	key: string,
): MemoryPane | undefined {
	for (let index = memory.length - 1; index >= 0; index -= 1) {
		const entry = memory[index];
		if (entry[0] === key) return entry[1];
	}
	return undefined;
}

/** The list held to the cap, dropping its oldest entries first. */
function withCap(memory: RightSlotMemory): RightSlotMemory {
	return memory.length > RIGHT_SLOT_MEMORY_CAP
		? memory.slice(memory.length - RIGHT_SLOT_MEMORY_CAP)
		: memory;
}

/**
 * Write a conversation's occupant, moving the key to the newest end.
 *
 * The existing entry for the key goes first: one entry per key is the shape's
 * invariant, and a write is a MOVE rather than a second row, so a conversation
 * the user has just switched to cannot appear twice in the LRU.
 */
export function memoryPut(
	memory: RightSlotMemory,
	key: string,
	pane: MemoryPane,
): RightSlotMemory {
	return withCap([
		...memory.filter(([entryKey]) => entryKey !== key),
		[key, pane],
	]);
}

/**
 * Drop a conversation's entry, but ONLY when it is the pane being closed.
 *
 * The guard is the whole reason this is a function rather than a filter at the
 * call site: a close is about the pane the user is looking at, and a delayed or
 * duplicated close (a remount's unmount handler, a route teardown) must not
 * delete an entry another writer has since replaced with a different pane. The
 * list is returned UNCHANGED (by identity, so the store can skip the write) when
 * the entry is not this pane's or is not there at all.
 */
export function memoryRemove(
	memory: RightSlotMemory,
	key: string,
	pane: MemoryPane,
): RightSlotMemory {
	if (memoryRead(memory, key) !== pane) return memory;
	return memory.filter(([entryKey]) => entryKey !== key);
}

/**
 * Carry a conversation's memory from one key to another — draft admission.
 *
 * At admission the draft's row learns its session id and the pane's identity
 * flips `draft:<uuid>` -> `<sessionId>` in the same synchronous step (the
 * canonical store patches the row, `panelIdentityOfView` moves the key), so the
 * entry has to move with it or the panel the user opened while drafting would
 * close on the remount that follows. The source key is deleted, not copied: the
 * draft row is gone from the roster and a stale entry under a key nothing can
 * reach again is only a slot the cap will evict too late.
 *
 * A source with no entry returns the list unchanged — admission is not a reason
 * to invent a panel for a conversation the user never opened one on.
 */
export function memoryCarry(
	memory: RightSlotMemory,
	from: string,
	to: string,
): RightSlotMemory {
	const pane = memoryRead(memory, from);
	if (pane === undefined) return memory;
	return withCap([
		...memory.filter(([key]) => key !== from && key !== to),
		[to, pane],
	]);
}

/** The four flags a conversation's memory projects onto. */
export type RightSlotFlagProjection = {
	isCanvasOpen: boolean;
	isRunPanelOpen: boolean;
	isBrowserPaneOpen: boolean;
	isConsolePaneOpen: boolean;
};

const NO_PANE_OPEN: RightSlotFlagProjection = Object.freeze({
	isCanvasOpen: false,
	isRunPanelOpen: false,
	isBrowserPaneOpen: false,
	isConsolePaneOpen: false,
});

/**
 * The flags the active conversation's memory means — the live projection.
 *
 * ALL FOUR FALSE while the asks drawer is open, and that is the drawer's
 * precedence rather than a detail of this reader: the drawer BORROWS the slot
 * (the store's `claimRightSlot` writes the same four false when it opens), so a
 * switch under an open drawer must not light a durable pane the drawer is
 * covering. The memory itself is untouched — closing the drawer re-projects it
 * — which is what makes the borrow transient and the memory durable.
 *
 * `null` is bound-no-conversation and `undefined` is an UNBOUND store; both are the
 * same answer here — nothing to project, so nothing
 * opens. That
 * is the state a launch on a route with no conversation reaches,
 * and the honest answer is the empty slot the decision record asks for, never
 * a pane remembered for some other conversation.
 */
export function memoryProject(
	memory: RightSlotMemory,
	key: string | null | undefined,
	askDrawerOpen: boolean,
): RightSlotFlagProjection {
	if (askDrawerOpen || typeof key !== "string") return NO_PANE_OPEN;
	const pane = memoryRead(memory, key);
	if (pane === undefined) return NO_PANE_OPEN;
	return {
		isCanvasOpen: pane === "canvas",
		isRunPanelOpen: pane === "run",
		isBrowserPaneOpen: pane === "browser",
		isConsolePaneOpen: pane === "console",
	};
}

/**
 * A stored list read back into the shape above — the hydrate-side sanitizer.
 *
 * THE STORE'S DISK IS NOT A TRUSTED INPUT: it is `localStorage`, so it survives
 * a downgrade, a hand edit and a half-written blob, and the rules here are the
 * ones a value from it has to meet to become memory:
 *
 * - an entry is a two-element array, a non-empty STRING key and one of the four
 *   panes; anything else is dropped rather than coerced (a coerced key is a
 *   conversation nobody can reach, and a coerced pane is a flag the store would
 *   have to answer for);
 * - ONE entry per key, last wins (the list's own invariant, restored);
 * - `draft:` keys are dropped — see `isDraftMemoryKey`;
 * - at most `RIGHT_SLOT_MEMORY_CAP` entries, newest kept.
 *
 * It returns the newest-last order the writers maintain, so a sanitized list is
 * indistinguishable from a written one.
 */
export function memorySanitize(raw: unknown): RightSlotMemory {
	if (!Array.isArray(raw)) return [];
	/*
	 * A `Map` rather than an array being filtered in place: `delete` then `set`
	 * moves a repeated key to the end, which is exactly "deduped, last wins" with
	 * the newest-last order the LRU reads — and it makes the dedupe O(n) instead
	 * of a splice per duplicate.
	 */
	const deduped = new Map<string, MemoryPane>();
	for (const entry of raw) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const [key, pane] = entry as [unknown, unknown];
		if (typeof key !== "string" || key === "") continue;
		if (isDraftMemoryKey(key)) continue;
		if (!isMemoryPane(pane)) continue;
		deduped.delete(key);
		deduped.set(key, pane);
	}
	return withCap([...deduped.entries()]);
}

/**
 * The keys whose memory must go, from the conversations store's own tombstones.
 *
 * TWO FACTS, and each is a different kind of gone (see `forgotten` and
 * `archiveFacts` in `canonical-sessions-store.ts`):
 *
 * - `forgotten[id]` is a DELETE. The conversation is gone for good, so a
 *   remembered pane for it is a slot nothing can ever restore onto.
 * - `archiveFacts[id].archived === true` is an ARCHIVE, and it only counts once
 *   the write has been ANSWERED. An optimistic fact (the press, before the
 *   daemon's sentence) must not prune: the archive can still be REFUSED, and a
 *   refused archive DELETES the fact — so pruning on the press would drop the
 *   memory of a conversation the user is still sitting in, and the surviving
 *   fact would have nothing to restore it from.
 *
 * A pure derivation from two records rather than a store subscription, so the
 * rule is exercisable without the store: `right-slot-follower.ts` is what wires
 * it to the subscription.
 */
export function memoryPruneKeys(input: {
	forgotten: Readonly<Record<string, unknown>>;
	archiveFacts: Readonly<
		Record<string, { archived?: boolean; answered?: boolean } | undefined>
	>;
}): ReadonlySet<string> {
	const keys = new Set<string>(Object.keys(input.forgotten));
	for (const [id, fact] of Object.entries(input.archiveFacts)) {
		if (fact?.archived === true && fact.answered === true) keys.add(id);
	}
	return keys;
}

/** The flag a pane claims, for callers that need the store's spelling. */
export function memoryPaneFlag(pane: MemoryPane): string {
	return PANE_FLAG[pane];
}
