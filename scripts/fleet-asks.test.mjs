import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE FLEET ASK SCOPE (operator ask, 2026-10-04): the drawer's second context.
 *
 * What this file is for. The session lane's own tests pin one conversation's
 * queue; this one pins the half that spans conversations and is therefore the
 * half where a mistake is invisible until it has answered the wrong person: the
 * AGGREGATE read's normalisation, the scope's identity rule (an answer is posted
 * to the row's OWN `session_id`, never to whichever conversation happens to be
 * open), the store field the scope travels on, and the two mount sites that keep
 * one container serving two contexts.
 *
 * It is deliberately DOM-free (the shape `ask-queue.test.mjs` established): the
 * two things most likely to break are pure - the row lookup and the scope the
 * store records - and neither needs a renderer to be exercised.
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
			'export { fleetAskRows, fleetAskFrontend, fleetAsksOutstanding, fleetAskSessionFor, fleetAskConversationLabel, FLEET_ASKS_QUERY_KEY, FLEET_ASKS_POLL_MS } from "./src/renderer/src/features/chat/fleet-asks";',
			'export { useUiPreferencesStore, persistedUiPreferences, resolveRightSlotWidth } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { askScopeLine } from "./src/renderer/src/features/chat/ask-queue";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": join(process.cwd(), "src/renderer/src/shared"),
		"@features": join(process.cwd(), "src/renderer/src/features"),
	},
	logLevel: "silent",
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	fleetAskRows,
	fleetAskFrontend,
	fleetAsksOutstanding,
	fleetAskSessionFor,
	fleetAskConversationLabel,
	FLEET_ASKS_QUERY_KEY,
	useUiPreferencesStore,
	persistedUiPreferences,
	resolveRightSlotWidth,
	desktopEndpoint,
	desktopRequestSchema,
	askScopeLine,
} = mod;

/** One aggregate row, in the route's own shape: frozen `PendingAsk` + identity. */
const row = (over = {}) => ({
	ask_id: "a-1",
	session_id: "abcdef123456",
	cwd: "/Users/someone/projects/pergamon-labs",
	status: "open",
	created_at: 1_700_000_000_000,
	expires_at: 1_700_000_900_000,
	questions: [{ id: "q", question: "Proceed?" }],
	...over,
});

/* ------------------------------------------------------------ the wire */

test("the aggregate read is a parameterless GET on the desktop plane", () => {
	assert.deepEqual(desktopEndpoint({ op: "asks.list" }), {
		path: "/v1/desktop/asks",
		method: "GET",
	});
	const parsed = desktopRequestSchema.safeParse({ op: "asks.list" });
	assert.equal(parsed.success, true);
	/*
	 * A FIXED SHAPE, so a caller cannot scope the read by hand: the route answers
	 * from the index and takes no parameters, and an accepted extra field would be a
	 * client inventing a filter the backend does not implement.
	 */
	assert.equal(
		desktopRequestSchema.safeParse({ op: "asks.list", sessionId: "x" }).success,
		false,
	);
});

test("the rows are normalised, and a row with no identity is dropped", () => {
	const envelope = {
		asks: [
			row({ ask_id: "a-1" }),
			row({ ask_id: "a-2", session_id: "ffffffffffff" }),
			/* No address to answer: dropped. */
			row({ ask_id: "" }),
			/* No conversation to answer INTO: dropped. */
			row({ ask_id: "a-4", session_id: null }),
			"not an object",
		],
	};
	const rows = fleetAskRows(envelope);
	assert.deepEqual(
		rows.map((r) => r.ask_id),
		["a-1", "a-2"],
	);
	/* A bare list is accepted too: the route's envelope and its rows are one shape. */
	assert.equal(fleetAskRows([row()]).length, 1);
	/* Anything else is an absence, not a crash. */
	assert.deepEqual(fleetAskRows(null), []);
	assert.deepEqual(fleetAskRows({ nope: true }), []);
});

test("the outstanding count is the backend's own set: open and timed-out, not settled", () => {
	const rows = [
		row({ ask_id: "a-1", status: "open" }),
		row({ ask_id: "a-2", status: "timed_out" }),
		row({ ask_id: "a-3", status: "answered" }),
		row({ ask_id: "a-4", status: "declined" }),
	];
	assert.equal(fleetAsksOutstanding(rows), 2);
	assert.equal(fleetAsksOutstanding([]), 0);
});

test("the drawer's frontend states the same count the badge does", () => {
	const rows = [
		row({ ask_id: "a-1" }),
		row({ ask_id: "a-2", status: "answered" }),
	];
	const frontend = fleetAskFrontend(rows);
	assert.equal(frontend.asks.length, 2);
	assert.equal(frontend.asks_open, 1);
	assert.equal(frontend.asks_truncated, false);
	/* The scope line states the scope: the whole point of the second context. */
	assert.equal(
		askScopeLine("fleet", {
			rows: [],
			waiting: 1,
			movedOn: 0,
			open: 1,
			truncated: false,
		}),
		"All conversations · 1 question waiting",
	);
	assert.equal(
		askScopeLine("session", {
			rows: [],
			waiting: 1,
			movedOn: 0,
			open: 1,
			truncated: false,
		}),
		"This conversation · 1 question waiting",
	);
	/* The MIXED queue is where the drawer's clause differs from the chip's, and the
	 * two scopes must not diverge on it either. */
	assert.equal(
		askScopeLine("fleet", {
			rows: [],
			waiting: 2,
			movedOn: 3,
			open: 5,
			truncated: false,
		}),
		"All conversations · 2 waiting, 3 moved on",
	);
});

/* ------------------------------------------------- the correctness heart */

test("an answer is addressed at the ROW's own conversation", () => {
	const rows = [
		row({ ask_id: "a-1", session_id: "111111111111" }),
		row({ ask_id: "a-2", session_id: "222222222222" }),
	];
	assert.equal(fleetAskSessionFor(rows, "a-2"), "222222222222");
	assert.equal(fleetAskSessionFor(rows, "a-1"), "111111111111");
	/*
	 * An id the panel is not painting refuses rather than guessing: the answer must
	 * never fall back to the conversation that happens to be open.
	 */
	assert.equal(fleetAskSessionFor(rows, "a-9"), null);
	assert.equal(fleetAskSessionFor([], "a-1"), null);
});

test("a row's conversation is named from the wire, never from display text", () => {
	assert.equal(
		fleetAskConversationLabel(
			row({ cwd: "/Users/someone/projects/pergamon-labs/" }),
		),
		"pergamon-labs",
	);
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "C:\\work\\minervaai" })),
		"minervaai",
	);
	/* No `cwd`: the id's tail is the honest name rather than nothing at all. */
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "", session_id: "abcdef123456" })),
		"conversation 3456",
	);
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "", session_id: null })),
		null,
	);
});

/* ------------------------------------------------------------- the store */

test("the scope travels with the flag and is never persisted", () => {
	const store = useUiPreferencesStore.getState();
	useUiPreferencesStore.setState({
		isCanvasOpen: true,
		isAskDrawerOpen: false,
		askDrawerScope: "session",
	});
	store.setAskDrawerOpen(true, "fleet");
	const opened = useUiPreferencesStore.getState();
	assert.equal(opened.isAskDrawerOpen, true);
	assert.equal(opened.askDrawerScope, "fleet");
	/* One right pane at a time still holds: the fleet pane took the slot. */
	assert.equal(opened.isCanvasOpen, false);
	/* And the scope is dropped from what goes to disk, with the flag it qualifies. */
	assert.equal("askDrawerScope" in persistedUiPreferences(opened), false);
	assert.equal("isAskDrawerOpen" in persistedUiPreferences(opened), false);
	/* Closing leaves the scope alone; it is meaningless while nothing is open. */
	store.setAskDrawerOpen(false, "fleet");
	assert.equal(useUiPreferencesStore.getState().isAskDrawerOpen, false);
});

test("the drawer wears the canvas family's width in either scope", () => {
	const base = useUiPreferencesStore.getState();
	const fleet = resolveRightSlotWidth(1400, {
		...base,
		isAskDrawerOpen: true,
		askDrawerScope: "fleet",
	});
	const session = resolveRightSlotWidth(1400, {
		...base,
		isAskDrawerOpen: true,
		askDrawerScope: "session",
	});
	assert.equal(fleet, session);
	assert.equal(fleet, 560);
});

test("the query key is one document, so the badge and the list cannot diverge", () => {
	assert.deepEqual(FLEET_ASKS_QUERY_KEY, ["desktop", "asks"]);
});

/* ----------------------------------------------------- the wiring, pinned */

/*
 * THE TWO MOUNT SITES, read from source. Both are one-line facts a refactor can
 * lose silently - and losing either is not a style change: the first one puts the
 * session drawer's answers on the fleet's rows, the second mounts the shell's
 * pane on every route including the ones with no chat surface. `pane-slot-ground`
 * pins the slot's own class string for the same reason.
 */
const read = (rel) => readFileSync(join(process.cwd(), rel), "utf8");

test("the shell owns the fleet pane, and the route owns the session one", () => {
	const shell = read(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.ok(
		/askDrawerOpen\s*&&\s*askDrawerScope\s*===\s*"fleet"/.test(shell),
		"chat-layout no longer mounts the FLEET drawer. The top-level row's press would then open nothing on every route but /chat, which is the entry point the operator asked for.",
	);
	assert.ok(
		shell.includes("FleetAskDrawer"),
		"chat-layout no longer renders the fleet drawer component.",
	);
	const content = read(
		"src/renderer/src/features/chat/components/chat-content.tsx",
	);
	assert.ok(
		/const sessionAsksOpen\s*=\s*isAskDrawerOpen\s*&&\s*askDrawerScope\s*===\s*"session"/.test(
			content,
		),
		"chat-content no longer gates its drawer on the SESSION scope. One flag with two homes needs the scope to pick the home, or both drawers paint at once.",
	);
	assert.ok(
		/\{sessionAsksOpen && \(/.test(content),
		"chat-content no longer renders its drawer through the scope-gated flag.",
	);
});

test("the fleet drawer answers by looking the row's session up", () => {
	const drawer = read(
		"src/renderer/src/features/chat/components/asks/fleet-ask-drawer.tsx",
	);
	assert.ok(
		drawer.includes("fleetAskSessionFor("),
		"the fleet drawer no longer resolves each answer's session from the row. An answer posted to the open conversation instead is exactly the misroute the scope split exists to prevent.",
	);
	assert.ok(
		!/sessionId\s*:\s*["']/.test(drawer),
		"the fleet drawer appears to hard-code a session id.",
	);
});
