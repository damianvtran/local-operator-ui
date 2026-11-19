import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { blankComments } from "./chrome-keychain.mjs";

/*
 * #1085: the toolkit's `watchWindowShortcuts` cancelled Ctrl+R in packaged
 * builds (the Console never got reverse search) and Cmd/Ctrl+minus by default
 * (Zoom Out never fired). Main now intercepts only dev-time F12.
 */
const SOURCE_FILE = /\.tsx?$/;
const F12_GATE = /shouldToggleDevTools\(input, is\.dev\)/;

const bundle = await build({
	entryPoints: ["src/main/dev-shortcuts.ts"],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { shouldToggleDevTools } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function mainSources(dir = "src/main") {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return mainSources(path);
		return SOURCE_FILE.test(entry.name) ? [path] : [];
	});
}

test("no main-process file installs the toolkit window shortcut hook", () => {
	const offenders = mainSources().filter((path) =>
		blankComments(readFileSync(path, "utf8")).includes("watchWindowShortcuts"),
	);
	assert.deepEqual(offenders, []);
});

test("the window hook keeps the dev-gated F12 handler", () => {
	const code = blankComments(readFileSync("src/main/index.ts", "utf8"));
	const hook = code.indexOf('"browser-window-created"');
	assert.ok(hook > 0, "browser-window-created hook is missing");
	const body = code.slice(hook, hook + 600);
	assert.match(body, F12_GATE);
});

const key = (code) => ({ type: "keyDown", code });

test("terminal and zoom chords are never intercepted", () => {
	for (const isDev of [true, false]) {
		for (const code of ["KeyR", "KeyT", "KeyI", "Minus", "Equal", "Digit0"]) {
			assert.equal(shouldToggleDevTools(key(code), isDev), false, code);
		}
	}
});

test("F12 toggles DevTools only in development, on key down", () => {
	assert.equal(shouldToggleDevTools(key("F12"), true), true);
	assert.equal(shouldToggleDevTools(key("F12"), false), false);
	assert.equal(
		shouldToggleDevTools({ type: "keyUp", code: "F12" }, true),
		false,
	);
});
