import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { blankComments } from "./chrome-keychain.mjs";

/**
 * Contract checks for the launch-window policy.
 *
 * Why these cases: this app is driven by agents on the operator's desktop, and
 * every agent-driven run used to end at `ready-to-show` with `show()`, which
 * activates the app and takes the operator's keyboard focus. The mode switch
 * that removes the grab is only worth anything if it is exact — a mode that
 * half-applies (window hidden but still focusable, page throttled in a run
 * that is measuring rendering) or a size request that silently comes out
 * different from the one an evidence frame is labelled with would each make a
 * headless run quietly unfaithful, which is the failure this file is here to
 * catch.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `update-robustness.test.mjs` does, so these stay tests of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/window-mode";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DEFAULT_WINDOW_HEIGHT,
	DEFAULT_WINDOW_WIDTH,
	LAUNCHER_KEEP_ALIVE_ENV,
	WINDOW_INTENT_KEY,
	WINDOW_MAX_EDGE,
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	WINDOW_MODE_ENV,
	WINDOW_SIZE_ENV,
	describeWindowLaunch,
	parseWindowMode,
	parseWindowSize,
	readWindowIntent,
	resolveLauncherWatchPlan,
	resolveSecondLaunchShow,
	resolveWindowLaunchPlan,
	windowIntentPayload,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const raise = await import(
	`data:text/javascript;base64,${Buffer.from(
		(
			await build({
				stdin: {
					contents: 'export * from "./src/main/window-raise";',
					resolveDir: process.cwd(),
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
			})
		).outputFiles[0].text,
	).toString("base64")}`
);
const {
	OPERATOR_SHOW,
	applySecondLaunch,
	canCreateWindowFor,
	presentWindow,
	raiseWindow,
	readSecondLaunchRequest,
	reportParked,
	reportParkedDelivered,
	reportParkedEvicted,
	reportParkedLeftWaiting,
	reportParksAtQuit,
} = raise;

/*
 * The dev-driver arming decision, bundled the same way. It is here rather than
 * in `dev-driver-gate.test.mjs` because what is being asserted is the
 * COMPOSITION the driven shape makes reachable — a launch nobody told anything
 * now resolves `headless`, and a `headless` plan is what turns an opt-in from a
 * refusal into an armed bridge — so the case needs the resolver and the arming
 * decision in one process.
 */
const devDriver = await import(
	`data:text/javascript;base64,${Buffer.from(
		(
			await build({
				stdin: {
					contents: 'export * from "./src/main/dev-driver";',
					resolveDir: process.cwd(),
				},
				bundle: true,
				format: "esm",
				platform: "node",
				write: false,
			})
		).outputFiles[0].text,
	).toString("base64")}`
);
const { DEV_DRIVER_ENV, DEV_DRIVER_OUT_ENV, resolveDevDriverArming } =
	devDriver;

const plan = (input) => resolveWindowLaunchPlan(input);

/*
 * The launch shape a tool-spawned run has, pinned to the platform this rule was
 * MEASURED on rather than left to the ambient `process.platform`.
 *
 * Without this, every shape case below would assert `headless` on macOS and
 * Linux CI and silently assert nothing on a Windows host, where the same input
 * resolves `normal` by design — so the file would pass on a platform whose
 * behaviour it does not describe. Passing the platform makes each case a
 * statement about the rule rather than about the machine running it.
 */
const DRIVEN = {
	packaged: false,
	stdinIsTTY: undefined,
	stdoutIsTTY: undefined,
	platform: "darwin",
};

test("no input is the shipped behaviour: a focused 1380x900 window", () => {
	// The default must stay exactly what the released app does today, because
	// this switch exists to change agent-driven runs and nothing else.
	const resolved = plan();
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.show, "focus");
	assert.equal(resolved.focusable, true);
	assert.equal(resolved.backgroundThrottling, true);
	assert.equal(resolved.width, DEFAULT_WINDOW_WIDTH);
	assert.equal(resolved.height, DEFAULT_WINDOW_HEIGHT);
	// The shipped app is a window somebody starts and finds in the Dock.
	assert.equal(resolved.hideDock, false);
	assert.deepEqual(resolved.problems, []);
});

test("headless creates the window and never shows it, unfocusable and unthrottled", () => {
	// Each of the three is load-bearing. `never` is what stops the focus grab;
	// `focusable: false` means a stray `show()` cannot cause one later; and
	// unthrottled is what keeps a headless run measuring the app users get
	// rather than a page Chromium decided nobody was watching.
	const resolved = plan({ env: { [WINDOW_MODE_ENV]: "headless" } });
	assert.equal(resolved.mode, "headless");
	assert.equal(resolved.show, "never");
	assert.equal(resolved.focusable, false);
	assert.equal(resolved.backgroundThrottling, false);
	/*
	 * And no Dock tile. A headless run is the one mode this app is launched in
	 * tens of times over on one machine, and every tile is an icon that leads
	 * nowhere: the operator's Dock is where the accumulation was noticed.
	 */
	assert.equal(resolved.hideDock, true);
});

test("inactive shows the window without activating the app", () => {
	const resolved = plan({ env: { [WINDOW_MODE_ENV]: "inactive" } });
	assert.equal(resolved.mode, "inactive");
	assert.equal(resolved.show, "inactive");
	// Still focusable: this mode exists for a run a person may want to click
	// into, so refusing focus permanently would be the wrong half-measure.
	assert.equal(resolved.focusable, true);
	assert.equal(resolved.backgroundThrottling, false);
	// Visible on purpose, so it keeps the tile that makes it findable.
	assert.equal(resolved.hideDock, false);
});

test("the mode is read case- and whitespace-insensitively", () => {
	assert.equal(parseWindowMode("  HEADLESS "), "headless");
	assert.equal(
		plan({ env: { [WINDOW_MODE_ENV]: " Inactive\t" } }).mode,
		"inactive",
	);
});

test("the argument wins over the environment, in both spellings", () => {
	// A rig's own spawn call is more specific than whatever the shell exported,
	// and `--window-mode headless` is what someone types by hand.
	const env = { [WINDOW_MODE_ENV]: "normal" };
	assert.equal(
		plan({ env, argv: ["--window-mode=headless"] }).mode,
		"headless",
	);
	assert.equal(
		plan({ env, argv: ["--window-mode", "headless"] }).mode,
		"headless",
	);
});

test("an appended flag overrides the value the command line already carried", () => {
	/*
	 * `pnpm app:headless` names `--window-mode=headless` on its own command line,
	 * and `pnpm app:headless -- --window-mode=inactive` APPENDS to it. Last-wins is
	 * what keeps that an override rather than a silently ignored request — the same
	 * rule `shared/open-session.ts` states for its own flag.
	 */
	assert.equal(
		plan({ argv: ["--window-mode=headless", "--window-mode=inactive"] }).mode,
		"inactive",
	);
	assert.equal(
		plan({ argv: ["--window-mode=headless", "--window-mode", "normal"] }).mode,
		"normal",
	);
	// The size flag follows the same rule.
	assert.equal(
		plan({ argv: ["--window-size=1380x900", "--window-size=1024x768"] }).width,
		1024,
	);
});

test("a valueless flag never clears a value that was given", () => {
	/*
	 * `--window-mode=headless --window-mode` under plain last-wins resolved to
	 * `normal` — a window where the caller asked for none, which is the same silent
	 * downgrade the last-wins rule exists to prevent (review round 1). The
	 * valueless occurrence is IGNORED and still reported, so it cannot be mistaken
	 * for silence or for a deliberate choice.
	 *
	 * AN EMPTY VALUE IS NOT A VALUELESS OCCURRENCE, and that distinction is
	 * deliberate: `--window-mode=` is a caller saying "tell me what I did wrong" and
	 * keeps the documented `normal` fallback with its own report, while a flag with
	 * nothing after it is not a value at all.
	 */
	const trailing = plan({ argv: ["--window-mode=headless", "--window-mode"] });
	assert.equal(trailing.mode, "headless");
	assert.equal(trailing.problems.length, 1);
	assert.match(trailing.problems[0], /no value/);
	assert.match(trailing.problems[0], /headless/);

	// A valueless flag on its own still needs a value: nothing was named, so the
	// outcome is `normal` and the caller is told, exactly as before.
	const alone = plan({ argv: ["--window-mode"] });
	assert.equal(alone.mode, "normal");
	assert.equal(alone.problems.length, 1);
	assert.match(alone.problems[0], /needs a value/);

	// A following flag is not the value either, and the value before it survives.
	const beforeFlag = plan({
		argv: ["--window-mode=headless", "--window-mode", "--window-size=1024x768"],
	});
	assert.equal(beforeFlag.mode, "headless");
	assert.equal(beforeFlag.width, 1024);

	// The size flag shares the reader, so it follows the same rule.
	const size = plan({ argv: ["--window-size=1024x768", "--window-size"] });
	assert.equal(size.width, 1024);
	assert.equal(size.problems.length, 1);
	assert.match(size.problems[0], /no value/);
});

test("a request that must not be shown may not CREATE a window, so its conversation waits", () => {
	/*
	 * The convergence-round decision on review round 1's MAJOR. Threading the
	 * requester's `never` through the create path stops the raise but leaves a
	 * window that is INVISIBLE AND REAL: macOS keeps the app alive with the renderer
	 * warm, `app.on("activate")` only creates a window when there are none, so the
	 * operator's Dock icon then activates an app that shows nothing while a
	 * conversation sits in a screen they cannot reach.
	 *
	 * So the plan is the thing that decides, before any window exists, and the
	 * decision is a truth table rather than a call-site judgement.
	 */
	assert.deepEqual(
		["focus", "inactive", "never"].map((show) => [
			show,
			canCreateWindowFor(show),
		]),
		[
			["focus", true],
			["inactive", true],
			["never", false],
		],
	);
});

test("a parked request is reported, and the operator's own request can show", () => {
	/*
	 * U5 (UX round 2): the winner creates no window and raises nothing for a
	 * `headless` request, so without this line a request that is WAITING has no
	 * account anywhere — and the losing launch was told its conversation would be
	 * delivered. The line has to say the conversation, so a reader can answer "what
	 * happened to what I asked for" with the id it asked about.
	 */
	const lines = [];
	reportParked("b1c2d3e4f5a6", {
		trigger: "second-instance",
		requester: { pid: 42, cwd: "/tmp/x" },
		report: (line) => lines.push(line),
	});
	assert.deepEqual(lines, [
		"trigger=second-instance mode=headless requested=never parked=b1c2d3e4f5a6 pid=42 cwd=/tmp/x applied=parked",
	]);

	// A reporter is optional, and a park with none is silent rather than a crash.
	reportParked("b1c2d3e4f5a6", { trigger: "second-instance" });

	/*
	 * U6 (UX round 2): the Dock click is the OPERATOR asking, so the plan it
	 * presents under must be able to show — a `headless`-plan process answering it
	 * with `never` would leave a real, invisible window holding the parked
	 * conversation, with the queue emptied into it. `canCreateWindowFor` is the same
	 * property read from the other end.
	 */
	assert.equal(OPERATOR_SHOW, "focus");
	assert.equal(canCreateWindowFor(OPERATOR_SHOW), true);
});

test("every way a parked conversation can end is a line", () => {
	/*
	 * U2 (UX round 3): a park was announced and its end was not, so the log could not
	 * answer "did the conversation I parked ever arrive?". Each state is a line now,
	 * in one shape — `applied=` is the token a reader greps for the state — and the
	 * two limits of the queue are among them, so an evicted or quit-lost park is
	 * visible rather than the same silence as a delivery (review round 3, NIT-3).
	 */
	const lines = [];
	const context = {
		trigger: "second-instance",
		requester: { pid: 7, cwd: "/tmp/y" },
		report: (line) => lines.push(line),
	};
	reportParkedDelivered("b1c2d3e4f5a6", context);
	reportParkedEvicted("b1c2d3e4f5a6", context);
	reportParkedLeftWaiting(["c2d3e4f5a6b1"], context);
	reportParkedLeftWaiting(["b1c2d3e4f5a6", "c2d3e4f5a6b1"], context);
	reportParksAtQuit(["b1c2d3e4f5a6"], (line) => lines.push(line));
	assert.deepEqual(lines, [
		"trigger=second-instance mode=headless requested=never parked=b1c2d3e4f5a6 pid=7 cwd=/tmp/y applied=delivered",
		"trigger=second-instance mode=headless requested=never parked=b1c2d3e4f5a6 pid=7 cwd=/tmp/y applied=evicted",
		"trigger=second-instance mode=headless requested=never parked=c2d3e4f5a6b1 pid=7 cwd=/tmp/y applied=left+waiting",
		"trigger=second-instance mode=headless requested=never parked=b1c2d3e4f5a6,c2d3e4f5a6b1 pid=7 cwd=/tmp/y applied=left+waiting",
		"trigger=app-quit mode=headless requested=never parked=b1c2d3e4f5a6 applied=dropped+quit",
	]);
	// A reporter is optional on all of them, as on the park itself.
	reportParkedDelivered("b1c2d3e4f5a6", { trigger: "second-instance" });
	reportParkedLeftWaiting(["b1c2d3e4f5a6"], { trigger: "second-instance" });
});

test("a window created for a request is presented under THAT request's plan", () => {
	/*
	 * THE REVIEW-ROUND-1 MAJOR, pinned where it actually lives. The policy in
	 * `window-raise.ts` cannot pin this on its own: the bug was that `index.ts`'s
	 * CREATE branch — the one taken when the app holds the lock with no window open
	 * (`mainWindow = null` on `closed`, macOS keeps the process alive) — presented
	 * the window it made with THIS process's plan, so a `headless` request that
	 * named a conversation created a window and SHOWED it.
	 *
	 * The real-app measurement for the same case is in the PR thread; this guards
	 * the wiring so a future edit cannot quietly reintroduce it, in the shape the
	 * "only window-raise.ts may raise" test already uses. The source is flattened
	 * first (comments stripped, whitespace collapsed) so the assertions describe
	 * the call graph rather than the formatting.
	 */
	const flat = readFileSync(join("src/main", "index.ts"), "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
		.replace(/\s+/g, " ");

	/*
	 * No present site may reach for the process's own launch plan. THE PROPERTY, NOT A
	 * SPELLING (review round 2, NIT-1): the previous form matched
	 * `presentWindow(...windowLaunch.show` literally, which a reach under another
	 * name — `ownLaunchRequest().show`, a local alias — satisfies while
	 * reintroducing round 1's MAJOR. So every call's ARGUMENTS are extracted and
	 * what a raise may be given is stated as an ALLOW-LIST, which is the shape that
	 * catches a rename: an identifier-based `doesNotMatch` for the old names said
	 * "by any name" while only ever checking those two spellings, and the
	 * allow-list below it already subsumed it (review round 3, NIT-1). The live
	 * evidence in the PR thread is what holds the behaviour; this holds the shape
	 * that produced it.
	 */
	const callArgs = (name) => {
		const found = [];
		let at = flat.indexOf(`${name}(`);
		while (at !== -1) {
			let depth = 0;
			for (let i = at + name.length; i < flat.length; i += 1) {
				if (flat[i] === "(") depth += 1;
				else if (flat[i] === ")") {
					depth -= 1;
					if (depth === 0) {
						found.push(flat.slice(at + name.length + 1, i));
						break;
					}
				}
			}
			at = flat.indexOf(`${name}(`, at + 1);
		}
		return found;
	};
	/*
	 * THE PROPERTY IS ABOUT PRESENT SITES (windows this process CREATES), which is
	 * where round 1's MAJOR lived. A `raiseWindow` site may legitimately use this
	 * process's own plan — the banner click and the viewer's `focus_window` are
	 * requests this process made to itself — so the assertion is not spread over
	 * both functions; a window that is CREATED must be presented as far as its
	 * REQUEST asked, and never as far as this process's launch plan does.
	 */
	const presentSites = callArgs("presentWindow");
	assert.ok(
		presentSites.length >= 2,
		`found ${presentSites.length} present sites`,
	);
	// Each present site says one of two things and nothing else: the plan of the
	// REQUEST that caused the window (an identifier of its own, whatever it is
	// called), or a literal plan where the operator's own request set it. A reach
	// for this process's launch plan is neither, whatever identifier it uses.
	for (const args of presentSites.filter((a) => !a.includes("show:"))) {
		assert.match(
			args,
			/(request\.show|held\.request\.show)/,
			`a present site is missing the request's plan: ${args.slice(0, 90)}`,
		);
	}
	// The delivery path's raise is the request's too: that is the second-instance
	// branch, where a `headless` plan must not raise.
	const deliveryRaises = callArgs("raiseWindow").filter((a) =>
		a.includes("request.show"),
	);
	assert.ok(
		deliveryRaises.length >= 1,
		`expected the request's plan on the delivery path, found ${deliveryRaises.length}`,
	);

	// And the request travels all the way from the second-instance branch to those
	// two sites: into the create call, into `createWindow`, and into the hold.
	assert.match(
		flat,
		/setupMainWindowWithUpdateService\( ?sessionId, sessionId === null, request,? ?\)/,
	);
	assert.match(
		flat,
		/mainWindow = createWindow\( ?parked\?\.session \?\? initialSession, openCatalogue, request,? ?\)/,
	);
	assert.match(
		flat,
		/holdPresentUntilConversation\( ?mainWindow, initialSession, request,? ?\)/,
	);
	assert.match(flat, /request: RaiseRequest = ownLaunchRequest\(\)/);

	/*
	 * AND THE CREATE CALL IS UNREACHABLE FOR A REQUEST THAT MUST NOT BE SHOWN. The
	 * park branch has to come first inside `openSessionInWindow`, and the parked
	 * conversation has to be consumed by the window that comes next — otherwise the
	 * fix is a hidden window, or a conversation that was never delivered at all.
	 */
	const open = flat.slice(
		flat.indexOf("function openSessionInWindow("),
		flat.indexOf("openConversationInWindow = openSessionInWindow"),
	);
	assert.ok(
		open.length > 0,
		"openSessionInWindow not found in src/main/index.ts",
	);
	assert.match(open, /if \(!canCreateWindowFor\(request\.show\)\) \{/);
	// The park goes through `parkLaunch`, which is where the queue's bound lives and
	// where the parked/evicted lines are written (review round 3, NIT-3).
	assert.match(open, /parkLaunch\(sessionId, request\)/);
	/*
	 * AND THE QUEUE IS A QUEUE. The single slot this replaced (`queuedLaunch`)
	 * overwrote silently, which is MAJOR-1 of round 2 — so the assertion is that the
	 * identifier is GONE (an overwrite cannot come back unnoticed) and that the
	 * drain takes every entry rather than one.
	 */
	assert.doesNotMatch(flat, /queuedLaunch/);
	/*
	 * AND AN ENTRY LEAVES THE QUEUE WHEN ITS SEND HAPPENS, NOT WHEN THE WINDOW IS
	 * CREATED (review round 3, MINOR-1 / QA round 3, Q-1). The up-front splice this
	 * asserts ABSENT emptied the queue into one `did-finish-load` callback, so a
	 * window that died first took every claimed conversation with it: no line, no
	 * re-park, nothing for the next window. The per-entry removal and the `closed`
	 * report are what make that impossible now, and the live evidence for the race
	 * itself is in the PR thread.
	 */
	assert.doesNotMatch(
		flat,
		/parkedLaunches\.splice\(0, parkedLaunches\.length\)/,
		"the drain must not empty the queue before the deliveries happen",
	);
	/*
	 * AND THE INITIAL-SESSION ENTRY IS ON THE SAME RULE (review round 4, MAJOR-1).
	 * `parkedLaunches.shift()` at window creation took the oldest park out of the
	 * queue BEFORE the window existed, so a window that died before its first paint
	 * destroyed that conversation: not delivered, not re-queued, no state line, and
	 * nothing left for the quit line to report, the queue being empty already. The
	 * entry is CLAIMED (`parkedLaunches[0]`) and leaves the queue on the rule every
	 * other entry follows — when the window that paints it has actually loaded. The
	 * old spelling is asserted ABSENT, which is what stops this path regressing while
	 * the splice assertion above stays green.
	 */
	assert.equal(
		(flat.match(/parkedLaunches\.shift\(\)/g) ?? []).length,
		1,
		"the only `shift` left is the bound's eviction; the initial-session entry must be claimed, not taken",
	);
	assert.match(flat, /const evicted = parkedLaunches\.shift\(\);/);
	assert.match(flat, /\? parkedLaunches\[0\]/);
	assert.match(flat, /painted\?: ParkedLaunch,/);
	/*
	 * AND THE DELIVERED LINE FOLLOWS THE DELIVERY (QA round 1, Q-1 / review round 1,
	 * MAJOR-2). It used to be reported BEFORE `deliver` ran, which was sound only while
	 * `deliver` could not refuse: it can — the drain hands entries back to the gated
	 * `openSessionInWindow` — and the log then asserted `applied=delivered` for the same
	 * id it re-parked one line later, with zero sends. The `continue` this replaces is
	 * what let the painted entry's report jump ahead of the sends; there is now one
	 * report statement, after the send, for every entry.
	 */
	assert.match(
		flat,
		/if \(queued !== painted\) deliver\(queued\.session, queued\.request\);/,
	);
	assert.ok(
		flat.search(/deliver\(queued\.session, queued\.request\)/) <
			flat.search(/reportParkedDelivered\( ?queued\.session,/),
		"the `delivered` line is written after the send it names",
	);
	assert.match(
		flat,
		/claimParkedFor\(\s*mainWindow,\s*\(session, request\) => openSessionInWindow\(session, request, \{ fromPark: true \}\),\s*parked,\s*\)/,
		"the drained delivery is exempt from the gate it already answered once (QA round 1, Q-1)",
	);
	assert.match(flat, /claimParkedFor\(\s*mainWindow,/);
	assert.match(flat, /window\.once\( ?"closed", \(\) => \{/);
	assert.match(flat, /for \(const queued of claimed\) \{/);
	assert.match(flat, /parkedLaunches\.splice\( ?at, 1\)/);
	assert.match(flat, /reportParkedDelivered\( ?queued\.session, ?\{/);
	/*
	 * PER ENTRY, EACH WITH ITS OWN REQUESTER (review round 4, NIT): the line used to
	 * borrow `left[0]`'s trigger for every conversation on it, and "who asked for this
	 * one" is the question the line exists to answer.
	 */
	assert.doesNotMatch(flat, /left\[0\]\.request\.trigger/);
	assert.match(
		flat,
		/reportParkedLeftWaiting\( ?\[queued\.session\], ?\{\s*trigger: queued\.request\.trigger,/,
	);
	/*
	 * AND THE QUEUE IS BOUNDED, AND ITS BOUND IS AUDIBLE (review round 3, NIT-3).
	 * An unbounded in-memory queue is a leak, and a park dropped silently is the same
	 * class of silence the park line exists to remove; the quit path is where a
	 * conversation that dies with the process is accounted for.
	 */
	assert.match(flat, /const PARKED_LAUNCH_LIMIT = \d+;/);
	assert.match(
		flat,
		/if \(parkedLaunches\.length <= PARKED_LAUNCH_LIMIT\) return;/,
	);
	assert.match(flat, /reportParkedEvicted\( ?evicted\.session, ?\{/);
	assert.match(
		flat,
		/reportParksAtQuit\(\s*parkedLaunches\.map\(\(parked\) => parked\.session\),\s*reportRaise,?\s*\)/,
	);
	/*
	 * AND THE LOSING LAUNCH NAMES THE CONVERSATION IT HANDED OVER (UX round 3, U4):
	 * the id is the only thing that ties its sentence to a conversation, and a
	 * launch that named none says so rather than reading like an id the line forgot.
	 */
	assert.match(
		flat,
		/readSecondLaunchRequest\(\{ commandLine: process\.argv \}\)\.session/,
	);
	// The id is built once and reused, so the guard follows the two halves it is
	// written as rather than one joined string that no longer exists.
	assert.match(
		flat,
		/session === null \? null : `the conversation it named \(\$\{session\}\)`/,
	);
	assert.match(flat, /rides with it/);
	assert.match(flat, /it named no conversation/);
	/*
	 * AND THE SESSION-LESS ARM PROMISES NOTHING IT CANNOT DO (review round 4, MINOR):
	 * no conversation is waiting, so the sentence says that instead of "the app will
	 * open it", and the queue's bound belongs to the arm where a conversation can
	 * actually be dropped.
	 */
	assert.match(
		flat,
		/nothing is waiting to be opened, and it will not raise a window in the meantime/,
	);
	assert.equal(
		(flat.match(/up to \$\{PARKED_LAUNCH_LIMIT\} conversations wait/g) ?? [])
			.length,
		1,
		"the queue bound belongs only to the arm that parks a conversation",
	);
	/*
	 * One present per window (both review streams measured two identical
	 * `[window-raise]` lines for one window, the `ready-to-show` handler having
	 * fired twice), and the Dock click presents under a plan that can show (U6).
	 */
	assert.match(flat, /let presentHandled = false;/);
	assert.ok(
		flat.indexOf("let presentHandled = false;") <
			flat.indexOf("presentWindow(mainWindow, request.show,"),
		"the one-shot guard must be in place before the present it guards",
	);
	assert.match(
		flat,
		/setupMainWindowWithUpdateService\(null, false, \{ show: OPERATOR_SHOW,/,
	);
	assert.ok(
		open.indexOf("canCreateWindowFor(request.show)") <
			open.indexOf(
				"setupMainWindowWithUpdateService(sessionId, sessionId === null, request)",
			),
		"the park branch must be tested before the window is created",
	);
	assert.match(flat, /parked\?\.session \?\? initialSession/);
	assert.match(flat, /once\("did-finish-load"/);
});

test("an unrecognised mode falls back to normal and is reported", () => {
	// Falling back to `headless` would be the worse failure: a typo in
	// `normal` would give someone a window they cannot find, and a release
	// that renders nothing. The report is what makes the typo findable.
	const resolved = plan({ env: { [WINDOW_MODE_ENV]: "headles" } });
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.problems.length, 1);
	assert.match(resolved.problems[0], /headles/);
	assert.match(resolved.problems[0], /normal/);
});

test("a mode argument with no value is missing, not the next flag", () => {
	const resolved = plan({
		argv: ["--window-mode", "--remote-debugging-port=9451"],
	});
	// The flag was reached for and misused, so the report is the answer — and
	// the debug port beside it must not turn that mistake into a silent
	// headless default.
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.problems.length, 1);
	assert.equal(resolved.assumed, null);
});

test("a launch that names a scratch profile and no mode is assumed headless", () => {
	// The rig-shaped launch: an isolated profile so it cannot touch the
	// operator's, and no mode named. This is the shape that took their focus
	// repeatedly on this machine, one window per run, so the silence has to
	// resolve to the mode that cannot grab it.
	const resolved = plan({
		argv: [
			".",
			"--remote-debugging-port=9451",
			"--user-data-dir=/tmp/rig/profile",
		],
	});
	assert.equal(resolved.mode, "headless");
	assert.equal(resolved.show, "never");
	assert.equal(resolved.focusable, false);
	assert.equal(resolved.backgroundThrottling, false);
	assert.deepEqual(resolved.problems, []);
	assert.match(resolved.assumed ?? "", /user-data-dir/);
});

test("either agent switch is enough, and both spellings are read", () => {
	// A rig that only opens a devtools port is as much a run as one with its
	// own profile, and `--user-data-dir /tmp/x` is how a shell script writes it.
	assert.equal(plan({ argv: ["--user-data-dir=/tmp/rig"] }).mode, "headless");
	assert.equal(
		plan({ argv: ["--user-data-dir", "/tmp/rig"] }).mode,
		"headless",
	);
	const portOnly = plan({ argv: ["--remote-debugging-port=9451"] });
	assert.equal(portOnly.mode, "headless");
	assert.match(portOnly.assumed ?? "", /remote-debugging-port/);
	// A section heading is not a value: `--user-data-dir --remote-debugging-
	// port=9451` is still a profile switch, and still a run.
	assert.equal(
		plan({ argv: ["--user-data-dir", "--remote-debugging-port=9451"] }).mode,
		"headless",
	);
});

test("a named mode wins over the agent switches, from either source", () => {
	// The escape hatch has to stay exact, or a person debugging with a scratch
	// profile could not get a real window at all.
	for (const mode of ["normal", "inactive", "headless"]) {
		const fromFlag = plan({
			argv: [`--window-mode=${mode}`, "--user-data-dir=/tmp/rig"],
		});
		assert.equal(fromFlag.mode, mode, `${mode} from the flag`);
		assert.equal(
			fromFlag.assumed,
			null,
			`${mode} from the flag is not assumed`,
		);
		const fromEnv = plan({
			env: { [WINDOW_MODE_ENV]: mode },
			argv: ["--user-data-dir=/tmp/rig"],
		});
		assert.equal(fromEnv.mode, mode, `${mode} from the environment`);
		assert.equal(
			fromEnv.assumed,
			null,
			`${mode} from the environment is not assumed`,
		);
	}
});

test("a mistyped mode beside an agent switch still reports rather than assumes", () => {
	// `headles` must not be read as silence and quietly become headless: the
	// typo is the whole problem, and the person who made it can only fix a
	// window they can see named in the report.
	const resolved = plan({
		env: { [WINDOW_MODE_ENV]: "headles" },
		argv: ["--user-data-dir=/tmp/rig"],
	});
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.assumed, null);
	assert.equal(resolved.problems.length, 1);
	assert.match(resolved.problems[0], /headles/);
});

test("an empty or blank mode value names nothing, so a rig launch is still headless", () => {
	// `env LOCAL_OPERATOR_UI_WINDOW_MODE="$MODE" …` with `MODE` unset, and a
	// harness env block with an empty default, are both ordinary — and both
	// spelled a value that names nothing. Reading that as "somebody chose
	// normal" is the focus grab this change removes, through a spelling no
	// reader would recognise as a choice.
	for (const empty of ["", "   ", "\t"]) {
		const resolved = plan({
			env: { [WINDOW_MODE_ENV]: empty },
			argv: ["--user-data-dir=/tmp/rig"],
		});
		assert.equal(resolved.mode, "headless", JSON.stringify(empty));
		assert.equal(resolved.show, "never", JSON.stringify(empty));
		assert.match(resolved.assumed ?? "", /user-data-dir/);
		// Reported, but with no claim about `normal` that this path does not honour.
		assert.equal(resolved.problems.length, 1, JSON.stringify(empty));
		assert.match(resolved.problems[0], /names no mode/);
		assert.doesNotMatch(resolved.problems[0], /using normal/);
	}
});

test("an empty mode value with no rig switch is still the operator's window, and says why", () => {
	// The other half: nothing about an empty value makes a launch a rig. It is
	// still the operator's app, and the report states the outcome too, because
	// there is no assumption here to explain the silence.
	const resolved = plan({ env: { [WINDOW_MODE_ENV]: "" } });
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.assumed, null);
	assert.equal(resolved.problems.length, 1);
	assert.match(resolved.problems[0], /names no mode/);
	assert.match(resolved.problems[0], /using normal/);
});

test("the flag given an empty value is a caller asking to be told, not a default", () => {
	// Reaching for `--window-mode` and handing it nothing is the same mistake as
	// reaching for it and handing it no value at all, so it keeps the report and
	// the historical fallback rather than being read as silence.
	const resolved = plan({
		argv: ["--window-mode=", "--user-data-dir=/tmp/rig"],
	});
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.assumed, null);
	assert.equal(resolved.problems.length, 1);
});

test("silence with no agent switch is still the operator's focused window", () => {
	// The shipped behaviour, asserted again next to the assumption so a future
	// edit cannot widen "is a rig" into "is any launch with arguments".
	assert.equal(plan().mode, "normal");
	assert.equal(plan().assumed, null);
	assert.equal(plan({ argv: [".", "--window-size=1024x673"] }).mode, "normal");
});

test("a launch with no terminal on either stream is a driven run, and resolves headless", () => {
	// The shape the agent switches could not see, and the one that was STILL
	// taking the operator's focus after the switch-based assumption shipped: a
	// tool booting the app straight out of a checkout with no switch at all.
	// A tool spawns it with pipes, so neither stream is a terminal, and a
	// checkout is not a packaged app — together those two facts say this is a
	// run rather than the operator using the app.
	const resolved = plan(DRIVEN);
	assert.equal(resolved.mode, "headless");
	assert.equal(resolved.show, "never");
	assert.equal(resolved.focusable, false);
	assert.equal(resolved.backgroundThrottling, false);
	assert.deepEqual(resolved.problems, []);
	assert.match(resolved.assumed ?? "", /no terminal/);
});

test("a terminal on either stream is a person, and keeps the focused window", () => {
	// A person runs `pnpm dev` in a terminal, and a person who redirects the log
	// (`local-operator-ui > app.log &`) still has stdin ON the terminal — the
	// pair is what makes this safe to pair with `packaged: false`, so each half
	// is asserted on its own.
	for (const streams of [
		{ stdinIsTTY: true, stdoutIsTTY: true },
		{ stdinIsTTY: true, stdoutIsTTY: undefined },
		{ stdinIsTTY: undefined, stdoutIsTTY: true },
	]) {
		const resolved = plan({ ...DRIVEN, ...streams });
		assert.equal(resolved.mode, "normal", JSON.stringify(streams));
		assert.equal(resolved.assumed, null, JSON.stringify(streams));
	}
});

test("the packaged app is never assumed headless, however it was started", () => {
	// A double-clicked `.app` has no terminal either, so `packaged` is the whole
	// reason a person's own app cannot be hidden by the rule above. This is the
	// assertion that keeps the shipped release rendering a window.
	const resolved = plan({
		packaged: true,
		stdinIsTTY: undefined,
		stdoutIsTTY: undefined,
	});
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.assumed, null);
});

test("a caller that cannot say whether it is packaged stays on the historical normal", () => {
	// `packaged` is optional, and only an explicit `false` takes part: a caller
	// that says nothing must keep the behaviour it had before this rule existed.
	assert.equal(
		plan({ stdinIsTTY: undefined, stdoutIsTTY: undefined, platform: "darwin" })
			.mode,
		"normal",
	);
});

test("a named mode still wins on a launch with no terminal", () => {
	// The escape hatch, on the new path: a person who launches the checkout from
	// a non-terminal launcher keeps `normal` by naming it.
	for (const mode of ["normal", "inactive", "headless"]) {
		const resolved = plan({ ...DRIVEN, argv: [`--window-mode=${mode}`] });
		assert.equal(resolved.mode, mode);
		assert.equal(
			resolved.assumed,
			null,
			`${mode} from the flag is not assumed`,
		);
	}
});

test("an agent switch is the stronger reason and is what the line names", () => {
	// Both signals can be true at once, and the line has to name the specific
	// one: "a rig passed --user-data-dir" is what a reader can act on.
	const both = plan({ ...DRIVEN, argv: ["--user-data-dir=/tmp/rig"] });
	assert.equal(both.mode, "headless");
	assert.match(both.assumed ?? "", /user-data-dir/);
	assert.doesNotMatch(both.assumed ?? "", /no terminal/);
});

test("a mistyped or empty mode beside a terminal-less launch still reports rather than assumes", () => {
	// Reaching for the mode is asking to be told. A typo keeps the report and
	// the `normal` fallback; an empty value names nothing and takes the new
	// assumption exactly as it takes the switch-based one.
	const typo = plan({ ...DRIVEN, env: { [WINDOW_MODE_ENV]: "headles" } });
	assert.equal(typo.mode, "normal");
	assert.equal(typo.assumed, null);
	assert.match(typo.problems[0], /headles/);

	const blank = plan({ ...DRIVEN, env: { [WINDOW_MODE_ENV]: "" } });
	assert.equal(blank.mode, "headless");
	assert.match(blank.assumed ?? "", /no terminal/);
	assert.doesNotMatch(blank.problems[0], /using normal/);
});

test("a person who detaches BOTH streams is hidden, deliberately and asserted", () => {
	// The trade this rule makes, pinned here so it cannot drift into an untested
	// gap: `pnpm dev < /dev/null > /tmp/dev.log 2>&1 &` is indistinguishable from
	// the tool spawns the rule exists to stop. It is announced on the launch's own
	// stdout line and one flag restores the window, which is why the rule is
	// preferred over the focus grab it prevents — but a person CAN meet it.
	const detached = plan(DRIVEN);
	assert.equal(detached.mode, "headless");
	assert.match(detached.assumed ?? "", /no terminal/);
});

test("Windows keeps the historical normal: the shape signal was not measured there", () => {
	// Electron takes a Windows GUI process's stdio through `AttachConsole`, not an
	// inherited handle, so `isTTY` there is not the terminal fact it is on macOS
	// (the platform this rule was measured on). Rather than hide a window on a
	// signal nobody has measured, the rule does not fire on win32 and rigs there
	// name the mode — which is what they had to do before it existed anyway.
	for (const platform of ["win32"]) {
		const resolved = plan({
			packaged: false,
			stdinIsTTY: undefined,
			stdoutIsTTY: undefined,
			platform,
		});
		assert.equal(resolved.mode, "normal", platform);
		assert.equal(resolved.assumed, null, platform);
	}
	// The switch-based assumption is platform-independent and still fires there.
	const withSwitch = plan({
		...DRIVEN,
		argv: ["--user-data-dir=/tmp/rig"],
		platform: "win32",
	});
	assert.equal(withSwitch.mode, "headless");
	assert.match(withSwitch.assumed ?? "", /user-data-dir/);
});

test("the dev driver arms on the plan a driven launch resolves", () => {
	// The composition this change makes reachable, asserted end to end rather
	// than in two halves: before it, a flagless rig that set the opt-in met the
	// refusal at the arming decision because its mode was `normal`. Now the same
	// launch resolves `headless`, and `headless` is what arms.
	const driven = plan(DRIVEN);
	assert.equal(driven.mode, "headless");
	const arming = resolveDevDriverArming({
		env: {
			[DEV_DRIVER_ENV]: "1",
			[DEV_DRIVER_OUT_ENV]: "/tmp/lo-dev-driver-frames",
		},
		windowMode: driven.mode,
	});
	assert.equal(arming.armed, true);
	// And the same opt-in in the operator's own window is still refused, so the
	// composition did not widen who may arm.
	const person = resolveDevDriverArming({
		env: {
			[DEV_DRIVER_ENV]: "1",
			[DEV_DRIVER_OUT_ENV]: "/tmp/lo-dev-driver-frames",
		},
		windowMode: "normal",
	});
	assert.equal(person.armed, false);
});

test("the startup line says the mode was assumed, and why", () => {
	// This line is what a rig greps and what a person reads after a window did
	// not appear. "headless" with no reason would be indistinguishable from a
	// caller that asked for it.
	const line = describeWindowLaunch(
		plan({ argv: ["--user-data-dir=/tmp/rig"] }),
	);
	assert.match(line, /window mode headless/);
	assert.match(line, /assumed/);
	assert.match(line, /user-data-dir/);
	assert.match(line, /never shown/);
	assert.doesNotMatch(
		describeWindowLaunch(plan({ env: { [WINDOW_MODE_ENV]: "headless" } })),
		/assumed/,
	);
});

test("the size comes from the environment, and the argument wins over it", () => {
	const env = { [WINDOW_SIZE_ENV]: "1024x768" };
	assert.deepEqual([plan({ env }).width, plan({ env }).height], [1024, 768]);
	const overridden = plan({ env, argv: ["--window-size=800x600"] });
	assert.deepEqual([overridden.width, overridden.height], [800, 600]);
});

test("a size below the verified floor is clamped, and the plan says so", () => {
	// Electron clamps to `minWidth`/`minHeight` regardless. Reporting the
	// clamp means an evidence frame cannot be labelled with a size the window
	// never had, which is the whole reason the plan carries the clamp.
	const resolved = plan({ env: { [WINDOW_SIZE_ENV]: "400x300" } });
	assert.deepEqual(
		[resolved.width, resolved.height],
		[WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT],
	);
	assert.equal(resolved.problems.length, 1);
	assert.match(resolved.problems[0], /400x300/);
	assert.match(resolved.problems[0], /800x600/);
});

test("a size above the ceiling is clamped to what Chromium will build", () => {
	const resolved = plan({ env: { [WINDOW_SIZE_ENV]: "40000x900" } });
	assert.deepEqual([resolved.width, resolved.height], [WINDOW_MAX_EDGE, 900]);
	assert.equal(resolved.problems.length, 1);
});

test("an unparsable size falls back to the default and is reported", () => {
	for (const bad of ["1380*900", "1380", "x900", "0x900", "wide"]) {
		assert.equal(parseWindowSize(bad), null, bad);
		const resolved = plan({ env: { [WINDOW_SIZE_ENV]: bad } });
		assert.equal(resolved.width, DEFAULT_WINDOW_WIDTH, bad);
		assert.equal(resolved.height, DEFAULT_WINDOW_HEIGHT, bad);
		assert.equal(resolved.problems.length, 1, bad);
	}
	assert.deepEqual(parseWindowSize(" 1600×1000 "), {
		width: 1600,
		height: 1000,
	});
});

test("the startup line cannot describe the wrong behaviour", () => {
	// Rigs read this line to prove a run was headless. A line that printed
	// "focused" for a headless plan would be worse than no line at all.
	const headless = describeWindowLaunch(
		plan({ env: { [WINDOW_MODE_ENV]: "headless" } }),
		"darwin",
	);
	assert.match(headless, /never shown/);
	assert.match(headless, /1380x900/);
	assert.match(headless, /throttling off/);
	assert.match(headless, /no Dock tile/);
	/*
	 * And nothing about the launcher. `headless` can be opted out of the watch or
	 * already detached, so a mode line claiming "quits when its launcher goes"
	 * would contradict the policy line printed straight after it in exactly the
	 * cases where a run does NOT leave by itself — the first line being the one a
	 * rig greps. The lifetime sentence belongs to `resolveLauncherWatchPlan`'s
	 * `reason`, which knows the answer.
	 */
	assert.doesNotMatch(headless, /launcher/i);
	const inactive = describeWindowLaunch(
		plan({ env: { [WINDOW_MODE_ENV]: "inactive" } }),
		"darwin",
	);
	assert.match(inactive, /without activating/);
	assert.doesNotMatch(inactive, /no Dock tile/);
	assert.doesNotMatch(inactive, /launcher/i);
	assert.match(describeWindowLaunch(plan(), "darwin"), /shown and focused/);
	// The Dock is a macOS object, so the claim is mac-only: a Linux or Windows
	// rig naming a Dock tile would be describing something that platform has not.
	assert.doesNotMatch(
		describeWindowLaunch(
			plan({ env: { [WINDOW_MODE_ENV]: "headless" } }),
			"linux",
		),
		/no Dock tile/,
	);
	// The mac line names the tile; asserted as the whole sentence, because an
	// alternation with a word the renderer never emits cannot fail on its own
	// (round 2, N8).
	assert.equal(
		describeWindowLaunch(
			plan({ env: { [WINDOW_MODE_ENV]: "headless" } }),
			"darwin",
		),
		"window mode headless: 1380x900, window created and never shown, page throttling off, no Dock tile",
	);
});

test("the assumed line and the Dock clause are one sentence, on the platform that has a Dock", () => {
	/*
	 * The sync onto main put two suffixes on this line: main's assumption clause
	 * (WHICH signal said this launch is a run rather than a person) and this
	 * branch's Dock clause (what the mac window does about the tile). Each half has
	 * its own assertion above, and the two never meet: the assumption test asserts
	 * fragments, and the whole-sentence test above passes a NAMED mode, which by
	 * construction carries no assumption at all. The platform was left to the
	 * default too, so on CI — `Desktop Tests` runs on ubuntu-latest, where
	 * `process.platform` is not darwin — the composed mac line was never rendered
	 * by any assertion (round 4, R11).
	 *
	 * Both spellings are pinned as whole sentences, because the join is the part the
	 * sync introduced and the Linux one is where the mac-only clause must not be.
	 * The aside trails the sentence since design round 4's D18 measured where an
	 * infix put the mode's colon and the facts a wrapped row starts with.
	 */
	assert.equal(
		describeWindowLaunch(
			plan({ argv: ["--user-data-dir=/tmp/rig"] }),
			"darwin",
		),
		"window mode headless: 1380x900, window created and never shown, page throttling off, no Dock tile (mode assumed: --user-data-dir marks an agent-driven launch, and no window mode was named)",
	);
	assert.equal(
		describeWindowLaunch(plan({ argv: ["--user-data-dir=/tmp/rig"] }), "linux"),
		"window mode headless: 1380x900, window created and never shown, page throttling off (mode assumed: --user-data-dir marks an agent-driven launch, and no window mode was named)",
	);
});

test("only a headless run with a launcher watches that launcher", () => {
	const watch = (input) => resolveLauncherWatchPlan(input);

	// The default: an app a person started, in the Dock, closed by them.
	const normal = watch({ mode: "normal", launcherPid: 4242 });
	assert.equal(normal.watch, false);
	assert.equal(normal.launcherPid, null);
	assert.match(normal.reason, /not launcher-bound/);

	// `inactive` is a run somebody may be watching, so it is not bound either.
	assert.equal(watch({ mode: "inactive", launcherPid: 4242 }).watch, false);

	// The case this exists for: a harness booted the app and may go away.
	const headless = watch({ mode: "headless", launcherPid: 4242 });
	assert.equal(headless.watch, true);
	assert.equal(headless.launcherPid, 4242);
	assert.match(headless.reason, /pid 4242/);

	// A run that detached on purpose has no launcher to watch, and is not
	// guessed at: `ppid 1` is the launcher being absent, not a launcher that
	// died, and only the second one is a leak.
	for (const pid of [0, 1, -1, 4242.5, Number.NaN]) {
		const detached = watch({ mode: "headless", launcherPid: pid });
		assert.equal(detached.watch, false, `pid ${pid}`);
		assert.equal(detached.launcherPid, null, `pid ${pid}`);
		assert.match(detached.reason, /already detached/, `pid ${pid}`);
	}
});

test("the keep-alive opt-out is read tightly, and only for headless runs", () => {
	const withEnv = (value) =>
		resolveLauncherWatchPlan({
			mode: "headless",
			launcherPid: 4242,
			env: { [LAUNCHER_KEEP_ALIVE_ENV]: value },
		});
	for (const value of ["1", "true", "TRUE", " yes ", "On"]) {
		const opted = withEnv(value);
		assert.equal(opted.watch, false, value);
		assert.match(opted.reason, /outlives its launcher/, value);
	}
	// Anything else — including a value that merely looks like a falsy one —
	// leaves the default in place, because the default is the one that does not
	// accumulate instances and a typo must not choose the leaky branch.
	for (const value of ["0", "false", "", "  ", "no", "maybe"]) {
		assert.equal(withEnv(value).watch, true, value);
	}
	assert.equal(
		resolveLauncherWatchPlan({ mode: "headless", launcherPid: 4242 }).watch,
		true,
	);
});

test("the raise policy is the only thing that decides how a window comes forward", () => {
	// Exhaustive over the three modes and both operations, with a fake window
	// that records the calls, because these two functions are the whole of the
	// policy: everything else in the app asks them.
	const presented = [];
	for (const show of ["focus", "inactive", "never"]) {
		const window = fakeWindow();
		presentWindow(window, show, { trigger: "initial-present" });
		presented.push([show, window.calls]);
	}
	assert.deepEqual(presented, [
		// A person's launch: show() and nothing else, exactly what shipped.
		["focus", ["show"]],
		["inactive", ["showInactive"]],
		["never", []],
	]);

	const raised = [];
	for (const show of ["focus", "inactive", "never"]) {
		const window = fakeWindow();
		raiseWindow(window, show, { trigger: "second-instance" });
		raised.push([show, window.calls]);
	}
	assert.deepEqual(raised, [
		["focus", ["show", "focus"]],
		["inactive", ["showInactive"]],
		["never", []],
	]);

	/*
	 * A minimised window is restored only for a FOCUS-class request (UX review
	 * U3): `restore()` takes a window back out of the Dock, and an `inactive`
	 * request is precisely the one that must not do that -- AND IT MAY NOT DO IT BY
	 * ORDERING EITHER. macOS deminiaturises a window as part of ordering it, so
	 * `showInactive()` on a Dock-ed window brought it back even after the explicit
	 * `restore()` was removed; measured, the window's own state went
	 * `minimized: true` -> `false` with `applied=showInactive`. So a minimised
	 * window is left alone and an `inactive` request only orders one that is
	 * already on screen.
	 */
	const restored = [];
	for (const show of ["focus", "inactive", "never"]) {
		const window = fakeWindow({ minimized: true });
		raiseWindow(window, show, { trigger: "second-instance" });
		restored.push([show, window.calls]);
	}
	assert.deepEqual(restored, [
		["focus", ["restore", "show", "focus"]],
		["inactive", []],
		["never", []],
	]);

	/*
	 * AND THE DECLINED REQUEST IS REPORTED (review round 2, MINOR-1). Returning
	 * silently made a request that was declined indistinguishable from one that
	 * never arrived — while the losing launch had been told the running app "may
	 * order its window forward". `never` stays silent: that is the documented
	 * promise of a mode that raises nothing, and there is no declined request in it.
	 */
	const declined = [];
	raiseWindow(fakeWindow({ minimized: true }), "inactive", {
		trigger: "second-instance",
		requester: { pid: 7, cwd: "/tmp/x" },
		report: (line) => declined.push(line),
	});
	assert.deepEqual(declined, [
		"trigger=second-instance mode=inactive requested=inactive pid=7 cwd=/tmp/x applied=skipped+minimised",
	]);

	// The `never` promise, re-asserted beside it so the two cannot drift.
	const silentNever = [];
	raiseWindow(fakeWindow({ minimized: true }), "never", {
		trigger: "second-instance",
		report: (line) => silentNever.push(line),
	});
	assert.deepEqual(silentNever, []);
});

/**
 * The RAISE TRIGGERS, as a list, so a name cannot be added to the union without
 * a line to go with it.
 */
const RAISE_TRIGGERS = [
	"initial-present",
	"second-instance",
	"banner-click",
	"viewer-focus",
	"viewer-resume",
];

/** A window that records what a raise did to it. */
const fakeWindow = ({ minimized = false } = {}) => {
	const calls = [];
	return {
		calls,
		show: () => calls.push("show"),
		showInactive: () => calls.push("showInactive"),
		focus: () => calls.push("focus"),
		isMinimized: () => minimized,
		restore: () => calls.push("restore"),
	};
};

/**
 * A session id the open-session parser accepts: twelve hex characters is the
 * shape a launch may name, and anything else counts as absent.
 */
const LAUNCHED_SESSION = "a1b2c3d4e5f6";

test("a raise names its trigger, the mode, the requester and what it did", () => {
	/*
	 * Why this is asserted rather than left to the comments: `window-raise.ts`
	 * logged nothing at all before this change, which is exactly why the
	 * operator's report ("the app steals my focus whenever a chat completes")
	 * could not be answered on the machine where it happened. Every call site
	 * raises a window from a different cause, and the line has to say which.
	 *
	 * The MODE token is asserted separately from `requested` (review round 1): the
	 * line used to print only the show token, so `requested=normal` — the value a
	 * reader greps for to find the ordinary launch — did not exist anywhere.
	 */
	const lines = [];
	for (const trigger of RAISE_TRIGGERS) {
		raiseWindow(fakeWindow(), "focus", {
			trigger,
			report: (line) => lines.push(line),
		});
	}
	assert.deepEqual(
		lines,
		RAISE_TRIGGERS.map(
			(trigger) =>
				`trigger=${trigger} mode=normal requested=focus applied=show+focus`,
		),
	);

	// `applied` is read off the calls, not derived from `requested`: that is what
	// lets the operator match a line against the focus they just lost.
	const inactive = [];
	raiseWindow(fakeWindow(), "inactive", {
		trigger: "second-instance",
		report: (line) => inactive.push(line),
	});
	assert.deepEqual(inactive, [
		"trigger=second-instance mode=inactive requested=inactive applied=showInactive",
	]);

	const minimized = [];
	raiseWindow(fakeWindow({ minimized: true }), "focus", {
		trigger: "banner-click",
		report: (line) => minimized.push(line),
	});
	assert.deepEqual(minimized, [
		"trigger=banner-click mode=normal requested=focus applied=restore+show+focus",
	]);

	const presented = [];
	presentWindow(fakeWindow(), "inactive", {
		trigger: "initial-present",
		report: (line) => presented.push(line),
	});
	assert.deepEqual(presented, [
		"trigger=initial-present mode=inactive requested=inactive applied=showInactive",
	]);

	// WHO ASKED, when the requester could say (UX review U2): a pid and a cwd make
	// the line actionable on a machine where several agents launch this app, and a
	// line without them means this process asked itself.
	const byRequester = [];
	raiseWindow(fakeWindow(), "focus", {
		trigger: "second-instance",
		requester: { pid: 9182, cwd: "/Users/someone/project" },
		report: (line) => byRequester.push(line),
	});
	assert.deepEqual(byRequester, [
		"trigger=second-instance mode=normal requested=focus pid=9182 cwd=/Users/someone/project applied=show+focus",
	]);

	// A requester that declared only half of it prints only that half: an empty
	// `cwd=` would read as a declaration of the empty string rather than as the
	// absence it is.
	const pidOnly = [];
	raiseWindow(fakeWindow(), "focus", {
		trigger: "second-instance",
		requester: { pid: 1 },
		report: (line) => pidOnly.push(line),
	});
	assert.deepEqual(pidOnly, [
		"trigger=second-instance mode=normal requested=focus pid=1 applied=show+focus",
	]);

	// SILENT WHEN NOTHING IS RAISED. A headless run's whole value is that it
	// leaves no trace, its logs included, and the two functions are the only
	// place that rule can be enforced for both of them.
	const silent = [];
	const report = (line) => silent.push(line);
	raiseWindow(fakeWindow(), "never", { trigger: "second-instance", report });
	presentWindow(fakeWindow(), "never", { trigger: "initial-present", report });
	assert.deepEqual(silent, []);

	// A reporter is optional; a raise with none is silent rather than a crash.
	raiseWindow(fakeWindow(), "focus", { trigger: "viewer-focus" });
	presentWindow(fakeWindow(), "focus", { trigger: "initial-present" });
});

test("a second launch's intent travels on the request that lost the lock, and the fallback is focus", () => {
	/*
	 * The defect this pins: `second-instance` is delivered to the process that
	 * WON the lock, and the losing process's environment is not part of what it
	 * receives. The documented agent launches put the mode in exactly that
	 * environment (`pnpm app:headless` is
	 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless electron .`), so before this the
	 * winner answered with its OWN plan — `show()` + `focus()` for the ordinary
	 * app — and an agent's deliberately invisible run yanked the operator's
	 * window to the front. Measured before the change: frontmost went from the
	 * operator's app to the agent's, on every sample.
	 */
	assert.deepEqual(windowIntentPayload("headless"), {
		[WINDOW_INTENT_KEY]: { mode: "headless" },
	});
	// The requester's identity rides along for the log line only (UX review U2),
	// and half of it is printed only when it was given.
	assert.deepEqual(windowIntentPayload("headless", { pid: 7 }), {
		[WINDOW_INTENT_KEY]: { mode: "headless", pid: 7 },
	});
	assert.deepEqual(windowIntentPayload("inactive", { cwd: "/tmp/x" }), {
		[WINDOW_INTENT_KEY]: { mode: "inactive", cwd: "/tmp/x" },
	});
	assert.deepEqual(
		readWindowIntent(
			windowIntentPayload("headless", { pid: 7, cwd: "/tmp/x" }),
		),
		{ mode: "headless", pid: 7, cwd: "/tmp/x" },
	);
	/*
	 * A BARE MODE STRING IS STILL READ. That is what the first cut of this
	 * channel sent; a build that predates the object form must keep its mode
	 * honoured rather than be silently downgraded to `focus`.
	 */
	assert.deepEqual(readWindowIntent({ [WINDOW_INTENT_KEY]: "inactive" }), {
		mode: "inactive",
	});
	assert.equal(
		resolveSecondLaunchShow({
			argv: ["electron", "."],
			additionalData: windowIntentPayload("headless"),
		}),
		"never",
	);
	assert.equal(
		resolveSecondLaunchShow({
			argv: ["electron", "."],
			additionalData: windowIntentPayload("inactive"),
		}),
		"inactive",
	);

	// The command line is the fallback, for a launch that reaches the window
	// server through a path which drops the environment (`open --args`).
	assert.equal(
		resolveSecondLaunchShow({
			argv: ["electron", ".", "--window-mode=headless"],
		}),
		"never",
	);
	assert.equal(
		resolveSecondLaunchShow({
			argv: ["electron", ".", "--window-mode", "inactive"],
		}),
		"inactive",
	);

	// UNDECLARED KEEPS TODAY'S BEHAVIOUR: this is a person double-clicking the
	// app while it runs, and it must still come to the front.
	assert.equal(resolveSecondLaunchShow({ argv: ["electron", "."] }), "focus");
	assert.equal(resolveSecondLaunchShow({}), "focus");

	// Anything this build does not model is ABSENT rather than guessed at: an
	// older release on either side of the boundary attaches nothing, and a
	// payload is data from another process, so it degrades to the undeclared
	// behaviour instead of throwing or being believed.
	for (const unrecognised of [
		undefined,
		null,
		"headless",
		42,
		{},
		{ [WINDOW_INTENT_KEY]: "hedless" },
		{ [WINDOW_INTENT_KEY]: 7 },
		{ [WINDOW_INTENT_KEY]: "" },
		{ [WINDOW_INTENT_KEY]: { mode: "hedless" } },
		{ [WINDOW_INTENT_KEY]: { mode: 7 } },
		{ [WINDOW_INTENT_KEY]: {} },
	]) {
		assert.equal(readWindowIntent(unrecognised), null, String(unrecognised));
		assert.equal(
			resolveSecondLaunchShow({
				argv: ["electron", "."],
				additionalData: unrecognised,
			}),
			"focus",
			String(unrecognised),
		);
	}
});

test("the requester's identity is read for the log and cannot become a decision", () => {
	// `readSecondLaunchRequest` is where the two payload halves meet the argv: the
	// conversation is argv-only, the mode is payload-then-argv, and the pid/cwd fall
	// back to what Electron reports about the second instance (which always has the
	// working directory, and never has the pid).
	const request = readSecondLaunchRequest({
		commandLine: ["electron", ".", `--open-session=${LAUNCHED_SESSION}`],
		additionalData: windowIntentPayload("headless", {
			pid: 4242,
			cwd: "/tmp/elsewhere",
		}),
		workingDirectory: "/tmp/from-electron",
	});
	assert.deepEqual(request, {
		session: LAUNCHED_SESSION,
		show: "never",
		requester: { pid: 4242, cwd: "/tmp/elsewhere" },
	});

	/*
	 * A DECLARED FIELD IS A LINE-ORIENTED LOG'S INPUT (review round 2, NIT-2): a
	 * `cwd` is legal on POSIX with a newline in it, and printing it verbatim forges
	 * a second `[window-raise]` line. Control characters become spaces and the value
	 * is capped; an all-control value is absence, not an empty field.
	 */
	assert.deepEqual(
		readWindowIntent(
			windowIntentPayload("headless", {
				cwd: "/tmp/one\n[window-raise] forged",
			}),
		),
		{ mode: "headless", cwd: "/tmp/one [window-raise] forged" },
	);
	// Each control character becomes a space, so the forged line break cannot
	// survive whatever it is spelled with (CR, LF, BEL, DEL, the C0 run).
	assert.deepEqual(
		readWindowIntent(
			windowIntentPayload("headless", { cwd: "/tmp/\u0007bell\r\nx" }),
		),
		{ mode: "headless", cwd: "/tmp/ bell  x" },
	);
	assert.deepEqual(
		readWindowIntent(windowIntentPayload("headless", { cwd: "\n\n" })),
		{ mode: "headless" },
	);
	/*
	 * AND NOT ONLY THE ASCII CONTROLS (review round 3, NIT-2): the claim was "control
	 * characters", the code flattened C0 and DEL, and C1 (where NEL `\u0085` — a line
	 * break to a terminal that honours it — lives) plus the Unicode line and
	 * paragraph separators passed through. Every class that can break a line is
	 * flattened now, because a claim the code does not keep is worse than the gap it
	 * describes.
	 */
	assert.deepEqual(
		readWindowIntent(
			windowIntentPayload("headless", {
				cwd: "/tmp/c1\u0085nel\u2028sep\u2029par\u009fdone",
			}),
		),
		{ mode: "headless", cwd: "/tmp/c1 nel sep par done" },
	);
	const long = "a".repeat(400);
	const capped = readWindowIntent(
		windowIntentPayload("headless", { cwd: long }),
	)?.cwd;
	assert.ok(
		capped?.startsWith("a".repeat(200)) && capped.length <= 204,
		`cwd not capped to 200 characters plus a marker: ${capped?.length}`,
	);
	// A pid that is not a safe integer is not a pid.
	assert.deepEqual(
		readWindowIntent(
			windowIntentPayload("headless", { pid: Number.MAX_VALUE }),
		),
		{ mode: "headless" },
	);
	assert.deepEqual(
		readWindowIntent(windowIntentPayload("headless", { pid: 1.5 })),
		{ mode: "headless" },
	);

	// An older launch attaches nothing: the working directory Electron reports is
	// still worth printing, and no pid is invented for it.
	assert.deepEqual(
		readSecondLaunchRequest({
			commandLine: ["electron", "."],
			workingDirectory: "/tmp/from-electron",
		}),
		{ session: null, show: "focus", requester: { cwd: "/tmp/from-electron" } },
	);

	// Nothing to say at all: null rather than an empty object, so the line prints
	// no `pid=`/`cwd=` fields instead of empty ones.
	assert.deepEqual(
		readSecondLaunchRequest({ commandLine: ["electron", "."] }),
		{
			session: null,
			show: "focus",
			requester: null,
		},
	);
});

test("a second launch raises the window only as far as it asked", () => {
	// The three cases the operator's report needs, end to end through the policy:
	// a headless request raises NOTHING, an inactive request orders the window
	// without activating the app, and an undeclared request is the person's own
	// second launch, unchanged.
	const raised = [];
	for (const argv of [
		["electron", ".", "--window-mode=headless"],
		["electron", ".", "--window-mode=inactive"],
		["electron", "."],
	]) {
		const window = fakeWindow();
		raiseWindow(window, resolveSecondLaunchShow({ argv }), {
			trigger: "second-instance",
		});
		raised.push([argv.at(-1), window.calls]);
	}
	assert.deepEqual(raised, [
		["--window-mode=headless", []],
		["--window-mode=inactive", ["showInactive"]],
		[".", ["show", "focus"]],
	]);

	// And the same three through the channel the documented scripts actually use,
	// where the command line carries no mode at all.
	for (const [mode, expected] of [
		["headless", []],
		["inactive", ["showInactive"]],
		["normal", ["show", "focus"]],
	]) {
		const window = fakeWindow();
		raiseWindow(
			window,
			resolveSecondLaunchShow({
				argv: ["electron", "."],
				additionalData: windowIntentPayload(mode),
			}),
			{ trigger: "second-instance" },
		);
		assert.deepEqual(window.calls, expected, `carried ${mode}`);
	}
});

test("a headless-declared second launch still names the conversation", () => {
	/*
	 * The delivery and the raise are different promises, and this is the test that
	 * keeps a click from becoming a silent no-op: the window's CONTENT moves to
	 * the conversation the launch named while the window itself stays where the
	 * mode says. Both halves are asserted here because a fix that answered the
	 * raise by dropping the conversation would pass every test about focus.
	 */
	const request = readSecondLaunchRequest({
		commandLine: ["electron", ".", `--open-session=${LAUNCHED_SESSION}`],
		additionalData: windowIntentPayload("headless"),
	});
	assert.deepEqual(request, {
		session: LAUNCHED_SESSION,
		show: "never",
		requester: null,
	});

	const window = fakeWindow();
	const applied = [];
	applySecondLaunch(request, {
		window,
		// `index.ts` owns delivery, so this mirrors what its window path does:
		// send the conversation, then come forward only as far as the request
		// allows. WHAT THIS DOES NOT PIN: that `index.ts` really does it in that
		// order — see the seam note in the PR thread.
		openConversation: (sessionId, delivered) => {
			applied.push([sessionId, delivered.show]);
			raiseWindow(window, delivered.show, {
				trigger: "second-instance",
				requester: delivered.requester ?? undefined,
			});
		},
		queue: () => {
			throw new Error("a deliverable conversation must not be queued");
		},
	});
	assert.deepEqual(applied, [[LAUNCHED_SESSION, "never"]]);
	assert.deepEqual(
		window.calls,
		[],
		"a headless request must not raise the window on the delivery path either",
	);

	// The control for that pair, so the assertion above cannot pass because the
	// delivery path never raises anything in any mode.
	const focused = fakeWindow();
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: ["electron", ".", `--open-session=${LAUNCHED_SESSION}`],
		}),
		{
			window: focused,
			openConversation: (sessionId, delivered) => {
				raiseWindow(focused, delivered.show, { trigger: "second-instance" });
			},
			queue: () => {},
		},
	);
	assert.deepEqual(focused.calls, ["show", "focus"]);
});

test("a second launch with no conversation raises by its own mode, and a parked one keeps it", () => {
	const cases = [
		[undefined, ["show", "focus"]],
		[windowIntentPayload("headless"), []],
		[windowIntentPayload("inactive"), ["showInactive"]],
	];
	for (const [additionalData, expected] of cases) {
		const window = fakeWindow();
		applySecondLaunch(
			readSecondLaunchRequest({
				commandLine: ["electron", "."],
				additionalData,
			}),
			{ window, openConversation: () => {}, queue: () => {} },
		);
		assert.deepEqual(
			window.calls,
			expected,
			`intent ${JSON.stringify(additionalData)}`,
		);
	}

	// A launch that arrives before there is a window to send to is PARKED with its
	// mode rather than dropped: by the time the queue flushes, the argv and the
	// payload it arrived with are gone, and re-deriving them is how a headless
	// request becomes a raise.
	const parked = [];
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: ["electron", ".", `--open-session=${LAUNCHED_SESSION}`],
			additionalData: windowIntentPayload("headless", { pid: 31 }),
		}),
		{
			window: null,
			openConversation: null,
			queue: (sessionId, queued) =>
				parked.push([sessionId, queued.show, queued.requester]),
		},
	);
	assert.deepEqual(parked, [[LAUNCHED_SESSION, "never", { pid: 31 }]]);

	/*
	 * NO WINDOW, NO CONVERSATION: the request opens the app's own window.
	 *
	 * It used to do nothing at all, which is why a windowless app ignored the
	 * operator launching it again (nothing appeared) and why a conversation parked
	 * by a `headless` request had no launch to open it. `headless` still opens
	 * nothing: that is the whole of the mode's promise, and the parked conversation
	 * waits for the window that comes next.
	 */
	for (const [additionalData, expected] of [
		[undefined, ["focus"]],
		[windowIntentPayload("inactive"), ["inactive"]],
		[windowIntentPayload("headless"), []],
	]) {
		const opened = [];
		applySecondLaunch(
			readSecondLaunchRequest({
				commandLine: ["electron", "."],
				additionalData,
			}),
			{
				window: null,
				openConversation: null,
				queue: () => {},
				openWindow: (request) => opened.push(request.show),
			},
		);
		assert.deepEqual(
			opened,
			expected,
			`a windowless app with ${JSON.stringify(additionalData)}`,
		);
	}

	// With a window there is nothing to open: the raise is the whole answer, and a
	// target that never opens a window must not be required to provide one.
	applySecondLaunch(
		readSecondLaunchRequest({ commandLine: ["electron", "."] }),
		{
			window: fakeWindow(),
			openConversation: null,
			queue: () => {},
			openWindow: () => {
				throw new Error("a request with a window must not open another");
			},
		},
	);
});

test("no file but window-raise.ts raises or focuses a window", () => {
	/*
	 * The source-level guard, because the defect this change removes was one
	 * unconditional `mainWindow.show()` and the guard has to be wider than the
	 * file that had it. It scans every module under `src/main/` RECURSIVELY
	 * (`src/main/backend/` is where most of them live: a non-recursive readdir
	 * left seven files unscanned, and a raise added to one of them passed this
	 * test), and it
	 * includes `focus()`: on macOS `show()` activates the app for any non-panel
	 * window whatever `focusable` says (measured), so a stray `focus()` on a
	 * window that is already up is a lesser version of the same mistake. A
	 * mutation that deletes the mode gate from any of these call sites fails
	 * here rather than in production.
	 *
	 * `notification.show()` is Electron's own banner API on a `Notification`,
	 * not a window, so it is named here rather than skipped by a filename: the
	 * allow-list is one line, and anything else that raises a window has to go
	 * through `window-raise.ts`.
	 */
	const RAISE_PATTERN = /\.(show|showInactive|focus)\(\)/;
	const ALLOWED = /notification\.show\(\)/;
	const offSite = [];
	const scanned = [];
	for (const file of readdirSync("src/main", { recursive: true }).filter(
		(name) => name.endsWith(".ts"),
	)) {
		scanned.push(file);
		if (file === "window-raise.ts") continue;
		readFileSync(join("src/main", file), "utf8")
			.split("\n")
			.forEach((line, index) => {
				if (!RAISE_PATTERN.test(line) || ALLOWED.test(line)) return;
				offSite.push(`src/main/${file}:${index + 1}: ${line.trim()}`);
			});
	}
	assert.deepEqual(
		offSite,
		[],
		"these lines raise or focus a window outside window-raise.ts, where no mode gate can be checked",
	);
	// Pins the recursion itself: the guard is only as wide as its scan, and a
	// flat readdir silently narrows it to the handful of files at the top.
	assert.ok(
		scanned.some((file) => file.includes(sep)),
		`the scan reached subdirectories (scanned ${scanned.length} modules)`,
	);
});

test("no rig script asks the operating system for window focus", () => {
	/*
	 * The RIG-side half of the scan above, and the half that was missing while
	 * the operator's focus was still being taken with the mode policy holding.
	 *
	 * Measured on the operator's machine (2026-09-19): 46 app instances launched
	 * by rigs, 227 window samples, ZERO windows — the mode policy working exactly
	 * as documented — and one of those windowless, unfocusable instances was
	 * still the FRONTMOST APPLICATION for about eight seconds. "Never shown" and
	 * "cannot take the operator's focus" are different properties: the launch
	 * decides the first one, and the requests the rig makes afterwards decide the
	 * second. The `src/main` scan cannot see a request made from the renderer
	 * side, and that is precisely where a rig reaches the operating system.
	 *
	 * The calls named here are the ones that leave the page: `window.focus()`
	 * asks macOS to order the window and activate the app, and
	 * `Page.bringToFront` / `Target.activateTarget` are the CDP spellings of the
	 * same request. Element focus (`input.focus()`, `document.body.focus()`) is
	 * deliberately NOT matched — moving a caret inside the page is the supported
	 * way to arrange a focus assertion, and `Emulation.setFocusEmulationEnabled`
	 * is the supported way to make a page that is not on screen read as focused.
	 * Between them they cover what a rig needs, which is why this is a ban on the
	 * three calls that leave the page rather than on focus assertions.
	 *
	 * THE RECEIVER IS A FAMILY, NOT A NAME (review round 1 on #406, MINOR R1-1).
	 * `self` IS `window` in a renderer, and `top`, `parent`, `defaultView` and
	 * `frames[n]` are the same WindowProxy under their own spellings — measured
	 * on `d109863e2`: with `self.focus()`, `top.focus()`, `parent.focus()`,
	 * `document.defaultView.focus()` and `frames[0].focus()` appended to a rig,
	 * the literal-`window.` version of this pattern passed, so the ban closed at
	 * one spelling and reopened at the next.
	 *
	 * THE NEAR-SPELLINGS TOO (review round 2, MINOR R2-1), because a guard that
	 * misses them undercuts the class it exists to close: optional chaining
	 * (`window?.focus()` — the defensive style this codebase already writes for
	 * element focus) and bracket access (`window["focus"]()`) are the same call,
	 * and both passed the widened pattern before this round.
	 *
	 * WHAT A RED SCAN MIGHT BE INSTEAD (review round 2, NIT R2-2): the receiver
	 * alternation matches by NAME, so it also matches a Node-side local that
	 * happens to be called `self`, `top`, `parent` or `frames[n]` —
	 * `const parent = node.parentElement; parent.focus()` fails closed, and no
	 * such use exists under the scanned trees today (the reviewer's grep, re-run
	 * here). A red line from this test may therefore be a name collision rather
	 * than an activation, which is worth knowing before one is diagnosed.
	 *
	 * AND WHAT IT STILL CANNOT BOUND: a name it never sees — an ALIAS
	 * (`const w = window; w.focus()`) or a COMPUTED key
	 * (`window["fo" + "cus"]()`). Both are review's business rather than this
	 * test's; the alternation's job is to leave no cheap spelling of the call open.
	 *
	 * WHAT THIS TEST DOES NOT CLAIM: that a rig caused the activation measured
	 * above. The mechanism was never identified, and the instance that took the
	 * front ran a driver whose only focus calls were element-level. The rule
	 * stands on its own terms — a rig has no business asking the operating system
	 * for the keyboard, whatever mode the run declared — so the scan exists to
	 * keep that request out of the tree, not to explain that afternoon.
	 */
	const LEAVES_THE_PAGE =
		/window\??\.focus\(\)|\b(window|self|top|parent|defaultView|frames\s*\[\s*\d+\s*\])\s*(?:\??\.\s*focus\s*\(|\[\s*["']focus["']\s*\]\s*\()|Page\.bringToFront|Target\.activateTarget/;
	/*
	 * COMMENTS ARE BLANKED, NOT FILTERED BY PREFIX (review round 1, F2). The first
	 * version skipped any line whose leading characters looked like a comment, and
	 * that also skipped a real call that followed one: a line whose leading
	 * characters were a block-comment opener and closer and then the CDP call, a
	 * line led by a comment terminator, and a line led by a bare asterisk all left
	 * this suite green while carrying the call. `blankComments` is this repository's own helper (scripts/chrome-keychain.mjs,
	 * the one the keychain rigs use): it preserves line structure, so a finding
	 * still reports the line it came from, and it copies template CONTENT through
	 * rather than blanking it, so a call inside a template literal — the shape
	 * these rigs actually use — is still seen.
	 */
	const SCANNED_TREES = [
		{
			/*
			 * Every executable a driver in this tree is written in today: `.mjs` and
			 * `.js` for the proofs, `.cjs` for the Electron scenario driver, `.ts` for
			 * the vite plugins, `.tsx` for the evidence components that speak CDP,
			 * `.html` for the viewports whose inline scripts click and focus. The
			 * `.mjs`-only filter let four real driver shapes through (round 1, F3).
			 */
			root: "scripts",
			extensions: /\.(mjs|js|cjs|ts|tsx|html)$/,
			include: () => true,
		},
		{
			/*
			 * The CDP harnesses that live beside the evidence they produced. They are
			 * the other half of "a rig" in this repository, and leaving them out is
			 * how the ban would hold for the proofs and not for the harnesses (F3).
			 */
			root: "docs/evidence",
			extensions: /\.(mjs|js|cjs)$/,
			include: (name) => name.split(sep).includes("harness"),
		},
		{ root: "bin", extensions: /\.(mjs|js|cjs)$/, include: () => true },
	];
	/*
	 * This file is skipped, the same way the scan above skips `window-raise.ts`:
	 * its subject matter is these three call sites, so it necessarily contains
	 * them, and a scan that flagged its own pattern list would only teach the
	 * next author to obfuscate the pattern.
	 */
	const SELF = "window-mode.test.mjs";
	/*
	 * HTML IS NOT JAVASCRIPT, and blanking it as if it were is wrong in both
	 * directions (review round 2, R2-1): an HTML comment that merely MENTIONS the
	 * call became a finding, and a real call sharing a line with an unquoted `//`
	 * — a URL in markup — was blanked away. HTML comments are stripped here with
	 * line structure preserved, and the rest is read verbatim, so both the markup
	 * and the inline script are seen without either artefact.
	 */
	const blankHtmlComments = (source) =>
		source.replace(/<!--[\s\S]*?-->/g, (hit) => hit.replace(/[^\n]/g, " "));
	const offSite = [];
	const scanned = [];
	/*
	 * The name RELATIVE to its tree is what the recursion pin reads, and the count
	 * is kept PER TREE so a walked root that silently vanished fails instead of
	 * passing on the strength of the others (review round 2, R1-F4: the first
	 * version pinned the `scanned` entries, which are `${root}/${file}` and
	 * therefore contain a separator whether or not the walk descended, so a flat
	 * readdir passed both pins).
	 */
	const relativeNames = [];
	const perTree = new Map();
	for (const tree of SCANNED_TREES) {
		let reached = 0;
		if (existsSync(tree.root)) {
			for (const file of readdirSync(tree.root, { recursive: true }).filter(
				(name) => tree.extensions.test(name) && tree.include(name),
			)) {
				reached += 1;
				scanned.push(`${tree.root}/${file}`);
				relativeNames.push(file);
				if (file.endsWith(SELF)) continue;
				const source = readFileSync(join(tree.root, file), "utf8");
				(file.endsWith(".html")
					? blankHtmlComments(source)
					: blankComments(source)
				)
					.split("\n")
					.forEach((line, index) => {
						if (!LEAVES_THE_PAGE.test(line)) return;
						offSite.push(`${tree.root}/${file}:${index + 1}: ${line.trim()}`);
					});
			}
		}
		perTree.set(tree.root, reached);
	}
	assert.deepEqual(
		offSite,
		[],
		"these lines ask the operating system to bring a window forward, which takes the operator's focus whatever window mode the run declared",
	);
	/*
	 * And the pattern FIRES on every spelling it names. A widened alternation that
	 * quietly stopped matching would leave the ban green while covering nothing —
	 * the one failure a green scan cannot show by itself — so each spelling is
	 * asserted against the pattern directly rather than left to a rig in this
	 * tree happening to contain one.
	 */
	const SPELLINGS = [
		"window.focus()",
		"window?.focus()",
		'window["focus"]()',
		"self.focus()",
		"self?.focus()",
		"self['focus']()",
		"top.focus()",
		"parent.focus()",
		"document.defaultView.focus()",
		"document.defaultView?.focus()",
		"frames[0].focus()",
		"Page.bringToFront",
		"Target.activateTarget",
	];
	assert.deepEqual(
		SPELLINGS.filter((spelling) => !LEAVES_THE_PAGE.test(spelling)),
		[],
		"the pattern must fire on every spelling of the request this ban names",
	);
	// Pins the width of the scan the way its `src/main` sibling does, and pins the
	// three ways it can silently narrow: too few files at all, a walk that stopped
	// descending, and a tree that stopped contributing anything.
	assert.ok(
		scanned.length > 20,
		`the scan reached the rig trees (scanned ${scanned.length} files)`,
	);
	assert.ok(
		relativeNames.some((name) => name.includes(sep)),
		`the walk descended into subdirectories (${relativeNames.length} files scanned)`,
	);
	for (const tree of SCANNED_TREES) {
		assert.ok(
			(perTree.get(tree.root) ?? 0) > 0,
			`the scan reached ${tree.root}`,
		);
	}
});
