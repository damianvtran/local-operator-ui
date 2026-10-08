import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The palette's Recents memory: the ring's ordering rule, its persistence, and
 * the visit rule that fills it.
 *
 * The PIN that reads the ring is pinned in `palette-search.test.mjs`; this file
 * owns the other half - what gets recorded and how it survives a reload. Three
 * things are exercised for real rather than described:
 *
 * - `pushConversationRecent`, the pure ordering rule (the same shape, and the
 *   same reason, as `pushProfileRecent` in `header-identity-menu.test.mjs`);
 * - the persisted store: `persistedUiPreferences` keeps the key, and a blob
 *   written BEFORE the key existed hydrates to `[]` with no version bump and no
 *   migration - proved by seeding `localStorage` with such a blob before the
 *   store module is first evaluated, which is what a real upgrade does;
 * - `visitedConversationId`, the visit rule `useConversationRecents` applies to
 *   the shell's displayed-session fields.
 *
 * The store is bundled once, with the renderer's own path aliases restated for
 * the reason `header-identity-menu.test.mjs` gives (esbuild reads the ROOT
 * tsconfig, and the renderer's mapping lives in `tsconfig.app.json`).
 */

const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

/*
 * An upgrade from a build that predates `conversationRecents`: a persisted blob
 * at the CURRENT store version (1) that carries other preferences and not the
 * key. Seeded before the store module is evaluated so zustand's own hydration
 * is what is under test, not a hand-rolled merge.
 */
memory.set(
	"ui-preferences-storage",
	JSON.stringify({
		state: { profileRecents: { agent: ["coder"], team: [] } },
		version: 1,
	}),
);

const bundle = await build({
	stdin: {
		contents: [
			'export { parseConversationRecents, pushConversationRecent, CONVERSATION_RECENTS_LIMIT, useUiPreferencesStore as store, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { chatRecentsOfRow, visitedConversationId } from "./src/renderer/src/features/command-palette/use-conversation-recents";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// The hook module imports react; bundling it is harmless because only the pure
	// rule beside the hook is called here.
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	logLevel: "silent",
});

const {
	chatRecentsOfRow,
	CONVERSATION_RECENTS_LIMIT,
	parseConversationRecents,
	persistedUiPreferences,
	pushConversationRecent,
	store,
	visitedConversationId,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the ring is bounded at twenty, deliberately more than the five the palette draws", () => {
	assert.equal(CONVERSATION_RECENTS_LIMIT, 20);
});

test("a blob written before the key existed hydrates to an empty ring, with no migration", () => {
	// Read first, before any test writes: this is the state a real upgrade boots in.
	assert.deepEqual(store.getState().conversationRecents, []);
	// The pre-existing preference in the same blob survived the same hydration.
	assert.deepEqual(store.getState().profileRecents.agent, ["coder"]);
});

test("pushConversationRecent: most recent first, a revisit moves rather than duplicates", () => {
	assert.deepEqual(pushConversationRecent([], "a"), ["a"]);
	assert.deepEqual(pushConversationRecent(["a", "b", "c"], "c"), [
		"c",
		"a",
		"b",
	]);
	assert.deepEqual(pushConversationRecent(["a", "b", "c"], "d"), [
		"d",
		"a",
		"b",
		"c",
	]);
});

test("pushConversationRecent drops the oldest at the bound", () => {
	const full = Array.from(
		{ length: CONVERSATION_RECENTS_LIMIT },
		(_, index) => `s${index}`,
	);
	const next = pushConversationRecent(full, "fresh");
	assert.equal(next.length, CONVERSATION_RECENTS_LIMIT);
	assert.equal(next[0], "fresh");
	assert.equal(next.includes(`s${CONVERSATION_RECENTS_LIMIT - 1}`), false);
	// A revisit at the bound evicts nothing: it is a move, not a growth.
	const moved = pushConversationRecent(full, "s5");
	assert.equal(moved.length, CONVERSATION_RECENTS_LIMIT);
	assert.equal(moved[0], "s5");
	assert.equal(moved.includes(`s${CONVERSATION_RECENTS_LIMIT - 1}`), true);
});

test("pushConversationRecent does not mutate its input", () => {
	const ring = ["a", "b"];
	pushConversationRecent(ring, "c");
	assert.deepEqual(ring, ["a", "b"]);
});

test("rememberConversation fills the ring through the store, and a repeat is a no-op", () => {
	const { rememberConversation } = store.getState();
	rememberConversation("one");
	rememberConversation("two");
	assert.deepEqual(store.getState().conversationRecents, ["two", "one"]);
	// Re-selecting the conversation already at the front must not notify: the
	// palette's source hook subscribes to this ring.
	const before = store.getState();
	let notified = 0;
	const unsubscribe = store.subscribe(() => {
		notified += 1;
	});
	rememberConversation("two");
	unsubscribe();
	assert.equal(notified, 0);
	assert.equal(store.getState(), before);
	// A revisit of an older one moves it to the front.
	rememberConversation("one");
	assert.deepEqual(store.getState().conversationRecents, ["one", "two"]);
});

test("the ring is written to disk by the store's own persistence", () => {
	// `persistedUiPreferences` strips in-flight requests and nothing else, so a
	// field added to the store is persisted by construction.
	const persisted = persistedUiPreferences({
		conversationRecents: ["a", "b"],
		runPanelReveal: { section: "todos" },
	});
	assert.deepEqual(persisted.conversationRecents, ["a", "b"]);
	assert.equal("runPanelReveal" in persisted, false);
	// And it really reached storage through the shipped persist middleware.
	const written = JSON.parse(memory.get("ui-preferences-storage"));
	assert.deepEqual(written.state.conversationRecents, ["one", "two"]);
	assert.equal(written.version, 1);
});

test("the visit rule: a conversation is recorded, a draft with no session yet is not", () => {
	// The ordinary case: no draft staged, the active session is on screen.
	assert.equal(visitedConversationId(null, undefined, "s1"), "s1");
	// A draft staged over a conversation the reader came from: the DRAFT's
	// session is what is displayed, and `activeSessionId` (the old one) is not.
	assert.equal(visitedConversationId("draft:agent:coder", "s2", "s1"), "s2");
	// A draft that has no session yet shows no conversation: skipped, and
	// notably NOT the stale active session behind it.
	assert.equal(
		visitedConversationId("draft:agent:coder", undefined, "s1"),
		null,
	);
	assert.equal(visitedConversationId("draft:agent:coder", null, "s1"), null);
	// Nothing open at all.
	assert.equal(visitedConversationId(null, undefined, null), null);
	assert.equal(visitedConversationId(null, undefined, undefined), null);
	assert.equal(visitedConversationId(null, undefined, ""), null);
});

/* ------------------------------------------------------------------ *
 * The row-to-ring join (agent review round 1, R1-1)
 * ------------------------------------------------------------------ */

/*
 * `chatRecentsOfRow` is the ONLY place a catalogue row and the visited ring meet
 * (`use-palette-sources.ts`'s `chatItems` memo calls it once per row), and that
 * memo is a React hook this node harness cannot mount - so before the extraction
 * the join was the one seam no unit test touched (deleting the `current` flag left
 * every palette test green, and only the heavy `--scene` rig would have noticed).
 * These are the cases the seam was missing: in the ring and out of it, a
 * hand-edited duplicate, the conversation on screen, and the archived row with the
 * archive capability on and off.
 */
test("chatRecentsOfRow: a row out of the ring carries no rank and is not current", () => {
	assert.deepEqual(
		chatRecentsOfRow({ session_id: "s9" }, ["a", "b"], "a", true),
		{ recentRank: undefined, current: false, archived: false },
	);
});

test("chatRecentsOfRow: a row in the ring carries its visit index, 0 the most recent", () => {
	const ring = ["a", "b", "c"];
	assert.equal(
		chatRecentsOfRow({ session_id: "b" }, ring, null, true).recentRank,
		1,
	);
	assert.equal(
		chatRecentsOfRow({ session_id: "c" }, ring, null, true).recentRank,
		2,
	);
});

test("chatRecentsOfRow: the conversation on screen is current, whatever its rank", () => {
	const here = chatRecentsOfRow({ session_id: "a" }, ["a", "b"], "a", true);
	assert.equal(here.current, true);
	assert.equal(here.recentRank, 0);
	// A null or undefined displayed id is "nothing on screen" - a draft with no
	// session yet, or a shell before one is open - and matches no row.
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, ["a"], null, true).current,
		false,
	);
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, ["a"], undefined, true).current,
		false,
	);
});

test("chatRecentsOfRow: a duplicated id in a hand-edited ring keeps its FIRST, most recent rank", () => {
	// The ring's order is a most-recent-first contract, so a manual duplicate must
	// not DEMOTE the row: the first occurrence is the visit that counts.
	const row = { session_id: "a" };
	assert.equal(
		chatRecentsOfRow(row, ["a", "b", "a"], null, true).recentRank,
		0,
	);
	assert.equal(
		chatRecentsOfRow(row, ["b", "a", "c", "a"], null, true).recentRank,
		1,
	);
});

test("chatRecentsOfRow: the archived fact is the sidebar's own rule, gated on the capability", () => {
	const archived = { session_id: "a", archived: true };
	const live = { session_id: "a", archived: false };
	// Capability ON: the archived row is out of view, the live one is not.
	assert.equal(chatRecentsOfRow(archived, [], null, true).archived, true);
	assert.equal(chatRecentsOfRow(live, [], null, true).archived, false);
	// Capability OFF: no partition at all - archived rows stay eligible, exactly as
	// `visibleRows` returns the rows unfiltered for a backend with no archive store.
	assert.equal(chatRecentsOfRow(archived, [], null, false).archived, false);
	// A row that does not state the fact is live under either gate ("absence is not
	// a claim").
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, [], null, true).archived,
		false,
	);
});

/* ------------------------------------------------------------------ *
 * The persisted ring is parsed on read (agent review round 1, R1-5)
 * ------------------------------------------------------------------ */

test("parseConversationRecents: a valid ring is returned as-is, anything else reads empty", () => {
	const ring = ["a", "b"];
	// The SAME reference: the palette's source hook selects this value and zustand
	// compares references, so a fresh array per call would re-render every render.
	assert.equal(parseConversationRecents(ring), ring);
	for (const malformed of [null, undefined, "a,b", 7, { a: 1 }, true]) {
		assert.deepEqual(parseConversationRecents(malformed), []);
	}
	// The malformed arm is ONE shared array, for the same re-render reason.
	assert.equal(
		parseConversationRecents(null),
		parseConversationRecents("nope"),
	);
});

test("a non-array persisted ring cannot throw in the store's own writer", () => {
	// zustand rehydrates PAST the setters, so a blob shape this build never wrote
	// can land in the state; the writer reads through the parser, so a string ring
	// is treated as empty rather than reaching `pushConversationRecent`'s `.filter`.
	store.setState({ conversationRecents: "not-an-array" });
	const { rememberConversation } = store.getState();
	assert.doesNotThrow(() => rememberConversation("s1"));
	assert.deepEqual(store.getState().conversationRecents, ["s1"]);
});
