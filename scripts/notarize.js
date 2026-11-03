/**
 * This script handles the notarization process for macOS builds.
 * It is called by electron-builder after the app is signed.
 *
 * Credentials (resolved by `notarizationCredentials` in `build-env.mjs`, the one
 * reader both notarization hooks share):
 * - APPLE_API_KEY: path to the App Store Connect API key (.p8) — what CI uses
 * - APPLE_API_KEY_ID: that key's id
 * - APPLE_API_ISSUER: the App Store Connect issuer id (a UUID)
 * A local `.env.build` may still carry APPLE_ID / APPLE_ID_PASSWORD /
 * APPLE_TEAM_ID instead; the release workflows no longer bind those.
 *
 * These variables are loaded from .env.build file in the root of the project.
 *
 * Note: This script uses @electron/notarize which uses notarytool instead of the
 * deprecated altool for notarization.
 */

const { notarize } = require("@electron/notarize");
const path = require("node:path");
const fs = require("node:fs");

module.exports = async (params) => {
	// Load environment variables from .env.build, through the same loader the
	// disk image hook uses so the two never read a different set of variables.
	const {
		loadBuildEnv,
		missingNotarizationCredentialIsFatal,
		NOTARIZATION_CREDENTIAL_HINT,
		notarizationCredentials,
	} = await import("./build-env.mjs");
	const env = loadBuildEnv();
	if (env.loaded) console.log(`Loaded build environment from ${env.path}`);

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

	// A missing credential under NOTARIZE=true. Locally that is a skip, as it
	// always was; on GitHub Actions it is a misbound secret on a release build, and
	// a skip there is one log line and exit 0 that only the artifact verification
	// notices after the whole two-pass build has been spent - so it fails here, at
	// the bundle that would have shipped unnotarized.
	const credentials = notarizationCredentials();
	if (!credentials) {
		const message = `Notarization credentials missing: ${NOTARIZATION_CREDENTIAL_HINT}`;
		if (missingNotarizationCredentialIsFatal()) throw new Error(message);
		console.log(`Skipping notarization: ${message}`);
		return;
	}

	console.log(`Notarizing macOS application (${credentials.kind})...`);

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
		// Notarize the app using notarytool (via @electron/notarize)
		await notarize({
			tool: "notarytool",
			appBundleId: params.packager.appInfo.appId,
			appPath: appPath,
			...credentials.options,
		});

		console.log(`Notarization completed successfully for: ${appPath}`);
	} catch (error) {
		console.error("Notarization failed:", error);
		throw error;
	}
};
