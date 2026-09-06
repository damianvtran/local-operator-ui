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
child.on("close", (code) => {
	process.exit(code);
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
