import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
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
 * What `managedVenvPath` answers with when nothing has been published yet.
 *
 * A SENTINEL, not a directory: nothing creates it, and no code should read it as
 * state. It used to be spelled `.../managed-python/<scope>/unprepared`, which is a
 * plausible-looking path - it was logged as one, and `BackendServiceManager.getVenvPath`
 * fed it to the pip-upgrade path, where the resulting error named a directory the
 * user could go looking for (review N3). The name now says what it is, and
 * `isUnpreparedVenvPath` is what a consumer asks.
 */
export const NO_SELECTION_DIR_NAME = "no-environment-selected";

/** Whether a `managedVenvPath` answer is the sentinel rather than an environment. */
export function isUnpreparedVenvPath(path: string): boolean {
	return path.endsWith(`${sep}${NO_SELECTION_DIR_NAME}`);
}

/** The macOS application-support root these environments live under. */
export function managedSupportRoot(home: string): string {
	return join(home, "Library", "Application Support", "Local Operator");
}

/**
 * The PRE-SPLIT environments, by their names on disk.
 *
 * Why this exists separately from `managedVenvPath`: that function answers "which
 * environment belongs to THIS instance", which after the split is the selected
 * generation venv or the sentinel - never the `local-operator-venv` an install
 * from before this change built. The start-up report was written for that legacy
 * environment and handed `managedVenvPath`'s answer to it, so on darwin it
 * inspected either a venv whose `pyvenv.cfg` names the external runtime by
 * construction or a sentinel that does not exist, and the promised line never
 * fired for the one state it describes (review R7).
 */
export function legacyVenvPaths(support: string): string[] {
	return [
		join(support, PACKAGED_VENV_DIR_NAME),
		join(support, DEV_VENV_DIR_NAME),
	];
}

/**
 * The variable the app hands its resolved venv path to the install scripts in.
 *
 * The scripts cannot derive it: they run as a subprocess with no view of
 * `app.isPackaged`, and a standalone run of one has no app at all. Without this
 * the separation above exists only in the app: a review measured the shipped
 * macOS script creating `.../local-operator-venv` with the app's own decision for
 * that instance reading `.../local-operator-venv-dev`, so a dev run still created,
 * pip-installed into and `rm -rf`ed the packaged app's environment.
 *
 * What each script does WITHOUT it is deliberately not uniform. Linux and Windows
 * fall back to the packaged name, which is harmless on both: Linux's default is
 * under `~/.config/local-operator` and Windows' under `%APPDATA%`, and neither is
 * a tree a packaged install is sealed against. macOS refuses - see
 * `macos-install-script.sh` - because its default IS the shared environment this
 * split exists to remove, so guessing there would rebuild exactly the venv the
 * fix is about.
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
		const support = managedSupportRoot(input.home);
		// A selection that is unusable answers null rather than throwing, so there
		// is nothing to catch here: "not published yet" and "published but gone"
		// are the same answer to this caller - the instance has no environment of
		// its own to name yet, and setup is what publishes one.
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
				NO_SELECTION_DIR_NAME,
			)
		);
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

/**
 * The log lines the pre-split environments deserve, as a pure function of the
 * disk - so the reporting the method claims to do is something a test can drive.
 *
 * Two facts, and they are not the same one: a venv whose interpreter is inside an
 * installed `.app` is still built on a tree that a replacement destroys, and one
 * whose bundle is already gone resolves nothing at all. Silence made them look
 * like the same healthy state, which is what R7 and Q3 were about. Neither is
 * repaired here: those environments are left byte-identical on purpose, so a
 * rollback to an older build still finds what it built.
 */
export function legacyEnvironmentReport(support: string): string[] {
	const lines: string[] = [];
	for (const venv of legacyVenvPaths(support)) {
		const resolution = venvInterpreter(venv);
		if (resolution.kind === "none") continue;
		lines.push(
			resolution.kind === "missing"
				? `The pre-split environment at ${venv} names an interpreter bundle that is not on disk (${resolution.bundle}); it is left exactly as it is.`
				: `The pre-split environment at ${venv} is built on the interpreter inside ${resolution.bundle}; it is left exactly as it is, and this instance does not use it.`,
		);
	}
	return lines;
}
