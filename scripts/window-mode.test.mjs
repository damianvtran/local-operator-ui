import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

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
const { applySecondLaunch, presentWindow, raiseWindow, readSecondLaunchRequest } =
	raise;

const plan = (input) => resolveWindowLaunchPlan(input);

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
});

test("inactive shows the window without activating the app", () => {
	const resolved = plan({ env: { [WINDOW_MODE_ENV]: "inactive" } });
	assert.equal(resolved.mode, "inactive");
	assert.equal(resolved.show, "inactive");
	// Still focusable: this mode exists for a run a person may want to click
	// into, so refusing focus permanently would be the wrong half-measure.
	assert.equal(resolved.focusable, true);
	assert.equal(resolved.backgroundThrottling, false);
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
		plan({ argv: ["--window-size=1380x900", "--window-size=1024x768"] })
			.width,
		1024,
	);
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
	);
	assert.match(headless, /never shown/);
	assert.match(headless, /1380x900/);
	assert.match(headless, /throttling off/);
	assert.match(
		describeWindowLaunch(plan({ env: { [WINDOW_MODE_ENV]: "inactive" } })),
		/without activating/,
	);
	assert.match(describeWindowLaunch(plan()), /shown and focused/);
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

	// A minimized window is restored before it is ordered — but not in
	// `headless`, where there is nothing to bring forward.
	for (const show of ["focus", "inactive", "never"]) {
		const window = fakeWindow({ minimized: true });
		raiseWindow(window, show, { trigger: "second-instance" });
		assert.equal(
			window.calls.includes("restore"),
			show !== "never",
			`restore-before-raise in ${show}`,
		);
	}
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
	"open-conversation",
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

test("a raise names its trigger and what it did, and a mode that raises nothing says nothing", () => {
	// Why this is asserted rather than left to the comments: `window-raise.ts`
	// logged nothing at all before this change, which is exactly why the
	// operator's report ("the app steals my focus whenever a chat completes")
	// could not be answered on the machine where it happened. Four call sites
	// raise a window from four different causes, and the line has to say which.
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
			(trigger) => `trigger=${trigger} requested=focus applied=show+focus`,
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
		"trigger=second-instance requested=inactive applied=showInactive",
	]);

	const minimized = [];
	raiseWindow(fakeWindow({ minimized: true }), "focus", {
		trigger: "banner-click",
		report: (line) => minimized.push(line),
	});
	assert.deepEqual(minimized, [
		"trigger=banner-click requested=focus applied=restore+show+focus",
	]);

	const presented = [];
	presentWindow(fakeWindow(), "inactive", {
		trigger: "initial-present",
		report: (line) => presented.push(line),
	});
	assert.deepEqual(presented, [
		"trigger=initial-present requested=inactive applied=showInactive",
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
		[WINDOW_INTENT_KEY]: "headless",
	});
	assert.equal(readWindowIntent(windowIntentPayload("headless")), "headless");
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
		resolveSecondLaunchShow({ argv: ["electron", ".", "--window-mode=headless"] }),
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
	assert.deepEqual(request, { session: LAUNCHED_SESSION, show: "never" });

	const window = fakeWindow();
	const applied = [];
	applySecondLaunch(request, {
		window,
		// `index.ts` owns delivery, so this mirrors what its window path does:
		// send the conversation, then come forward only as far as `show` allows.
		openConversation: (sessionId, show) => {
			applied.push([sessionId, show]);
			raiseWindow(window, show, { trigger: "open-conversation" });
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
			openConversation: (sessionId, show) => {
				raiseWindow(focused, show, { trigger: "open-conversation" });
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
		assert.deepEqual(window.calls, expected, `intent ${JSON.stringify(additionalData)}`);
	}

	// A launch that arrives before there is a window to send to is PARKED with its
	// mode rather than dropped: by the time the queue flushes, the argv and the
	// payload it arrived with are gone, and re-deriving them is how a headless
	// request becomes a raise.
	const parked = [];
	applySecondLaunch(
		readSecondLaunchRequest({
			commandLine: ["electron", ".", `--open-session=${LAUNCHED_SESSION}`],
			additionalData: windowIntentPayload("headless"),
		}),
		{
			window: null,
			openConversation: null,
			queue: (sessionId, show) => parked.push([sessionId, show]),
		},
	);
	assert.deepEqual(parked, [[LAUNCHED_SESSION, "never"]]);

	// With no window and no conversation there is nothing to do at all — and
	// specifically no error, which is what a second launch during startup is.
	applySecondLaunch(
		readSecondLaunchRequest({ commandLine: ["electron", "."] }),
		{ window: null, openConversation: null, queue: () => {} },
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
