#!/usr/bin/env node

/**
 * Restore the setuid bit on Electron's chrome-sandbox helper after install.
 *
 * npm strips setuid bits from package contents by design, so the helper lands
 * root:root 0755 and Chromium aborts for a non-root user (issue #91). We fix it
 * here because `sudo npm install -g` — the ordinary way to install a global CLI
 * — runs this script as root, which is the one moment in the lifecycle where we
 * hold the privilege the fix needs.
 *
 * THIS SCRIPT MUST NEVER FAIL THE INSTALL. An unprivileged `npm install -g`
 * (prefix in $HOME), a container without CAP_CHOWN, macOS and Windows where the
 * helper does not exist, and an install where the optional Electron download was
 * skipped are all normal situations in which the repair cannot happen. Leaving
 * the user with no package at all would be a worse defect than the one being
 * fixed, so every failure path exits 0. Where the repair does not happen, the
 * launcher's post-mortem guidance (bin/local-operator-ui.js) covers it with the
 * exact commands.
 *
 * It is quiet on success for the same reason npm scripts generally are: the
 * common case is a working install and noise there trains people to ignore it.
 */

const process = require("node:process");

// Silence is the contract on non-Linux: the helper is a Linux-only artifact, so
// there is nothing to repair and nothing worth printing on a Mac.
if (process.platform !== "linux") {
	process.exit(0);
}

const main = () => {
	const path = require("node:path");
	const {
		ensureElectronDist,
		repairSandboxHelper,
	} = require("./linux-sandbox.js");

	// Do NOT resolve the helper through require("electron"). npm runs this script
	// BEFORE electron's own postinstall downloads dist/, so at this point that
	// call throws and the helper does not exist yet. ensureElectronDist() drives
	// electron's installer first; see the long note on it for the measurements.
	const packageRoot = path.join(__dirname, "..");
	if (!ensureElectronDist(packageRoot)) {
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
