import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

// bin/ is CommonJS (it is the published launcher, loaded by `npx` through a
// plain `require`), so exercise it through createRequire rather than converting
// it or re-implementing it here. Testing the shipped module is the point: the
// launcher's behaviour on Linux is what issue #91 is about.
const require = createRequire(import.meta.url);
const {
	isHelperHealthy,
	resolveSandboxHelper,
	inspectSandboxHelper,
	repairSandboxHelper,
	rootGuidance,
	sandboxHelperGuidance,
	exitCodeFor,
} = require("../bin/linux-sandbox.js");

const scratch = mkdtempSync(join(tmpdir(), "lo-sandbox-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const helperAt = (name, mode) => {
	const p = join(scratch, name);
	writeFileSync(p, "#!/bin/true\n");
	chmodSync(p, mode);
	return p;
};

test("the helper is resolved beside the electron binary", () => {
	assert.equal(
		resolveSandboxHelper("/opt/app/node_modules/electron/dist/electron"),
		"/opt/app/node_modules/electron/dist/chrome-sandbox",
	);
});

test("an unresolvable electron path yields no helper rather than throwing", () => {
	// require("electron") can return undefined on a skipped optional install; a
	// diagnostic must not be the reason the launcher crashes.
	assert.equal(resolveSandboxHelper(undefined), null);
	assert.equal(resolveSandboxHelper(""), null);
});

test("a missing helper is not reported as needing repair", () => {
	// macOS and Windows have no chrome-sandbox at all. Reporting that as broken
	// would fire the Linux guidance on platforms the bug cannot affect.
	const state = inspectSandboxHelper(join(scratch, "does-not-exist"));
	assert.equal(state.exists, false);
	assert.equal(state.needsRepair, false);
});

test("a 0755 helper is reported as needing repair", () => {
	// This is exactly the state npm leaves behind: mode 0755, no setuid bit.
	const state = inspectSandboxHelper(helperAt("plain-0755", 0o755));
	assert.equal(state.exists, true);
	assert.equal(state.needsRepair, true);
	assert.equal(state.mode, 0o755);
});

test("the health rule requires BOTH root ownership and the setuid bit", () => {
	// Assert the SHIPPED predicate, not a copy of it. An earlier version of this
	// test re-implemented the rule locally and therefore passed unchanged when the
	// real one was mutated to ignore the setuid bit -- a test that could not fail
	// for the bug it existed to catch.
	//
	// Ownership cannot be forged without privilege, so the root-owned cases are
	// only reachable as a pure function; the file-backed paths are covered above
	// and end to end in Docker.
	assert.equal(isHelperHealthy(0, 0o4755), true);
	assert.equal(
		isHelperHealthy(0, 0o0755),
		false,
		"root-owned without the setuid bit is exactly what npm leaves behind",
	);
	assert.equal(
		isHelperHealthy(1000, 0o4755),
		false,
		"the setuid bit confers nothing on a file owned by a normal user",
	);
});

test("repair on an absent helper is a no-op, not an error", () => {
	// The postinstall must succeed on macOS and on an install with no Electron.
	assert.equal(repairSandboxHelper(join(scratch, "nope")).outcome, "absent");
	assert.equal(repairSandboxHelper(null).outcome, "absent");
});

test("repair reports not-permitted instead of throwing when it lacks privilege", () => {
	// The unprivileged `npm install -g` case. A throw here would fail the whole
	// install, which is worse than the bug: the user would get no package at all.
	if (process.getuid?.() === 0) {
		return; // meaningless as root; the privileged path is covered in Docker
	}
	const result = repairSandboxHelper(helperAt("cannot-chown", 0o755));
	assert.equal(result.outcome, "not-permitted");
});

test("root guidance names the real cause and never enables the opt-out for the user", () => {
	const lines = rootGuidance("local-operator-ui").join("\n");
	assert.match(lines, /cannot start as root/);
	// Must NOT claim a chmod fixes it: measured, root aborts with a correct 4755
	// helper too, and sending the user to chmod would waste their time.
	assert.doesNotMatch(lines, /chmod 4755/);
	assert.match(lines, /run the app as your normal desktop user/i);
	// The opt-out is offered as the user's choice with its consequence stated.
	assert.match(lines, /ELECTRON_DISABLE_SANDBOX=1 local-operator-ui/);
	assert.match(lines, /removes a significant security boundary/);
});

test("helper guidance prints the exact commands with the real resolved path", () => {
	// The complaint in #91 is that Chromium names the file but not the commands.
	const state = inspectSandboxHelper(helperAt("guidance-0755", 0o755));
	const lines = sandboxHelperGuidance(state, "local-operator-ui").join("\n");
	assert.match(lines, new RegExp(`sudo chown root:root '${state.path}'`));
	assert.match(lines, new RegExp(`sudo chmod 4755 '${state.path}'`));
	assert.match(lines, /currently\s+\d+:\d+ 0755/);
	assert.match(lines, /required\s+0:0 4755/);
});

test("no guidance ever tells the user to run with --no-sandbox", () => {
	// The standing decision in #91: we do not disable the Chromium sandbox by
	// default for anyone. The root guidance legitimately QUOTES Chromium's own
	// "Running as root without --no-sandbox is not supported" text, so the rule
	// under test is that the flag never appears as something to run, not that the
	// string never appears at all.
	const state = inspectSandboxHelper(helperAt("no-sandbox-check", 0o755));
	for (const text of [
		rootGuidance("local-operator-ui").join("\n"),
		sandboxHelperGuidance(state, "local-operator-ui").join("\n"),
	]) {
		assert.doesNotMatch(text, /local-operator-ui\s+--no-sandbox/);
		assert.doesNotMatch(text, /^\s*(sudo )?\S*--no-sandbox/m);
	}
	const launcher = require("node:fs").readFileSync(
		new URL("../bin/local-operator-ui.js", import.meta.url),
		"utf8",
	);
	// The launcher must not put the flag in the spawn argv, nor set the opt-out
	// env var itself. It may only READ the variable to honour a user's choice.
	assert.doesNotMatch(launcher, /"--no-sandbox"/);
	assert.doesNotMatch(launcher, /ELECTRON_DISABLE_SANDBOX\s*[=:]\s*"?1/);
});

test("a signal death exits non-zero instead of reporting success", () => {
	// A Chromium FATAL kills by signal, so close() reports code null. The old
	// wrapper called process.exit(null), which Node coerces to 0: an app that
	// aborted on startup told the shell and CI it had succeeded.
	assert.equal(exitCodeFor(null, "SIGTRAP"), 128 + 5);
	assert.equal(exitCodeFor(null, "SIGSEGV"), 128 + 11);
	assert.notEqual(exitCodeFor(null, "SIGTRAP"), 0);
	// A real exit code still passes through unchanged, including a clean 0.
	assert.equal(exitCodeFor(0, null), 0);
	assert.equal(exitCodeFor(3, null), 3);
	// Neither code nor signal is not a success either.
	assert.equal(exitCodeFor(null, null), 1);
});

test("the postinstall exits 0 even when it cannot repair the helper", async () => {
	// Contract: a postinstall that fails the install is worse than the bug. Run
	// the real script as a subprocess, which is the only way to assert the exit
	// code the npm lifecycle actually sees.
	const { spawnSync } = await import("node:child_process");
	const script = new URL("../bin/postinstall.js", import.meta.url).pathname;
	const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
});

test("the helper mode constant matches what Chromium demands", () => {
	// Chromium's FATAL text asks for "owned by root and has mode 4755"; a drifted
	// constant here would produce a silent non-fix.
	const { REQUIRED_MODE } = require("../bin/linux-sandbox.js");
	assert.equal(REQUIRED_MODE, 0o4755);
});

test("statting a path that cannot be read degrades quietly", () => {
	// Diagnostics must never throw into the launcher's startup path.
	assert.doesNotThrow(() => inspectSandboxHelper("/proc/1/root/nope"));
	assert.equal(statSync(scratch).isDirectory(), true);
});
