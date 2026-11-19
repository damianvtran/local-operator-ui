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
			export { formatBoundaryError, BOUNDARY_ERROR_CAP, BOUNDARY_COMPONENT_STACK_CAP } from "./src/renderer/src/shared/components/common/error-boundary-log";
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
const {
	formatBoundaryError,
	BOUNDARY_ERROR_CAP,
	BOUNDARY_COMPONENT_STACK_CAP,
	ErrorBoundary,
	setLocale,
} = compiled.exports;
setLocale("en");
const HEAD_TRUNCATED = /\.\.\.\[truncated \d+ chars\]\nComponent stack:/;
const TAIL_TRUNCATED = /\.\.\.\[truncated \d+ chars\]$/;

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

test("a non-Error throw logs its type and key names, never its values (F3, F4)", () => {
	assert.equal(
		formatBoundaryError({ code: 7, secret: "do-not-log" }, undefined),
		"Error caught by ErrorBoundary: [object Object] keys: code, secret\nComponent stack: (none reported)",
	);
	const many = Object.fromEntries(
		Array.from({ length: 25 }, (_, index) => [`k${index}`, index]),
	);
	assert.ok(formatBoundaryError(many, null).includes("k19, +5 more"));
	assert.ok(
		formatBoundaryError(Symbol("x"), null).startsWith(
			"Error caught by ErrorBoundary: Symbol(x)\n",
		),
	);
	assert.ok(
		formatBoundaryError(function thrown() {}, null).includes("function thrown"),
	);
	assert.ok(formatBoundaryError("plain", null).includes(": plain\n"));
});

/*
 * NEVER THROWS (agent review round 1, F1): every one of these threw before,
 * and a throw from the boundary's own error path replaces the original error.
 */
test("hostile thrown values and info never make the formatter throw (F1)", () => {
	const cyclic = Object.create(null);
	cyclic.self = cyclic;
	const hostile = {
		toJSON() {
			throw new Error("toJSON");
		},
		toString() {
			throw new Error("toString");
		},
	};
	const { proxy, revoke } = Proxy.revocable({}, {});
	revoke();
	const badStack = new Error("kept message");
	Object.defineProperty(badStack, "stack", {
		get() {
			throw new Error("stack getter");
		},
	});
	const badInfo = {
		get componentStack() {
			throw new Error("componentStack getter");
		},
	};
	const cases = [
		[cyclic, null],
		[hostile, null],
		[proxy, null],
		[badStack, null],
		[new Error("ok"), badInfo],
	];
	for (const [error, info] of cases) {
		const line = formatBoundaryError(error, info);
		assert.equal(typeof line, "string");
		assert.ok(line.startsWith("Error caught by ErrorBoundary:"), line);
	}
	assert.ok(formatBoundaryError(cyclic, null).includes("keys: self"));
	assert.ok(formatBoundaryError(badStack, null).includes("kept message"));
	assert.ok(
		formatBoundaryError(new Error("ok"), badInfo).includes(
			"Component stack: (none reported)",
		),
	);
});

test("each part is capped with a truncation marker (F2)", () => {
	const huge = new Error("m".repeat(BOUNDARY_ERROR_CAP * 4));
	const deep = Array.from(
		{ length: 10_000 },
		(_, index) => `\n    at Frame${index} (bundle.js:1:${index})`,
	).join("");
	const line = formatBoundaryError(huge, { componentStack: deep });
	assert.ok(
		line.length < BOUNDARY_ERROR_CAP + BOUNDARY_COMPONENT_STACK_CAP + 200,
		`bounded: ${line.length}`,
	);
	assert.match(line, HEAD_TRUNCATED);
	assert.ok(line.includes("at Frame0 "), "the stack's top survives");
	assert.match(line, TAIL_TRUNCATED);
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
	// Unmounted whatever the assertions do, so a failure leaves no live root (F5).
	try {
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
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});
