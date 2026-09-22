/**
 * Where the bundled `uv` is, and the environment variable that carries its path
 * to the install scripts.
 *
 * WHY THE APP RESOLVES IT rather than the script probing for it: the resource
 * namespace, the per-architecture directory and the platform's binary name
 * (`uv` / `uv.exe`) are the app's own layout, read from
 * `src/shared/bundled-runtime-layout.json`. A shell script that re-derived any
 * of the three would be a second copy of that layout in another language, which
 * is the drift review R10 / QA Q2 cost this repository a release. The script
 * gets one path and either runs it or falls back to pip.
 *
 * WHY IT IS EXECUTED FROM THE BUNDLE, WHEN THE INTERPRETER IS NOT. The
 * interpreter is copied out of the bundle before use because a venv built on an
 * in-bundle interpreter *records that path*: its `pyvenv.cfg` names
 * `Contents/Resources/.../bin`, so every later start of that environment
 * resolves its stdlib inside the code-sealed `.app`, and CPython writes
 * `__pycache__` beside those sources - a change to a signed resource, which
 * macOS reports as a damaged app and Squirrel refuses to update in place (the
 * measurement is quoted at length in `venv-paths.ts`). None of that applies to
 * `uv`: it is a stateless tool, invoked with argv and an environment, that
 * installs into the venv it is pointed at and exits. Nothing persists a
 * reference to its own path, it never imports the bundled stdlib, and it is
 * handed `PYTHONDONTWRITEBYTECODE` plus a cache prefix of its own, so it has no
 * route to writing inside the bundle. The one thing it does write - the cache it
 * links from - is redirected under the app's support directory by
 * `UV_CACHE_DIR` (`scripts/*-install-script.*`), which is also why the
 * interpreter's copy-out is not the pattern to follow here.
 *
 * `null` when the binary is not there, which is the ordinary state of a dev
 * checkout where `pnpm setup-python` has not been run, and of any artifact built
 * before this change. The caller passes the path down only when it resolves one.
 */
import { constants, accessSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import RUNTIME_LAYOUT from "../../shared/bundled-runtime-layout.json";

/** The environment variable the install scripts read for the uv path. */
export const UV_TOOL_ENV = "LOCAL_OPERATOR_UV_BIN";

/** The mode the bundled uv must have to be spawned, on every platform.
 *
 * The same value the console's own bundled executable is repaired to
 * (`SPAWN_HELPER_MODE`, `scripts/console-pack.mjs`) - one mode for "a file this
 * app execs out of its own bundle", rather than a second number that means the
 * same thing. */
export const UV_TOOL_MODE = 0o755;

/** The one bit that decides whether `exec` is even attempted. */
const OWNER_EXECUTE = 0o100;

/** The `uv` binary name on a platform, or a throw: a platform the layout does
 * not name is one the packaging lists and the layout have diverged about. */
function binaryName(platform: string): string {
	const name = (RUNTIME_LAYOUT.uv.binaryNames as Record<string, string>)[
		platform
	];
	if (!name)
		throw new Error(
			`No bundled uv binary name is defined for platform "${platform}"; src/shared/bundled-runtime-layout.json names ${Object.keys(RUNTIME_LAYOUT.uv.binaryNames).join(", ")}`,
		);
	return name;
}

/**
 * The result of resolving the bundled `uv`: the binary to run, or why there is
 * none - and whether the mode it arrived with had to be repaired to run it.
 */
export interface UvToolSelection {
	/** The binary to hand to the installer, or `null` when there is none to run. */
	path: string | null;
	/** Whether the execute bit was missing and has been restored. */
	healed: boolean;
	/** The mode the binary has now, when one was found. */
	mode: number | null;
	/** Why there is no path, when `path` is null. */
	reason: string | null;
}

/**
 * Where the bundled `uv` is, or `null` when nothing is staged there.
 *
 * THE MODE IS NOT THIS FUNCTION'S QUESTION - `ensureUvToolExecutable` below is
 * what decides whether the file can actually be run, and repairs it if it
 * cannot. This one answers "is there a uv for this architecture", which is a
 * fact about the build; requiring `X_OK` here (as an earlier revision did) turned
 * every mode loss into a silent absence, which is the R1-1 failure.
 *
 * `packaged` picks between the two layouts the app itself ships: the packaged
 * app carries `Resources/uv/<arch>/<binary>` (the namespace `package.json`'s
 * `extraResources` maps into, for the platforms that ship one), and a checkout
 * carries `resources/uv` for x64 and `resources/uv_aarch64` for arm64 - the same
 * `<name>` / `<name>_aarch64` convention `setup-python-resource.sh` already
 * stages the interpreter under.
 */
export function uvToolPath(options: {
	resources: string;
	packaged: boolean;
	arch: string;
	platform?: string;
}): string | null {
	const platform = options.platform ?? process.platform;
	const name = binaryName(platform);
	const directory = options.packaged
		? join(options.resources, RUNTIME_LAYOUT.uv.namespace, options.arch)
		: options.resources;
	const path = options.packaged
		? join(directory, name)
		: join(
				directory,
				(RUNTIME_LAYOUT.uv.checkoutNames as Record<string, string>)[
					options.arch
				] ?? "",
				name,
			);
	try {
		accessSync(path, constants.F_OK);
	} catch {
		return null;
	}
	return statSync(path).isFile() ? path : null;
}

/**
 * The bundled `uv`, with its execute bit repaired if the bundle that arrived lost
 * it, or the reason there is none to run.
 *
 * WHY A REPAIR AT RUNTIME, when the build sets the mode and the release gate
 * asserts it: **the mode is not part of the signature, and a ZIP does not carry
 * it.** `after-pack.mjs` states it for the console helper, and this is the same
 * tree: the build step cannot help a bundle that arrived by update - a ZIP drops
 * the modes, and `codesign`'s seal does not cover them, so a file delivered 0644
 * passes every signature check and fails only at the first spawn. The console's
 * own helper is repaired by `ensureSpawnHelperExecutable`
 * (`src/main/console/pty.ts`) for exactly that reason, and `uv` is now the second
 * file this app execs out of its own bundle.
 *
 * WHY IT MATTERS MORE THAN A MISSING FEATURE: without the repair the failure is
 * not an error anyone sees. The install script's `[ -x ]` check fails, the script
 * prints one WARNING and installs with pip - so one dropped mode bit silently
 * reverts every update-installed user to the slow path, with a green exit code, a
 * normal-looking UI and no line in the log that says the feature is off.
 *
 * A repair that cannot be made (a read-only bundle, a lock) reports its reason and
 * hands back no path, which is the plain fallback rather than a claim.
 */
export function ensureUvToolExecutable(options: {
	resources: string;
	packaged: boolean;
	arch: string;
	platform?: string;
}): UvToolSelection {
	const path = uvToolPath(options);
	if (path === null)
		return {
			path: null,
			healed: false,
			mode: null,
			reason:
				"no bundled uv is staged for this architecture (a dev checkout whose `pnpm setup-python` has not run, or an artifact built before uv was bundled)",
		};
	const mode = statSync(path).mode & 0o777;
	if ((mode & OWNER_EXECUTE) !== 0)
		return { path, healed: false, mode, reason: null };
	try {
		chmodSync(path, UV_TOOL_MODE);
		return { path, healed: true, mode: UV_TOOL_MODE, reason: null };
	} catch (error) {
		return {
			path: null,
			healed: false,
			mode,
			reason: `the bundled uv at ${path} has mode ${mode.toString(8)} and could not be repaired (${error instanceof Error ? error.message : String(error)})`,
		};
	}
}
