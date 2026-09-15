import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the app's log-directory override.
 *
 * Why these cases. A harness or QA run of this app must not leave marks on the
 * operator's machine, and the log directory was the one path it still did: the
 * default is the user's real home (Electron's `home` is the OS account's, which
 * neither a scratch `HOME` nor `--user-data-dir` redirects), so a run's lines —
 * measured, its dead backend port — landed in the operator's own
 * `~/Library/Application Support/Local Operator/logs/backend-service.log`. The
 * override is what `scripts/renderer-driver.mjs` sets, and it exists to be an
 * OVERRIDE: a launch that does not set it must resolve the path this app has
 * always resolved.
 *
 * The decision is asserted in process because `./log-dir` imports nothing from
 * Electron, exactly like `window-mode.ts` and `dev-driver.ts`. That the app
 * actually RESOLVES the override is measured on a real boot instead — the
 * harness reads the `Log path: …` line the app writes at logger init and fails
 * the run if it names anything but the scratch tree.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/log-dir";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { LOG_DIR_ENV, logDirOverride } = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

/** Capture one call's stdout warning without letting it into the test output. */
function captureWarn(body) {
	const original = console.warn;
	const lines = [];
	console.warn = (...args) => lines.push(args.join(" "));
	try {
		body();
	} finally {
		console.warn = original;
	}
	return lines;
}

test("a launch that did not ask for a log directory gets the app's own default", () => {
	for (const value of [undefined, "", "   "]) {
		assert.equal(
			logDirOverride(value),
			null,
			`${JSON.stringify(value)} must mean "use the default", not a directory`,
		);
	}
});

test("an absolute directory is honoured, trimmed", () => {
	assert.equal(logDirOverride("/tmp/lo-logs"), "/tmp/lo-logs");
	assert.equal(logDirOverride("  /tmp/lo-logs  "), "/tmp/lo-logs");
});

test("a relative directory is refused loudly rather than resolved somewhere odd", () => {
	const warnings = captureWarn(() => {
		for (const value of ["logs", "./logs", "~/logs"]) {
			assert.equal(logDirOverride(value), null, `${value} must not be used`);
		}
	});
	assert.equal(warnings.length, 3);
	assert.match(
		warnings[0],
		/LOCAL_OPERATOR_LOG_DIR=logs is not an absolute path/,
	);
	assert.match(warnings[0], /default log directory is used instead/);
});

test("the environment variable name is pinned, because a harness script sets it", () => {
	assert.equal(LOG_DIR_ENV, "LOCAL_OPERATOR_LOG_DIR");
});

test("the logger resolves the override, and still composes the old default", () => {
	/*
	 * The two halves this file cannot exercise by import (the module calls
	 * Electron's `app.getPath`), stated as source assertions rather than assumed:
	 * the constructor must prefer the override and fall back to the app's own
	 * default composer, and that composer must still have one branch per platform
	 * so a normal launch's log path is the path it has always been.
	 */
	const logger = readFileSync(
		join(process.cwd(), "src/main/backend/logger.ts"),
		"utf8",
	);
	assert.match(
		logger,
		/logDirOverride\(process\.env\[LOG_DIR_ENV\]\) \?\? Logger\.defaultLogPath\(\)/,
		"the logger no longer resolves the launch's log-directory override",
	);
	const def = logger.indexOf("private static defaultLogPath()");
	assert.notEqual(def, -1, "the logger no longer has a default log path");
	const body = logger.slice(def, logger.indexOf("private constructor", def));
	assert.match(body, /process\.platform === "win32"/);
	assert.match(body, /app\.getPath\("userData"\), "logs"/);
	assert.match(body, /process\.platform === "darwin"/);
	assert.match(body, /"Application Support",\s*"Local Operator",\s*"logs"/);
	assert.match(
		body,
		/app\.getPath\("home"\), "\.config", "local-operator", "logs"/,
	);
});
