import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { NOTIFICATIONS_ENV as TOOLING_ENV } from "./notifications-off.mjs";

/**
 * The app side of the notification kill switch: the environment entry the
 * backend this app spawns is handed, resolved from the LAUNCH.
 *
 * Why these cases. `scripts/notifications-off.mjs` guards the harness side — the
 * children a test run starts — and the app's own spawn of the backend is the
 * OTHER end of the same path: the app hands that child its own environment, and
 * by the time it does, a `.env` in the working directory (folded with dotenv
 * `override: true` in `backend/config.ts`) and the operator's shell rc (merged by
 * `loadMacOSEnvironment`) have both had a chance to replace the value the launch
 * was given. QA round 1 on #206 measured both surviving shapes through
 * `pnpm app:headless`: a `.env` carrying `0` reached the backend child as `0`,
 * and one carrying the key EMPTY reached it as `""` — which the consumer reads
 * with `os.environ.get()`, i.e. falsy, i.e. arms every banner again behind a
 * launch that reported success.
 *
 * The module is bundled in memory from the shipped TypeScript, the same way
 * `window-mode.test.mjs` does, so these stay tests of the code that ships rather
 * than of a copy of its rules.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/notification-launch";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { NOTIFICATIONS_ENV, resolveNotificationLaunch } = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

test("the env name is the backend's own kill switch, spelled once across both runtimes", () => {
	// The consumer is `local_operator/tui/notify.py::_ENV_DISABLE`. Both halves
	// of this repo's guard read that name, and neither compile-time nor runtime
	// would notice if the two halves drifted apart: the tooling would silence
	// nothing, or the app would set a variable nothing reads, and every test in
	// this repo would stay green either way. So the literal is asserted here, and
	// the tooling's own constant is asserted to match it.
	assert.equal(NOTIFICATIONS_ENV, "LOCAL_OPERATOR_NO_NOTIFICATIONS");
	assert.equal(
		TOOLING_ENV,
		NOTIFICATIONS_ENV,
		"scripts/notifications-off.mjs and src/main/backend/notification-launch.ts must spell the same variable",
	);
});

test("a launch that says nothing adds nothing", () => {
	// The shipped app on a user's own machine. `backendSpawnEnv` spreads the
	// result into the environment it returns, so an empty object is what keeps a
	// normal launch's environment byte-identical to what it was before this
	// change — and keeps the parked-gate banner, which is the feature there.
	assert.deepEqual(resolveNotificationLaunch({ HOME: "/tmp/scratch" }), {});
});

test("a launch value that is empty silences the backend", () => {
	// Not a considered choice, and the one shape that used to re-arm everything:
	// `""` is falsy at the consumer. Same rule the tooling helper applies to a
	// child environment, so the two ends agree about what "off" means.
	assert.deepEqual(resolveNotificationLaunch({ [NOTIFICATIONS_ENV]: "" }), {
		[NOTIFICATIONS_ENV]: "1",
	});
});

test("a value the launch stated is passed through verbatim", () => {
	// `notify.py` is presence-based: `0`, `1`, `no` and `false` all silence,
	// because it tests `os.environ.get(_ENV_DISABLE)` for truthiness. Normalising
	// the spellings here would be this app inventing a contract the consumer does
	// not have, and a value the operator typed must survive the app either way.
	for (const value of ["0", "1", "yes", "no", "0 "]) {
		assert.deepEqual(
			resolveNotificationLaunch({ [NOTIFICATIONS_ENV]: value }),
			{ [NOTIFICATIONS_ENV]: value },
			`launch value ${JSON.stringify(value)} must arrive unaltered`,
		);
	}
});

/** The source of the method that builds the backend child's environment. */
function backendSpawnEnv(source) {
	const start = source.indexOf("private backendSpawnEnv(");
	assert.notEqual(start, -1, "backendSpawnEnv() is gone; this pin reads it");
	// The body, by brace matching, so "the resolver is applied somewhere in
	// backend-service.ts" cannot stand in for "it is applied to THIS
	// environment": the file has other builders, and the one that matters is the
	// one every serve spawn calls.
	let depth = 0;
	let i = source.indexOf("{", start);
	const bodyStart = i;
	for (; i < source.length; i += 1) {
		if (source[i] === "{") depth += 1;
		else if (source[i] === "}" && (depth -= 1) === 0) break;
	}
	return source.slice(bodyStart, i + 1);
}

test("the backend spawn env resolves the switch from the launch, after the shell env", () => {
	/*
	 * The structural half of the fix, and the reason it is a source assertion:
	 * the defect is ORDER — the value has to be applied after the spread that
	 * carries the folded `.env` and the shell rc, and inside the one builder
	 * every serve spawn calls (`const env = this.backendSpawnEnv();`). A
	 * behavioural test here would have to stand an Electron app up to reach it,
	 * and the end-to-end measurement of that hop is in
	 * `docs/evidence/desktop-notifications-off/`; this is what makes the shape
	 * fail loudly if it is lost.
	 */
	const body = backendSpawnEnv(
		readFileSync(
			join(process.cwd(), "src/main/backend/backend-service.ts"),
			"utf8",
		),
	);
	const applied = body.indexOf("...resolveNotificationLaunch(launchEnv)");
	assert.notEqual(
		applied,
		-1,
		"backendSpawnEnv() must spread resolveNotificationLaunch(launchEnv) into the environment it returns",
	);
	const inherited = body.indexOf("withPythonBytecodeCache(this.shellEnv");
	assert.notEqual(inherited, -1, "the shell environment is still the base");
	assert.ok(
		applied > inherited,
		"the launch value must come AFTER the shell environment: applied before it, the `.env` fold and the shell rc would go on winning, which is the measured defect",
	);
	// The expression is asserted literally rather than by shape: `launchEnv` is the
	// snapshot taken before the fold, and `resolveNotificationLaunch(process.env)`
	// would read the value the fold just replaced - which is the defect itself,
	// wearing the fix's name.
	assert.match(
		body,
		/\.\.\.resolveNotificationLaunch\(launchEnv\)/,
		"and it must be given the launch snapshot rather than `process.env`",
	);
});
