import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the interpreter environment the app spawns python with.
 *
 * Why these cases: the app bundles a standalone CPython as an `extraResource`,
 * so the stdlib the backend venv runs on lives inside the code-sealed `.app`.
 * CPython writes `__pycache__/*.pyc` beside the sources it imports, and every
 * one of those writes breaks the signature ShipIt validates before an in-place
 * update - measured on the operator's installed 0.17.3: 308 `file added:` and 3
 * `file modified:` violations, all of them `.pyc`. `PYTHONPYCACHEPREFIX` is what
 * redirects those writes, and this is the test that it is actually set, that it
 * is never set to somewhere inside the bundle, and that nothing else in the
 * spawn environment is disturbed by setting it.
 *
 * Bundled from the shipped TypeScript in memory, the same way the update and
 * renderer contract tests do, so this is a test of the code that ships.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/python-bytecode-cache";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const cache = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);
const {
	PYTHON_BYTECODE_CACHE_DIR_NAME,
	pythonBytecodeCacheDir,
	withPythonBytecodeCache,
} = cache;

/** The userData directory a packaged macOS run would hand in. */
const USER_DATA =
	"/Users/someone/Library/Application Support/local-operator-ui";

test("the cache directory is a child of userData, never of the bundle", () => {
	const dir = pythonBytecodeCacheDir(USER_DATA);
	assert.equal(dir, `${USER_DATA}/${PYTHON_BYTECODE_CACHE_DIR_NAME}`);

	// The property that matters, stated as a test rather than as a convention:
	// userData is outside the `.app` on every platform, which is why the cache
	// lives there rather than in the OS temp directory the app also owns.
	assert.ok(!dir.includes(".app"), `${dir} is not inside a bundle`);
});

test("the prefix is set when the environment has none", () => {
	const env = withPythonBytecodeCache({ PATH: "/usr/bin" }, USER_DATA);
	assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
});

test("every other variable survives, and the input is not mutated", () => {
	const original = {
		PATH: "/opt/homebrew/bin:/usr/bin",
		HOME: "/Users/someone",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "token",
		PYTHONHASHSEED: "0",
	};
	const env = withPythonBytecodeCache(original, USER_DATA);
	assert.deepEqual(
		{ ...env, PYTHONPYCACHEPREFIX: undefined },
		{ ...original, PYTHONPYCACHEPREFIX: undefined },
	);
	assert.notEqual(env, original);
	assert.deepEqual(original, {
		PATH: "/opt/homebrew/bin:/usr/bin",
		HOME: "/Users/someone",
		LOCAL_OPERATOR_DESKTOP_TOKEN: "token",
		PYTHONHASHSEED: "0",
	});
});

test("an undefined value in the environment is passed through, not dropped", () => {
	// `process.env` on Windows carries `=C:` style keys with undefined values, and
	// dropping one on the way into a spawn environment is a behaviour change in
	// the backend's PATH handling rather than a tidy-up.
	const env = withPythonBytecodeCache(
		{ PATH: "/usr/bin", OMITTED: undefined },
		USER_DATA,
	);
	assert.ok("OMITTED" in env);
	assert.equal(env.OMITTED, undefined);
});

test("a prefix the operator set outside a bundle is respected", () => {
	// They already solved this problem for themselves. Rewriting their value
	// would move their bytecode somewhere they did not ask for.
	const env = withPythonBytecodeCache(
		{ PYTHONPYCACHEPREFIX: "/Users/someone/pycache" },
		USER_DATA,
	);
	assert.equal(env.PYTHONPYCACHEPREFIX, "/Users/someone/pycache");
});

test("a prefix pointing inside a .app bundle is replaced", () => {
	// Reachable in practice, not hypothetical: the backend service sources the
	// operator's shell rc files, so one `export` there would otherwise be
	// inherited by every python the app spawns - and this is the value that
	// reproduces the bug the module exists to prevent.
	const inBundle = [
		"/Applications/Local Operator.app/Contents/Resources/python_aarch64/pycache",
		"/private/var/folders/x/T/Some.app/Contents/Resources/pycache",
	];
	for (const value of inBundle) {
		const env = withPythonBytecodeCache(
			{ PYTHONPYCACHEPREFIX: value },
			USER_DATA,
		);
		assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
	}

	// A directory merely named `.app`-ish is not a bundle, so it stays: the test
	// is on whole path segments, and a substring test would rewrite a path the
	// operator deliberately chose.
	const notABundle = withPythonBytecodeCache(
		{ PYTHONPYCACHEPREFIX: "/Users/someone/appcache" },
		USER_DATA,
	);
	assert.equal(notABundle.PYTHONPYCACHEPREFIX, "/Users/someone/appcache");
});

test("an empty or whitespace-only prefix is treated as unset", () => {
	// Measured, not assumed: a copy of the shipped 0.17.0 interpreter tree goes
	// from 3 `.pyc` to 20 with `PYTHONPYCACHEPREFIX=` and to 23 with
	// `PYTHONPYCACHEPREFIX=" "` - both write into the bundle, which an empty
	// value makes CPython fall back to. Preserving either would leave the bug in
	// place while looking like the operator's own setting.
	for (const value of ["", "  "]) {
		const env = withPythonBytecodeCache(
			{ PYTHONPYCACHEPREFIX: value },
			USER_DATA,
		);
		assert.equal(env.PYTHONPYCACHEPREFIX, pythonBytecodeCacheDir(USER_DATA));
	}
});
