#!/usr/bin/env node

/**
 * Make sure the Electron runtime the BUILD shells out to is on disk.
 *
 * WHY A BUILD NEEDS THE BINARY AT ALL: electron-vite's bytecode step runs the
 * Electron binary from `node_modules/electron/dist` to produce `.jsc` for the
 * exact V8 it will load under — so the build needs a real dist/, and it does
 * not go through `require("electron")`, which is the call that would fetch the
 * runtime on demand. Missing dist/ therefore fails the build with
 * `[vite:bytecode] spawn … ENOENT` rather than downloading anything.
 *
 * WHY THIS EXISTS BESIDE bin/postinstall.js: since Electron 42 the `electron`
 * package has no postinstall, so `node_modules/electron/dist` is absent on a
 * fresh install until something fetches it. bin/postinstall.js fetches it on
 * every platform, which covers `pnpm install`; this script covers the trees
 * that hook cannot reach — `pnpm install --ignore-scripts`, and the common
 * local case of a dist/ deleted or replaced by hand — by running from the
 * `prebuild` hook, before anything reads it. Both call the same
 * ensureElectronDist() so there is one implementation of "what counts as
 * present" and one fetch.
 *
 * It is IDEMPOTENT and cache-backed: with dist/ present this exits in well
 * under a second without touching the network.
 *
 * It FAILS the build when the runtime cannot be fetched, unlike the postinstall
 * (which must never fail an install). There is no way for the build to succeed
 * without it, and a named failure with the one command that fixes it beats the
 * ENOENT this exists to prevent.
 */

const path = require("node:path");
const { ensureElectronDist } = require("./linux-sandbox.js");

const packageRoot = path.join(__dirname, "..");

if (!ensureElectronDist(packageRoot, { quiet: false })) {
	console.error(
		"local-operator-ui: the Electron runtime is missing from node_modules and could not be fetched.",
	);
	console.error(
		"The build needs it: electron-vite compiles the main bundle to V8 bytecode for that exact runtime (the preload ships as plain JS — bytecode cannot load in an Electron 44 renderer, see electron.vite.config.js).",
	);
	console.error("Fetch it explicitly, then build again:");
	console.error("  npx install-electron --no && pnpm build");
	process.exit(1);
}
