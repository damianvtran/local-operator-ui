import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where the interpreter environment this app builds and runs lives.
 *
 * Why this is one module rather than the two copies that used to exist
 * (`backend-installer.ts` and `backend-service.ts` each spelled the same three
 * platform branches): the path is now a *decision* - a packaged install and an
 * unpackaged one must not share it, see below - and two spellings of one
 * decision is how the two halves come to disagree about which environment the
 * app is running.
 *
 * The packaged name is the one on disk today; the `-dev` name is what an
 * unpackaged instance uses, and it is the fix for a measured failure rather
 * than tidiness. Trace on the operator's machine, 2026-09-14: an unpackaged
 * instance resolves the SAME app-managed venv the installed app uses
 * (`~/Library/Application Support/Local Operator/local-operator-venv`, a
 * hardcoded path, so `pnpm dev` from any worktree reached it), that venv's
 * `pyvenv.cfg` records
 * `home = /Applications/Local Operator.app/Contents/Resources/python_aarch64/bin`,
 * and so starting its backend runs a python whose STDLIB is inside the
 * installed, code-sealed `.app`. One write of `__pycache__/*.pyc` there is a
 * change to a sealed resource, which is what macOS then reports as a damaged
 * app and Squirrel refuses to update in place. A dev instance breaking the
 * operator's installed app, from the dev instance's own backend start, is not a
 * state to leave reachable: they get their own environment.
 *
 * The cost is stated rather than hidden: an unpackaged instance with no venv of
 * its own yet asks for the one-time backend setup, exactly as a machine with no
 * backend does today. Machines that already have a global `local-operator` never
 * reach this path at all (`index.ts` skips the install when one is on `PATH`),
 * and the cost is once per machine, not once per worktree - this name is shared
 * by every unpackaged instance on it.
 */
export const PACKAGED_VENV_DIR_NAME = "local-operator-venv";
export const DEV_VENV_DIR_NAME = "local-operator-venv-dev";

/** `home = <path>` in a venv's `pyvenv.cfg`, as `venv` writes it. */
const PYVENV_HOME = /^\s*home\s*=\s*(.+?)\s*$/;

/**
 * A `home` that resolves inside a bundle's bundled-interpreter resources.
 *
 * The `.app` component is required rather than the `Resources/python` tail
 * alone: an unpackaged instance's interpreter lives at
 * `<checkout>/resources/python_aarch64/bin`, which is the same tail with no
 * bundle around it, and that is not a code-sealed tree anybody needs protecting
 * from.
 */
const BUNDLED_INTERPRETER_HOME =
	/^(.*?\.app)\/Contents\/Resources\/python(?:_aarch64)?\//;

/**
 * The app-managed venv for this instance.
 *
 * `packaged` is `app.isPackaged` rather than "am I in dev mode": the question is
 * which app the environment belongs to, and a packaged build pointed at a dev
 * server still owns the environment its bundle carries.
 */
export function managedVenvPath(input: {
	platform: NodeJS.Platform;
	home: string;
	appDataPath: string;
	packaged: boolean;
}): string {
	const name = input.packaged ? PACKAGED_VENV_DIR_NAME : DEV_VENV_DIR_NAME;
	if (input.platform === "win32") {
		// Windows keeps everything under userData, so the name alone is the split.
		return join(input.appDataPath, name);
	}
	if (input.platform === "darwin") {
		// Hardcoded rather than `appDataPath`: that is what every install on this
		// platform has on disk today (`~/Library/Application Support/Local
		// Operator`), and the app must find the environment it built rather than
		// one Electron would name after the bundle when it is unpackaged.
		return join(
			input.home,
			"Library",
			"Application Support",
			"Local Operator",
			name,
		);
	}
	return join(input.home, ".config", "local-operator", name);
}

/**
 * The `.app` bundle the interpreter of `venvPath` resolves its stdlib from, or
 * null when it is not built on one.
 *
 * Read from the venv's own `pyvenv.cfg`, because that file is the record of what
 * the environment was created from: `home` is the interpreter's `bin`, and a
 * `home` inside `Contents/Resources/python[_aarch64]` means every module that
 * environment imports has its source inside that bundle. That is the only way a
 * process running *this* instance can know another bundle is part of its own
 * failure surface - measured on this machine, the app-managed venv's `home` is
 * `/Applications/Local Operator.app/Contents/Resources/python_aarch64/bin` - and
 * it is what lets an unpackaged instance repair the installed app its shared
 * environment writes into (see `repairReachableBundleSeals` in `update-service`).
 *
 * Only a `Contents/Resources/python*` home counts: a venv built on a system or
 * uv-managed python has no bundle to protect here, and the `.app` component is
 * required so a checkout's `resources/python_aarch64/bin` (the unpackaged case)
 * is not reported as one.
 */
export function venvInterpreterBundle(venvPath: string): string | null {
	let config: string;
	try {
		config = readFileSync(join(venvPath, "pyvenv.cfg"), "utf8");
	} catch {
		// No venv, or one whose config this cannot read: nothing to resolve.
		return null;
	}
	const home = config
		.split("\n")
		.map((line) => line.match(PYVENV_HOME))
		.find((match) => match != null)?.[1];
	if (!home) return null;
	const resourceMarked = home.match(BUNDLED_INTERPRETER_HOME);
	if (!resourceMarked) return null;
	const bundle = resourceMarked[1];
	return existsSync(bundle) ? bundle : null;
}
