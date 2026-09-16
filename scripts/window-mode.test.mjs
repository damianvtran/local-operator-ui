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
	LAUNCHER_KEEP_ALIVE_ENV,
	WINDOW_MAX_EDGE,
	WINDOW_MIN_HEIGHT,
	WINDOW_MIN_WIDTH,
	WINDOW_MODE_ENV,
	WINDOW_SIZE_ENV,
	describeWindowLaunch,
	parseWindowMode,
	parseWindowSize,
	resolveLauncherWatchPlan,
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
