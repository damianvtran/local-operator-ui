import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE ASKS DRAWER'S OPEN POLICY, pinned as a decision over facts.
 *
 * WHAT THIS FILE IS: the web UI's half of the shared open-policy contract (see the
 * module note in `ask-open-policy.ts` for the six rules), driven FRAME BY FRAME the way
 * the app drives it - one `AskOpenView` per mounted pane, fed the facts the pane has on
 * each render - with the frames built by the SHIPPED `askQueueView` from wire-shaped
 * payloads rather than hand-written facts. A fact written by hand would be a claim
 * about what the wire looks like; a frame built from the wire's own shapes is the
 * claim the wire makes.
 *
 * THE FOUR STATES of the matrix, named for the operator's request:
 *   1. no asks            -> closed
 *   2. pending on open    -> open (once)
 *   3. all addressed      -> closed, and never re-opens once settled
 *   4. dismissed pending  -> stays closed through a re-render, a queue refresh, an ask
 *                            arriving, and a switch away and back
 * plus the guards that make the policy safe to ship: an unresolved frame opens nothing,
 * a tally with no rows opens nothing, an ask that ARRIVED during the view is not
 * "pending on open", a first answer that comes after the window is not "on open", and
 * an open never takes the user's keyboard.
 *
 * WHAT IT CANNOT CLAIM: that the drawer is on screen. That is `ask-open-render.test.mjs`
 * (the hook and the real drawer in jsdom) and the committed frames. The module under
 * test is DOM-free by construction, and one of the cases below pins that as a property
 * of its source.
 */

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/chat/ask-open-policy";
			export { askQueueView } from "./src/renderer/src/features/chat/ask-queue";
		`,
		loader: "ts",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	// `ask-queue` reaches `userFacingMessage` through `@shared/api/...`.
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
	logLevel: "silent",
});
const bundlePath = new URL(
	`./_ask-open-policy-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let policy;
try {
	policy = await import(bundlePath.href);
} finally {
	// Removed even when the import throws: a stray bundle in `scripts/` is repo
	// scratch that a `git add -A` would commit.
	await unlink(bundlePath).catch(() => {});
}
const {
	ASK_ARRIVAL_SKEW_MS,
	ASK_OPEN_WINDOW_MS,
	askOpenFacts,
	askQueueView,
	createAskDismissals,
	createAskOpenView,
	decideAskAutoOpen,
	shouldCloseCarriedDrawer,
} = policy;

/*
 * What "no DOM" means for the module's source, as patterns hoisted to module scope
 * (a regex literal inside a test body is rebuilt per call). Comments are blanked
 * first, so the module's own prose about focus does not trip the pin.
 */
const DOM_REACHES = [
	/\.focus\s*\(/,
	/\bdocument\b/,
	/\bwindow\b/,
	/\bactiveElement\b/,
	/\bimport\s+[^;]*\breact\b/,
];
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:])\/\/.*$/gm;

/*
 * THE CLOCK. `T0` is the instant every view in this file begins, in the unit an ask's
 * `created_at` uses (epoch milliseconds). An ask built by `ask()` is OLD by default -
 * queued a minute before the view - which is the ordinary "pending on open" row; the
 * arrival cases build theirs with `arrivedAfter`.
 */
const T0 = 1_760_000_000_000;
const TS = T0 - 60_000;
let counter = 0;
/** One ask row as the wire carries it; `status` is the fold's word for its state. */
const ask = (status = "open", extra = {}) => {
	counter += 1;
	return {
		ask_id: `ask-${counter}`,
		created_at: TS + counter,
		expires_at: T0 + 3_600_000,
		timeout_s: 3600,
		status,
		delivered: status !== "open" && status !== "timed_out",
		questions: [
			{
				id: "target",
				question: "Which environment?",
				options: [{ label: "staging" }],
			},
		],
		...extra,
	};
};

/*
 * THE WIRE'S FRAMES, one constructor each, named for what the core publishes
 * (`ask_wire`): a queue with rows publishes `asks` plus the outstanding tally; a live
 * queue with nothing in it publishes the tally ALONE (`asks` absent, `asks_open: 0`);
 * a runtime that cannot answer publishes neither; and a frame that has not been read
 * is `null`.
 */
const OUTSTANDING = new Set(["open", "timed_out"]);
const withRows = (rows) => ({
	asks: rows,
	asks_open: rows.filter((row) => OUTSTANDING.has(row.status)).length,
	asks_truncated: null,
});
const liveEmpty = () => ({ asks: null, asks_open: 0 });
const unsupported = () => ({ asks: null, asks_open: null });
const tallyOnly = (n) => ({ asks: null, asks_open: n, asks_truncated: true });
const unread = () => null;

/**
 * One render's facts for a pane showing conversation `c-a`: the queue facts come from
 * the shipped read model, the rest are the pane's ordinary state, overridable per case.
 */
const frame = (frontend, over = {}) => ({
	conversationId: "c-a",
	...askOpenFacts(askQueueView(frontend), T0),
	nowMs: T0 + 1_000,
	composerHasText: false,
	keyboardOnDoor: false,
	drawerOpen: false,
	sessionDrawerOpen: false,
	...over,
});

/** A pane's life: a fresh view over the page's dismissals, fed frames in order. */
const pane = (dismissals = createAskDismissals()) => ({
	dismissals,
	view: createAskOpenView(dismissals, T0),
});

const opened = { drawerOpen: true, sessionDrawerOpen: true };

/* ======================================================= the four states ==== */

test("state 1 - no asks on open: closed, and an ask that arrives later does not open it", () => {
	for (const empty of [liveEmpty(), withRows([])]) {
		const { view } = pane();
		const first = view.observe(frame(empty));
		assert.equal(first.verdict.action, "leave");
		assert.equal(first.verdict.reason, "nothing-pending");
		assert.equal(first.verdict.settled, true, "an empty queue is a decision");
		/*
		 * RULE 4's last clause, from the other direction: the chip and the badge cover
		 * a NEW ask, the surface does not jump open for it. The view already decided.
		 */
		const later = view.observe(frame(withRows([ask("open")])));
		assert.equal(later.verdict.action, "leave");
		assert.equal(later.verdict.reason, "already-decided");
	}
});

test("state 2 - pending on open: opens, once, and then lets go", () => {
	const { view } = pane();
	const first = view.observe(frame(withRows([ask("open")])));
	assert.deepEqual(
		{ action: first.verdict.action, reason: first.verdict.reason },
		{ action: "open", reason: "pending-on-open" },
	);
	assert.equal(view.settled, true);
	/*
	 * ONCE. Every frame after the decision - the same frame again (a re-render), a
	 * refreshed queue, a second ask arriving, the drawer already up - is the user's.
	 */
	const rows = [ask("open")];
	for (const later of [
		frame(withRows(rows), opened),
		frame(withRows(rows), opened),
		frame(withRows([...rows, ask("open")]), opened),
		frame(withRows([ask("answered"), ask("open")]), opened),
	]) {
		const again = view.observe(later);
		assert.equal(again.verdict.action, "leave");
		assert.equal(again.verdict.reason, "already-decided");
	}
});

test("state 2 - an ask the agent has stopped waiting for is still pending", () => {
	/*
	 * `timed_out` is OUTSTANDING (the fold keeps it answerable: a late answer still
	 * reaches the agent) and the header badge counts it, so a conversation whose only
	 * ask has moved on is not a conversation with nothing to answer.
	 */
	const { view } = pane();
	assert.equal(
		view.observe(frame(withRows([ask("timed_out")]))).verdict.action,
		"open",
	);
});

test("state 3 - all addressed on open: closed, and settling never re-opens", () => {
	const settled = ["answered", "declined", "dismissed", "late", "expired"];
	for (const status of settled) {
		const { view } = pane();
		const first = view.observe(frame(withRows([ask(status)])));
		assert.equal(
			first.verdict.action,
			"leave",
			`a ${status} ask is not pending`,
		);
		assert.equal(first.verdict.reason, "nothing-pending");
	}
	/* An unknown status degrades to "not pending", never silently to "open". */
	assert.equal(
		pane().view.observe(frame(withRows([ask("a-status-from-the-future")])))
			.verdict.action,
		"leave",
	);

	/*
	 * NEVER RE-OPENS ONCE SETTLED, on the path that matters: the policy opened the
	 * drawer, the user answered, the queue settled, and the drawer closed itself over
	 * the empty queue (#864). Nothing in that sequence is the user turning the surface
	 * away, so it records no dismissal - and nothing in it re-opens.
	 */
	const { view, dismissals } = pane();
	const row = ask("open");
	assert.equal(view.observe(frame(withRows([row]))).verdict.action, "open");
	view.observe(frame(withRows([row]), opened));
	const answered = { ...row, status: "answered", delivered: true };
	const settledFrame = view.observe(frame(withRows([answered]), opened));
	assert.equal(settledFrame.verdict.reason, "already-decided");
	const closed = view.observe(frame(withRows([answered])));
	assert.equal(closed.closeWatch, "nothing-to-show");
	assert.equal(
		dismissals.size,
		0,
		"the queue emptying under the drawer is not a deliberate close",
	);
	const fresh = view.observe(frame(withRows([ask("open")])));
	assert.equal(
		fresh.verdict.reason,
		"already-decided",
		"a new ask does not re-open",
	);
});

test("state 4 - dismissed while pending: stays closed, including after switching away and back", () => {
	const dismissals = createAskDismissals();
	const rows = [ask("open")];

	// The view opens it, the user closes it while the ask is still pending.
	const first = createAskOpenView(dismissals, T0);
	assert.equal(first.observe(frame(withRows(rows))).verdict.action, "open");
	first.observe(frame(withRows(rows), opened));
	const close = first.observe(frame(withRows(rows)));
	assert.equal(close.closeWatch, "dismissed");
	assert.equal(dismissals.has("c-a"), true);

	/* Stays closed on a re-render, a queue refresh, and an ask arriving or changing. */
	for (const later of [
		frame(withRows(rows)),
		frame(withRows(rows)),
		frame(withRows([ask("open"), ...rows])),
		frame(withRows([{ ...rows[0], status: "timed_out" }])),
		frame(withRows([ask("answered"), ask("open")])),
	]) {
		const again = first.observe(later);
		assert.equal(again.verdict.action, "leave");
	}

	/*
	 * SWITCH AWAY AND BACK: the pane unmounts and a NEW view mounts for the same
	 * conversation, over the page's same dismissals. Its first published frame is
	 * pending and it still stays closed - which is the whole point of keying the record
	 * by conversation outside the view.
	 */
	const back = createAskOpenView(dismissals, T0);
	assert.equal(back.observe(frame(unread())).verdict.reason, "unresolved");
	const returned = back.observe(frame(withRows(rows)));
	assert.deepEqual(
		{ action: returned.verdict.action, reason: returned.verdict.reason },
		{ action: "leave", reason: "dismissed" },
	);
	assert.equal(back.settled, true);
});

/* ============================================================ the guards ==== */

test("a dismissal belongs to its conversation, and to this page's lifetime only", () => {
	const dismissals = createAskDismissals();
	dismissals.record("c-a");

	// Another conversation's pending queue is not muted by it.
	const other = createAskOpenView(dismissals, T0);
	assert.equal(
		other.observe(frame(withRows([ask("open")]), { conversationId: "c-b" }))
			.verdict.action,
		"open",
	);

	// A fresh page lifetime is a fresh record: the same conversation opens again.
	const restarted = createAskOpenView(createAskDismissals(), T0);
	assert.equal(
		restarted.observe(frame(withRows([ask("open")]))).verdict.action,
		"open",
	);
});

test("the record is memory only: the policy module never reaches a store", () => {
	const source = stripComments(
		readFileSync(
			join(process.cwd(), "src/renderer/src/features/chat/ask-open-policy.ts"),
			"utf8",
		),
	);
	for (const forbidden of [
		"localStorage",
		"sessionStorage",
		"indexedDB",
		"document.cookie",
		"zustand",
	]) {
		assert.ok(
			!source.includes(forbidden),
			`the dismissal record must not outlive the page (rule 4), and the module names ${forbidden}`,
		);
	}
});

test("an unresolved frame opens nothing and spends nothing", () => {
	const { view } = pane();
	for (const [name, frontend] of [
		["an unread frame", unread()],
		["a runtime that publishes no engine", unsupported()],
	]) {
		const verdict = view.observe(frame(frontend)).verdict;
		assert.equal(verdict.action, "leave", name);
		assert.equal(verdict.reason, "unresolved", name);
		assert.equal(verdict.settled, false, `${name} must not spend the decision`);
	}
	assert.equal(view.settled, false);
	/* A conversation that warms later still gets its one decision. */
	assert.equal(
		view.observe(frame(withRows([ask("open")]))).verdict.action,
		"open",
	);
});

test("a tally with no rows behind it opens nothing, says so truthfully, and keeps waiting inside the window", () => {
	const { view } = pane();
	const first = view.observe(frame(tallyOnly(4)));
	assert.equal(first.verdict.action, "leave");
	assert.equal(
		first.verdict.reason,
		"tally-only",
		"four asks ARE outstanding; `nothing-pending` would be a false sentence",
	);
	assert.equal(
		first.verdict.settled,
		false,
		"a frame that cannot show the asks is not an answer about them: the view keeps waiting",
	);
	assert.equal(view.settled, false);

	/* The rows arrive inside the window (the wire re-sends a frame that fits): open. */
	const rescued = view.observe(
		frame(withRows([ask("open")]), { nowMs: T0 + 12_000 }),
	);
	assert.equal(rescued.verdict.action, "open");
	assert.equal(rescued.verdict.reason, "pending-on-open");
});

test("a tally that never gets its rows stops waiting when the window closes", () => {
	const { view } = pane();
	assert.equal(
		view.observe(frame(tallyOnly(4), { nowMs: T0 + 30_000 })).verdict.reason,
		"tally-only",
	);
	const late = view.observe(
		frame(withRows([ask("open")]), { nowMs: T0 + ASK_OPEN_WINDOW_MS + 1 }),
	);
	assert.deepEqual(
		{
			action: late.verdict.action,
			reason: late.verdict.reason,
			settled: late.verdict.settled,
		},
		{ action: "leave", reason: "too-late", settled: true },
	);
});

test("a draft has no conversation, and a view over one never settles", () => {
	const { view } = pane();
	const verdict = view.observe(
		frame(withRows([ask("open")]), { conversationId: undefined }),
	).verdict;
	assert.deepEqual(
		{
			action: verdict.action,
			reason: verdict.reason,
			settled: verdict.settled,
		},
		{ action: "leave", reason: "no-conversation", settled: false },
	);
});

test("opening never takes the user's keyboard: a held draft and a focused door both keep it shut", () => {
	/*
	 * The two moments an open would land on something the user is in the middle of:
	 *  - the composer holds text (rule 5: not while typing). On the desktop the drawer
	 *    cannot hurt the draft, so the LATCH is a judgment call the design round is asked
	 *    to make; this pins what ships, including that clearing the box later does not
	 *    open the surface for the view;
	 *  - the keyboard is on one of the drawer's doors, which the drawer would read as a
	 *    PRESS (rule 6) and answer by moving focus into its list.
	 * Both decline, both are final for the view, and neither is a dismissal.
	 */
	const rows = [ask("open")];
	for (const [over, reason] of [
		[{ composerHasText: true }, "composer-has-text"],
		[{ keyboardOnDoor: true }, "door-focused"],
	]) {
		const { view, dismissals } = pane();
		const verdict = view.observe(frame(withRows(rows), over)).verdict;
		assert.deepEqual(
			{
				action: verdict.action,
				reason: verdict.reason,
				settled: verdict.settled,
			},
			{ action: "leave", reason, settled: true },
		);
		assert.equal(dismissals.size, 0, "declining to knock is not a dismissal");
		assert.equal(
			view.observe(frame(withRows(rows), { composerHasText: false })).verdict
				.reason,
			"already-decided",
			"clearing the box later does not open it: the view decided on open",
		);
	}
});

test("the policy module has no DOM to move focus with", () => {
	const source = stripComments(
		readFileSync(
			join(process.cwd(), "src/renderer/src/features/chat/ask-open-policy.ts"),
			"utf8",
		),
	);
	for (const forbidden of DOM_REACHES) {
		assert.ok(
			!forbidden.test(source),
			`rule 5 is a property of the file: the policy must not touch ${forbidden}`,
		);
	}
});

test("an already-open drawer is left alone, in either scope", () => {
	const verdict = pane().view.observe(
		frame(withRows([ask("open")]), { drawerOpen: true }),
	).verdict;
	assert.deepEqual(
		{ action: verdict.action, reason: verdict.reason },
		{ action: "leave", reason: "drawer-open" },
	);
});

/* ======================================================== the close watch ==== */

test("a close before the queue answered spends the decision and records nothing", () => {
	/*
	 * The drawer was open (a door press, or the flag carried over from the last
	 * conversation) while the frame had not landed, and the user closed it. The frame
	 * landing with pending rows must not pop it back open (rule 4), but nobody saw
	 * whether asks remained, so the conversation is not recorded as dismissed.
	 */
	const { view, dismissals } = pane();
	view.observe(frame(unread(), opened));
	const closed = view.observe(frame(unread()));
	assert.equal(closed.closeWatch, "before-decision");
	assert.equal(view.settled, true);
	assert.equal(dismissals.size, 0);
	const landed = view.observe(frame(withRows([ask("open")])));
	assert.equal(landed.verdict.reason, "already-decided");
	// A later view of the same conversation is not muted by it.
	assert.equal(
		createAskOpenView(dismissals, T0).observe(frame(withRows([ask("open")])))
			.verdict.action,
		"open",
	);
});

test("a durable pane does not stop an auto-open: it borrows the slot like a press", () => {
	/*
	 * The policy has no slot term at all. The store's writer does the borrowing
	 * (`claimRightSlot` + `askDrawerEvictedPane`), exactly as for the chip, so the pane
	 * the user had up comes back when the drawer closes. Pinned as an ABSENCE: the
	 * decision's inputs name no pane, so a future "yield to the canvas" has to be a
	 * deliberate change to the contract rather than a clause that slipped in.
	 */
	const reasons = ["pane-open", "slot-held", "canvas-open"];
	const source = readFileSync(
		join(process.cwd(), "src/renderer/src/features/chat/ask-open-policy.ts"),
		"utf8",
	);
	for (const reason of reasons) {
		assert.ok(
			!source.includes(`"${reason}"`),
			`the policy names a ${reason} reason: auto-open yields to a pane the press does not`,
		);
	}
});

/* ====================================== the global flag carries across views ==== */

test("a policy-opened drawer carried onto a DISMISSED conversation is closed", () => {
	const dismissals = createAskDismissals();
	dismissals.record("c-a");
	const facts = (over = {}) => ({
		conversationId: "c-a",
		dismissed: dismissals,
		sessionDrawerOpen: true,
		openedByPolicy: true,
		...over,
	});
	assert.equal(shouldCloseCarriedDrawer(facts()), true);
	/* Each narrowing term is load-bearing: drop any one and the answer is no. */
	assert.equal(
		shouldCloseCarriedDrawer(facts({ openedByPolicy: false })),
		false,
		"a drawer the USER opened follows them, as it always did",
	);
	assert.equal(
		shouldCloseCarriedDrawer(facts({ sessionDrawerOpen: false })),
		false,
		"nothing to close; and a FLEET pane is not this conversation's to close",
	);
	assert.equal(
		shouldCloseCarriedDrawer(facts({ conversationId: "c-b" })),
		false,
		"another conversation was not dismissed",
	);
	assert.equal(
		shouldCloseCarriedDrawer(facts({ conversationId: undefined })),
		false,
		"a draft has no conversation to have dismissed",
	);
});

test("a swap to the fleet pane is not a dismissal", () => {
	const { view, dismissals } = pane();
	const rows = [ask("open")];
	view.observe(frame(withRows(rows), opened));
	const swapped = view.observe(
		frame(withRows(rows), { drawerOpen: true, sessionDrawerOpen: false }),
	);
	assert.equal(swapped.closeWatch, null);
	assert.equal(dismissals.size, 0);
});

test("a close over rows the frame could not show still counts as a dismissal", () => {
	/* The chip keeps counting them, so the surface was turned away over live asks. */
	const { view, dismissals } = pane();
	view.observe(frame(tallyOnly(4), opened));
	assert.equal(view.observe(frame(tallyOnly(4))).closeWatch, "dismissed");
	assert.equal(dismissals.has("c-a"), true);
});

/* ================================================= the decision, in isolation ==== */

test("the reason a verdict names is the first thing that kept the drawer shut", () => {
	const base = {
		conversationId: "c-a",
		resolved: true,
		pendingRows: 2,
		arrivedRows: 0,
		outstanding: 2,
		viewAgeMs: 1_000,
		dismissed: { has: () => false },
		viewDecided: false,
		composerHasText: false,
		keyboardOnDoor: false,
		drawerOpen: false,
	};
	const reason = (over) => decideAskAutoOpen({ ...base, ...over }).reason;
	assert.equal(reason({}), "pending-on-open");
	assert.equal(reason({ viewDecided: true }), "already-decided");
	assert.equal(reason({ resolved: false }), "unresolved");
	assert.equal(reason({ pendingRows: 0, outstanding: 0 }), "nothing-pending");
	assert.equal(reason({ pendingRows: 0, outstanding: 3 }), "tally-only");
	assert.equal(
		reason({ pendingRows: 0, arrivedRows: 2, outstanding: 2 }),
		"arrived",
	);
	assert.equal(reason({ viewAgeMs: ASK_OPEN_WINDOW_MS + 1 }), "too-late");
	assert.equal(
		reason({ viewAgeMs: ASK_OPEN_WINDOW_MS + 1, resolved: false }),
		"too-late",
		"the window outranks an unanswered queue: a view that never got an answer is decided",
	);
	/* Overrides are reported only over a queue that WOULD have opened. */
	assert.equal(
		reason({
			dismissed: { has: () => true },
			composerHasText: true,
			keyboardOnDoor: true,
			drawerOpen: true,
		}),
		"dismissed",
	);
	assert.equal(
		reason({ composerHasText: true, keyboardOnDoor: true, drawerOpen: true }),
		"composer-has-text",
	);
	assert.equal(
		reason({ keyboardOnDoor: true, drawerOpen: true }),
		"door-focused",
	);
	assert.equal(reason({ drawerOpen: true }), "drawer-open");
	assert.equal(
		reason({ pendingRows: 0, outstanding: 0, dismissed: { has: () => true } }),
		"nothing-pending",
		"a settled queue in a dismissed conversation says the truer thing",
	);
});

test("the facts are read off the shipped view: published, rows, and the wire's tally", () => {
	const facts = (frontend, startedAtMs = T0) =>
		askOpenFacts(askQueueView(frontend), startedAtMs);
	const none = { pendingRows: 0, arrivedRows: 0, outstanding: 0 };
	assert.deepEqual(facts(null), { resolved: false, ...none });
	assert.deepEqual(facts(unsupported()), { resolved: false, ...none });
	assert.deepEqual(facts(liveEmpty()), { resolved: true, ...none });
	assert.deepEqual(facts(tallyOnly(4)), {
		resolved: true,
		pendingRows: 0,
		arrivedRows: 0,
		outstanding: 4,
	});
	assert.deepEqual(
		facts(withRows([ask("open"), ask("timed_out"), ask("answered")])),
		{ resolved: true, pendingRows: 2, arrivedRows: 0, outstanding: 2 },
	);
});

/* ============================================ "on open" means it existed first ==== */

/** An outstanding ask the owner queued `ms` after the view began (an ARRIVAL). */
const arrivedAfter = (ms, status = "open") =>
	ask(status, { created_at: T0 + ms });

test("an ask that arrives on the view's first resolved frame is an arrival, not pending on open", () => {
	/*
	 * THE RACE the TUI lane found, and the same latch exists here: the view settles on
	 * its first RESOLVED reading, so a brand-new conversation whose first question lands
	 * on that very frame would read as "pending on open" and pop the drawer over a user
	 * who is only watching the agent work. The ask was queued a minute AFTER the pane
	 * mounted; that is an ask arriving, which rule 4 says never forces the surface open.
	 */
	const { view } = pane();
	const first = view.observe(
		frame(withRows([arrivedAfter(ASK_ARRIVAL_SKEW_MS + 55_000)])),
	);
	assert.deepEqual(
		{
			action: first.verdict.action,
			reason: first.verdict.reason,
			settled: first.verdict.settled,
		},
		{ action: "leave", reason: "arrived", settled: true },
	);
	/* And it is final: nothing later in the view re-opens it. */
	assert.equal(
		view.observe(frame(withRows([ask("open")]))).verdict.reason,
		"already-decided",
	);
});

test("the arrival boundary: queued before the view or within the skew counts as on open", () => {
	const at = (ms) =>
		pane().view.observe(frame(withRows([arrivedAfter(ms)]))).verdict.action;
	assert.equal(at(-60_000), "open", "queued before the view began");
	assert.equal(at(0), "open", "queued the instant the view began");
	assert.equal(
		at(ASK_ARRIVAL_SKEW_MS),
		"open",
		"within the skew: a peer's clock a few seconds ahead must not turn a pending ask into an arrival",
	);
	assert.equal(
		at(ASK_ARRIVAL_SKEW_MS + 1),
		"leave",
		"one millisecond past the skew is an arrival",
	);
});

test("one ask that existed before the view makes the queue pending, whatever else arrived", () => {
	const { view } = pane();
	const mixed = view.observe(
		frame(withRows([ask("open"), arrivedAfter(40_000)])),
	);
	assert.equal(mixed.verdict.action, "open");
	assert.equal(mixed.verdict.reason, "pending-on-open");
});

test("an ask with no usable created_at is read as old, the safe reading of a fact not stated", () => {
	for (const created_at of [undefined, null, 0, Number.NaN, "later"]) {
		const row = ask("open", { created_at });
		assert.equal(
			pane().view.observe(frame(withRows([row]))).verdict.action,
			"open",
			`created_at=${String(created_at)}`,
		);
	}
});

test("a timed-out ask that arrived during the view is an arrival too", () => {
	const row = arrivedAfter(40_000, "timed_out");
	assert.equal(
		pane().view.observe(frame(withRows([row]))).verdict.reason,
		"arrived",
	);
});

test("a close over an arrived ask is still a dismissal: asks remained", () => {
	const { view, dismissals } = pane();
	const rows = [arrivedAfter(40_000)];
	/* The user opened it by hand (the chip), then closed it with the ask outstanding. */
	view.observe(frame(withRows(rows), opened));
	assert.equal(view.observe(frame(withRows(rows))).closeWatch, "dismissed");
	assert.equal(dismissals.has("c-a"), true);
});

test("the wait for a first answer is bounded: a frame that resolves later is not on open", () => {
	const old = withRows([ask("open")]);
	const at = (ms) =>
		pane().view.observe(frame(old, { nowMs: T0 + ms })).verdict;
	assert.equal(at(ASK_OPEN_WINDOW_MS).action, "open", "exactly on the bound");
	const late = at(ASK_OPEN_WINDOW_MS + 1);
	assert.deepEqual(
		{ action: late.action, reason: late.reason, settled: late.settled },
		{ action: "leave", reason: "too-late", settled: true },
	);
});

test("a late view stays decided: a long wait does not reopen the question", () => {
	const { view } = pane();
	assert.equal(
		view.observe(frame(unread(), { nowMs: T0 + 10_000 })).verdict.reason,
		"unresolved",
		"inside the window the view waits",
	);
	assert.equal(
		view.observe(
			frame(withRows([ask("open")]), {
				nowMs: T0 + ASK_OPEN_WINDOW_MS + 5_000,
			}),
		).verdict.reason,
		"too-late",
	);
	assert.equal(view.settled, true);
	assert.equal(
		view.observe(frame(withRows([ask("open")]), { nowMs: T0 + 1_000 })).verdict
			.reason,
		"already-decided",
		"even a frame stamped inside the window cannot reopen a view that timed out",
	);
});

test("a cold conversation that warms inside the window still opens on its pending ask", () => {
	/*
	 * The reason the wait exists at all: a conversation resumed cold only builds its
	 * queue once it is engaged, so its first frames are unread / unsupported. The
	 * desktop's own snapshot bound is 20 s plus one 10 s re-check, inside the window.
	 */
	const { view } = pane();
	for (const [frontend, ms] of [
		[unread(), 0],
		[unsupported(), 4_000],
		[unread(), 21_000],
	]) {
		assert.equal(
			view.observe(frame(frontend, { nowMs: T0 + ms })).verdict.reason,
			"unresolved",
		);
	}
	const warmed = view.observe(
		frame(withRows([ask("open")]), { nowMs: T0 + 31_000 }),
	);
	assert.equal(warmed.verdict.action, "open");
});

test("the window and the skew are the shared contract's numbers", () => {
	/*
	 * Pinned because they are cross-surface: the TUI's `OPEN_WINDOW_S` is 45 s and its
	 * `ARRIVAL_SKEW_MS` is 5000. A surface that quietly changed one would make a
	 * conversation open on one client and stay shut on another.
	 */
	assert.equal(ASK_OPEN_WINDOW_MS, 45_000);
	assert.equal(ASK_ARRIVAL_SKEW_MS, 5_000);
});

/** Comments blanked, so the source pins read code and not the prose about it. */
function stripComments(source) {
	return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}
