#!/usr/bin/env node

/**
 * Local Operator UI CLI
 *
 * This script serves as the entry point for the npx command.
 * It launches the Electron app.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

// Electron is an optionalDependency pinned to an exact version, not a plain
// dependency: electron-builder refuses to package a project that lists electron
// under "dependencies", but the npm/npx launcher below still needs a runtime at
// require time. "optional" keeps electron-builder happy while npm/bun/pnpm still
// install it for the CLI. The cost of "optional" is that a failed install is
// silent, so resolve it defensively and say what to do. See issue #88.
let electronPath;
try {
	electronPath = require("electron");
} catch (err) {
	console.error("Error: Could not resolve the Electron runtime.");
	console.error(
		"Electron is an optional dependency and its binary download may have been",
	);
	console.error(
		"skipped or blocked. Reinstall with optional dependencies enabled, e.g.",
	);
	console.error("  npm install -g local-operator-ui --include=optional");
	console.error(`Underlying error: ${err.message}`);
	process.exit(1);
}

// The try/catch above only catches "nothing resolvable at all", and that is not
// how issue #88 actually failed. There, `require("electron")` succeeded and
// returned an AMBIENT Electron 44.2.0 from higher up the directory tree, because
// our own optional install had not produced one. Resolution throws nothing in
// that case, so the guard above never fires and the app runs on a runtime we
// never tested. Assert the version, not just the presence.
//
// Compare on MAJOR only. Electron's ABI, V8, Chromium and Node all move on the
// major boundary, which is the axis that broke #88 (35 vs 44); a patch or minor
// difference is the normal result of a hoisted or deduped tree and warning about
// it would print noise on a working install.
//
// WARN, never exit. Since #88 the npm channel ships plain JS rather than V8
// bytecode, so a mismatched major usually still runs. Making this fatal would
// convert a degraded-but-working install into no app at all, which is a worse
// outcome than the one being guarded against. The user gets the diagnosis and
// the app still starts. CI does not get this latitude: scripts/npx-smoke-test.mjs
// asserts the EXACT pinned version and fails, because there we control the
// install and an unintended runtime means the artifact was never really tested.
//
// Both versions are read defensively inside the try for the same reason: this
// is a diagnostic, and a diagnostic must never be why the app fails to start.
// Missing or malformed metadata degrades to "cannot verify". An earlier revision
// read the pin at module scope and crashed the launcher outright on a
// package.json with no optionalDependencies.
try {
	const pinned = require("../package.json").optionalDependencies?.electron;
	const resolved = require("electron/package.json").version;
	if (!pinned || !resolved) {
		throw new Error("no version to compare");
	}
	if (resolved.split(".")[0] !== pinned.split(".")[0]) {
		console.warn(
			`Warning: local-operator-ui pins Electron ${pinned} but resolved ${resolved}.`,
		);
		console.warn(
			"This usually means the optional Electron install was skipped and another",
		);
		console.warn(
			"Electron was picked up from the surrounding environment. The app will try",
		);
		console.warn("to start anyway. If it misbehaves, reinstall with:");
		console.warn("  npm install -g local-operator-ui --include=optional");
	}
} catch (err) {
	// Version metadata is unreadable while the binary itself resolved. Nothing
	// actionable to assert, and the app is more useful started than blocked.
	console.warn(
		`Warning: could not verify the Electron version: ${err.message}`,
	);
}

const {
	resolveSandboxHelper,
	inspectSandboxHelper,
	isStartupFailure,
	rootGuidance,
	sandboxHelperGuidance,
	exitCodeFor,
} = require("./linux-sandbox.js");

// How the user invoked us, for guidance that can be copied verbatim.
//
// A global install puts `local-operator-ui` on PATH and that is the name to
// echo back. But `npx local-operator-ui` and a local ./node_modules/.bin/ run
// reach this file through a shim whose basename is still ours, so use argv[1]'s
// basename when it resolves to something other than the bare script path --
// otherwise we hand a user without a global install a command that will not
// resolve for them.
const invokedAs = (() => {
	const fromArgv =
		typeof process.argv[1] === "string" ? path.basename(process.argv[1]) : "";
	// Strip a .js suffix: the shim is the extensionless name on PATH.
	const name = fromArgv.replace(/\.[cm]?js$/, "");
	return name === "" ? "local-operator-ui" : name;
})();

// Linux preflight: running as root ALWAYS aborts, whatever the sandbox helper's
// mode (measured — a correctly 4755 helper does not help root). Because it
// depends only on the effective uid, it is decidable here, so the user gets an
// explanation instead of Chromium's
// "[FATAL:electron_main_delegate.cc(288)] Running as root without --no-sandbox
// is not supported", which says nothing about what to do next.
//
// The user's own ELECTRON_DISABLE_SANDBOX opt-out must still be honoured: they
// have made the security decision explicitly, and blocking them here would
// override it. We never set that variable ourselves. See bin/linux-sandbox.js.
if (
	process.platform === "linux" &&
	typeof process.getuid === "function" &&
	process.getuid() === 0 &&
	process.env.ELECTRON_DISABLE_SANDBOX !== "1"
) {
	for (const line of rootGuidance(invokedAs)) {
		console.error(line);
	}
	process.exit(1);
}

// Get the path to the main.js file
const appPath = path.join(__dirname, "../out/main/index.js");

// Check if the main.js file exists
if (!fs.existsSync(appPath)) {
	console.error("Error: Could not find the application entry point.");
	console.error(
		"This could happen if the application was not built correctly.",
	);
	console.error("Please report this issue to the package maintainer.");
	process.exit(1);
}

// Launch the Electron app
const child = spawn(electronPath, [appPath], {
	stdio: "inherit",
	windowsHide: false,
});

// Handle process exit
// Wall-clock reference for the startup-failure window below. Taken immediately
// after spawn so the measurement covers the child's whole life.
const spawnedAt = Date.now();

child.on("close", (code, signal) => {
	// A missing setuid bit is NOT predictable as a failure: Chromium falls back to
	// the unprivileged user-namespace sandbox and starts normally where the kernel
	// allows it (measured — the same container reaches readiness with the helper
	// still at 0755 once seccomp permits unshare). Checking before launch would
	// therefore refuse installs that work today, and the /proc indicators cannot
	// see a seccomp filter that blocks the syscall.
	//
	// So diagnose after the fact instead: the app has already failed to START,
	// and the helper is in the state known to cause exactly this.
	//
	// "Failed to start" is narrower than "did not exit zero", and the difference
	// is user-visible: on a working 0755 userns install the helper sits
	// permanently in the state this guidance keys on, so a plain Ctrl+C would
	// otherwise be answered with "run sudo chmod 4755". See isStartupFailure.
	const failedToStart = isStartupFailure({
		code,
		signal,
		elapsedMs: Date.now() - spawnedAt,
	});
	if (failedToStart && process.platform === "linux") {
		const helper = inspectSandboxHelper(resolveSandboxHelper(electronPath));
		if (helper.exists && helper.needsRepair) {
			console.error("");
			for (const line of sandboxHelperGuidance(helper, invokedAs)) {
				console.error(line);
			}
		}
	}

	// A Chromium FATAL terminates by signal, so `code` is null here and the old
	// `process.exit(code)` reported success (Node coerces null to 0) for an app
	// that never started. Map a signal death onto the conventional 128+n.
	process.exit(exitCodeFor(code, signal));
});

// Handle errors
child.on("error", (err) => {
	console.error("Failed to start Electron application:", err);
	process.exit(1);
});

// Handle process termination
process.on("SIGINT", () => {
	child.kill("SIGINT");
});

process.on("SIGTERM", () => {
	child.kill("SIGTERM");
});
