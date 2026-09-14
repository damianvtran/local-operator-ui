/*
 * The launch-argument path, end to end within this process (R1-4).
 *
 * WHY THIS FILE EXISTS. B3's mechanism - main puts the click's session id into
 * the window's own argv, preload reads it before the first paint, and the store
 * refuses to let the persisted conversation win - was exercised by NOTHING.
 * `grep -rn "open-session\|readOpenSessionArgv\|initialSession" scripts/` found no
 * test, and both halves are pure functions over data a test can build: the argv
 * reader, and the merge rule that keeps a launch id from being overwritten
 * during hydration. A silent regression in either shows the user the wrong
 * conversation in a window that was created to show a specific one, which is
 * the flash this change exists to remove.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const reactStandIn = `const R = () => globalThis.__reactRuntime;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = () => {};
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = () => {};
export const createElement = () => ({});
export const Fragment = Symbol("fragment");
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment };`;

const bundle = await build({
	stdin: {
		contents: `
			export { OPEN_SESSION_FLAG, readOpenSessionArgv } from "./src/shared/open-session";
			export { mergePersistedSession, useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			name: "launch-session-fixture",
			setup(builder) {
				builder.onResolve({ filter: /local-operator\/desktop-api$/ }, () => ({
					path: "transport",
					namespace: "launch-fixture",
				}));
				builder.onLoad({ filter: /.*/, namespace: "launch-fixture" }, () => ({
					// The same stand-in `reconnect-page-gap.test.mjs` uses, and
					// deliberately the whole surface rather than the three names this
					// file's entry point happens to need: the store's import graph
					// reaches the desktop transport through the session hook, and a
					// trimmed fixture fails at BUILD time the moment that graph grows
					// - a maintenance trap rather than a narrower test.
					contents: `
						export class DesktopControlError extends Error {}
						export class UserFacingError extends Error {}
						export const userFacingMessage = (error) => String(error?.message ?? error);
						export const desktopResult = (request) => globalThis.__launchRequest(request);
						export const subscribeDesktopStream = (args, onEvent) => globalThis.__launchSubscribe(args, onEvent);`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
				builder.onResolve({ filter: /^react$/ }, () => ({
					path: "react",
					namespace: "launch-react",
				}));
				builder.onLoad({ filter: /.*/, namespace: "launch-react" }, () => ({
					contents: reactStandIn,
					loader: "js",
				}));
			},
		},
	],
});
const module_ = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { OPEN_SESSION_FLAG, readOpenSessionArgv, mergePersistedSession, useCanonicalSessionsStore } =
	module_;

/** The id shape the whole path validates on: 12 lowercase hex characters. */
const SESSION = "a1b2c3d4e5f6";
const OTHER = "0f0e0d0c0b0a";

function withLaunchArgument(value, run) {
	const previous = globalThis.window;
	globalThis.window = { api: { desktop: { initialSession: value } } };
	try {
		return run();
	} finally {
		globalThis.window = previous;
	}
}

test("readOpenSessionArgv accepts both spellings, last wins, and validates the id", () => {
	// Both spellings are real: `--open-session <id>` is what the launcher writes
	// and `--open-session=<id>` is what a hand-typed command line produces, and
	// Electron's `second-instance` hands over whichever the shell received.
	assert.equal(
		readOpenSessionArgv([OPEN_SESSION_FLAG, SESSION]),
		SESSION,
		"the space-separated spelling",
	);
	assert.equal(
		readOpenSessionArgv([`${OPEN_SESSION_FLAG}=${SESSION}`]),
		SESSION,
		"the equals spelling",
	);
	// LAST wins: a second launch that names another conversation is the newer
	// request, and taking the first would reopen the stale one.
	assert.equal(
		readOpenSessionArgv([
			OPEN_SESSION_FLAG,
			OTHER,
			`${OPEN_SESSION_FLAG}=${SESSION}`,
		]),
		SESSION,
		"the last occurrence wins",
	);
	// The id shape is validated at BOTH ends of the path, so a malformed one
	// cannot reach `setActiveSession` or a navigation.
	for (const bad of [
		[OPEN_SESSION_FLAG, "not-a-session"],
		[OPEN_SESSION_FLAG, "A1B2C3D4E5F6"],
		[OPEN_SESSION_FLAG, "a1b2c3d4e5f"],
		[OPEN_SESSION_FLAG, "a1b2c3d4e5f6a"],
		[`${OPEN_SESSION_FLAG}=`],
	]) {
		assert.equal(readOpenSessionArgv(bad), null, JSON.stringify(bad));
	}
	// A trailing flag with no value is the argv a shell produces when the id is
	// lost, and it must read as "no launch conversation" rather than as the flag.
	assert.equal(readOpenSessionArgv([OPEN_SESSION_FLAG]), null);
	assert.equal(
		readOpenSessionArgv(["electron", ".", OPEN_SESSION_FLAG]),
		null,
		"a trailing flag with no value",
	);
	assert.equal(readOpenSessionArgv(["--other", SESSION]), null);
});

test("the launch argument outranks the persisted conversation in the merge", () => {
	// The half that makes the id true of the FIRST render: `persist` hydrates
	// after the store is created, and a merge that let the persisted value
	// through would put the wrong conversation back for exactly as long as the
	// renderer takes to correct itself - the flash B3 removes.
	const current = { ...useCanonicalSessionsStore.getState(), activeSessionId: null };
	const persisted = { activeSessionId: OTHER };
	assert.equal(
		withLaunchArgument(SESSION, () =>
			mergePersistedSession(persisted, { ...current, activeSessionId: null })
				.activeSessionId,
		),
		SESSION,
		"the launch id wins over the persisted one",
	);
	// With no launch argument the persisted conversation is the user's own last
	// position and stays untouched.
	assert.equal(
		withLaunchArgument(null, () =>
			mergePersistedSession(persisted, current).activeSessionId,
		),
		OTHER,
	);
	// Everything else hydration restores still comes from storage: the override
	// is one field, not a merge that discards the persisted state.
	const restored = withLaunchArgument(SESSION, () =>
		mergePersistedSession({ activeSessionId: OTHER, cwd: "/tmp/from-storage" }, {
			...current,
			cwd: "~",
		}),
	);
	assert.equal(restored.cwd, "/tmp/from-storage");
	assert.equal(restored.activeSessionId, SESSION);
});

test("a windowless import reads as no launch argument rather than throwing", () => {
	// The store is imported in contexts with no `window` (this harness, and any
	// node tooling that walks the renderer tree). `launchSession()` reads through
	// a guard for exactly that reason, and the honest answer there is "no launch
	// argument" - not an exception that would take the module down at import.
	assert.equal(globalThis.window, undefined);
	assert.equal(useCanonicalSessionsStore.getState().activeSessionId, null);
});
