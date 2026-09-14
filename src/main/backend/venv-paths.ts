import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readManagedSelection } from "./managed-python";

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

/**
 * The variable the app hands its resolved venv path to the install scripts in.
 *
 * The scripts cannot derive it: they run as a subprocess with no view of
 * `app.isPackaged`, and a standalone run of one has no app at all - so their own
 * default stays the packaged name (what every install on a disk today has), and
 * the app overrides it when the instance is not packaged. Without this the
 * separation above exists only in the app: a review measured the shipped macOS
 * script creating `.../local-operator-venv` with the app's own decision for that
 * instance reading `.../local-operator-venv-dev`, so a dev run still created,
 * pip-installed into and `rm -rf`ed the packaged app's environment.
 */
export const VENV_PATH_ENV = "LOCAL_OPERATOR_VENV_PATH";

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
		const support = join(
			input.home,
			"Library",
			"Application Support",
			"Local Operator",
		);
		try {
			return (
				readManagedSelection({
					support,
					resources: "",
					packaged: input.packaged,
					arch: process.arch,
				})?.venv ??
				join(
					support,
					"managed-python",
					input.packaged ? "packaged" : "dev",
					"unprepared",
				)
			);
		} catch {
			// Readiness reports a corrupt selection through setup's error UI. A
			// constructor must not crash before that UI can explain what happened.
			return join(
				support,
				"managed-python",
				input.packaged ? "packaged" : "dev",
				"unprepared",
			);
		}
	}
	return join(input.home, ".config", "local-operator", name);
}

/**
 * What an app-managed venv's interpreter resolves its stdlib from.
 *
 * Three answers rather than `string | null`, because the two nulls were not the
 * same fact and the caller could not tell them apart: a venv built on a system
 * python or on the checkout's own interpreter tree names no bundle at all
 * (`none`), while a venv whose `pyvenv.cfg` names a bundle that is no longer on
 * disk (`missing`) is the state this machine is actually in - `/Applications/
 * Local Operator.app` does not exist here while the operator's venv still names
 * it. The second one used to be silent, so the start-up repair had nothing to say
 * about the one venv it exists to repair; it now names the path it could not find
 * (review/QA R3/Q3).
 */
export type VenvInterpreter =
	/** Nothing to resolve: no venv, no `home`, or an interpreter outside a bundle. */
	| { kind: "none" }
	/** A bundle this venv's interpreter resolves from, present on disk. */
	| { kind: "bundled"; bundle: string }
	/** A bundle the venv names that is not on disk any more. */
	| { kind: "missing"; bundle: string };

export function venvInterpreter(venvPath: string): VenvInterpreter {
	let config: string;
	try {
		config = readFileSync(join(venvPath, "pyvenv.cfg"), "utf8");
	} catch {
		// No venv, or one whose config this cannot read: nothing to resolve.
		return { kind: "none" };
	}
	const home = config
		.split("\n")
		.map((line) => line.match(PYVENV_HOME))
		.find((match) => match != null)?.[1];
	if (!home) return { kind: "none" };
	const resourceMarked = home.match(BUNDLED_INTERPRETER_HOME);
	if (!resourceMarked) return { kind: "none" };
	const bundle = resourceMarked[1];
	return existsSync(bundle)
		? { kind: "bundled", bundle }
		: { kind: "missing", bundle };
}
