import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The About panel's policy, and the shape of the code that applies it.
 *
 * Why these cases. The macOS About panel is AppKit's own window and it is a
 * window on the OPERATOR's screen: for an unpackaged launch - which is how every
 * rig, QA harness and `npx electron .` boots this app - it was filled from
 * Electron.app's bundle, so it read "Electron / Version 44.3.0 (44.3.0)" under
 * Electron's icon, and an agent run could put that in front of the operator by
 * opening the app menu. Two things have to hold for that to be gone, and neither
 * is visible in a unit test of the other:
 *
 *   * the DECISION - which modes raise the panel - which is why the decision is a
 *     pure function of the resolved mode and is asserted here for all three;
 *   * the APPLICATION - that the menu's About item actually goes through that
 *     decision, and that the app registers its own identity - which is a fact
 *     about `src/main/index.ts` and is asserted against its source, the way
 *     `window-mode.test.mjs` asserts the shapes there.
 *
 * The module is bundled in memory from the shipped TypeScript, so these stay
 * tests of the code that ships.
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
const { WINDOW_MODES, resolveAboutPanelAction } = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

const SOURCE = join(process.cwd(), "src", "main");
const indexSource = readFileSync(join(SOURCE, "index.ts"), "utf8");

/** Every `.ts` file under `src/main`, so a second call site anywhere is found. */
const mainSources = () => {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry);
			if (statSync(path).isDirectory()) walk(path);
			else if (entry.endsWith(".ts")) out.push(path);
		}
	};
	walk(SOURCE);
	return out;
};

/**
 * A source file's executable lines, with comment lines dropped.
 *
 * The assertion below counts CALL SITES, and this repository comments in prose
 * that names the calls it is talking about: `window-mode.ts` argues the About
 * decision in a doc comment that spells `app.showAboutPanel()`. Counting raw
 * text would count that prose and fail on a file that is exactly right.
 */
const codeLines = (text) =>
	text
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("*") ||
				trimmed.startsWith("//") ||
				trimmed.startsWith("/*")
			);
		})
		.join("\n");

const countIn = (sources, needle) =>
	sources.reduce(
		(total, file) =>
			total + codeLines(readFileSync(file, "utf8")).split(needle).length - 1,
		0,
	);

/**
 * The `setAboutPanelOptions` call's own text, from the call to the end of its
 * argument object. Extracted rather than regexed over the whole file so the
 * assertions below are about the registration and not about any other `version:`
 * or `copyright` in a 2,900-line file.
 */
const aboutOptionsSource = () => {
	const at = indexSource.indexOf("app.setAboutPanelOptions({");
	assert.notEqual(at, -1, "index.ts must register the About panel options");
	const lines = indexSource.slice(at).split("\n");
	const block = [];
	for (const line of lines) {
		block.push(line);
		if (block.length > 1 && line.trim() === "});") break;
	}
	return block.join("\n");
};

test("headless is the only mode that suppresses the About action", () => {
	/*
	 * `headless` is the mode whose entire promise is that nothing appears on the
	 * operator's screen, and the panel is a window on it. The other two show a
	 * window by design: `inactive` shows it without activating the app, and the
	 * panel is allowed there because it does not activate the app either
	 * (measured: `app.isActive()` stays false and the frontmost pid never moves).
	 */
	assert.equal(resolveAboutPanelAction("headless"), "suppress");
	assert.equal(resolveAboutPanelAction("inactive"), "show");
	assert.equal(resolveAboutPanelAction("normal"), "show");
});

test("every documented window mode has an answer, so a new one cannot be unhandled", () => {
	for (const mode of WINDOW_MODES) {
		const action = resolveAboutPanelAction(mode);
		assert.ok(
			action === "suppress" || action === "show",
			`mode ${mode} resolved to ${String(action)}, which is not a decision this action knows how to apply`,
		);
	}
	assert.deepEqual([...WINDOW_MODES].sort(), [
		"headless",
		"inactive",
		"normal",
	]);
});

test("the menu item is gated by the launch's RESOLVED mode, not by a second read of the environment", () => {
	/*
	 * The gate has to consult the plan the process already resolved: the window
	 * mode is a fact about the launch (see `window-mode.ts` on `launchEnv`), and a
	 * menu handler that re-read `process.env` could disagree with the mode the run
	 * reported in its own startup line.
	 */
	assert.match(
		indexSource,
		/resolveAboutPanelAction\(windowLaunch\.mode\)\s*===\s*"suppress"/,
		"the About handler must branch on the resolved window mode",
	);
});

test("no About item is left to Electron's role, whose action nothing can intercept", () => {
	/*
	 * A `role: "about"` item's click is AppKit's `orderFrontStandardAboutPanel:`:
	 * there is no handler of ours in the path, so a headless run would raise a real
	 * panel. Measured on the base tree, where that is exactly what happened.
	 */
	for (const file of mainSources()) {
		const text = readFileSync(file, "utf8");
		assert.doesNotMatch(
			text,
			/role:\s*"about"/,
			`${file} still registers Electron's about role`,
		);
	}
	assert.match(indexSource, /label:\s*`About \$\{app\.name\}`/);
});

test("the panel is raised from exactly one place, and only past the suppression branch", () => {
	const sources = mainSources();
	assert.equal(
		countIn(sources, "showAboutPanel("),
		1,
		"the panel must have one call site, so the gate cannot be routed around",
	);
	const gate = indexSource.indexOf(
		"resolveAboutPanelAction(windowLaunch.mode)",
	);
	const raise = indexSource.indexOf("app.showAboutPanel();");
	assert.notEqual(gate, -1);
	assert.notEqual(raise, -1);
	assert.ok(
		gate < raise,
		"the suppression decision must be read before the panel is raised",
	);
	assert.match(
		indexSource.slice(gate, raise),
		/return;/,
		"the suppressed branch must return, not fall through to the panel",
	);
});

test("the app registers its own identity for the About panel", () => {
	const options = aboutOptionsSource();
	/*
	 * The name is the app's own (`app.name`, which resolves from `productName` in
	 * package.json - "Local Operator"), because the panel's DEFAULT for an
	 * unpackaged run is not the app's name at all: it is Electron.app's bundle
	 * identity, which is the defect this registration removes.
	 */
	assert.match(options, /applicationName:\s*app\.name/);
	// The version is the app's own version, not the runtime's: `package.json` is
	// the version source of truth, and the panel used to show Electron's.
	assert.match(options, /applicationVersion:\s*app\.getVersion\(\)/);
	// macOS puts this string in the parenthesised half of the version line; a bare
	// repeat of the version tells a reader nothing about the run in front of them.
	assert.match(
		options,
		/version:\s*`Electron \$\{process\.versions\.electron\}/,
	);
	assert.match(options, /app\.isPackaged/);
	// The project's existing string, from its one home, and omitted rather than
	// guessed when that read fails.
	assert.match(options, /copyright/);
	assert.match(indexSource, /configureAboutPanel\(\);/);
});
