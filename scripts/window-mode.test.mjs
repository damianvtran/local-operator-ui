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
	WINDOW_MAX_EDGE,
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	WINDOW_MODE_ENV,
	WINDOW_SIZE_ENV,
	describeWindowLaunch,
	parseWindowMode,
	parseWindowSize,
	resolveWindowLaunchPlan,
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
const { presentWindow, raiseWindow } = raise;

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
	const resolved = plan({
		packaged: false,
		stdinIsTTY: undefined,
		stdoutIsTTY: undefined,
	});
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
		const resolved = plan({ packaged: false, ...streams });
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
		plan({ stdinIsTTY: undefined, stdoutIsTTY: undefined }).mode,
		"normal",
	);
});

test("a named mode still wins on a launch with no terminal", () => {
	// The escape hatch, on the new path: a person who launches the checkout from
	// a non-terminal launcher keeps `normal` by naming it.
	for (const mode of ["normal", "inactive", "headless"]) {
		const resolved = plan({
			argv: [`--window-mode=${mode}`],
			packaged: false,
			stdinIsTTY: undefined,
			stdoutIsTTY: undefined,
		});
		assert.equal(resolved.mode, mode);
		assert.equal(resolved.assumed, null, `${mode} from the flag is not assumed`);
	}
});

test("an agent switch is the stronger reason and is what the line names", () => {
	// Both signals can be true at once, and the line has to name the specific
	// one: "a rig passed --user-data-dir" is what a reader can act on.
	const both = plan({
		argv: ["--user-data-dir=/tmp/rig"],
		packaged: false,
		stdinIsTTY: undefined,
		stdoutIsTTY: undefined,
	});
	assert.equal(both.mode, "headless");
	assert.match(both.assumed ?? "", /user-data-dir/);
	assert.doesNotMatch(both.assumed ?? "", /no terminal/);
});

test("a mistyped or empty mode beside a terminal-less launch still reports rather than assumes", () => {
	// Reaching for the mode is asking to be told. A typo keeps the report and
	// the `normal` fallback; an empty value names nothing and takes the new
	// assumption exactly as it takes the switch-based one.
	const typo = plan({
		env: { [WINDOW_MODE_ENV]: "headles" },
		packaged: false,
		stdinIsTTY: undefined,
		stdoutIsTTY: undefined,
	});
	assert.equal(typo.mode, "normal");
	assert.equal(typo.assumed, null);
	assert.match(typo.problems[0], /headles/);

	const blank = plan({
		env: { [WINDOW_MODE_ENV]: "" },
		packaged: false,
		stdinIsTTY: undefined,
		stdoutIsTTY: undefined,
	});
	assert.equal(blank.mode, "headless");
	assert.match(blank.assumed ?? "", /no terminal/);
	assert.doesNotMatch(blank.problems[0], /using normal/);
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

	const presented = [];
	for (const show of ["focus", "inactive", "never"]) {
		const window = fakeWindow();
		presentWindow(window, show);
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
		raiseWindow(window, show);
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
		raiseWindow(window, show);
		assert.equal(
			window.calls.includes("restore"),
			show !== "never",
			`restore-before-raise in ${show}`,
		);
	}
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
