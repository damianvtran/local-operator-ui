/**
 * The macOS window chrome: the pure frame decision, the style rules that act on
 * it, and the lane the renderer reserves for the OS traffic lights.
 *
 * WHAT THIS CANNOT SEE. The lights themselves. `Page.captureScreenshot` and
 * `webContents.capturePage()` photograph the renderer alone, so no frame this app
 * can take contains them; the only instrument that can is a `screencapture -l`
 * window capture, and that needs a window on the operator's screen. The pixels
 * are therefore NOT asserted here - only the decision, the rules and the
 * element's place in the tree, which are the three things that can be read.
 *
 * The module is bundled from the shipped source rather than re-implemented, the
 * same way `scripts/sidebar-split.test.mjs` drives its own module.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/titlebar-options";',
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { titlebarOptions } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("macOS hides the titlebar while retaining the native traffic lights", () => {
	assert.deepEqual(titlebarOptions("darwin"), { titleBarStyle: "hidden" });
	/*
	 * The lights keep the platform default. `trafficLightPosition` is deliberately
	 * NOT set: nothing shares a centre with them any more - the renderer gives them
	 * their own lane and puts every column's first row below it - so moving them
	 * would be native chrome moved for nothing. Pinned because it is exactly the
	 * kind of field a later "let us line the brand up with the lights" edit adds.
	 */
	assert.equal("trafficLightPosition" in titlebarOptions("darwin"), false);
});

test("every other platform keeps its existing native frame", () => {
	for (const platform of ["win32", "linux", "freebsd", "aix"]) {
		assert.deepEqual(titlebarOptions(platform), {});
	}
});

test("the main window takes the frame from the closed decision", () => {
	const main = readSource("src/main/index.ts");
	assert.match(main, /\.\.\.titlebarOptions\(process\.platform\)/);
});

test("a CSS comment is prose, and the rules that act on the gate are declarations", () => {
	const css = readSource("src/renderer/src/styles/index.css").replace(
		/\/\*[\s\S]*?\*\//g,
		"",
	);
	/* The drag vocabulary: the region drags, and every control inside opts out. */
	assert.match(
		css,
		/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-drag\]\s*\{\s*-webkit-app-region:\s*drag;/,
	);
	assert.match(css, /-webkit-app-region:\s*no-drag;/);
	assert.match(
		css,
		/\[data-titlebar-no-drag\]/,
		"the no-drag selector list must name the explicit opt-out, which is what a control inside a drag region uses",
	);
	/*
	 * The lane is invisible off macOS and 32px on it, and the two rules must be
	 * ATTRIBUTE-SCOPED rather than relying on source order: a lane that shows on
	 * Windows is 32px of nothing between the native frame and the app's own rows.
	 */
	assert.match(css, /\[data-titlebar-lane\]\s*\{\s*display:\s*none;/);
	assert.match(
		css,
		/\[data-titlebar-platform="mac"\]\s+\[data-titlebar-lane\]\s*\{[\s\S]*?height:\s*var\(--chrome-strip-h\);/,
	);
	assert.match(css, /--chrome-strip-h:\s*32px;/);
});

test("the shell carries the gate, and the lane is the first thing under it", () => {
	const app = readSource("src/renderer/src/app.tsx");
	/*
	 * Compound on ONE element, which is the defect #477's own review caught on the
	 * rail: `data-titlebar-platform` and `data-titlebar-sidebar-collapsed` are both
	 * set on the shell `<div>`, so a rule written as `[platform] [collapsed]` is
	 * dead CSS that still looks present.
	 */
	assert.match(app, /data-titlebar-platform=\{/);
	assert.match(app, /data-titlebar-sidebar-collapsed=\{/);

	const shell = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	/*
	 * ORDER, not a count: the lane has to be ABOVE the columns, because that is what
	 * makes the sidebar's brand row and the conversation title share one line (a
	 * lane between them, or below them, is 32px of misalignment). The shell renders
	 * ONE tree for all three sidebar modes now (docked, strip, and the sheet over
	 * the pane - design round 1, D2), so there is exactly one lane and it precedes
	 * the row wrapper.
	 */
	const lane = shell.indexOf('data-titlebar-lane=""');
	assert.notEqual(lane, -1, "the shell renders no macOS lane");
	const rowAfterLane = shell.indexOf(
		'className="flex min-h-0 flex-1 overflow-hidden"',
	);
	assert.notEqual(rowAfterLane, -1);
	assert.ok(
		lane < rowAfterLane,
		"the lane must be the first child of the shell column, above the columns it insets",
	);
	assert.equal(
		shell.split('data-titlebar-lane=""').length - 1,
		1,
		"one shell tree, one lane - a second branch is how the overlay once dropped the pane",
	);
});
