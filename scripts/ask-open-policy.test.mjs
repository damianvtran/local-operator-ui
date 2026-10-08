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
 * a tally with no rows opens nothing, and an open never takes the user's keyboard.
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
	askOpenFacts,
	askQueueView,
	createAskDismissals,
	createAskOpenView,
	decideAskAutoOpen,
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

const TS = 1_760_000_000_000;
let counter = 0;
/** One ask row as the wire carries it; `status` is the fold's word for its state. */
const ask = (status = "open", extra = {}) => {
	counter += 1;
	return {
		ask_id: `ask-${counter}`,
		created_at: TS + counter,
		expires_at: TS + 3_600_000,
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
	...askOpenFacts(askQueueView(frontend)),
	composerHasText: false,
	keyboardOnDoor: false,
	drawerOpen: false,
	sessionDrawerOpen: false,
	...over,
});

/** A pane's life: a fresh view over the page's dismissals, fed frames in order. */
const pane = (dismissals = createAskDismissals()) => ({
	dismissals,
	view: createAskOpenView(dismissals),
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
	const first = createAskOpenView(dismissals);
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
	const back = createAskOpenView(dismissals);
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
	const other = createAskOpenView(dismissals);
	assert.equal(
		other.observe(frame(withRows([ask("open")]), { conversationId: "c-b" }))
			.verdict.action,
		"open",
	);

	// A fresh page lifetime is a fresh record: the same conversation opens again.
	const restarted = createAskOpenView(createAskDismissals());
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

test("a tally with no rows behind it opens nothing, and does not claim there are no asks", () => {
	const { view } = pane();
	const first = view.observe(frame(tallyOnly(4)));
	assert.equal(first.verdict.action, "leave");
	assert.equal(
		first.verdict.reason,
		"tally-only",
		"four asks ARE outstanding; `nothing-pending` would be a false sentence",
	);
	assert.equal(first.verdict.settled, true);
	assert.equal(
		view.observe(frame(withRows([ask("open")]))).verdict.reason,
		"already-decided",
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
	 * The two ways an open could move or swap what the user is in the middle of:
	 *  - the composer holds text, and opening flips the flag that puts the box into
	 *    answer mode (the draft would be swapped out from under the cursor);
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
		createAskOpenView(dismissals).observe(frame(withRows([ask("open")])))
			.verdict.action,
		"open",
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
		outstanding: 2,
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
		reason({ pendingRows: 0, outstanding: 0, dismissed: { has: () => true } }),
		"nothing-pending",
		"a settled queue in a dismissed conversation says the truer thing",
	);
});

test("the facts are read off the shipped view: published, rows, and the wire's tally", () => {
	assert.deepEqual(askOpenFacts(askQueueView(null)), {
		resolved: false,
		pendingRows: 0,
		outstanding: 0,
	});
	assert.deepEqual(askOpenFacts(askQueueView(unsupported())), {
		resolved: false,
		pendingRows: 0,
		outstanding: 0,
	});
	assert.deepEqual(askOpenFacts(askQueueView(liveEmpty())), {
		resolved: true,
		pendingRows: 0,
		outstanding: 0,
	});
	assert.deepEqual(askOpenFacts(askQueueView(tallyOnly(4))), {
		resolved: true,
		pendingRows: 0,
		outstanding: 4,
	});
	assert.deepEqual(
		askOpenFacts(
			askQueueView(withRows([ask("open"), ask("timed_out"), ask("answered")])),
		),
		{ resolved: true, pendingRows: 2, outstanding: 2 },
	);
});

/** Comments blanked, so the source pins read code and not the prose about it. */
function stripComments(source) {
	return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}
