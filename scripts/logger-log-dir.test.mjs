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
		/logDirOverride\(launchEnv\[LOG_DIR_ENV\]\) \?\? Logger\.defaultLogPath\(\)/,
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

/**
 * The override is read from the pre-dotenv launch snapshot, not from
 * `process.env`.
 *
 * WHY THIS IS A SOURCE ASSERTION, and what it protects. `logger.ts` resolves the
 * override while the `Logger` singleton is constructed, which happens during that
 * module's own evaluation — and `backend/config.ts` folds a cwd `.env` over the
 * launch in ITS body, which runs later. So reading `process.env` there behaved as
 * a launch fact by import order alone (review round 2 measured exactly that: a
 * `.env` naming its own log directory did not win, but only because of when the
 * singleton was built). A refactor to a lazy `getInstance()` would have handed a
 * file in the working directory the choice of where this app writes its logs —
 * the one path a harness run otherwise writes into the operator's own log files.
 * `launchEnv` is a copy taken before the fold, so the read cannot depend on
 * evaluation order at all.
 */
test("the override comes from the launch snapshot, not a mutable process.env", () => {
	const logger = readFileSync(
		join(process.cwd(), "src/main/backend/logger.ts"),
		"utf8",
	);
	assert.match(logger, /import \{ launchEnv \} from "\.\/launch-env";/);
	assert.doesNotMatch(
		logger,
		/logDirOverride\(process\.env\[/,
		"the log directory is decided from process.env again, which a cwd .env can rewrite",
	);

	const snapshot = readFileSync(
		join(process.cwd(), "src/main/backend/launch-env.ts"),
		"utf8",
	);
	assert.match(
		snapshot,
		/export const launchEnv: Record<string, string \| undefined> = \{\s*\.\.\.process\.env,\s*\};/,
		"the snapshot no longer copies process.env",
	);
	assert.doesNotMatch(
		snapshot,
		/^import /m,
		"the snapshot must stay a leaf module: an import here is how it stops being taken before the fold",
	);

	/*
	 * And the module that DOES fold a `.env` still imports the snapshot, which is
	 * what keeps the ordering: a dependency is evaluated before the module that
	 * imports it, so the copy is taken before the `dotenvConfig` call in
	 * `config.ts`'s body can rewrite `process.env`. Asserted as an ordering rather
	 * than as a line number, because the position of the statement stopped being
	 * the guarantee when the snapshot moved out of that file.
	 */
	const config = readFileSync(
		join(process.cwd(), "src/main/backend/config.ts"),
		"utf8",
	);
	const snapshotImport = config.indexOf('from "./launch-env"');
	const fold = config.indexOf("dotenvConfig({");
	assert.notEqual(
		snapshotImport,
		-1,
		"config.ts no longer imports the launch snapshot at all",
	);
	assert.notEqual(fold, -1, "config.ts no longer folds a .env");
	assert.ok(
		snapshotImport < fold,
		"the snapshot import must precede the dotenv call in config.ts",
	);
	assert.match(
		config,
		/export \{ launchEnv \};/,
		"config.ts no longer re-exports the snapshot the launch facts are resolved from",
	);
});
