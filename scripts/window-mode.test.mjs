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
	assert.equal(resolved.mode, "normal");
	assert.equal(resolved.problems.length, 1);
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
