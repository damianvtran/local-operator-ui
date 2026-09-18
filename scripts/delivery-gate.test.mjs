import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE DELIVERY GATE: a named conversation may replace what an existing window is
 * showing, EXCEPT for the one delivery that would leave no trace — a second launch
 * under a plan that declared it must not be shown (`show === "never"`), arriving at
 * a window the operator is using.
 *
 * What is being defended, in one line: this app is driven by agents on the
 * operator's own desktop, so a tool-spawned launch can name a conversation, reach
 * the app he already has open, and be applied to it — while raising nothing and
 * logging nothing, because the mode those runs resolve (`headless`) is deliberately
 * silent. The window does not move, the app does not come forward, and the panel
 * still RE-KEYS on the new session, so the composer subtree unmounts and the caret
 * dies with it. The only symptom is a keystroke landing nowhere.
 *
 * WHAT THE GATE MUST NOT REFUSE, and why that is the fix rather than a hole in it
 * (UX round 1, U1/U3). `viewer-resume` is the verb the operator's OWN notification
 * click routes through, and the ladder that calls it decides from the ack ALONE
 * (`deliver_click` sets `switched` on any ack), so a refusal that still answers
 * `showing <id>` makes his own click report success while switching nothing — a
 * conversation that can then die at quit, which is worse than the lost caret this
 * gate was written for. So that delivery is APPLIED and LOGGED
 * (`reportViewerDelivery`), and a `banner-click` is applied for the same kind of
 * reason: one act must not mean two things depending on which process raised the
 * toast. The gate's whole job is now the silent delivery nobody would otherwise be
 * able to attribute.
 *
 * WHERE EACH HALF OF THAT IS PROVEN, and why it is split.
 *
 *  - The DECISION and the PARK LINE are shipped code (`canRetargetWindow` and
 *    `reportParkedInUse` in `src/main/window-raise.ts`), bundled from source here,
 *    so this file asserts the app's rule rather than a copy of it. The VIEWER
 *    DELIVERY LINE (`reportViewerDelivery`) is asserted the same way.
 *  - The WIRING — that `openSessionInWindow` consults that predicate BEFORE it
 *    sends and parks on the refusal (TERMINALLY), logs the viewer delivery, and is
 *    NOT re-asked for the parked drain — is a SOURCE SCAN over `index.ts`, in the
 *    shape `window-mode.test.mjs` already uses for the same file. `index.ts` imports
 *    Electron at module load and builds real windows on the ready path, so it cannot
 *    be bundled in process; a scan is what is available, and it is falsifying where
 *    an absent scan is not.
 *  - The RENDERER-side observables the manager asked for (`activeSessionId`
 *    unchanged, the same textarea node still holding focus with the same
 *    `selectionStart`) are NOT here, and deliberately so: they are consequences of
 *    main sending nothing, and this change touches no renderer code. The renderer
 *    applies whatever it is told, unconditionally (`app.tsx`) — so "no send" fully
 *    determines them, and asserting them against a stand-in DOM would assert the
 *    stand-in. The same division `palette-focus.test.mjs` draws: the caret half
 *    belongs to the renderer driver's scenes and to QA's pass on the built app.
 */

/** One main-process policy module, bundled from the shipped TypeScript. */
const loaded = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const {
	OPERATOR_SHOW,
	applySecondLaunch,
	canRetargetWindow,
	raiseWindow,
	readSecondLaunchRequest,
	reportParkedInUse,
	reportViewerDelivery,
} = await loaded("./src/main/window-raise");

const {
	WINDOW_MODES,
	resolveSecondLaunchShow,
	resolveWindowLaunchPlan,
	windowIntentPayload,
} = await loaded("./src/main/window-mode");

/**
 * The session ids this file works with. `NAMED` is the conversation a delivery
 * names (B); the window's own conversation (A) is deliberately not written down —
 * nothing in the gate is told which conversation the window is showing, which is
 * what makes a refusal independent of it.
 */
const NAMED = "0f1e2d3c4b5a";

/** The raise plan of a plain launch of this app, resolved the way main resolves it. */
const normalPlan = resolveWindowLaunchPlan({ argv: ["electron", "."] });

/** The raise calls the invariant file scans this tree for, spelled once. */
const RAISE_PATTERN = /\.(show|showInactive|focus)\(\)/;

/** The slice of `BrowserWindow` the raise policy touches, plus the two reads the
 * gate makes — `isFocused()` for the decision and `webContents.send` for the
 * delivery. A fake window, as `window-mode.test.mjs` uses, because the policy is
 * in process and Electron is not. */
const fakeWindow = ({ focused = false } = {}) => {
	const calls = [];
	const sent = [];
	return {
		calls,
		sent,
		show: () => calls.push("show"),
		showInactive: () => calls.push("showInactive"),
		focus: () => calls.push("focus"),
		isMinimized: () => false,
		restore: () => calls.push("restore"),
		isFocused: () => focused,
		webContents: {
			send: (channel, payload) => sent.push({ channel, payload }),
		},
	};
};

/**
 * `openSessionInWindow`'s existing-window branch, spelled from the SHIPPED
 * decision, the SHIPPED reporters and the SHIPPED raise and nothing else: it sends,
 * logs a viewer delivery, and raises when `canRetargetWindow` allows it, and parks
 * and reports when it does not. `fromPark` mirrors the ONE exemption `index.ts`
 * passes for the parked drain, and the scan further down pins that `index.ts` asks
 * the same question in the same order and passes that flag in exactly one place —
 * this model exists only to carry the pieces that cannot be built in process (a
 * `webContents.send` sink and a park queue), not to restate the rule.
 */
const branch = (sessionId, request, { window, queue, fromPark = false }) => {
	const raise = () =>
		raiseWindow(window, request.show, {
			trigger: request.trigger,
			requester: request.requester,
			// The raise's own line is not what this file is about, so it is dropped
			// rather than collected: every raise assertion has a home already.
			report: () => {},
		});
	if (
		!fromPark &&
		sessionId !== null &&
		!canRetargetWindow(request, window.isFocused())
	) {
		queue.push(sessionId);
		reportParkedInUse(sessionId, request.show, {
			trigger: request.trigger,
			requester: request.requester,
			report: (line) => queue.lines.push(line),
		});
		return;
	}
	window.webContents.send("desktop-open-conversation", { sessionId });
	if (sessionId !== null && request.trigger === "viewer-resume") {
		reportViewerDelivery(sessionId, request.show, {
			trigger: request.trigger,
			requester: request.requester,
			report: (line) => queue.lines.push(line),
		});
	}
	raise();
};

/** A park queue standing in for `index.ts`'s, keeping the lines it was given. */
const parkQueue = () => {
	const queue = [];
	queue.lines = [];
	return queue;
};

/**
 * `index.ts` with its comments removed, so a scan reads code rather than prose.
 *
 * The gate's own comments quote `parkLaunch` and the send, which is why an order
 * assertion over raw text is not enough on its own: prose that names a call reads
 * exactly like the call.
 */
const withoutComments = (text) =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/**
 * Every verb a raise can carry (`RaiseTrigger`), spelled out because a type is not a
 * value at runtime.
 *
 * The `Record` in `window-raise.ts` makes the COMPILER demand an answer for a new
 * verb; this list makes the SWEEP below demand the same thing of a reader, and a verb
 * added to the union without being added here leaves the sweep narrower than the rule
 * it is checking (which the comment on the sweep says).
 */
const RAISE_TRIGGERS = [
	"initial-present",
	"second-instance",
	"banner-click",
	"viewer-focus",
	"viewer-resume",
];

/* ------------------------------------------------------------------ */
/* The exemption marker, pinned to the mode table                       */
/* ------------------------------------------------------------------ */

test("the silence the one refusal turns on is the mode table's headless plan, read from the public API", () => {
	/*
	 * The gate refuses `show === "never"` for one trigger, and that is a fact about
	 * `window-mode.ts`'s table living in another module — so it is pinned HERE, beside
	 * the predicate, against the same public entry points main uses: a re-mapping in
	 * `WINDOW_BEHAVIOUR` that made `headless` come forward (or `normal` stop doing so)
	 * would silently change which delivery the app may refuse, and fails this test
	 * instead. `never` is also why the refusal is cheap: a delivery under it reports
	 * nothing at all, present or raise, so pulling it back costs the requester nothing
	 * it can observe.
	 *
	 * Asserted as three DISTINCT plans rather than as truthiness, so a table that
	 * collapsed two modes onto one value cannot pass by being consistently wrong.
	 */
	assert.equal(OPERATOR_SHOW, "focus");
	assert.deepEqual([...WINDOW_MODES], ["normal", "headless", "inactive"]);
	// A launch that names nothing, and one that names `normal`, are both a person's.
	assert.equal(normalPlan.show, OPERATOR_SHOW);
	assert.equal(
		resolveWindowLaunchPlan({
			argv: ["electron", ".", "--window-mode=normal"],
		}).show,
		OPERATOR_SHOW,
	);
	// ...and the two modes that are runs resolve away from the marker, to their own
	// plans. This is the half that would rot if `headless` ever came to mean `focus`.
	assert.equal(
		resolveWindowLaunchPlan({
			argv: ["electron", ".", "--window-mode=headless"],
		}).show,
		"never",
	);
	assert.equal(
		resolveWindowLaunchPlan({
			argv: ["electron", ".", "--window-mode=inactive"],
		}).show,
		"inactive",
	);
	// The channel a second launch actually travels on: the mode it resolved, read
	// back through the same payload main reads.
	assert.equal(
		resolveSecondLaunchShow({ additionalData: windowIntentPayload("normal") }),
		OPERATOR_SHOW,
	);
	assert.equal(
		resolveSecondLaunchShow({
			additionalData: windowIntentPayload("headless"),
		}),
		"never",
	);
	// ...and THAT plan is what the gate reads: a second launch under it may be
	// refused, and under the other two plans it may not. `inactive` is the row UX
	// round 1's U4 was about — it is APPLIED, so the loser's own sentence ("the app
	// may order its window forward without activating it") is true, not a promise a
	// focused window denies.
	assert.equal(
		canRetargetWindow(
			{ trigger: "second-instance", show: OPERATOR_SHOW },
			true,
		),
		true,
	);
	assert.equal(
		canRetargetWindow({ trigger: "second-instance", show: "inactive" }, true),
		true,
	);
	assert.equal(
		canRetargetWindow({ trigger: "second-instance", show: "never" }, true),
		false,
	);
});

/* ------------------------------------------------------------------ */
/* The decision, per trigger                                            */
/* ------------------------------------------------------------------ */

test("a delivery may not replace the conversation of the window the operator is using", () => {
	/*
	 * The rule as a table over the two things a request declares: which VERB it is,
	 * and how far it was allowed to come forward.
	 *
	 * `show` alone cannot carry this, and the rows below are why. A banner click is a
	 * person clicking a real notification; a `viewer-resume` is a verb on a control
	 * endpoint any script can dial (`lop resume-click`, a rig, an agent) — AND the verb
	 * the operator's own notification click routes through. Both reach
	 * `openSessionInWindow` carrying THIS process's launch plan rather than a
	 * requester's, so they arrive with the same `show` and cannot be told apart by it:
	 * refusing the script's delivery is what round 1 did, and it cost the operator his
	 * own click, because the ladder reads the ack and never sees the park (U1). The one
	 * refusable cell is therefore the delivery whose silence nobody is waiting on — a
	 * run's own launch, under the plan it declared for itself.
	 */
	const rows = [
		// trigger, show, may it retarget a focused window, and why
		["banner-click", OPERATOR_SHOW, true, "a person clicked a real banner"],
		[
			"banner-click",
			"never",
			true,
			"the same click on a headless-plan process: one act, one outcome (U3)",
		],
		[
			"second-instance",
			OPERATOR_SHOW,
			true,
			"only his own launch resolves focus",
		],
		[
			"second-instance",
			"inactive",
			true,
			"a run's launch, come forward inactively — applied, not parked (U4)",
		],
		["second-instance", "never", false, "the driven, tool-spawned shape"],
		[
			"viewer-resume",
			OPERATOR_SHOW,
			true,
			"the operator's own notification click routes through this verb (U1)",
		],
		[
			"viewer-resume",
			"never",
			true,
			"and under a headless plan too: applied, and LOGGED instead of parked",
		],
		[
			"viewer-focus",
			OPERATOR_SHOW,
			true,
			"raises only; it never reaches the gate, so nothing may refuse it",
		],
	];
	for (const [trigger, show, expected, why] of rows) {
		assert.equal(
			canRetargetWindow({ trigger, show }, true),
			expected,
			`${trigger} with requested=${show} against a focused window: ${why}`,
		);
	}
	/*
	 * And the other half of the rule, which is the one a reader is most likely to
	 * lose in a rewrite: a window that is up but NOT being typed into is fair game.
	 * A window behind another app costs the operator no caret, and refusing there
	 * would turn every agent launch into a conversation that never opens while the
	 * app is running.
	 */
	for (const [trigger, show] of rows.map((row) => [row[0], row[1]])) {
		assert.equal(
			canRetargetWindow({ trigger, show }, false),
			true,
			`${trigger} with requested=${show} must be applied when nothing is being used`,
		);
	}
	/*
	 * AND THE REFUSAL IS EXACTLY ONE CELL. Swept over every verb a raise can carry
	 * against every plan the mode table can resolve, a window in use yields exactly one
	 * refusal — so a rule that widened back out (round 1's shape, where a `viewer-resume`
	 * was refused) fails here rather than in the operator's hands. The verb list is the
	 * test's own; a verb added to `RaiseTrigger` without being added to `RAISE_TRIGGERS`
	 * would narrow this sweep silently, which is the one way it can rot.
	 */
	const plans = [...WINDOW_MODES].map(
		(mode) =>
			resolveWindowLaunchPlan({
				argv: ["electron", ".", `--window-mode=${mode}`],
			}).show,
	);
	const refusals = [];
	for (const trigger of RAISE_TRIGGERS) {
		for (const show of plans) {
			if (!canRetargetWindow({ trigger, show }, true)) {
				refusals.push(`${trigger}+${show}`);
			}
		}
	}
	assert.deepEqual(
		refusals,
		["second-instance+never"],
		"only a run's own launch, under the plan that leaves no trace, may be refused",
	);
	/*
	 * A catalogue request is not a conversation being installed over one, and the gate
	 * is written on the ID rather than on the verb (the wiring test asserts that guard).
	 */
	assert.equal(
		canRetargetWindow({ trigger: "banner-click", show: "never" }, true),
		true,
		"a banner click is the operator's own whatever plan this process is running",
	);
});

/* ------------------------------------------------------------------ */
/* Must switch: the delivered-and-logged paths, and the one exemption    */
/* ------------------------------------------------------------------ */

test("a viewer-resume against a focused window is DELIVERED and LOGGED, not parked", () => {
	/*
	 * THE ROUND-1 FIX (UX round 1, U1), and why refusing this verb was wrong. This is
	 * the verb the operator's own notification click routes through: `resume_click`
	 * rung 1 decides from the endpoint's ack ALONE and `deliver_click` sets `switched`
	 * on ANY ack, so a refusal that still answers `showing <id>` makes his own click
	 * report success while switching nothing — and the conversation it parked can then
	 * die at quit. Round 1 measured exactly that against the real client:
	 * `switched=True focused=True detail='showing <id>'` with zero bytes delivered.
	 *
	 * Asserted on four things: the conversation IS sent (his click does what it says),
	 * nothing parks, the delivery is LOGGED with a line naming the trigger and the
	 * session — which is what makes the next caret lost this way attributable — and a
	 * `never`-plan request is logged too, because under that plan the delivery itself
	 * writes nothing at all.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	branch(
		NAMED,
		{ trigger: "viewer-resume", show: OPERATOR_SHOW },
		{ window, queue },
	);

	assert.deepEqual(window.sent, [
		{ channel: "desktop-open-conversation", payload: { sessionId: NAMED } },
	]);
	assert.deepEqual(
		[...queue],
		[],
		"his own click is never queued behind a window",
	);
	assert.deepEqual(queue.lines, [
		"trigger=viewer-resume mode=normal requested=focus delivered=0f1e2d3c4b5a applied=conversation+replaced",
	]);

	// The same verb under the plan that is silent about everything else. The log line is
	// then the ONLY account of the delivery, which is the whole reason it exists — and
	// the raise still reports nothing, which is what made this invisible before.
	const quiet = fakeWindow({ focused: true });
	const quietQueue = parkQueue();
	branch(
		NAMED,
		{ trigger: "viewer-resume", show: "never" },
		{ window: quiet, queue: quietQueue },
	);
	assert.deepEqual(quiet.sent, [
		{ channel: "desktop-open-conversation", payload: { sessionId: NAMED } },
	]);
	assert.deepEqual(quietQueue.lines, [
		"trigger=viewer-resume mode=headless requested=never delivered=0f1e2d3c4b5a applied=conversation+replaced",
	]);
	assert.deepEqual(
		quiet.calls,
		[],
		"and the raise under a never plan is silent",
	);
});

test("only the viewer verb logs a delivery: the line means a viewer delivery, not any delivery", () => {
	/*
	 * A `delivered=` token that appeared for every applied delivery would stop answering
	 * the question it was added for — "did a VIEWER delivery re-key my panel?" — and the
	 * raise line already accounts for the plans that may move the window. So the other
	 * verbs are asserted to log nothing: a banner click and a second launch have their
	 * own evidence (the raise line, the loser's sentence), and the `never`-plan second
	 * launch is the one that parks.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	for (const trigger of ["banner-click", "initial-present"]) {
		branch(NAMED, { trigger, show: OPERATOR_SHOW }, { window, queue });
	}
	branch(
		NAMED,
		{ trigger: "second-instance", show: OPERATOR_SHOW },
		{ window, queue },
	);
	assert.deepEqual(
		queue.lines,
		[],
		"no delivery line outside the viewer's own verb",
	);
	assert.equal(window.sent.length, 3, "and every one of them was delivered");
});

test("an inactive second launch is APPLIED to a focused window and orders it without activating it", () => {
	/*
	 * UX round 1, U4 asked for the loser's sentence ("the app may order its window
	 * forward without activating it") to stop promising a window order a focused window
	 * now denies. Under the narrowed rule there is nothing to edit: the delivery is
	 * applied and the raise is `showInactive`. This is the row that says so — applied,
	 * nothing parked, and no `show`/`focus` among the calls — so if the rule ever widened
	 * again, the sentence in `index.ts` would become a lie with a failing test under it.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: [
				"electron",
				".",
				`--open-session=${NAMED}`,
				"--window-mode=inactive",
			],
		}),
		{
			window,
			openConversation: (sessionId, request) =>
				branch(
					sessionId,
					{
						trigger: "second-instance",
						show: request.show,
						requester: request.requester ?? undefined,
					},
					{ window, queue },
				),
			queue: () =>
				assert.fail("a named conversation has something to deliver to"),
			openWindow: () =>
				assert.fail("a window exists, so nothing may open another"),
		},
	);
	assert.deepEqual(window.sent, [
		{ channel: "desktop-open-conversation", payload: { sessionId: NAMED } },
	]);
	assert.deepEqual(
		[...queue],
		[],
		"an inactive request is applied, not parked",
	);
	assert.deepEqual(queue.lines, []);
	assert.deepEqual(
		window.calls,
		["showInactive"],
		"the window is ordered forward without the app being activated",
	);
});

test("the parked drain is not re-gated: a promise this app made cannot be refused by it", () => {
	/*
	 * QA round 1, Q-1 / review round 1, MAJOR-2, MEASURED: the drain hands every entry
	 * back to `openSessionInWindow`, which asked the gate again — so against a window
	 * focused by the time it loaded, one entry produced `applied=delivered` and then
	 * `applied=parked+in-use` for the same id, with zero sends and the entry back on the
	 * queue's tail. Parking promises the operator's next window; that made it need more
	 * than one.
	 *
	 * Two halves, because neither can prove it alone: the model below carries the
	 * SHIPPED decision with the drain's exemption, and the scan pins that `index.ts`
	 * passes that exemption at the drain call and nowhere else. A re-gating is one
	 * deleted argument away, so the scan is the half that has to be exact.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	branch(
		NAMED,
		{ trigger: "second-instance", show: "never" },
		{ window, queue, fromPark: true },
	);
	assert.deepEqual(
		window.sent,
		[{ channel: "desktop-open-conversation", payload: { sessionId: NAMED } }],
		"the window created to open it delivers it, however focused it is",
	);
	assert.deepEqual([...queue], []);
	assert.deepEqual(queue.lines, []);

	const source = readFileSync("src/main/index.ts", "utf8");
	assert.equal(
		(source.match(/fromPark: true/g) ?? []).length,
		1,
		"exactly one delivery path is exempt from the gate: the drain's",
	);
	assert.match(
		withoutComments(source),
		/claimParkedFor\(\s*mainWindow,\s*\(session, request\) =>\s*openSessionInWindow\(session, request, \{ fromPark: true \}\),\s*parked,/,
		"and it is the drain beneath the created window that passes it",
	);
	const gate = withoutComments(source).match(
		/!fromPark &&\s*sessionId !== null &&\s*!canRetargetWindow\(/,
	);
	assert.ok(
		gate,
		"and the gate itself reads the exemption BEFORE it can refuse, or the argument would be decoration",
	);
});

/* ------------------------------------------------------------------ */
/* Must NOT switch: the one refusal left                                 */
/* ------------------------------------------------------------------ */

test("a headless second launch that names a conversation parks, which is the defect's own shape", () => {
	/*
	 * THE REPORTED SHAPE, and now THE ONLY REFUSAL: a tool-spawned launch on the
	 * operator's own profile — no terminal, so the driven shape, so `headless` — naming
	 * a conversation while the app is already open and in use. Driven through
	 * `applySecondLaunch`, which is the real seam the `second-instance` handler calls,
	 * with the real argv and the real payload a losing launch hands over.
	 *
	 * A `headless` request raises nothing and reports nothing, so before the gate the
	 * entire effect was the conversation swap: the caret died inside a window that never
	 * moved, and the log said nothing at all. THIS is the cell UX round 1 (U1) left
	 * standing when it took `viewer-resume` out of the rule — a delivery whose silence
	 * belongs to a requester, against a window the operator is typing in.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: ["electron", ".", `--open-session=${NAMED}`],
			additionalData: windowIntentPayload("headless", { pid: 4242 }),
		}),
		{
			window,
			openConversation: (sessionId, request) =>
				branch(
					sessionId,
					{
						trigger: "second-instance",
						show: request.show,
						requester: request.requester ?? undefined,
					},
					{ window, queue },
				),
			queue: () =>
				assert.fail("a named conversation has something to deliver to"),
			openWindow: () =>
				assert.fail("a window exists, so nothing may open another"),
		},
	);

	assert.deepEqual(
		window.sent,
		[],
		"the conversation was not installed over the one in use",
	);
	assert.deepEqual([...queue], [NAMED]);
	assert.deepEqual(
		queue.lines,
		[
			`trigger=second-instance mode=headless requested=never parked=${NAMED} pid=4242 applied=parked+in-use`,
		],
		"the line says WHICH launch did it: pid travels with the refusal, not just with a raise",
	);
	assert.deepEqual(
		window.calls,
		[],
		"a headless request raises nothing, as it always did",
	);
});

/* ------------------------------------------------------------------ */
/* Still MUST switch: the three cases the rule must not swallow          */
/* ------------------------------------------------------------------ */

test("the same request against a window nobody is using is still delivered", () => {
	// (i) Blurred: the window is up but the operator is somewhere else, so there is
	// no caret to lose and a conversation that never opens is the worse failure.
	const window = fakeWindow({ focused: false });
	const queue = parkQueue();
	branch(
		NAMED,
		{ trigger: "viewer-resume", show: OPERATOR_SHOW },
		{ window, queue },
	);

	assert.deepEqual(window.sent, [
		{ channel: "desktop-open-conversation", payload: { sessionId: NAMED } },
	]);
	assert.deepEqual([...queue], [], "nothing parks when nothing is being used");
	// The delivery line is the viewer verb's, blurred or focused: it answers "did a
	// viewer delivery re-key this panel", which is a question about the delivery and
	// not about who was looking at it.
	assert.deepEqual(queue.lines, [
		"trigger=viewer-resume mode=normal requested=focus delivered=0f1e2d3c4b5a applied=conversation+replaced",
	]);
});

test("the operator's own request is still delivered to a window he is using", () => {
	/*
	 * (ii) and (iii): a banner click, and his own second launch with the mode named
	 * as `normal`. Both are his own by declaration, and a rule that refused these
	 * would mean the app stops doing what a person just asked it to do — which is a
	 * worse bug than the one being fixed, and the reason the exemption is a table
	 * over the trigger rather than a blanket refusal.
	 */
	const banner = fakeWindow({ focused: true });
	const bannerQueue = parkQueue();
	branch(
		NAMED,
		{ trigger: "banner-click", show: normalPlan.show },
		{
			window: banner,
			queue: bannerQueue,
		},
	);
	assert.deepEqual(
		banner.sent,
		[
			{
				channel: "desktop-open-conversation",
				payload: { sessionId: NAMED },
			},
		],
		"a person clicking a banner is not a script naming a conversation at them",
	);
	assert.deepEqual(bannerQueue.lines, []);

	const own = fakeWindow({ focused: true });
	const ownQueue = parkQueue();
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: [
				"electron",
				".",
				`--open-session=${NAMED}`,
				"--window-mode=normal",
			],
		}),
		{
			window: own,
			openConversation: (sessionId, request) =>
				branch(
					sessionId,
					{
						trigger: "second-instance",
						show: request.show,
						requester: request.requester ?? undefined,
					},
					{ window: own, queue: ownQueue },
				),
			queue: () =>
				assert.fail("a named conversation has something to deliver to"),
			openWindow: () =>
				assert.fail("a window exists, so nothing may open another"),
		},
	);
	assert.deepEqual(
		own.sent,
		[
			{
				channel: "desktop-open-conversation",
				payload: { sessionId: NAMED },
			},
		],
		"only a person's own launch resolves focus, so this is the operator asking",
	);
	assert.deepEqual(ownQueue.lines, []);
});

test("a catalogue request is not gated: it names no conversation to park", () => {
	/*
	 * `null` is the CATALOGUE, not a missing value: a burst digest's click names
	 * several conversations and must open the list. Its only source is a person
	 * clicking, and — the mechanical half — the queue is keyed by conversation, so
	 * there is nothing to park it under. Asserted so the `sessionId !== null` guard
	 * at the call site is a decision a reader can see rather than a coincidence.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	branch(null, { trigger: "banner-click", show: "never" }, { window, queue });
	assert.deepEqual(window.sent, [
		{ channel: "desktop-open-conversation", payload: { sessionId: null } },
	]);
	assert.deepEqual(queue.lines, []);
});

/* ------------------------------------------------------------------ */
/* The wiring in index.ts, which cannot be bundled                       */
/* ------------------------------------------------------------------ */

test("openSessionInWindow consults the gate before it delivers, and parks on a refusal", () => {
	/*
	 * The policy above is only worth anything if the ONE function that retargets a
	 * window asks it. `index.ts` imports Electron at module load and creates real
	 * windows on the ready path, so it cannot be bundled in process — the same
	 * situation `window-mode.test.mjs` is in when it pins
	 * `setupMainWindowWithUpdateService(null, false, { show: OPERATOR_SHOW,` as a
	 * source line, and a scan is what is available.
	 *
	 * Asserted as an ORDER over the function's own text rather than as a whole-body
	 * match, so a comment or an unrelated edit nearby does not fail it while an
	 * inverted order does: the gate, then the park and its return, then — after both
	 * — the send.
	 */
	const source = readFileSync("src/main/index.ts", "utf8");
	const start = source.indexOf("function openSessionInWindow(");
	assert.ok(
		start > 0,
		"openSessionInWindow is still the one function that retargets a window",
	);
	// The create branch begins at the canCreateWindowFor question; the existing-window
	// branch is everything before it, which is where the gate has to be.
	const createBranch = source.indexOf("if (!canCreateWindowFor(", start);
	assert.ok(
		createBranch > start,
		"the create branch is still there and still after",
	);
	const body = source.slice(start, createBranch);

	const gate = body.indexOf("canRetargetWindow(request, window.isFocused())");
	const park = body.indexOf('parkLaunch(sessionId, request, "in-use")');
	const send = body.indexOf('webContents.send("desktop-open-conversation"');
	assert.ok(gate > 0, "the existing-window branch asks canRetargetWindow");
	assert.ok(park > gate, "a refusal parks, with the in-use reason");
	assert.ok(
		send > park,
		"and the send is still BEHIND the gate: a delivery that reaches it has already been allowed",
	);
	/*
	 * AND THE REFUSAL IS TERMINAL, not merely early — the assertion this cell was
	 * missing (review round 1, MAJOR-1; QA round 1's section 6 corroborated it, and
	 * section 6 measured what it costs). ORDER ALONE TOLERATED THE MUTATION THAT MAKES A
	 * REFUSED DELIVERY SEND ANYWAY: with the `return;` after the park deleted, the suite
	 * stayed green — `tests 9 pass 9 fail 0` — while the park ran AND the delivery fell
	 * through to the send below, which is the caret loss this whole file exists to
	 * prevent, restored, under a green suite. So the slice between the park and the send
	 * — comments stripped, because the surrounding prose quotes both calls — must END
	 * the refusal: the park, then the return, then the brace that closes the block.
	 */
	const refusal = withoutComments(body.slice(park, send)).replace(/\s+/g, " ");
	assert.match(
		refusal,
		/^parkLaunch\(sessionId, request, "in-use"\); return; \}/,
		"the park is TERMINAL: a refusal that could fall through to the send would re-key the panel it was written to protect",
	);
	/*
	 * AND THE VIEWER DELIVERY IS LOGGED, AFTER the send (UX round 1, U1/U2). The
	 * narrowing that stops refusing `viewer-resume` is only honest if such a delivery
	 * can be attributed afterwards — under a `never` plan the delivery itself reports
	 * nothing — and a line written before the send would be a claim about something
	 * that had not happened yet.
	 */
	const viewerLog = body.indexOf('request.trigger === "viewer-resume"');
	assert.ok(
		viewerLog > send,
		"the viewer delivery is logged after the send, not before",
	);
	assert.ok(
		body
			.slice(viewerLog, createBranch)
			.includes("reportViewerDelivery(sessionId, request.show"),
		"and it reports through the shipped viewer-delivery reporter",
	);
	// The exemption the drain needs, read by the gate above rather than trusted to a
	// comment: without it the app can refuse the delivery it just promised
	// (QA round 1, Q-1 / MAJOR-2 — the drain's own test drives this half).
	assert.ok(
		body.includes("!fromPark &&"),
		"the gate has the one exemption the parked drain passes",
	);
	// The guard the catalogue case depends on, asserted rather than assumed: only a
	// NAMED conversation is gated, so `null` still reaches the renderer.
	assert.ok(
		body.includes("sessionId !== null &&"),
		"only a named conversation is gated; the catalogue is not a conversation to park",
	);
	// And nothing in that branch raises on its own: the raise still belongs to
	// window-raise.ts, which is what keeps the mode gate the only way through
	// (`window-mode.test.mjs` scans this whole tree for the same reason).
	assert.ok(
		!RAISE_PATTERN.test(body),
		"the existing-window branch raises nothing itself",
	);
});

test("a refused park reports through the shipped in-use reporter, not a second line shape", () => {
	/*
	 * `parkLaunch` is index.ts's, so the CHOICE of line is pinned at the source: the
	 * in-use park must report through `reportParkedInUse`, which is the shape
	 * `window-mode.test.mjs` and this file both assert the text of. A park that
	 * reported through `reportParked` instead would print `applied=parked` for a
	 * delivery that was refused, which is the same line the operator's own
	 * not-yet-showable request gets — and those two need telling apart, because only
	 * one of them means somebody tried to take the screen they were typing on.
	 */
	const source = readFileSync("src/main/index.ts", "utf8");
	assert.ok(
		source.includes(
			'if (why === "in-use") reportParkedInUse(session, request.show, parkLine);',
		),
		"the in-use park reports the in-use line",
	);
	assert.ok(
		source.includes('why: "unreachable" | "in-use" = "unreachable"'),
		"the reason defaults to the existing behaviour, so the create branch is unchanged",
	);
	/*
	 * AND EVERY PARK LINE CARRIES THE PARKED ENTRY'S OWN PLAN (review round 1, MINOR-2)
	 * — the line used to fall back to the `never` default, so a second launch that
	 * declared `focus` and was parked before this process could answer it printed
	 * `requested=never` in the log. The delivery and the `left+waiting` line carry the
	 * same value, so one entry cannot be described under two plans in one log.
	 */
	assert.ok(
		source.includes("else reportParked(session, parkLine, request.show);"),
		"a park carries the plan its entry declared, not the `never` default",
	);
	assert.ok(
		source.includes("evicted.request.show,"),
		"and so does the eviction it causes",
	);
	assert.ok(
		source.includes("queued.request.show,"),
		"and the line that reports its delivery",
	);
});
