/**
 * Preloadable lazy route chunks (PR #1869 QA Q1).
 *
 *     node --test scripts/preloadable-import.test.mjs
 *
 * The first Team Bridge open after a cold launch paid for downloading the lazy
 * `TeamBridgePage` chunk. The shell now preloads it at idle through
 * `preloadableImport`, and the route's `lazy` factory reuses that same import.
 * Asserted here:
 *
 * 1. Preload and the lazy factory share ONE import call.
 * 2. Once preloaded, a `React.lazy` built on `load` renders its content in the
 *    FIRST render (no Suspense fallback) — the control without a preload
 *    renders the fallback.
 * 3. A failed download does not poison the route: the next call retries.
 * 4. `preloadWhenIdle` runs the preload at idle, once, and its cancel stops it.
 *
 * Nothing is mocked except the importer (a counted function standing in for
 * Vite's `import()`); React and react-dom/server are the real packages.
 */
import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/shared/utils/preloadable-import";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	tsconfig: "tsconfig.app.json",
	write: false,
	logLevel: "silent",
});
const compiledPath = `${process.cwd()}/scripts/preloadable-import-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;

const require = Module.createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");

const CONTENT = /team bridge page/;
const FALLBACK = /loading/;
const OFFLINE = /offline/;

const Page = () => React.createElement("main", null, "team bridge page");
const counted = () => {
	const importer = () => {
		importer.calls += 1;
		return Promise.resolve({ TeamBridgePage: Page });
	};
	importer.calls = 0;
	return importer;
};
const route = (chunk) => {
	const Lazy = React.lazy(() =>
		chunk.load().then((mod) => ({ default: mod.TeamBridgePage })),
	);
	return renderToString(
		React.createElement(
			React.Suspense,
			{ fallback: React.createElement("p", null, "loading") },
			React.createElement(Lazy),
		),
	);
};

test("preload and the lazy factory share one import", async () => {
	const importer = counted();
	const chunk = m.preloadableImport(importer);
	const first = chunk.preload();
	const again = chunk.preload();
	assert.equal(first, again);
	assert.equal(chunk.load(), first, "load joins the preload in flight");
	await first;
	chunk.load();
	assert.equal(importer.calls, 1);
});

test("once preloaded, the route renders in the first render (no fallback)", async () => {
	const chunk = m.preloadableImport(counted());
	await chunk.preload();
	const html = route(chunk);
	assert.match(html, CONTENT);
	assert.doesNotMatch(html, FALLBACK);
});

test("control: without a preload the same route suspends to its fallback", () => {
	const chunk = m.preloadableImport(counted());
	const html = route(chunk);
	assert.match(html, FALLBACK);
	assert.doesNotMatch(html, CONTENT);
});

test("a failed download is retried by the next call", async () => {
	let calls = 0;
	const chunk = m.preloadableImport(() => {
		calls += 1;
		return calls === 1
			? Promise.reject(new Error("offline"))
			: Promise.resolve({ TeamBridgePage: Page });
	});
	await assert.rejects(chunk.preload(), OFFLINE);
	await chunk.preload();
	assert.equal(calls, 2);
	assert.match(route(chunk), CONTENT);
});

test("preloadWhenIdle runs at idle once, and cancel stops it", async () => {
	const callbacks = [];
	const cancelled = [];
	globalThis.requestIdleCallback = (fn, options) => {
		assert.equal(options.timeout, 2_000);
		callbacks.push(fn);
		return callbacks.length;
	};
	globalThis.cancelIdleCallback = (handle) => cancelled.push(handle);
	try {
		let preloads = 0;
		const preload = () => {
			preloads += 1;
			return Promise.resolve();
		};
		m.preloadWhenIdle(preload);
		assert.equal(preloads, 0, "nothing before idle");
		callbacks[0]();
		assert.equal(preloads, 1);
		const cancel = m.preloadWhenIdle(preload);
		cancel();
		assert.deepEqual(cancelled, [2]);
		callbacks[1]();
		assert.equal(preloads, 1, "a cancelled idle callback does nothing");
	} finally {
		globalThis.requestIdleCallback = undefined;
		globalThis.cancelIdleCallback = undefined;
	}
});

test("preloadWhenIdle swallows a failed preload (no unhandled rejection)", async () => {
	let unhandled = 0;
	const onUnhandled = () => {
		unhandled += 1;
	};
	process.on("unhandledRejection", onUnhandled);
	try {
		m.preloadWhenIdle(() => Promise.reject(new Error("offline")));
		await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(unhandled, 0);
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
});
