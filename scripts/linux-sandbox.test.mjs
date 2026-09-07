import assert from "node:assert/strict";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
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
	isStartupFailure,
	STARTUP_WINDOW_MS,
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
	//
	// FORCE_POSTINSTALL is what makes this non-vacuous off Linux: without it the
	// script exits at the platform guard on darwin, so the assertion below held
	// while the entire repair body was mutated away (the reviewer's M14 survived
	// for exactly this reason). Forcing the branch means the body really runs --
	// against this repo's own node_modules, where ensureElectronDist finds no
	// electron installer and returns false, i.e. the "cannot repair" case named
	// in the title.
	const { spawnSync } = await import("node:child_process");
	const script = new URL("../bin/postinstall.js", import.meta.url).pathname;
	const result = spawnSync(process.execPath, [script], {
		encoding: "utf8",
		env: { ...process.env, LOCAL_OPERATOR_UI_FORCE_POSTINSTALL: "1" },
	});
	assert.equal(result.status, 0, result.stderr);
	// It must also stay silent on stderr: npm surfaces that as install noise.
	assert.equal(result.stderr, "");
});

test("the postinstall really reaches the repair path and reports it honestly", () => {
	// The strongest available assertion that the body RUNS, not merely that the
	// process exits 0. Build a package root shaped like a real install -- our
	// bin/ beside a node_modules/electron carrying install.js, dist/version and
	// dist/chrome-sandbox -- so ensureElectronDist takes its fast path and
	// repairSandboxHelper is actually called on a 0755 helper.
	//
	// Unprivileged, the chown must fail, so the script has to print the
	// "not running as root" line. That line is proof of arrival: it exists
	// nowhere else, and it cannot be produced by the platform guard.
	const { spawnSync } = require("node:child_process");
	const root = join(scratch, "fake-install");
	const dist = join(root, "node_modules", "electron", "dist");
	mkdirSync(dist, { recursive: true });
	mkdirSync(join(root, "bin"), { recursive: true });
	for (const f of ["postinstall.js", "linux-sandbox.js"]) {
		writeFileSync(
			join(root, "bin", f),
			readFileSync(new URL(`../bin/${f}`, import.meta.url), "utf8"),
		);
	}
	writeFileSync(join(root, "node_modules", "electron", "install.js"), "");
	writeFileSync(join(dist, "version"), "35.5.1\n");
	const helper = join(dist, "chrome-sandbox");
	writeFileSync(helper, "#!/bin/true\n");
	chmodSync(helper, 0o755);

	const result = spawnSync(
		process.execPath,
		[join(root, "bin", "postinstall.js")],
		{
			encoding: "utf8",
			env: { ...process.env, LOCAL_OPERATOR_UI_FORCE_POSTINSTALL: "1" },
		},
	);

	assert.equal(result.status, 0, result.stderr);
	if (process.getuid?.() === 0) {
		// As root the repair succeeds and the script is deliberately quiet.
		assert.equal(statSync(helper).mode & 0o7777, 0o4755);
		return;
	}
	assert.match(
		result.stdout,
		/not running as root/,
		"the repair path was never entered -- this test would be vacuous",
	);
	// And it must NOT claim a packaging defect, which is the root-only message.
	assert.doesNotMatch(result.stdout, /packaging defect/);
	// The helper is left exactly as found: we could not repair it.
	assert.equal(statSync(helper).mode & 0o7777, 0o755);
});

test("the postinstall refuses a symlinked helper instead of repairing through it", () => {
	// End-to-end companion to the unit-level symlink refusal: the shipped script,
	// as a subprocess, must decline and say so rather than exit quietly.
	const { spawnSync } = require("node:child_process");
	const root = join(scratch, "symlink-install");
	const dist = join(root, "node_modules", "electron", "dist");
	mkdirSync(dist, { recursive: true });
	mkdirSync(join(root, "bin"), { recursive: true });
	for (const f of ["postinstall.js", "linux-sandbox.js"]) {
		writeFileSync(
			join(root, "bin", f),
			readFileSync(new URL(`../bin/${f}`, import.meta.url), "utf8"),
		);
	}
	writeFileSync(join(root, "node_modules", "electron", "install.js"), "");
	writeFileSync(join(dist, "version"), "35.5.1\n");
	const victim = join(scratch, "symlink-install-victim");
	writeFileSync(victim, "not ours\n");
	chmodSync(victim, 0o600);
	symlinkSync(victim, join(dist, "chrome-sandbox"));

	const result = spawnSync(
		process.execPath,
		[join(root, "bin", "postinstall.js")],
		{
			encoding: "utf8",
			env: { ...process.env, LOCAL_OPERATOR_UI_FORCE_POSTINSTALL: "1" },
		},
	);

	assert.equal(result.status, 0, "the install must still succeed");
	assert.match(result.stdout, /refusing to modify/);
	assert.equal(
		statSync(victim).mode & 0o7777,
		0o600,
		"the symlink target must be untouched",
	);
});

test("the postinstall never throws the install even when the repair explodes", () => {
	// The try/catch in postinstall.js is the last line of defence for the
	// "MUST NEVER FAIL THE INSTALL" contract. Point the script at a package root
	// whose node_modules cannot be read and require exit 0 regardless.
	const { spawnSync } = require("node:child_process");
	const script = new URL("../bin/postinstall.js", import.meta.url).pathname;
	const result = spawnSync(process.execPath, [script], {
		encoding: "utf8",
		cwd: scratch,
		env: { ...process.env, LOCAL_OPERATOR_UI_FORCE_POSTINSTALL: "1" },
	});
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

// --------------------------------------------------------------------------
// Symlink safety. This is the highest-value assertion in the file: the repair
// runs as ROOT during `sudo npm install -g`, so a path-based chown/chmod on a
// symlinked helper applies root:root 4755 to the link's TARGET -- a root setuid
// primitive a crafted dependency can aim at, say, /usr/bin/env.
//
// The demonstration needs no privilege: chmod on a file we already own proves
// the primitive, and asserting the victim is UNTOUCHED proves the fix. Against
// the pre-fix code these fail (measured: victim 0600 -> 0755, and inspect
// reported the target's mode straight through the link).
// --------------------------------------------------------------------------

const symlinkedHelper = (name, victimMode) => {
	const victim = join(scratch, `${name}-victim`);
	writeFileSync(victim, "not ours to modify\n");
	chmodSync(victim, victimMode);
	const link = join(scratch, `${name}-link`);
	symlinkSync(victim, link);
	return { victim, link, modeOf: () => statSync(victim).mode & 0o7777 };
};

test("repair refuses a symlinked helper and leaves the target untouched", () => {
	const { victim, link, modeOf } = symlinkedHelper("repair", 0o600);
	assert.equal(modeOf(), 0o600, "precondition");

	// Simulate the privilege the real bug needs. The exposure only materialises
	// as root (`sudo npm install -g`), but an unprivileged chown(0,0) throws
	// before chmod ever runs -- so without this stub the run below would leave
	// the victim untouched for the WRONG reason (lack of privilege) and the mode
	// assertion could not fail on vulnerable code. Neutering only chown lets the
	// chmod proceed exactly as it would as root, which is what puts the setuid
	// bit on the link's target.
	const fsModule = require("node:fs");
	const originalChown = fsModule.chownSync;
	fsModule.chownSync = () => {};
	let result;
	try {
		result = repairSandboxHelper(link);
	} finally {
		fsModule.chownSync = originalChown;
	}

	// THE assertion. Against the pre-fix path-based repair this reads 0755:
	// root:root 4755 applied through the link to a file outside the install tree.
	assert.equal(
		modeOf(),
		0o600,
		"the symlink target outside the install tree was modified",
	);
	assert.equal(
		result.outcome,
		"unsafe",
		"a symlink must be refused as unsafe, distinctly from absent",
	);
	assert.equal(lstatSync(link).isSymbolicLink(), true, "link left in place");
	assert.equal(readFileSync(victim, "utf8"), "not ours to modify\n");
});

test("inspect reports a symlinked helper as unsafe, not as a repairable file", () => {
	// Pre-fix this returned the TARGET's uid/mode with needsRepair true, so the
	// launcher would print chown/chmod guidance aimed at someone else's file.
	const { link } = symlinkedHelper("inspect", 0o600);
	const state = inspectSandboxHelper(link);

	assert.equal(state.unsafe, true);
	assert.equal(
		state.needsRepair,
		false,
		"we must never offer to repair through a link",
	);
	assert.equal(state.mode, undefined, "no mode is read from the target");
});

test("a non-regular file in the helper's place is refused", () => {
	// A directory (or fifo/device) is not something to chmod 4755.
	const dir = join(scratch, "helper-is-a-dir");
	mkdirSync(dir);
	assert.equal(repairSandboxHelper(dir).outcome, "unsafe");
	assert.equal(inspectSandboxHelper(dir).needsRepair, false);
});

// --------------------------------------------------------------------------
// chown-before-chmod ordering. Previously excused as "needs root"; it does not.
// The shipped module calls through the shared `fs` module object, so spying on
// it observes the real call order unprivileged. The inversion is the exact
// mutation that silently produces 0755 instead of 4755.
// --------------------------------------------------------------------------

test("repair chowns BEFORE it chmods, because chown clears the setuid bit", () => {
	const fsModule = require("node:fs");
	const calls = [];
	const original = {
		fchownSync: fsModule.fchownSync,
		fchmodSync: fsModule.fchmodSync,
		fstatSync: fsModule.fstatSync,
	};
	fsModule.fchownSync = (_fd, uid, gid) => {
		calls.push({ op: "chown", uid, gid });
	};
	fsModule.fchmodSync = (_fd, mode) => {
		calls.push({ op: "chmod", mode });
	};
	// Report the post-repair state as healthy so the outcome path is exercised;
	// the ordering, not the outcome, is what this test is about.
	let statCount = 0;
	fsModule.fstatSync = (fd) => {
		statCount += 1;
		const real = original.fstatSync(fd);
		if (statCount === 1) {
			return real; // pre-state: an unprivileged 0755 file, needs repair
		}
		return Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
			uid: 0,
			mode: 0o100000 | 0o4755,
			isFile: () => true,
		});
	};
	try {
		const result = repairSandboxHelper(helperAt("ordering", 0o755));
		assert.equal(result.outcome, "repaired");
	} finally {
		Object.assign(fsModule, original);
	}

	assert.deepEqual(
		calls.map((c) => c.op),
		["chown", "chmod"],
		"chmod before chown silently yields 0755: chown clears the setuid bit",
	);
	assert.deepEqual(calls[0], { op: "chown", uid: 0, gid: 0 });
	assert.equal(calls[1].mode, 0o4755);
});

test("repair re-stats after the syscalls instead of trusting them", () => {
	// M10 in the reviewer's battery: nothing asserted that the post-repair
	// verification was real, so a mutant returning { isSetuidRoot: true }
	// survived. Make the syscalls succeed while leaving the file unchanged --
	// exactly what a chmod-then-chown inversion does -- and require that repair
	// notices and reports not-permitted rather than success.
	const fsModule = require("node:fs");
	const original = {
		fchownSync: fsModule.fchownSync,
		fchmodSync: fsModule.fchmodSync,
	};
	fsModule.fchownSync = () => {};
	fsModule.fchmodSync = () => {};
	try {
		const result = repairSandboxHelper(helperAt("lying-syscalls", 0o755));
		assert.equal(
			result.outcome,
			"not-permitted",
			"a repair that did not actually change the file must not report success",
		);
	} finally {
		Object.assign(fsModule, original);
	}
});

test("the chown-clears-setuid premise is real, not folklore", () => {
	// The whole ordering rule rests on this kernel behaviour. Demonstrable with
	// no privilege via a chown to our own uid/gid, which is always permitted.
	const p = helperAt("setuid-premise", 0o755);
	const fsModule = require("node:fs");
	chmodSync(p, 0o4755);
	assert.equal(statSync(p).mode & 0o7777, 0o4755, "setuid set");
	fsModule.chownSync(p, process.getuid(), process.getgid());
	assert.equal(
		statSync(p).mode & 0o7777,
		0o755,
		"chown cleared the setuid bit -- which is why chown must come first",
	);
});

// --------------------------------------------------------------------------
// Startup-failure narrowing (the post-mortem must not fire on a normal quit).
// --------------------------------------------------------------------------

test("Ctrl+C is never diagnosed as a sandbox startup failure", () => {
	// The launcher forwards SIGINT to the child, so a normal quit arrives as
	// code null + SIGINT. Under the old `code !== 0` guard this printed
	// "your sandbox helper is misconfigured; sudo chmod 4755" to a user whose
	// app had been running fine -- on the 0755 userns install this design exists
	// to keep working, where the helper is permanently in the flagged state.
	assert.equal(
		isStartupFailure({ code: null, signal: "SIGINT", elapsedMs: 5 }),
		false,
	);
	assert.equal(
		isStartupFailure({ code: null, signal: "SIGTERM", elapsedMs: 5 }),
		false,
	);
});

test("an app that ran for a while is never diagnosed as a startup failure", () => {
	// A crash an hour in is not the sandbox helper: the app demonstrably started.
	assert.equal(
		isStartupFailure({
			code: 1,
			signal: null,
			elapsedMs: STARTUP_WINDOW_MS + 1,
		}),
		false,
	);
	assert.equal(
		isStartupFailure({ code: null, signal: "SIGSEGV", elapsedMs: 3_600_000 }),
		false,
	);
});

test("the Chromium sandbox FATAL still IS diagnosed", () => {
	// The case the guidance exists for: an immediate signal death at startup.
	// Measured shape -- code null, SIGTRAP, within milliseconds of spawn.
	assert.equal(
		isStartupFailure({ code: null, signal: "SIGTRAP", elapsedMs: 120 }),
		true,
	);
	// And a fast non-zero exit is still worth diagnosing.
	assert.equal(
		isStartupFailure({ code: 1, signal: null, elapsedMs: 80 }),
		true,
	);
	// A clean exit never is, however fast.
	assert.equal(
		isStartupFailure({ code: 0, signal: null, elapsedMs: 5 }),
		false,
	);
	// Neither code nor signal: nothing to go on, do not guess.
	assert.equal(
		isStartupFailure({ code: null, signal: null, elapsedMs: 5 }),
		false,
	);
});

test("guidance quotes a path containing an apostrophe so it can be pasted", () => {
	// Copy-paste guidance whose whole point is being pasteable must survive
	// /home/o'brien/.npm-global. A bare '...' would terminate the quoted run.
	const state = {
		path: "/home/o'brien/lib/chrome-sandbox",
		uid: 1000,
		gid: 1000,
		mode: 0o755,
	};
	const lines = sandboxHelperGuidance(state, "local-operator-ui").join("\n");
	assert.match(lines, /'\/home\/o'\\''brien\/lib\/chrome-sandbox'/);
});

test("ensureElectronDist reports false when there is no electron installer", () => {
	// M13 in the battery: the wrapper's contract was never asserted, so a mutant
	// returning true with no installer present survived -- and the postinstall
	// keys on this to decide whether there is anything to repair at all. A false
	// true sends it looking for a helper that was never downloaded.
	const { ensureElectronDist } = require("../bin/linux-sandbox.js");
	const empty = join(scratch, "no-electron");
	mkdirSync(join(empty, "node_modules"), { recursive: true });
	assert.equal(ensureElectronDist(empty), false);
});

test("ensureElectronDist's fast path requires electron's own install marker", () => {
	// A partially-extracted dist/ that happens to contain chrome-sandbox is not a
	// usable install: electron's isInstalled() keys on dist/version. Keying only
	// on the helper made us skip the installer that would have repaired it.
	const { ensureElectronDist } = require("../bin/linux-sandbox.js");
	const root = join(scratch, "partial-electron");
	const dist = join(root, "node_modules", "electron", "dist");
	mkdirSync(dist, { recursive: true });
	// install.js present but deliberately failing, so the ONLY way this returns
	// true is the fast path -- which must refuse without dist/version.
	writeFileSync(
		join(root, "node_modules", "electron", "install.js"),
		"process.exit(1);\n",
	);
	writeFileSync(join(dist, "chrome-sandbox"), "#!/bin/true\n");
	assert.equal(
		ensureElectronDist(root),
		false,
		"a dist/ without version is a broken install, not a healthy one",
	);

	writeFileSync(join(dist, "version"), "35.5.1\n");
	assert.equal(
		ensureElectronDist(root),
		true,
		"with both markers the fast path returns without running the installer",
	);
});

test("the postinstall stays silent on non-Linux platforms", () => {
	// M14: deleting the platform guard survived, because nothing asserted the
	// macOS/Windows contract -- silence, and no attempt to touch a helper that
	// does not exist there. Assert it WITHOUT the force flag, which is the only
	// way to observe the guard itself.
	const { spawnSync } = require("node:child_process");
	const script = new URL("../bin/postinstall.js", import.meta.url).pathname;
	const root = join(scratch, "guard-install");
	const dist = join(root, "node_modules", "electron", "dist");
	mkdirSync(dist, { recursive: true });
	mkdirSync(join(root, "bin"), { recursive: true });
	for (const f of ["postinstall.js", "linux-sandbox.js"]) {
		writeFileSync(
			join(root, "bin", f),
			readFileSync(new URL(`../bin/${f}`, import.meta.url), "utf8"),
		);
	}
	writeFileSync(join(root, "node_modules", "electron", "install.js"), "");
	writeFileSync(join(dist, "version"), "35.5.1\n");
	const helper = join(dist, "chrome-sandbox");
	writeFileSync(helper, "#!/bin/true\n");
	chmodSync(helper, 0o755);

	const result = spawnSync(
		process.execPath,
		[join(root, "bin", "postinstall.js")],
		{
			encoding: "utf8",
			env: { ...process.env, LOCAL_OPERATOR_UI_FORCE_POSTINSTALL: "0" },
		},
	);

	assert.equal(result.status, 0);
	if (process.platform === "linux") {
		return; // the guard is a no-op here by design; asserted above instead
	}
	assert.equal(
		result.stdout,
		"",
		"non-Linux must print nothing at all: there is no helper to repair",
	);
	assert.equal(statSync(helper).mode & 0o7777, 0o755, "and touch nothing");
	assert.equal(script.endsWith("postinstall.js"), true);
});
