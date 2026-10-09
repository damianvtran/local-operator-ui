import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE RIGHT SLOT'S PER-CONVERSATION MEMORY (issue #894).
 *
 * The reporter's observation: the four durable right-slot panes were global, so a
 * canvas opened for one conversation sat beside the next one. These cells drive the
 * SHIPPED stores and the SHIPPED follower - not a re-implementation - through the
 * transitions the decision record names, and pin the halves of the inversion that
 * no frame can show: which conversation an entry belongs to, what a close deletes,
 * what a bind projects, what survives a relaunch and what prunes.
 *
 * Two cells are marked FAIL-ON-MAIN, and the difference is their subject rather
 * than their strictness: (A) is the switch itself and (C) is the fleet drawer's
 * restore, both of which the global-flag store cannot answer at all. On `main`
 * every cell here fails at the bundle, because the follower and the memory do not
 * exist yet; the discriminating reading for A and C is the focused probe in the
 * evidence (`psr-894-main-probe`), which drives the shipped API those two cells
 * need against `main`'s store and prints the flags it reads.
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

const bundle = await build({
	stdin: {
		contents: [
			'export { useUiPreferencesStore, persistedUiPreferences, mergePersistedUiPreferences, migrateUiPreferences, resolveRightSlotWidth, resolveDrawnRightSlotPane, EMPTY_RIGHT_SLOT_ROUTE, EMPTY_RIGHT_SLOT_MEMORY, DEFAULT_RUN_PANEL_WIDTH } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
			'export { installRightSlotMemoryFollower, rightSlotKeyForView, admittedFromFor } from "./src/renderer/src/shared/store/right-slot-follower";',
			'export { RIGHT_SLOT_MEMORY_CAP, memoryPut, memoryCarry, memoryProject, memoryRemove, memorySanitize, memoryPruneKeys } from "./src/renderer/src/shared/store/right-slot-memory";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		// The renderer's own path aliases, restated because esbuild reads the ROOT
		// tsconfig by default and the renderer's mapping lives in `tsconfig.app.json`.
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
		"@assets": join(process.cwd(), "src/renderer/src/assets"),
	},
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	useUiPreferencesStore,
	persistedUiPreferences,
	mergePersistedUiPreferences,
	migrateUiPreferences,
	resolveRightSlotWidth,
	resolveDrawnRightSlotPane,
	EMPTY_RIGHT_SLOT_ROUTE,
	EMPTY_RIGHT_SLOT_MEMORY,
	DEFAULT_RUN_PANEL_WIDTH,
	useCanonicalSessionsStore,
	installRightSlotMemoryFollower,
	rightSlotKeyForView,
	admittedFromFor,
	RIGHT_SLOT_MEMORY_CAP,
	memoryPut,
	memoryCarry,
	memoryProject,
	memoryRemove,
	memorySanitize,
	memoryPruneKeys,
} = mod;

/*
 * THE INSTALL IS THE APP'S (`main.tsx`), done once for the file: the subscriber
 * must outlive every cell, and a per-cell install would leave the earlier
 * subscriptions live.
 */
installRightSlotMemoryFollower();

const sessions = () => useCanonicalSessionsStore.getState();
const prefs = () => useUiPreferencesStore.getState();

/**
 * A reset to the store's own initial slot state, with the bind left UNBOUND.
 *
 * The four flags are set from `EMPTY_RIGHT_SLOT_MEMORY`'s projection by hand,
 * because the point of a reset is a known starting point rather than a bind: a
 * cell that wants the bound path says so with `setActiveSession`, which is also
 * what moves the follower.
 */
const reset = (overrides = {}) =>
	useUiPreferencesStore.setState({
		rightSlotKey: undefined,
		rightSlotMemory: EMPTY_RIGHT_SLOT_MEMORY,
		rightSlotLegacySeed: null,
		isCanvasOpen: false,
		isRunPanelOpen: false,
		isBrowserPaneOpen: false,
		isConsolePaneOpen: false,
		isAskDrawerOpen: false,
		askDrawerEvictedPane: null,
		rightSlotRoute: EMPTY_RIGHT_SLOT_ROUTE,
		...overrides,
	});

/*
 * (A) FAIL-ON-MAIN. The switch itself: a panel opened on A is gone on B and
 * back on A. On `main` the flag is global, so the middle assertion reads true.
 */
test("(A) a panel opened on one conversation is not there on the next, and returns with the first", () => {
	reset();
	sessions().setActiveSession("A-1");
	prefs().setCanvasOpen(true);
	assert.equal(prefs().isCanvasOpen, true, "A has its canvas");
	assert.deepEqual(prefs().rightSlotMemory, [["A-1", "canvas"]]);

	sessions().setActiveSession("A-2");
	assert.equal(
		prefs().isCanvasOpen,
		false,
		"a conversation with no memory opens with no panel (FAIL-ON-MAIN)",
	);

	sessions().setActiveSession("A-1");
	assert.equal(
		prefs().isCanvasOpen,
		true,
		"returning to A restores its canvas",
	);
});

/*
 * (B) ADMISSION. A panel opened while drafting belongs to the conversation the
 * draft becomes - moved in the same step as the identity flip, and the draft's
 * entry gone, so the remount has nothing to close and reopen.
 */
test("(B) a draft's entry is carried to the session it becomes, and the draft entry goes", () => {
	reset();
	sessions().setActiveSession("B-origin");
	const draftKey = sessions().stageDraft();
	assert.equal(
		prefs().rightSlotKey,
		draftKey,
		"a fresh draft's key is the draft's own, not the conversation it was staged from",
	);
	prefs().setCanvasOpen(true);
	assert.deepEqual(prefs().rightSlotMemory, [[draftKey, "canvas"]]);

	sessions().updateDraft(draftKey, { sessionId: "B-session" });
	assert.equal(prefs().rightSlotKey, "B-session", "the identity flip rebinds");
	assert.equal(prefs().isCanvasOpen, true, "and the panel is still open");
	assert.deepEqual(
		prefs().rightSlotMemory,
		[["B-session", "canvas"]],
		"carried, not duplicated",
	);
});

/*
 * (R) THE ABANDON (agent review round 1, F1; UX round 1, U1). Clicking an
 * existing conversation while a New-chat draft is open moves the key exactly as
 * an admission does — `draft:<uuid>` -> `<sessionId>` — but it is NOT one: the
 * draft's pane must not travel, and the destination keeps its own answer.
 */
test("(R) leaving a draft for an existing conversation does not carry its pane", () => {
	reset();
	sessions().setActiveSession("R-OTHER");
	prefs().setBrowserPaneOpen(true);
	assert.deepEqual(prefs().rightSlotMemory, [["R-OTHER", "browser"]]);

	const draftKey = sessions().stageDraft();
	prefs().setCanvasOpen(true);
	assert.deepEqual(
		prefs().rightSlotMemory,
		[
			["R-OTHER", "browser"],
			[draftKey, "canvas"],
		],
		"the draft's own entry lives under the draft key",
	);

	sessions().setActiveSession("R-OTHER");
	assert.equal(prefs().rightSlotKey, "R-OTHER");
	assert.equal(
		prefs().isBrowserPaneOpen,
		true,
		"the destination keeps ITS OWN pane — no overwrite, no erasure",
	);
	assert.equal(
		prefs().isCanvasOpen,
		false,
		"the draft's canvas did not travel",
	);
	assert.deepEqual(
		prefs().rightSlotMemory,
		[
			["R-OTHER", "browser"],
			[draftKey, "canvas"],
		],
		"both entries stand exactly as they were",
	);
});

/*
 * (S) THE SAME ABANDON onto a destination that never opened a pane (U1's second
 * shape): it stays empty rather than inheriting the draft's canvas.
 */
test("(S) the same abandon leaves a conversation with no memory empty", () => {
	reset();
	sessions().setActiveSession("S-PLAIN");
	const draftKey = sessions().stageDraft();
	prefs().setCanvasOpen(true);
	assert.deepEqual(prefs().rightSlotMemory, [[draftKey, "canvas"]]);

	sessions().setActiveSession("S-PLAIN");
	assert.equal(prefs().rightSlotKey, "S-PLAIN");
	assert.equal(
		prefs().isCanvasOpen,
		false,
		"nothing paints on the destination",
	);
	assert.equal(prefs().isBrowserPaneOpen, false);
	assert.equal(prefs().isRunPanelOpen, false);
	assert.equal(prefs().isConsolePaneOpen, false);
	assert.deepEqual(
		prefs().rightSlotMemory,
		[[draftKey, "canvas"]],
		"the draft's entry still lives under its draft key",
	);
});

/*
 * (C) FAIL-ON-MAIN. The drawer is the one occupant that travels: opened over A's
 * canvas and closed over B it must give B its own pane back, not A's.
 */
test("(C) a fleet drawer opened on one conversation and closed on another restores the LATTER's pane", () => {
	reset();
	sessions().setActiveSession("C-A");
	prefs().setCanvasOpen(true);
	sessions().setActiveSession("C-B");
	prefs().setBrowserPaneOpen(true);
	sessions().setActiveSession("C-A");
	assert.equal(prefs().isCanvasOpen, true, "A's canvas is back");

	prefs().setAskDrawerOpen(true, "fleet");
	assert.equal(prefs().isAskDrawerOpen, true);
	assert.equal(prefs().isCanvasOpen, false, "the drawer holds the one slot");
	assert.equal(
		prefs().askDrawerEvictedPane,
		null,
		"bound mode records no borrow: the memory is the record",
	);

	sessions().setActiveSession("C-B");
	assert.equal(prefs().isAskDrawerOpen, true, "the drawer follows the user");
	assert.equal(
		prefs().isBrowserPaneOpen,
		false,
		"and the pane under it is off",
	);

	prefs().setAskDrawerOpen(false, "fleet");
	assert.equal(
		prefs().isBrowserPaneOpen,
		true,
		"closing gives B the pane B had (FAIL-ON-MAIN: main puts A's canvas back)",
	);
	assert.equal(prefs().isCanvasOpen, false, "and never A's");
});

/*
 * (D) ASKS PRECEDENCE. The drawer borrows over the remembered panel, writes no
 * memory of its own, and gives the memory back on close.
 */
test("(D) the asks drawer borrows the slot over a remembered panel and never writes the memory", () => {
	reset();
	sessions().setActiveSession("D-A");
	prefs().setCanvasOpen(true);
	prefs().setAskDrawerOpen(true, "session");
	assert.equal(prefs().isCanvasOpen, false);
	assert.deepEqual(
		prefs().rightSlotMemory,
		[["D-A", "canvas"]],
		"the drawer is not memory",
	);
	prefs().setAskDrawerOpen(false, "session");
	assert.equal(prefs().isCanvasOpen, true, "the close restores the canvas");
	assert.deepEqual(prefs().rightSlotMemory, [["D-A", "canvas"]]);
});

/*
 * (E) PERSISTENCE. The round trip in parts: the write filter, the migration chain,
 * the cap, and the sanitiser a hydrated blob must pass.
 */
test("(E) the memory persists without drafts, migrates from the global flags, and hydrates sanitised", () => {
	// The cap: newest last, oldest dropped, one entry per key.
	let grown = EMPTY_RIGHT_SLOT_MEMORY;
	for (let i = 0; i <= RIGHT_SLOT_MEMORY_CAP; i += 1)
		grown = memoryPut(grown, `s-${i}`, "canvas");
	assert.equal(grown.length, RIGHT_SLOT_MEMORY_CAP);
	assert.equal(grown[0][0], "s-1", "the oldest entry is the one evicted");
	assert.equal(grown[grown.length - 1][0], `s-${RIGHT_SLOT_MEMORY_CAP}`);

	// The write filter: flags and bind key out, drafts out, the memory and the seed in.
	const persisted = persistedUiPreferences({
		...prefs(),
		rightSlotKey: "s-1",
		rightSlotMemory: [
			["draft:abc", "run"],
			["s-1", "canvas"],
		],
	});
	assert.deepEqual(
		persisted.rightSlotMemory,
		[["s-1", "canvas"]],
		"a draft is a launch's own row and does not go to disk",
	);
	for (const key of [
		"isCanvasOpen",
		"isRunPanelOpen",
		"isBrowserPaneOpen",
		"isConsolePaneOpen",
		"rightSlotKey",
		"askDrawerEvictedPane",
		"askDrawerScope",
		"isAskDrawerOpen",
		"rightSlotRoute",
		"runPanelReveal",
		"consoleOpenIntent",
	])
		assert.equal(key in persisted, false, `${key} must not be persisted`);
	assert.equal("rightSlotMemory" in persisted, true);
	assert.equal("rightSlotLegacySeed" in persisted, true);

	// The migration chain: a v2 blob's flags become the one-shot seed and go.
	const migrated = migrateUiPreferences(
		{
			isCanvasOpen: true,
			isRunPanelOpen: false,
			isBrowserPaneOpen: false,
			isConsolePaneOpen: false,
			chatMeasureWidth: 720,
			rightSlotWidth: 700,
			themeName: "dracula",
		},
		/*
		 * VERSION 1, not 2: `main`'s blobs are v1, so the chain that a real upgrading
		 * profile runs is v<2 (the chat-measure delete) and v<3 (the seed) together.
		 * The v2->v3 hop is asserted on its own below.
		 */
		1,
	);
	assert.equal(migrated.rightSlotLegacySeed, "canvas");
	assert.equal(migrated.rightSlotWidth, 700);
	for (const key of [
		"isCanvasOpen",
		"isRunPanelOpen",
		"isBrowserPaneOpen",
		"isConsolePaneOpen",
		"chatMeasureWidth",
	])
		assert.equal(key in migrated, false, `${key} must not survive the chain`);

	// The v2 -> v3 hop alone, for a blob the neighbouring lane already migrated.
	const fromV2 = migrateUiPreferences(
		{ isRunPanelOpen: true, themeName: "dark" },
		2,
	);
	assert.equal(fromV2.rightSlotLegacySeed, "run");
	assert.equal("isRunPanelOpen" in fromV2, false);

	/*
	 * AND THE CHAIN IS IDEMPOTENT: a v3 blob is carried through untouched, which is
	 * what makes a rebase onto a sibling lane's step a conflict with no behaviour in
	 * it.
	 */
	assert.deepEqual(migrateUiPreferences(migrated, 3), migrated);

	// The v0 fold still runs (the chain did not lose its first step).
	const folded = migrateUiPreferences(
		{ canvasWidth: 900, runPanelWidth: 320, themeName: "dark" },
		0,
	);
	assert.equal(folded.rightSlotWidth, 900);
	assert.equal("canvasWidth" in folded, false);

	/*
	 * `current` IS A FRESH LAUNCH'S STORE, which is what hydration hands the merge:
	 * reset rather than the live state, so the assertion below about the bind is about
	 * the merge's rule rather than about whatever the previous cell left bound.
	 */
	reset();
	const hydrated = mergePersistedUiPreferences(
		{
			...migrated,
			rightSlotMemory: [
				["a", "run"],
				["draft:x", "canvas"],
				["a", "console"],
				42,
				[],
				["c"],
				["b", "not-a-pane"],
			],
		},
		prefs(),
	);
	assert.deepEqual(hydrated.rightSlotMemory, [["a", "console"]]);
	assert.equal(hydrated.rightSlotLegacySeed, "canvas");
	assert.equal(hydrated.rightSlotKey, undefined, "the bind is not restored");
	assert.equal(hydrated.isCanvasOpen, false, "a flag in the blob is refused");

	/*
	 * THE SEED IS DISK TOO (agent review round 1, F2): a hand-edited blob's
	 * `rightSlotLegacySeed` must not survive the merge, or the first bind would
	 * plant it; a real pane name still applies.
	 */
	const hostileSeed = mergePersistedUiPreferences(
		{ rightSlotLegacySeed: "bogus" },
		prefs(),
	);
	assert.equal(
		hostileSeed.rightSlotLegacySeed,
		null,
		"a value that is not one of the four panes is dropped",
	);
	const realSeed = mergePersistedUiPreferences(
		{ rightSlotLegacySeed: "console" },
		prefs(),
	);
	assert.equal(realSeed.rightSlotLegacySeed, "console", "a real seed persists");
});

/*
 * (F) THE SEED. Applied once, on a session with no entry, never on a draft, and
 * held across a bind with no conversation.
 */
test("(F) the legacy seed lands once, on a session, and never on a draft", () => {
	reset({ rightSlotLegacySeed: "run" });
	prefs().bindRightSlotKey("draft:f-1");
	assert.equal(
		prefs().rightSlotLegacySeed,
		null,
		"a draft drops the seed rather than planting it",
	);
	assert.equal(prefs().isRunPanelOpen, false);
	assert.deepEqual(prefs().rightSlotMemory, []);

	reset({ rightSlotLegacySeed: "run" });
	prefs().bindRightSlotKey(null);
	assert.equal(
		prefs().rightSlotLegacySeed,
		"run",
		"no conversation holds the seed",
	);
	assert.equal(prefs().isRunPanelOpen, false);

	prefs().bindRightSlotKey("f-2");
	assert.equal(
		prefs().isRunPanelOpen,
		true,
		"the session it lands on opens it",
	);
	assert.equal(prefs().rightSlotLegacySeed, null, "and the seed is spent");
	assert.deepEqual(prefs().rightSlotMemory, [["f-2", "run"]]);

	prefs().bindRightSlotKey("f-3");
	assert.equal(
		prefs().isRunPanelOpen,
		false,
		"the next conversation inherits nothing",
	);

	// A session that already has an entry keeps its own answer.
	reset({ rightSlotLegacySeed: "browser" });
	prefs().bindRightSlotKey("f-4");
	prefs().setCanvasOpen(true);
	reset({
		rightSlotLegacySeed: "browser",
		rightSlotMemory: [["f-4", "canvas"]],
	});
	prefs().bindRightSlotKey("f-4");
	assert.equal(
		prefs().isCanvasOpen,
		true,
		"the profile's own choice outranks a flag from before the memory",
	);
	assert.equal(prefs().rightSlotLegacySeed, "browser");

	/*
	 * AND A HOSTILE SEED PLANTS NOTHING (agent review round 1, F2): the merge's
	 * drop is what the bind reads, so a hand-edited blob cannot turn "bogus" into
	 * an entry — where the same path with a real value still plants.
	 */
	reset();
	const hostile = mergePersistedUiPreferences(
		{ rightSlotLegacySeed: "bogus" },
		prefs(),
	);
	useUiPreferencesStore.setState({
		rightSlotLegacySeed: hostile.rightSlotLegacySeed,
	});
	prefs().bindRightSlotKey("f-5");
	assert.equal(prefs().isCanvasOpen, false);
	assert.deepEqual(prefs().rightSlotMemory, [], "nothing was planted");

	reset();
	const real = mergePersistedUiPreferences(
		{ rightSlotLegacySeed: "console" },
		prefs(),
	);
	useUiPreferencesStore.setState({
		rightSlotLegacySeed: real.rightSlotLegacySeed,
	});
	prefs().bindRightSlotKey("f-6");
	assert.equal(prefs().isConsolePaneOpen, true, "a real seed still applies");
	assert.deepEqual(prefs().rightSlotMemory, [["f-6", "console"]]);
});

/*
 * (G) PRUNING. A deleted conversation and a settled archive lose their entry; an
 * optimistic (unanswered) archive does not, and a refused one leaves the memory
 * alone.
 */
test("(G) a forgotten key loses its memory, an unanswered archive does not, a settled one does", () => {
	reset();
	sessions().setActiveSession("G-A");
	prefs().setCanvasOpen(true);
	sessions().setActiveSession("G-B");
	prefs().setRunPanelOpen(true);
	sessions().setActiveSession("G-C");
	prefs().setBrowserPaneOpen(true);
	assert.equal(prefs().rightSlotMemory.length, 3);

	useCanonicalSessionsStore.setState({
		archiveFacts: { "G-C": { archived: true, answered: false, at: 1 } },
	});
	assert.equal(
		prefs().rightSlotMemory.some(([key]) => key === "G-C"),
		true,
		"an unanswered archive is a press, not a fact",
	);

	useCanonicalSessionsStore.setState({ forgotten: { "G-B": { at: 2 } } });
	assert.equal(
		prefs().rightSlotMemory.some(([key]) => key === "G-B"),
		false,
		"a deletion drops the entry",
	);

	useCanonicalSessionsStore.setState({
		archiveFacts: { "G-C": { archived: true, answered: true, at: 3 } },
	});
	assert.equal(
		prefs().rightSlotMemory.some(([key]) => key === "G-C"),
		false,
	);
	assert.equal(
		prefs().rightSlotMemory.some(([key]) => key === "G-A"),
		true,
		"an untouched conversation keeps its entry",
	);

	// A refused archive DELETES the fact, and the memory it was never asked about stays.
	useCanonicalSessionsStore.setState({
		archiveFacts: { "G-A": { archived: true, answered: false, at: 4 } },
	});
	useCanonicalSessionsStore.setState({ archiveFacts: {} });
	assert.equal(
		prefs().rightSlotMemory.some(([key]) => key === "G-A"),
		true,
		"a refusal leaves the conversation's memory standing",
	);

	// And the forgotten key does not restore: returning to it opens nothing.
	sessions().setActiveSession("G-B");
	assert.equal(prefs().isRunPanelOpen, false);

	useCanonicalSessionsStore.setState({ forgotten: {}, archiveFacts: {} });
});

/*
 * (H) A PROGRAMMATIC WRITER. `setActiveSession` then a pane setter - the order
 * app.tsx's reveals and the attachment opens keep - writes the NAMED conversation
 * and nothing else.
 */
test("(H) setActiveSession then an open writes only the conversation named", () => {
	reset();
	sessions().setActiveSession("H-A");
	prefs().setCanvasOpen(true);
	sessions().setActiveSession("H-B");
	prefs().setBrowserPaneOpen(true);
	assert.deepEqual(prefs().rightSlotMemory, [
		["H-A", "canvas"],
		["H-B", "browser"],
	]);
	assert.equal(prefs().isCanvasOpen, false);
	assert.equal(prefs().isBrowserPaneOpen, true);
});

/*
 * (I) THE #868 REGRESSION PIN. A remembered run panel on a conversation with no
 * run details still resolves to NOTHING DRAWN and a zero width: the claim is not a
 * promise, and the memory must not re-open the reserved band #868 closed.
 */
test("(I) a remembered run panel on a conversation without details draws nothing (#868)", () => {
	reset();
	sessions().setActiveSession("I-A");
	prefs().setRunPanelOpen(true);
	sessions().setActiveSession("I-B");
	assert.equal(prefs().isRunPanelOpen, false, "B never opened it");
	sessions().setActiveSession("I-A");
	assert.equal(prefs().isRunPanelOpen, true, "and A's is remembered");

	useUiPreferencesStore.setState({
		rightSlotRoute: { mounted: true, runDetails: false, session: true },
	});
	assert.equal(resolveDrawnRightSlotPane(prefs()), null);
	assert.equal(resolveRightSlotWidth(1400, prefs()), 0);

	useUiPreferencesStore.setState({
		rightSlotRoute: { mounted: true, runDetails: true, session: true },
	});
	assert.equal(resolveDrawnRightSlotPane(prefs()), "run");
	assert.equal(resolveRightSlotWidth(1400, prefs()), DEFAULT_RUN_PANEL_WIDTH);
});

/*
 * (J) ONE WIDTH (#677). The memory is per conversation and the width is not: a
 * switch does not resize the column whichever occupant arrives.
 */
test("(J) the shared width is identical across a switch between two remembered panes", () => {
	reset();
	/*
	 * A route that can draw the slot at all: `rightSlotWidth` answers for a DRAWN
	 * pane (#868), so an unmounted route resolves 0 whatever the memory says.
	 */
	useUiPreferencesStore.setState({
		rightSlotRoute: { mounted: true, runDetails: true, session: true },
	});
	prefs().setRightSlotWidth(700);
	sessions().setActiveSession("J-A");
	prefs().setRunPanelOpen(true);
	sessions().setActiveSession("J-B");
	prefs().setBrowserPaneOpen(true);
	assert.equal(resolveRightSlotWidth(1400, prefs()), 700);
	sessions().setActiveSession("J-A");
	assert.equal(resolveRightSlotWidth(1400, prefs()), 700);
	assert.equal(resolveDrawnRightSlotPane(prefs()), "run");
	sessions().setActiveSession("J-B");
	assert.equal(resolveDrawnRightSlotPane(prefs()), "browser");
	assert.equal(
		resolveRightSlotWidth(1400, prefs()),
		700,
		"one shared width across the switch",
	);
});

/*
 * (K) UNBOUND. Stories, the desktop rigs and the mini window bind nothing, so the
 * setters are the global flags they always were - including the drawer's borrow,
 * which has no memory to lean on there.
 */
test("(K) unbound, the setters behave exactly as the global flags did", () => {
	reset();
	assert.equal(
		prefs().rightSlotKey,
		undefined,
		"this cell is the unbound store",
	);
	prefs().setCanvasOpen(true);
	assert.equal(prefs().isCanvasOpen, true);
	assert.deepEqual(prefs().rightSlotMemory, [], "unbound writes no memory");
	prefs().setAskDrawerOpen(true, "session");
	assert.equal(
		prefs().askDrawerEvictedPane,
		"isCanvasOpen",
		"unbound keeps the per-run borrow record",
	);
	prefs().setAskDrawerOpen(false, "session");
	assert.equal(prefs().isCanvasOpen, true, "and gives the pane back");
	assert.deepEqual(prefs().rightSlotMemory, []);
});

/*
 * The pure halves, driven directly so a failure names the rule rather than a
 * transition: these are what the store's writers and the follower's prune read.
 */
test("(P) the memory algebra: carry moves, remove is pane-scoped, project is the overlay's", () => {
	const base = [
		["x", "run"],
		["draft:y", "canvas"],
	];
	assert.deepEqual(memoryCarry(base, "draft:y", "y"), [
		["x", "run"],
		["y", "canvas"],
	]);
	assert.deepEqual(
		memoryCarry(base, "missing", "y"),
		base,
		"nothing to carry is not a change",
	);
	assert.deepEqual(
		memoryRemove(base, "x", "canvas"),
		base,
		"a close only retracts its own pane",
	);
	assert.deepEqual(memoryRemove(base, "x", "run"), [["draft:y", "canvas"]]);
	assert.deepEqual(memoryProject(base, "x", false), {
		isCanvasOpen: false,
		isRunPanelOpen: true,
		isBrowserPaneOpen: false,
		isConsolePaneOpen: false,
	});
	assert.deepEqual(memoryProject(base, "x", true), {
		isCanvasOpen: false,
		isRunPanelOpen: false,
		isBrowserPaneOpen: false,
		isConsolePaneOpen: false,
	});
	assert.deepEqual(
		memoryProject(base, null, false),
		memoryProject(base, "nobody", false),
	);
	assert.deepEqual(memorySanitize("nonsense"), []);
	assert.deepEqual(
		memoryPruneKeys({ forgotten: { a: {} }, archiveFacts: {} }),
		new Set(["a"]),
	);
	assert.deepEqual(
		memoryPruneKeys({
			forgotten: {},
			archiveFacts: {
				b: { archived: true, answered: false },
				c: { archived: true, answered: true },
				d: { archived: false, answered: true },
			},
		}),
		new Set(["c"]),
	);
});

/*
 * The follower's two pure inputs, so a regression in the identity rule or the
 * admission carry is named here rather than diagnosed through a transition.
 */
test("(Q) the follower's key is the pane's identity, and only an admission carries", () => {
	assert.equal(
		rightSlotKeyForView({
			activeDraftKey: "draft:z",
			draftSessionId: undefined,
			activeSessionId: "old",
		}),
		"draft:z",
		"a fresh draft keys on itself, not on the conversation it was staged from",
	);
	assert.equal(
		rightSlotKeyForView({
			activeDraftKey: "draft:z",
			draftSessionId: "s-9",
			activeSessionId: "old",
		}),
		"s-9",
	);
	assert.equal(
		rightSlotKeyForView({
			activeDraftKey: null,
			draftSessionId: undefined,
			activeSessionId: "s-1",
		}),
		"s-1",
	);
	assert.equal(
		rightSlotKeyForView({
			activeDraftKey: null,
			draftSessionId: undefined,
			activeSessionId: null,
		}),
		null,
	);
	assert.equal(
		admittedFromFor("draft:z", "s-9", "s-9"),
		"draft:z",
		"the row's own session id is what makes the flip an admission",
	);
	assert.equal(
		admittedFromFor("draft:z", "s-9", undefined),
		undefined,
		"leaving a draft for a conversation is an ABANDON, not an admission",
	);
	assert.equal(
		admittedFromFor("draft:z", "s-9", "s-other"),
		undefined,
		"and the draft's id must be exactly the key being entered",
	);
	assert.equal(
		admittedFromFor("s-1", "s-2", undefined),
		undefined,
		"a switch is not an admission",
	);
	assert.equal(admittedFromFor("draft:z", "draft:w", undefined), undefined);
	assert.equal(admittedFromFor(null, "s-9", undefined), undefined);
});
