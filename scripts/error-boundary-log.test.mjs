/**
 * What the app-wide error boundary writes when it catches.
 *
 *     node --test scripts/error-boundary-log.test.mjs
 *
 * WHY. A shipped build's only durable copy of a renderer error is the text the
 * main process forwards from `console-message` into `backend-service.log`, and
 * that text is Chromium's flattening of the console arguments: an `Error` keeps
 * only its message and React's `ErrorInfo` becomes `[object Object]`. The
 * 2026-11-10 Team Bridge crash loop (React #185, three times) was logged exactly
 * that way, with no component named. These cases pin that the boundary now
 * logs ONE string carrying the error's stack and React's component stack, so the
 * flattening has nothing left to drop.
 *
 * The render case drives the real `ErrorBoundary` through the same failure
 * class as the incident: a layout effect whose update re-triggers itself, which
 * React stops with "Maximum update depth exceeded". The component stack must
 * name the looping component.
 *
 * WHAT IT DOES NOT PROVE: that Electron forwards the line (that is
 * `src/main/index.ts`'s `console-message` handler, unchanged here).
 */

import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of ["HTMLElement", "Element", "Node", "MutationObserver"])
	globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const bundle = await build({
	stdin: {
		contents: `
			export { formatBoundaryError } from "./src/renderer/src/shared/components/common/error-boundary-log";
			export { ErrorBoundary } from "./src/renderer/src/shared/components/common/error-boundary";
			export { setLocale } from "./src/renderer/src/shared/i18n";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["react", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	loader: { ".css": "empty" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/error-boundary-log-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { formatBoundaryError, ErrorBoundary, setLocale } = compiled.exports;
setLocale("en");

test("the line carries the stack and the component stack, never [object Object]", () => {
	const error = new Error("boom");
	const line = formatBoundaryError(error, {
		componentStack: "\n    at Looping (file.tsx:1:1)\n    at Page",
	});
	assert.equal(typeof line, "string");
	assert.ok(line.startsWith("Error caught by ErrorBoundary: Error: boom"));
	assert.ok(line.includes(error.stack.split("\n")[1].trim()), "a stack frame");
	assert.ok(line.includes("at Looping (file.tsx:1:1)"), "the component stack");
	assert.ok(!line.includes("[object Object]"));
});

test("a non-Error throw and a missing component stack still format", () => {
	assert.equal(
		formatBoundaryError({ code: 7 }, undefined),
		'Error caught by ErrorBoundary: {"code":7}\nComponent stack: (none reported)',
	);
	const cyclic = {};
	cyclic.self = cyclic;
	assert.ok(formatBoundaryError(cyclic, null).includes("[object Object]"));
});

test("the real boundary logs one string naming the looping component", async () => {
	// The incident's failure class: an update in a layout effect that schedules
	// itself again, which React aborts as "Maximum update depth exceeded".
	function LoopingRow() {
		const [count, setCount] = React.useState(0);
		React.useLayoutEffect(() => setCount(count + 1));
		return React.createElement("span", null, count);
	}
	const calls = [];
	const original = console.error;
	console.error = (...args) => calls.push(args);
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(
					ErrorBoundary,
					null,
					React.createElement(LoopingRow),
				),
			),
		);
	} finally {
		console.error = original;
	}
	const ours = calls.filter(
		(args) =>
			typeof args[0] === "string" &&
			args[0].startsWith("Error caught by ErrorBoundary:"),
	);
	assert.equal(ours.length, 1, "one boundary line");
	assert.equal(ours[0].length, 1, "a single preformatted argument");
	const [line] = ours[0];
	assert.ok(line.includes("Maximum update depth exceeded"), line);
	assert.ok(line.includes("at LoopingRow"), "names the component");
	assert.ok(!line.includes("[object Object]"));
	assert.ok(
		element.textContent.includes("Something went wrong"),
		"the fallback rendered",
	);
	await act(async () => root.unmount());
	element.remove();
});
