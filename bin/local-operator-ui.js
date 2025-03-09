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

// Get the path to the electron executable
const electronPath = require("electron");

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
