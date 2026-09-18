import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE DELIVERY GATE: a named conversation may replace what an existing window is
 * showing only if the request is the operator's own, or the window is not the one
 * he is using.
 *
 * What is being defended, in one line: this app is driven by agents on the
 * operator's own desktop, so a tool-spawned launch can name a conversation, reach
 * the app he already has open, and be applied to it — while raising nothing and
 * logging nothing, because the mode those runs resolve (`headless`) is deliberately
 * silent. The window does not move, the app does not come forward, and the panel
 * still RE-KEYS on the new session, so the composer subtree unmounts and the caret
 * dies with it. The only symptom is a keystroke landing nowhere.
 *
 * WHERE EACH HALF OF THAT IS PROVEN, and why it is split.
 *
 *  - The DECISION and the PARK LINE are shipped code (`canRetargetWindow` and
 *    `reportParkedInUse` in `src/main/window-raise.ts`), bundled from source here,
 *    so this file asserts the app's rule rather than a copy of it.
 *  - The WIRING — that `openSessionInWindow` consults that predicate BEFORE it
 *    sends, and parks on the refusal — is a SOURCE SCAN over `index.ts`, in the
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
 * decision, the SHIPPED reporter and the SHIPPED raise and nothing else: it sends
 * and raises when `canRetargetWindow` allows it, and parks and reports when it does
 * not. The scan further down pins that `index.ts` answers the same question in the
 * same order — this model exists only to carry the pieces that cannot be built in
 * process (a `webContents.send` sink and a park queue), not to restate the rule.
 */
const branch = (sessionId, request, { window, queue }) => {
	const raise = () =>
		raiseWindow(window, request.show, {
			trigger: request.trigger,
			requester: request.requester,
			// The raise's own line is not what this file is about, so it is dropped
			// rather than collected: every raise assertion has a home already.
			report: () => {},
		});
	if (sessionId !== null && !canRetargetWindow(request, window.isFocused())) {
		queue.push(sessionId);
		reportParkedInUse(sessionId, request.show, {
			trigger: request.trigger,
			requester: request.requester,
			report: (line) => queue.lines.push(line),
		});
		return;
	}
	window.webContents.send("desktop-open-conversation", { sessionId });
	raise();
};

/** A park queue standing in for `index.ts`'s, keeping the lines it was given. */
const parkQueue = () => {
	const queue = [];
	queue.lines = [];
	return queue;
};

/* ------------------------------------------------------------------ */
/* The exemption marker, pinned to the mode table                       */
/* ------------------------------------------------------------------ */

test("the operator's-own marker is the mode table's normal plan, read from the public API", () => {
	/*
	 * The gate turns on `show === OPERATOR_SHOW` meaning "a person launched this".
	 * That is a fact about `window-mode.ts`'s table living in another module, so it
	 * is pinned HERE, beside the predicate, against the same public entry points
	 * main uses: a rename or re-mapping in `WINDOW_BEHAVIOUR` that inverted the
	 * marker fails this test rather than silently admitting the launches the rule
	 * exists to refuse.
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
	// ...and the marker is what the gate reads: a person's plan is admitted on a
	// focused window, a run's is not.
	assert.equal(
		canRetargetWindow(
			{ trigger: "second-instance", show: OPERATOR_SHOW },
			true,
		),
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
	 * `show` alone cannot carry this, and the two `normal` rows below are why. A
	 * banner click is a person clicking a real notification; a `viewer-resume` is a
	 * verb on a control endpoint any script can dial (`lop resume-click`, a rig, an
	 * agent). Both reach `openSessionInWindow` carrying THIS process's launch plan
	 * rather than a requester's, so on the operator's own app they arrive with the
	 * SAME `show` — `focus` — and a predicate that read only `show` would admit the
	 * script and lose the operator's caret to it. That is the defect, on the profile
	 * it was reported from.
	 */
	const rows = [
		// trigger, show, may it retarget a focused window, and why
		["banner-click", OPERATOR_SHOW, true, "a person clicked a real banner"],
		[
			"second-instance",
			OPERATOR_SHOW,
			true,
			"only his own launch resolves focus",
		],
		[
			"second-instance",
			"inactive",
			false,
			"a run's launch, come forward inactively",
		],
		["second-instance", "never", false, "the driven, tool-spawned shape"],
		[
			"viewer-resume",
			OPERATOR_SHOW,
			false,
			"a scriptable verb on the control endpoint",
		],
		[
			"viewer-resume",
			"inactive",
			false,
			"the same verb under an inactive plan",
		],
		[
			"viewer-focus",
			OPERATOR_SHOW,
			false,
			"raises only, but never anyone's own",
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
	// A catalogue request is not a conversation being installed over one: the call
	// site gates on the id, which is why the park line can always name one.
	assert.equal(
		canRetargetWindow({ trigger: "banner-click", show: "never" }, true),
		true,
		"a banner click is the operator's own whatever plan this process is running",
	);
});

/* ------------------------------------------------------------------ */
/* Must NOT switch: the refusal, its park line, and its silence          */
/* ------------------------------------------------------------------ */

test("a viewer-resume that names another conversation parks instead of replacing the one on screen", () => {
	/*
	 * THE OPERATIVE CASE, driven as the control endpoint drives it: `resume_session`
	 * over the viewer's endpoint while the operator is typing in conversation A.
	 *
	 * Asserted on four things, because the refusal is only correct if all four hold:
	 * nothing is SENT to the renderer (so nothing re-keys and the caret survives),
	 * the conversation is QUEUED rather than dropped, the park line is present and
	 * says which line it is, and nothing was raised — the last one being what makes
	 * this the quiet failure in the first place.
	 */
	const window = fakeWindow({ focused: true });
	const queue = parkQueue();
	branch(
		NAMED,
		{ trigger: "viewer-resume", show: OPERATOR_SHOW },
		{ window, queue },
	);

	assert.deepEqual(
		window.sent,
		[],
		"no desktop-open-conversation send: the renderer is what re-keys the panel and unmounts the composer",
	);
	assert.deepEqual(
		[...queue],
		[NAMED],
		"the conversation waits for the operator's next window",
	);
	assert.deepEqual(
		queue.lines,
		[
			// The exact line, because the whole defect was that this case was INVISIBLE:
			// a `never`-mode raise reports nothing by design, so without this the
			// operator has no account of where their caret went.
			"trigger=viewer-resume mode=normal requested=focus parked=0f1e2d3c4b5a applied=parked+in-use",
		],
		"the park line is the only evidence this attempt happened",
	);
	assert.deepEqual(
		window.calls,
		[],
		"and nothing was raised or focused either",
	);
});

test("a headless second launch that names a conversation parks, which is the defect's own shape", () => {
	/*
	 * THE REPORTED SHAPE: a tool-spawned launch on the operator's own profile —
	 * no terminal, so the driven shape, so `headless` — naming a conversation while
	 * the app is already open and in use. Driven through `applySecondLaunch`, which
	 * is the real seam the `second-instance` handler calls, with the real argv and
	 * the real payload a losing launch hands over.
	 *
	 * A `headless` request raises nothing and reports nothing, so before the gate the
	 * entire effect was the conversation swap: the caret died inside a window that
	 * never moved, and the log said nothing at all.
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
	assert.deepEqual(queue.lines, []);
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
});
