/**
 * Load the build-time environment from `.env.build`.
 *
 * Shared by the two release hooks (app notarization in `notarize.js`, disk image
 * notarization in `notarize-artifacts.mjs`) so that there is one answer to
 * "where do APPLE_ID and friends come from" - a second reader of the same file
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
