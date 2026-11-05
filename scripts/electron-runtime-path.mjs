/** Resolve an ALREADY installed Electron binary without executing its package.
 * Electron45's index runs install.js on require when dist is missing. Proof
 * harness imports/help must never download or mutate caches/dependencies; the
 * native launch/preflight caller gets a fail-closed prerequisite error instead.
 * Keep npm's documented dist override, but never execute its installer/shim.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function installedElectronBinary(
	root,
	overrideDist = process.env.ELECTRON_OVERRIDE_DIST_PATH,
) {
	const resolve = createRequire(join(root, "package.json"));
	const packageDir = dirname(resolve.resolve("electron/package.json"));
	const marker = join(packageDir, "path.txt");
	const relative = existsSync(marker)
		? readFileSync(marker, "utf8").trim()
		: null;
	if (!relative && !overrideDist)
		throw new Error(
			"native executable absent; proof harnesses never bootstrap Electron",
		);
	const binary = join(
		overrideDist || join(packageDir, "dist"),
		relative || "electron",
	);
	if (!existsSync(binary))
		throw new Error(
			`native executable absent at ${binary}; proof harnesses never bootstrap Electron`,
		);
	return binary;
}
