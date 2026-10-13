import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * The app's side of the agent-shell marker: the environment entry the backend
 * this app spawns is handed.
 *
 * Why these cases. Three names travel in the environment of anything started
 * from an agent's `bash` tool, and core stamps a session an agent's shell opened
 * as `agent-shell`, which every listing filters out of the operator's own
 * surfaces. The desktop app is long-lived and outlives the session that launched
 * it: it seeds `shellEnv` from `{ ...process.env }` and spawns its backend with
 * a copy of it, so an app started from an agent's shell passed the markers into
 * the `lop serve` backend, and every session THAT backend minted — the
 * operator's New Chat included — was stamped `agent-shell` and hidden from the
 * sidebar, the phone list and the picker (operator, 2026-10-13).
 *
 * Core closes the leak at its SERVE entry point; this is the app's own
 * responsibility one level above it, and it also covers spawns core's strip does
 * not reach. The helper is bundled in memory from the shipped TypeScript, the
 * same way `notification-launch.test.mjs` does, and `backendSpawnEnv` is checked
 * as a STRUCTURE so a future spawn env cannot be built without passing through
 * it.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/agent-shell-spawn-env";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	AGENT_SHELL_ENV,
	MAY_DELEGATE_ENV,
	ALLOW_NESTED_SESSION_ENV,
	AGENT_SHELL_MARKERS,
	withoutAgentShellMarker,
} = await import(
	`data:text/javascript;base64,${Buffer.from(
		bundle.outputFiles[0].text,
	).toString("base64")}`
);

test("the three names are the ones core reads, spelled once across both runtimes", () => {
	// The consumer is `local_operator/agent_shell.py`'s `AGENT_SHELL_ENV`,
	// `MAY_DELEGATE_ENV` and `ALLOW_NESTED_SESSION_ENV`. The two runtimes cannot
	// import each other, so neither compile-time nor runtime would notice a
	// drift: the app would strip names nothing reads or miss the one that hides
	// the operator's chats. The literals are asserted here, so a rename on either
	// side that is not mirrored fails this test.
	assert.equal(AGENT_SHELL_ENV, "LOCAL_OPERATOR_AGENT_SHELL");
	assert.equal(MAY_DELEGATE_ENV, "LOCAL_OPERATOR_AGENT_MAY_DELEGATE");
	assert.equal(ALLOW_NESTED_SESSION_ENV, "LOCAL_OPERATOR_ALLOW_NESTED_SESSION");
	assert.deepEqual(
		[...AGENT_SHELL_MARKERS],
		[AGENT_SHELL_ENV, MAY_DELEGATE_ENV, ALLOW_NESTED_SESSION_ENV],
	);
});

test("core's own module spells the same three names, when the sibling checkout is here", () => {
	// A cross-repo agreement check, run only when `~/local-operator` sits beside
	// this checkout (the development machine). CI has no sibling, so the literal
	// assertion above stays the portable half; this one catches a drift on the
	// machine where the two are edited together.
	const candidate = `${process.env.HOME ?? ""}/local-operator/local_operator/agent_shell.py`;
	if (!existsSync(candidate)) return;
	const core = readFileSync(candidate, "utf8");
	for (const name of AGENT_SHELL_MARKERS) {
		assert.ok(
			core.includes(`"${name}"`),
			`core's agent_shell.py must spell ${name}; the app strips exactly the names core reads`,
		);
	}
});

test("a marked environment is stripped of all three names", () => {
	const stripped = withoutAgentShellMarker({
		[AGENT_SHELL_ENV]: "1",
		[MAY_DELEGATE_ENV]: "1",
		[ALLOW_NESTED_SESSION_ENV]: "1",
		PATH: "/usr/bin",
	});
	assert.ok(!(AGENT_SHELL_ENV in stripped), "the shell marker is gone");
	assert.ok(
		!(MAY_DELEGATE_ENV in stripped),
		"the delegation allowance is gone",
	);
	assert.ok(
		!(ALLOW_NESTED_SESSION_ENV in stripped),
		"the escape hatch is gone: a daemon must not inherit a harness's waiver",
	);
	// Unrelated variables pass through: this drops three names and nothing else.
	// A copy that also dropped PATH would break every spawn the backend makes in
	// a way no "marker absent" assertion would notice.
	assert.equal(stripped.PATH, "/usr/bin");
});

test("the removal is by absence, not by an undefined value", () => {
	// A key present with an `undefined` value and a key absent read the same to
	// Node's spawn, but the difference is visible to anything that logs the
	// object — and `backendSpawnEnv`'s callers do. The names must be GONE.
	const stripped = withoutAgentShellMarker({ [AGENT_SHELL_ENV]: "1" });
	assert.ok(!Object.hasOwn(stripped, AGENT_SHELL_ENV));
});

test("an ordinary environment is returned unchanged, and the input is not mutated", () => {
	const original = { PATH: "/usr/bin", HOME: "/Users/operator" };
	const stripped = withoutAgentShellMarker(original);
	assert.deepEqual(stripped, original);
	// A copy, never in place: `shellEnv` is shared state other callers read (the
	// python probes, the identity checks), and mutating it would delete the
	// markers for every path that did NOT ask for that.
	assert.notEqual(stripped, original);
	assert.deepEqual(original, { PATH: "/usr/bin", HOME: "/Users/operator" });
});

test("backendSpawnEnv passes every spawn environment through the strip", () => {
	// The WIRING, not the helper: a helper nobody calls is the leak. The strip is
	// applied where the environment is handed to the spawn — structurally, like
	// `withPythonBytecodeCache` and `resolveNotificationLaunch` — so no spawn
	// path and no fold order can miss it. This reads the shipped source and
	// requires `withoutAgentShellMarker` to be the call `backendSpawnEnv` returns,
	// and that the notification fold still happens inside it.
	const source = readFileSync("src/main/backend/backend-service.ts", "utf8");
	const start = source.indexOf("private backendSpawnEnv(");
	assert.ok(start > 0, "backendSpawnEnv must exist");
	// A bounded window rather than brace matching: the method is short and the
	// two calls below are what it is for.
	const window = source.slice(start, start + 1600);
	assert.match(
		window,
		/return withoutAgentShellMarker\(\{/,
		"backendSpawnEnv must return the strip's result, not a raw object",
	);
	assert.match(
		window,
		/\.\.\.resolveNotificationLaunch\(launchEnv\)/,
		"the notification fold is still applied inside the strip (regression guard)",
	);
	assert.match(
		source,
		/import \{ withoutAgentShellMarker \} from "\.\/agent-shell-spawn-env"/,
		"the helper is imported from its module, not re-inlined",
	);
});
