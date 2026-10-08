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
			'export { fleetAskRows, fleetAskFrontend, fleetAsksOutstanding, fleetAsksBySession, fleetAskSessionFor, fleetAskConversationLabel, fleetAskConversationLabels, FLEET_ASKS_QUERY_KEY, FLEET_ASKS_POLL_MS } from "./src/renderer/src/features/chat/fleet-asks";',
			'export { useUiPreferencesStore, persistedUiPreferences, resolveRightSlotWidth } from "./src/renderer/src/shared/store/ui-preferences-store";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { askScopeLine, ASK_ITEM_SELECTOR, ASK_HEADER_ITEM_SELECTOR } from "./src/renderer/src/features/chat/ask-queue";',
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
	fleetAsksBySession,
	fleetAskSessionFor,
	fleetAskConversationLabel,
	fleetAskConversationLabels,
	FLEET_ASKS_QUERY_KEY,
	useUiPreferencesStore,
	persistedUiPreferences,
	resolveRightSlotWidth,
	desktopEndpoint,
	desktopRequestSchema,
	askScopeLine,
	ASK_ITEM_SELECTOR,
	ASK_HEADER_ITEM_SELECTOR,
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

/*
 * THE PER-CONVERSATION COUNTS the sidebar's own row marks read, and the reason
 * they come from here rather than from `SessionCatalogueRow.asks_open`: the
 * desktop catalogue route never fills that field, so a mark sourced from the row
 * alone draws NOTHING - which was the operator's report, verbatim ("the session's
 * sidebar row showed nothing" while the composer chip read "1 question
 * waiting"). The count is the same predicate and the same population as the
 * badge above, which is what keeps the row and the top-level total one claim.
 */
test("the outstanding set is counted per conversation, and a quiet row is absent", () => {
	const rows = [
		row({ ask_id: "a-1", session_id: "s-one" }),
		row({ ask_id: "a-2", session_id: "s-one", status: "timed_out" }),
		row({ ask_id: "a-3", session_id: "s-two" }),
		row({ ask_id: "a-4", session_id: "s-one", status: "answered" }),
		row({ ask_id: "a-5", session_id: "s-three", status: "declined" }),
	];
	const bySession = fleetAsksBySession(rows);
	// Timed-out is still outstanding (a late answer reaches the agent), settled is
	// not - so `s-one` is 2 and not 3, and not 1 either.
	assert.equal(bySession.get("s-one"), 2);
	assert.equal(bySession.get("s-two"), 1);
	/* Absent, not `0`: every reader treats a miss as "draw nothing", and a zero
	 * entry would be a claim no caller wants and one more shape to keep true. */
	assert.equal(bySession.has("s-three"), false);
	assert.equal(bySession.size, 2);
	assert.equal(fleetAsksBySession([]).size, 0);
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
	/* The scope line states the scope: the whole point of the second context.
	 *
	 * `published: true` is the WIRE FIX's capability read (`asks` OR `asks_open`
	 * present) and these literals must carry it: a view that has not been read gets
	 * the drawer's unread clause instead of a count, which is the whole point of the
	 * field - so a fixture that omits it is asserting the unread frame by accident. */
	assert.equal(
		askScopeLine("fleet", {
			rows: [],
			waiting: 1,
			movedOn: 0,
			open: 1,
			truncated: false,
			published: true,
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
			published: true,
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
			published: true,
		}),
		"All conversations · 2 waiting, 3 moved on",
	);
	/*
	 * AND AN UNREAD FRAME IS NOT A ZERO ONE, NOR AN UNSUPPORTED ONE (remediation round
	 * 1: D1, D5). `unread` is what separates the two unpublishable frames: a read in
	 * flight names itself in the BODY, so the bar carries no clause at all (the
	 * separator goes with it), while a resolved frame that publishes no engine states the
	 * capability it lacks. Neither may read as `All asks settled`, which is the verdict
	 * their zero count would otherwise compose (the `a failure must not wear a verdict's
	 * clothes` rule the lane's copy contract keeps).
	 */
	assert.equal(
		askScopeLine("session", {
			rows: [],
			waiting: 0,
			movedOn: 0,
			open: 0,
			truncated: false,
			published: false,
			unread: true,
		}),
		"This conversation",
		"an unread frame drops the clause: the body names that fact once",
	);
	assert.equal(
		askScopeLine("session", {
			rows: [],
			waiting: 0,
			movedOn: 0,
			open: 0,
			truncated: false,
			published: false,
			unread: false,
		}),
		"This conversation · Asks unavailable",
		"a runtime that answered with `no engine` says so rather than promising a read",
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

test("a row's conversation is named the way the sessions list names it", () => {
	/*
	 * THE TITLE FIRST, which is the name `chat-sidebar.tsx` gives the same
	 * conversation: one conversation must not have two names, and two conversations
	 * in one repository must not print one (design review round 1, D1; UX round 1,
	 * U2). `titleOf` is the catalogue's answer for the row's `session_id`.
	 */
	const titles = new Map([
		["abcdef123456", "Ship the ask remediation"],
		["feedfacecafe", "Pergamon enrichment"],
	]);
	const titleOf = (id) => titles.get(id);
	assert.equal(
		fleetAskConversationLabel(
			row({ cwd: "/Users/someone/projects/pergamon-labs" }),
			titleOf,
		),
		"Ship the ask remediation",
	);
	/* No catalogue entry (an archived or un-paged conversation): the directory. */
	assert.equal(
		fleetAskConversationLabel(
			row({
				cwd: "/Users/someone/projects/pergamon-labs/",
				session_id: "999999999",
			}),
			titleOf,
		),
		"pergamon-labs",
	);
	/* An empty/absent title is a place-holder, not a name: the directory is better. */
	assert.equal(
		fleetAskConversationLabel(
			row({ cwd: "/Users/someone/projects/pergamon-labs" }),
			() => "   ",
		),
		"pergamon-labs",
	);
	/* The basename rules are unchanged when no catalogue is consulted. */
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "C:\\work\\minervaai" })),
		"minervaai",
	);
	/* No `cwd` and no title: the id's tail is the honest name rather than nothing. */
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "", session_id: "abcdef123456" })),
		"conversation 3456",
	);
	assert.equal(
		fleetAskConversationLabel(row({ cwd: "", session_id: null })),
		null,
	);
});

test("two rows that would print one name are disambiguated", () => {
	/*
	 * The case the fixture could not show and the operator's own install does: two
	 * conversations open in one repository, neither with a title to separate them.
	 * Resolving the names over the WHOLE visible set is what makes the tail
	 * available to append (design review round 1, D1).
	 */
	const labels = fleetAskConversationLabels([
		row({
			ask_id: "a-1",
			cwd: "/Users/someone/pergamon-labs",
			session_id: "aaaa11112222",
		}),
		row({
			ask_id: "a-2",
			cwd: "/Users/someone/pergamon-labs",
			session_id: "bbbb33334444",
		}),
		row({
			ask_id: "a-3",
			cwd: "/Users/someone/minervaai",
			session_id: "cccc55556666",
		}),
	]);
	assert.equal(labels.get("a-1"), "pergamon-labs · 2222");
	assert.equal(labels.get("a-2"), "pergamon-labs · 4444");
	/* A unique name is left alone: the tail is a disambiguator, not a suffix. */
	assert.equal(labels.get("a-3"), "minervaai");
	/*
	 * SEVERAL ASKS FROM ONE CONVERSATION ARE NOT A COLLISION - the ordinary case,
	 * and the one the first capture of this set got wrong (three cards of one
	 * conversation came out `Migrate the billing schema · cdef`).
	 */
	const oneConversation = fleetAskConversationLabels(
		[
			row({ ask_id: "a-1", cwd: "/p", session_id: "aaaa11112222" }),
			row({ ask_id: "a-2", cwd: "/p", session_id: "aaaa11112222" }),
			row({ ask_id: "a-3", cwd: "/p", session_id: "aaaa11112222" }),
		],
		() => "Migrate the billing schema",
	);
	assert.equal(oneConversation.get("a-1"), "Migrate the billing schema");
	assert.equal(oneConversation.get("a-3"), "Migrate the billing schema");
	/* Titles separate two conversations in one directory without a tail. */
	const titled = fleetAskConversationLabels(
		[
			row({ ask_id: "a-1", cwd: "/p", session_id: "aaaa11112222" }),
			row({ ask_id: "a-2", cwd: "/p", session_id: "bbbb33334444" }),
		],
		(id) => (id === "aaaa11112222" ? "first" : "second"),
	);
	assert.equal(titled.get("a-1"), "first");
	assert.equal(titled.get("a-2"), "second");
	/* A row that names nothing is not in the map at all, so the panel draws no line. */
	assert.equal(
		fleetAskConversationLabels([
			row({ ask_id: "a-9", cwd: "", session_id: null }),
		]).has("a-9"),
		false,
	);
});

test("every press is addressed at the pressed row's OWN conversation", () => {
	/*
	 * THE CHECK THE OLD PROOF'S AGGREGATE SENTENCE DID NOT ACTUALLY MAKE (agent
	 * review round 1, F4). `prove-answer-addressing.mjs` printed `requests
	 * addressing a session that is not the row's own: 0` while filtering on
	 * `!rows.some(r => r.session_id === request.sessionId)` - satisfied by ANY row's
	 * session, so a press addressed to the wrong ROW's conversation passed it. The
	 * durable form is per PRESS: the target must equal the `session_id` of the very
	 * row the press carries, and the open conversation's id must never appear.
	 */
	const rows = [
		row({ ask_id: "a-1", session_id: "111111111111" }),
		row({ ask_id: "a-2", session_id: "222222222222" }),
		row({ ask_id: "a-3", session_id: "333333333333" }),
	];
	const openConversation = "999999999999";
	const mismatches = rows.filter(
		(pressed) =>
			fleetAskSessionFor(rows, pressed.ask_id) !== pressed.session_id,
	);
	assert.deepEqual(mismatches, [], "a press must target the row's own session");
	/*
	 * And the mis-address is not merely absent by luck: nothing in this path can
	 * produce the open conversation's id, because the only input is the pressed
	 * row. An id the panel is not painting refuses rather than falling back.
	 */
	assert.equal(fleetAskSessionFor(rows, "a-not-painted"), null);
	assert.ok(
		rows.every(
			(pressed) =>
				fleetAskSessionFor(rows, pressed.ask_id) !== openConversation,
		),
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
	/*
	 * A conversation route: the facts the slot's resolver reads since #868. The
	 * session-scope arm needs them (a session drawer has no home without a
	 * conversation); the fleet arm's home is the shell whatever the route.
	 */
	const drawable = { mounted: true, runDetails: true, session: true };
	const fleet = resolveRightSlotWidth(1400, {
		...base,
		isAskDrawerOpen: true,
		askDrawerScope: "fleet",
		rightSlotRoute: drawable,
	});
	const session = resolveRightSlotWidth(1400, {
		...base,
		isAskDrawerOpen: true,
		askDrawerScope: "session",
		rightSlotRoute: drawable,
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

/*
 * THE DOOR, THE KEY AND THE NAME, pinned at the source. All three are the class
 * of fact a refactor loses silently: the pane's Escape claim, the selector the
 * drawer's entry move accepts, and the key that keeps two `/chat` rows apart.
 */
test("the fleet pane claims Escape at the window, and the drawer accepts the header door", () => {
	const drawer = read(
		"src/renderer/src/features/chat/components/asks/fleet-ask-drawer.tsx",
	);
	assert.match(
		drawer,
		/window\.addEventListener\("keydown"/,
		"the fleet pane no longer claims Escape at the window. Its own section handler cannot see a press made on the rail row that opened it, and the press then falls to the interrupt rung and stops the running turn (UX round 1, U1 / agent review round 1, F1).",
	);
	assert.match(
		drawer,
		/pressLandsOnOverlay\(event\.target\)/,
		"the claim must defer to an open dialog/menu/listbox, the same guard the canvas uses.",
	);
	assert.match(
		drawer,
		/event\.preventDefault\(\)/,
		"the claim must preventDefault: the interrupt ladder stands down on that flag, and on nothing else.",
	);
	const container = read(
		"src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
	);
	assert.ok(
		container.includes("ASK_HEADER_ITEM_SELECTOR"),
		"the drawer's entry move no longer accepts the header door, so focus never enters the pane when it is opened from the header trigger.",
	);
	assert.equal(ASK_HEADER_ITEM_SELECTOR, '[data-tour-tag="ask-pane-trigger"]');
});

test("the nav list is keyed by the row's own tag, not the shared route", () => {
	const nav = read(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(
		nav,
		/key=\{item\.tourTag\}/,
		"the rows must be keyed by something unique per row.",
	);
	assert.ok(
		!/key=\{item\.path\}/.test(nav),
		'Aida\'s row carries `path: "/chat"` and resolves asynchronously - keying by path is the duplicate-key warning and ambiguous reconciliation design review round 1, F2 recorded.',
	);
});

/*
 * THE ENTRY POINT LIVES IN THE HEADER (operator ask, 2026-10-05). The row this
 * lane used to be opened from was removed from the sidebar because that column
 * was over-subscribed, so the door moved into the conversation header's own
 * cluster - and this pins the move at the source, because the failure mode is
 * silent: the fleet scope would simply have no door, and every read behind it
 * would keep working while the surface became unreachable.
 */
test("the asks door left the sidebar for the conversation header", () => {
	const nav = read(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.ok(
		!/nav-item-asks/.test(nav),
		"the sidebar still carries the `All asks` row. The operator asked for it to come out: the nav column was over-subscribed, and the row was a disclosure wearing a destination's clothes.",
	);
	const header = read(
		"src/renderer/src/features/chat/components/chat-header.tsx",
	);
	assert.match(
		header,
		/data-tour-tag="ask-pane-trigger"/,
		"the header cluster no longer carries the asks trigger, which is the door the selector above names.",
	);
	assert.match(
		header,
		/onToggleAsks/,
		"the header must take the asks door as a prop rather than reach into the store: it is rendered for a draft too, where the scope is the fleet's.",
	);
	const content = read(
		"src/renderer/src/features/chat/components/chat-content.tsx",
	);
	assert.match(
		content,
		/setAskDrawerOpen\(!headerAsksOpen, headerAsksScope\)/,
		"the header door must open the drawer in the scope its own conversation resolves to (session inside a session, fleet at the top level).",
	);
	assert.match(
		content,
		/headerAsksScope: AskScope = headerAsksSession \? "session" : "fleet"/,
		"and the scope split is the operator's own: a session's asks inside a conversation, the total at the top level.",
	);
});

test("the fleet drawer names its cards from the sessions catalogue", () => {
	const drawer = read(
		"src/renderer/src/features/chat/components/asks/fleet-ask-drawer.tsx",
	);
	assert.ok(
		drawer.includes("fleetAskConversationLabels("),
		"the labels must be resolved over the whole visible set so a collision can be disambiguated (design review round 1, D1).",
	);
	assert.ok(
		drawer.includes("useCanonicalSessionsStore"),
		"and the names must come from the same catalogue the sessions list reads.",
	);
	const container = read(
		"src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
	);
	assert.ok(
		container.includes("conversationOf={conversationOf}"),
		"the container must take the conversation line from its caller rather than reading the fleet model itself.",
	);
});

/*
 * THE ENTRY MOVE'S BOUND, pinned as behaviour-in-source (F3). The rig proves it
 * (`fleet-ask-escape-evidence.mjs`), but a rig is an `*-evidence.mjs` and sits
 * outside `test:desktop`: the only other claim this lane makes on `ask-drawer.tsx`
 * is that the selector STRING appears in it, so a re-added `[]` dependency array -
 * or a one-shot spent only by a commit that found both a door and a surface - would
 * restore the old steal with every gate green.
 *
 * The invariant, in the order the block reads: the effect is offered every commit
 * (no dependency array); the ONLY early return that keeps the one-shot alive is "a
 * door is under focus and its surface is not drawn yet" - the awaiting read; and
 * the flag is consumed BEFORE the door is required, so a mount with nothing focused
 * resolves instead of watching the rail row for the rest of the pane's life.
 */
test("the drawer's entry move is a bounded one-shot", () => {
	const src = read(
		"src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
	);
	const start = src.indexOf("const wasBootstrapped = useRef(false);");
	assert.notEqual(start, -1, "the entry move is gone from the drawer");
	const focused = src.indexOf("landing.focus();", start);
	assert.notEqual(
		focused,
		-1,
		"the entry move no longer focuses the landed control",
	);
	/*
	 * THE EFFECT'S OWN CLOSE, whichever shape it has, so assertion 1 below reds on
	 * the dependency array rather than on a slice that ran away. A real `}, []);`
	 * removes the `\n\t});` this used to search for, and with one `\n\t});` behind
	 * `landing.focus()` in the whole file the old slice then failed its own "no
	 * closing line" guard - a red for the mutation, but reported as a broken
	 * extraction instead of as the dependency array it is (QA round 1's note). The
	 * bare close and the deps close are both accepted here; taking whichever comes
	 * FIRST, and running the block THROUGH the end of that line rather than up to its
	 * start, leaves the closing line itself inside the slice - which is where the
	 * dependency array would live. Slicing up to the terminator's own start would
	 * exclude it and assertion 1 would pass on the very mutation it exists for.
	 */
	const bareClose = src.indexOf("\n\t});", focused);
	const depsClose = src.indexOf("\n\t}, [", focused);
	const closeStart =
		depsClose !== -1 && (bareClose === -1 || depsClose < bareClose)
			? depsClose
			: bareClose;
	assert.notEqual(
		closeStart,
		-1,
		"the entry move's effect has no closing line",
	);
	const afterClose = src.indexOf("\n", closeStart + 1);
	const block = src.slice(start, afterClose === -1 ? undefined : afterClose);

	/* 1. No dependency array: the effect must be offered every commit until the
	 * surface it may focus has been drawn, or it runs once on the empty mount commit
	 * and the re-render carrying the rows never gets its chance (U1). */
	assert.ok(
		!block.includes("\n\t}, ["),
		"the entry move grew a dependency array; it must be offered every commit until it is consumed.",
	);

	/* 2. The bounded window: this pair is the ONLY state that retries, and a
	 * `door === null` early return that does not consume is the old unbounded shape.
	 *
	 * THE WINDOW IS SPELLED ON THE FRAME, NOT ON THE ROOT (the stuck-slot fix): the
	 * container draws its chrome on every frame now, so a root exists from the first
	 * commit and `root === null` no longer names "the read has not answered". The
	 * state the wait is for is the frame's absence, so the frame is what it reads.
	 *
	 * THIS IS THE STRUCTURAL HALF AND IT HAS A BEHAVIOURAL COMPANION, which is the
	 * answer to "does this assert a string or a fact" (agent review round 1, R4):
	 * `scripts/ask-draft-swap.test.mjs`'s `the entry move waits for the frame and moves
	 * focus once it lands` mounts the drawer with focus on the header door over an
	 * unread frame, asserts the keyboard stayed on the door, then rerenders with the
	 * rows and asserts the one-shot resolved onto the card's first option. What THIS
	 * assertion adds, which that one cannot: the no-dependency-array and
	 * spend-before-require properties are shape facts about an effect that runs every
	 * commit, and driving every commit's timing through jsdom would be a weaker reading
	 * than the two-line property it already states. */
	assert.ok(
		block.includes("if (door !== null && frameUnread) return;"),
		"the entry move no longer bounds its retry to the awaiting-read window (a door under focus while the frame that carries its surface is unread).",
	);
	const consume = block.indexOf("wasBootstrapped.current = true;");
	/* 3. The flag is spent before the door is required, and focus can move only
	 * after both checks - so a mount with nothing focused resolves, and the bounded
	 * wait cannot move anything either. */
	const resolved = block.indexOf("if (door === null) return;");
	assert.ok(
		consume !== -1 && resolved !== -1 && consume < resolved,
		"the one-shot is spent only after the door check; a mounted pane with no door under focus never resolves and a later Tab onto the rail row can steal focus.",
	);
	assert.ok(
		block.indexOf("landing.focus();") > resolved,
		"focus can move before the door check has resolved.",
	);
});
