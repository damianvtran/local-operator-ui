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
import { constants, accessSync } from "node:fs";
import { join } from "node:path";
import RUNTIME_LAYOUT from "../../shared/bundled-runtime-layout.json";

/** The environment variable the install scripts read for the uv path. */
export const UV_TOOL_ENV = "LOCAL_OPERATOR_UV_BIN";

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
 * The bundled `uv` for this instance, or `null` when there is none to run.
 *
 * `packaged` picks between the two layouts the app itself ships: the packaged
 * app carries `Resources/uv/<arch>/<binary>` (the namespace `package.json`'s
 * `extraResources` maps into, for every platform), and a checkout carries
 * `resources/uv` for x64 and `resources/uv_aarch64` for arm64 - the same
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
		accessSync(path, constants.X_OK);
	} catch {
		return null;
	}
	return path;
}
