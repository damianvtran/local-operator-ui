#!/usr/bin/env node

/**
 * Two install-time duties, one script, because both are "the install did not
 * leave this tree runnable" problems and npm's lifecycle gives us one hook:
 *
 * 1. Fetch the Electron runtime. Since Electron 42 the `electron` package has
 *    no postinstall that downloads the binary, and `electron-vite`'s bytecode
 *    step spawns the binary straight from `dist/` rather than through
 *    `require("electron")` (the one call that would fetch it on demand). So
 *    without this, a fresh clone or a cold CI runner fails its first
 *    `pnpm build` with `[vite:bytecode] spawn ... ENOENT` -- on macOS and
 *    Windows too, not only on Linux. bin/ensure-electron.js calls the same
 *    helper from the build path, for trees installed with --ignore-scripts or
 *    with dist/ removed afterwards.
 *
 * 2. Restore the setuid bit on Electron's chrome-sandbox helper. npm strips
 *    setuid bits from package contents by design, so the helper lands
 *    root:root 0755 and Chromium aborts for a non-root user (issue #91). We fix
 *    it here because `sudo npm install -g` -- the ordinary way to install a
 *    global CLI -- runs this script as root, which is the one moment in the
 *    lifecycle where we hold the privilege the fix needs. Linux only: the
 *    helper does not exist anywhere else.
 *
 * THIS SCRIPT MUST NEVER FAIL THE INSTALL. An unprivileged `npm install -g`
 * (prefix in $HOME), a container without CAP_CHOWN, macOS and Windows where the
 * helper does not exist, and an install where the Electron download failed or
 * was skipped are all normal situations. Leaving the user with no package at
 * all would be a worse defect than the one being fixed, so every failure path
 * exits 0. Where the runtime could not be fetched, `bin/ensure-electron.js`
 * fails the build with the exact command instead, and where the repair does not
 * happen the launcher's post-mortem guidance (bin/local-operator-ui.js) covers
 * it.
 *
 * It is quiet on success for the same reason npm scripts generally are: the
 * common case is a working install and noise there trains people to ignore it.
 */

const process = require("node:process");

const main = () => {
	const path = require("node:path");
	const {
		ensureElectronDist,
		repairSandboxHelper,
	} = require("./linux-sandbox.js");

	// Fetch BEFORE the platform guard, because the build needs the runtime on
	// every platform and this is the only hook that runs on a plain
	// `pnpm install`. The installer is silent here on purpose: the download
	// prints a progress bar that would otherwise appear twice in one install,
	// once from us and once from npm's own run of the same script.
	const packageRoot = path.join(__dirname, "..");
	const distReady = ensureElectronDist(packageRoot);

	// Silence is the contract on non-Linux: the helper is a Linux-only artifact,
	// so with the runtime in place there is nothing left to repair and nothing
	// worth printing on a Mac.
	//
	// LOCAL_OPERATOR_UI_FORCE_POSTINSTALL exists so the test suite can reach the
	// repair path on a macOS developer machine and on CI's ubuntu runner alike.
	// Without it the only assertion this script's test could make on darwin was
	// "exit 0", which it satisfies by returning here before doing anything -- a
	// vacuous test that passed while the whole body was mutated away. It is read
	// only, never written by us, and namespaced so it cannot be set by accident.
	if (
		process.platform !== "linux" &&
		process.env.LOCAL_OPERATOR_UI_FORCE_POSTINSTALL !== "1"
	) {
		return;
	}

	// Do NOT resolve the helper through require("electron"): that call fetches
	// the runtime on demand when it is missing, which inside an install is a
	// synchronous download in the wrong place. ensureElectronDist() above is the
	// one that drives electron's installer, on purpose.
	if (!distReady) {
		// No Electron to repair: optional install skipped, or the download failed.
		// The launcher reports that case with its own guidance.
		return;
	}

	const helper = path.join(
		packageRoot,
		"node_modules",
		"electron",
		"dist",
		"chrome-sandbox",
	);
	const result = repairSandboxHelper(helper);

	if (result.outcome === "unsafe") {
		// The helper path is a symlink or not a regular file. We refuse to chown
		// and chmod 4755 through it as root -- that would apply the setuid bit to
		// whatever the link points at (see the O_NOFOLLOW note in linux-sandbox.js).
		// Say so loudly: this is not a normal install state, and it is the one case
		// here that warrants suspicion rather than a shrug.
		console.log(
			"local-operator-ui: refusing to modify the Chromium sandbox helper" +
				" because it is not a regular file (possible symlink). Nothing was" +
				" changed. Please report this.",
		);
		return;
	}

	if (result.outcome === "not-permitted") {
		// Distinguish the two ways this branch is reached. An unprivileged install
		// genuinely cannot chown, and that is expected. Reaching it AS ROOT means
		// the repair itself is broken -- which is exactly what a chmod-before-chown
		// ordering bug produces, since chown clears the setuid bit again -- and
		// reporting that as "not running as root" would send the reader to
		// diagnose their permissions instead of our code.
		const asRoot =
			typeof process.getuid === "function" && process.getuid() === 0;
		if (asRoot) {
			console.log(
				"local-operator-ui: the Chromium sandbox helper is still not setuid" +
					" after running as root; this is a packaging defect, please report it.",
			);
		} else {
			console.log(
				"local-operator-ui: could not set the Chromium sandbox helper setuid" +
					" (this install is not running as root).",
			);
		}
		console.log(
			"If the app fails to start on Linux, it will print the exact commands to fix it.",
		);
	}
};

try {
	main();
} catch (err) {
	// Defensive: nothing above is expected to throw, and if something does the
	// install must still succeed. See the header.
	console.log(
		`local-operator-ui: skipped the Chromium sandbox check (${err.message}).`,
	);
}

process.exit(0);
