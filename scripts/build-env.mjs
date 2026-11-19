/**
 * Load the build-time environment from `.env.build`.
 *
 * Shared by the two release hooks (app notarization in `notarize.js`, disk image
 * notarization in `notarize-artifacts.mjs`) so that there is one answer to
 * "where do the notarization credentials come from" - a second reader of the same file
 * is how one of them silently ends up with a different set of variables.
 *
 * Values already present in the environment win: CI supplies the secrets
 * directly and has no `.env.build`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

export function loadBuildEnv(cwd = process.cwd()) {
	const envPath = resolve(cwd, ".env.build");
	if (!existsSync(envPath)) return { loaded: false, path: envPath };

	const parsed = dotenv.parse(readFileSync(envPath));
	for (const key of Object.keys(parsed)) {
		if (!process.env[key]) process.env[key] = parsed[key];
	}
	return { loaded: true, path: envPath };
}

/**
 * The notarytool credential set to notarize with, or `null` when none is
 * complete. Shared by both notarization hooks for the same reason the loader
 * above is: two readers of "which credentials" is how one of them ends up
 * notarizing with a different set.
 *
 * AN APP STORE CONNECT API KEY FIRST, AND IT IS WHAT CI USES. Release
 * notarization moved from an Apple ID + app-specific password to the Radient
 * Inc. organization's App Store Connect API key (`notarytool --key <p8> --key-id
 * <id> --issuer <uuid>`): a team key is not tied to one person's Apple ID, does
 * not expire with a password rotation, and can be revoked on its own.
 * `APPLE_API_KEY` is the PATH of the `.p8` (the workflows decode
 * `APPLE_API_KEY_P8_BASE64` to a 0600 file under `$RUNNER_TEMP` and point this
 * at it), which is the form `@electron/notarize` 2.x takes as `appleApiKey`.
 *
 * The Apple ID set stays readable as a LOCAL fallback only, for a developer
 * whose `.env.build` predates the key; the release workflows no longer bind it,
 * and `scripts/mac-build-arch.test.mjs` fails a workflow that does.
 *
 * Returns the options to spread into `notarize()` plus a `kind` the caller logs;
 * never a value worth printing.
 */
export function notarizationCredentials(env = process.env) {
	if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) {
		return {
			kind: "App Store Connect API key",
			options: {
				appleApiKey: env.APPLE_API_KEY,
				appleApiKeyId: env.APPLE_API_KEY_ID,
				appleApiIssuer: env.APPLE_API_ISSUER,
			},
		};
	}
	if (env.APPLE_ID && env.APPLE_ID_PASSWORD && env.APPLE_TEAM_ID) {
		return {
			kind: "Apple ID (local fallback)",
			options: {
				appleId: env.APPLE_ID,
				appleIdPassword: env.APPLE_ID_PASSWORD,
				teamId: env.APPLE_TEAM_ID,
			},
		};
	}
	return null;
}

/** What to set, for the message a missing credential produces. */
export const NOTARIZATION_CREDENTIAL_HINT =
	"set APPLE_API_KEY (path to the App Store Connect .p8), APPLE_API_KEY_ID and APPLE_API_ISSUER (in .env.build when building locally)";

/**
 * Whether a missing credential under `NOTARIZE=true` must FAIL rather than skip.
 *
 * On GitHub Actions it must: a release run that asked for notarization and has
 * no credential is a misbound secret, and a skip there is one log line and exit
 * 0 that only a later gate notices (the disk-image step's
 * `require-notarized-dmg.sh`, the artifact verification) after the whole
 * two-pass build has been spent. Locally a skip stays a skip, because a developer
 * packaging an ad-hoc build with `NOTARIZE=true` left in `.env.build` is not a
 * release.
 */
export function missingNotarizationCredentialIsFatal(env = process.env) {
	return env.GITHUB_ACTIONS === "true";
}
