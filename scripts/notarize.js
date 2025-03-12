/**
 * This script handles the notarization process for macOS builds.
 * It is called by electron-builder after the app is signed.
 *
 * Environment variables required for notarization:
 * - APPLE_ID: Your Apple ID email
 * - APPLE_ID_PASSWORD: App-specific password for your Apple ID
 * - APPLE_TEAM_ID: Your Apple Developer Team ID
 *
 * These variables are loaded from .env.build file in the root of the project.
 */

const { notarize } = require("electron-notarize");
const path = require("node:path");
const fs = require("node:fs");
const dotenv = require("dotenv");

// Load environment variables from .env.build file
const envPath = path.resolve(process.cwd(), ".env.build");
if (fs.existsSync(envPath)) {
	const envConfig = dotenv.parse(fs.readFileSync(envPath));
	for (const key in envConfig) {
		process.env[key] = envConfig[key];
	}
}

module.exports = async (params) => {
	// Only notarize the app on macOS
	if (process.platform !== "darwin") {
		console.log("Skipping notarization: not macOS");
		return;
	}

	// Skip notarization if NOTARIZE is not set to true
	if (process.env.NOTARIZE !== "true") {
		console.log("Skipping notarization: NOTARIZE not set to true");
		return;
	}

	// Skip notarization if required environment variables are missing
	if (
		!process.env.APPLE_ID ||
		!process.env.APPLE_ID_PASSWORD ||
		!process.env.APPLE_TEAM_ID
	) {
		console.log(
			"Skipping notarization: required environment variables missing",
		);
		console.log(
			"To enable notarization, set APPLE_ID, APPLE_ID_PASSWORD, and APPLE_TEAM_ID in .env.build file",
		);
		return;
	}

	console.log("Notarizing macOS application...");

	// Get the app path from the build parameters
	const appPath = path.join(
		params.appOutDir,
		`${params.packager.appInfo.productFilename}.app`,
	);

	if (!fs.existsSync(appPath)) {
		console.error(`Cannot find application at: ${appPath}`);
		return;
	}

	try {
		// Notarize the app
		await notarize({
			appBundleId: params.packager.appInfo.appId,
			appPath: appPath,
			appleId: process.env.APPLE_ID,
			appleIdPassword: process.env.APPLE_ID_PASSWORD,
			teamId: process.env.APPLE_TEAM_ID,
		});

		console.log(`Notarization completed successfully for: ${appPath}`);
	} catch (error) {
		console.error("Notarization failed:", error);
		throw error;
	}
};
