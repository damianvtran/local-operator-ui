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
 *   written BEFORE the key existed hydrates to `[]` with no step of its own in
 *   the migration - proved by seeding `localStorage` with such a blob before the
 *   store module is first evaluated, which is what a real upgrade does. And
 *   because the v2 step that retires `chatMeasureWidth` (#895) runs over the
 *   same blob, a second cell (the fold of origin/main) seeds a v1 blob carrying
 *   BOTH and pins that the step drops the width and keeps the ring;
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
 * at version 1 - the version that build wrote, and the shape a real upgrade
 * presents - that carries other preferences and not the key. Seeded before the
 * store module is evaluated so zustand's own hydration is what is under test,
 * not a hand-rolled merge.
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
			'export { parseConversationRecents, pushConversationRecent, CONVERSATION_RECENTS_LIMIT, UI_PREFERENCES_VERSION, useUiPreferencesStore as store, persistedUiPreferences } from "./src/renderer/src/shared/store/ui-preferences-store";',
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
	UI_PREFERENCES_VERSION,
	visitedConversationId,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("the ring is bounded at twenty, deliberately more than the five the palette draws", () => {
	assert.equal(CONVERSATION_RECENTS_LIMIT, 20);
});

test("a blob written before the key existed hydrates to an empty ring, with no step of its own in the migration", () => {
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
	// Stamped at the version the store ships (2 since the fold of origin/main:
	// the `chatMeasureWidth` retirement) - this key rides no step of its own.
	assert.equal(written.version, UI_PREFERENCES_VERSION);
});

test("a v1 blob carrying BOTH the retired width and the ring: the v2 step drops the width and keeps the ring (fold of origin/main)", async () => {
	/*
	 * The v2 step that retires `chatMeasureWidth` (#895) and this ring ride the
	 * SAME `ui-preferences-storage` blob through the same `migrateUiPreferences`
	 * pass, and the two halves shipped from different lanes: this cell pins that
	 * the step drops the width WITHOUT taking the ring with it - through a real
	 * rehydrate, the retired key must not survive zustand's default merge, and
	 * the ring must come through intact.
	 */
	memory.set(
		"ui-preferences-storage",
		JSON.stringify({
			state: {
				chatMeasureWidth: 900,
				conversationRecents: ["x", "y", "z"],
				themeName: "dracula",
			},
			version: 1,
		}),
	);
	await store.persist.rehydrate();
	const state = store.getState();
	assert.equal(
		"chatMeasureWidth" in state,
		false,
		"the stale key must not survive zustand's default merge",
	);
	assert.deepEqual(
		state.conversationRecents,
		["x", "y", "z"],
		"the ring rides the step untouched",
	);
	assert.equal(state.themeName, "dracula", "the rest of the blob is kept");
	// The blob the store writes back next carries the same two facts: no width,
	// and the ring, now extended by the store's own writer.
	store.getState().rememberConversation("w");
	const written = JSON.parse(memory.get("ui-preferences-storage"));
	assert.equal("chatMeasureWidth" in written.state, false);
	assert.deepEqual(written.state.conversationRecents, ["w", "x", "y", "z"]);
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
		chatRecentsOfRow({ session_id: "s9" }, ["a", "b"], "a", true, {}),
		{ recentRank: undefined, current: false, archived: false },
	);
});

test("chatRecentsOfRow: a row in the ring carries its visit index, 0 the most recent", () => {
	const ring = ["a", "b", "c"];
	assert.equal(
		chatRecentsOfRow({ session_id: "b" }, ring, null, true, {}).recentRank,
		1,
	);
	assert.equal(
		chatRecentsOfRow({ session_id: "c" }, ring, null, true, {}).recentRank,
		2,
	);
});

test("chatRecentsOfRow: the conversation on screen is current, whatever its rank", () => {
	const here = chatRecentsOfRow({ session_id: "a" }, ["a", "b"], "a", true, {});
	assert.equal(here.current, true);
	assert.equal(here.recentRank, 0);
	// A null or undefined displayed id is "nothing on screen" - a draft with no
	// session yet, or a shell before one is open - and matches no row.
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, ["a"], null, true, {}).current,
		false,
	);
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, ["a"], undefined, true, {}).current,
		false,
	);
});

test("chatRecentsOfRow: a duplicated id in a hand-edited ring keeps its FIRST, most recent rank", () => {
	// The ring's order is a most-recent-first contract, so a manual duplicate must
	// not DEMOTE the row: the first occurrence is the visit that counts.
	const row = { session_id: "a" };
	assert.equal(
		chatRecentsOfRow(row, ["a", "b", "a"], null, true, {}).recentRank,
		0,
	);
	assert.equal(
		chatRecentsOfRow(row, ["b", "a", "c", "a"], null, true, {}).recentRank,
		1,
	);
});

test("chatRecentsOfRow: the archived fact is the sidebar's own rule, gated on the capability", () => {
	const archived = { session_id: "a", archived: true };
	const live = { session_id: "a", archived: false };
	// Capability ON: the archived row is out of view, the live one is not.
	assert.equal(chatRecentsOfRow(archived, [], null, true, {}).archived, true);
	assert.equal(chatRecentsOfRow(live, [], null, true, {}).archived, false);
	// Capability OFF: no partition at all - archived rows stay eligible, exactly as
	// `visibleRows` returns the rows unfiltered for a backend with no archive store.
	assert.equal(chatRecentsOfRow(archived, [], null, false, {}).archived, false);
	// A row that does not state the fact is live under either gate ("absence is not
	// a claim").
	assert.equal(
		chatRecentsOfRow({ session_id: "a" }, [], null, true, {}).archived,
		false,
	);
});

test("chatRecentsOfRow: an ANSWERED archive fact is laid over the row first, as the sidebar's membership does (agent review round 2, R2-1)", () => {
	const live = { session_id: "a", archived: false };
	const archived = { session_id: "a", archived: true };
	const answered = (value) => ({
		a: { archived: value, at: 1, answered: true },
	});
	const unanswered = (value) => ({
		a: { archived: value, at: 1, answered: false },
	});
	// THE MISSING CASE: an accepted archive press settles the fact and patches no
	// row, so the row still says live and the fact says archived. Excluded.
	assert.equal(
		chatRecentsOfRow(live, ["a"], null, true, answered(true)).archived,
		true,
	);
	// The way back: the row says archived, the answered fact says live. Eligible.
	assert.equal(
		chatRecentsOfRow(archived, ["a"], null, true, answered(false)).archived,
		false,
	);
	// A press still in flight is only an intent: it changes nothing in either
	// direction, exactly as in the sidebar.
	assert.equal(
		chatRecentsOfRow(live, ["a"], null, true, unanswered(true)).archived,
		false,
	);
	assert.equal(
		chatRecentsOfRow(archived, ["a"], null, true, unanswered(false)).archived,
		true,
	);
	// A fact about ANOTHER conversation is not this row's.
	assert.equal(
		chatRecentsOfRow(live, ["a"], null, true, {
			b: { archived: true, at: 1, answered: true },
		}).archived,
		false,
	);
	// No capability: nothing is partitioned, whatever the facts say.
	assert.equal(
		chatRecentsOfRow(live, ["a"], null, false, answered(true)).archived,
		false,
	);
	assert.equal(
		chatRecentsOfRow(archived, ["a"], null, false, {}).archived,
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
