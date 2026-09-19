import { chmodSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { IPty } from "node-pty";

/**
 * The pty seam, and the two measured packing traps it exists to survive.
 *
 * Design: docs/design/ui-console-tab.md 5.3 (node-pty is the one native
 * dependency, and it is a packaging decision), 18.1 (the three traps and the
 * mitigations), 19.1 P11/P13 (what proves them).
 *
 * TRAP 1 — the helper is not executable, and no install step fixes it.
 * Measured on the published tarball: `prebuilds/darwin-arm64/spawn-helper`
 * arrives at mode **0644**, `scripts/prebuild.js` only *checks* for the
 * directory and `scripts/post-install.js` only prunes `build/Release`, and this
 * repo's pnpm 10 install gate skips a dependency's scripts anyway. A pty spawned
 * against that file dies `FATAL Error: posix_spawnp failed.` The heal therefore
 * lives in two places on purpose: `after-pack.mjs` fixes the artifact, and
 * `ensureSpawnHelperExecutable` re-asserts the mode at runtime, because the
 * auto-update path stages a ZIP through Squirrel ShipIt with no step that
 * re-asserts file modes — and `codesign`'s seal does not cover modes, so a
 * helper delivered 0644 passes every signature check and fails only at
 * `posix_spawn`.
 *
 * TRAP 2 — `prebuilds/` must be UNPACKED from the asar, not merely rewritten.
 * node-pty's own `lib/unixTerminal.js` rewrites `app.asar` to
 * `app.asar.unpacked` before forking, which makes the path *look* right; the
 * spawn still fails in a fully-packed archive because the rewritten path does not
 * exist. The `asarUnpack` entry in `package.json` and the `afterPack` prune are
 * the two halves of that fix, and P13 asserts the result in the built tree.
 *
 * WHY THE PRUNE IS NOT A DEV-ONLY STEP: the package ships ~58 MB of `win32`
 * prebuilds and `.pdb` files against 136 KB of `darwin-arm64` ones. Deleting them
 * from `node_modules` at install time would break a Windows build on a machine
 * that had run a macOS one, so the prune runs per-target inside `afterPack`, where
 * the platform and architecture being built are known facts rather than guesses.
 */

/** The one native dependency (design 5.3). */
export const PTY_PACKAGE = "node-pty";

/** The executable inside each prebuild directory.
 *
 * The PRUNE of the other platforms' prebuilds lives in `scripts/console-pack.mjs`
 * rather than here: it is a packaging step (it needs a target platform and
 * architecture, and it runs inside `afterPack`), and keeping a copy of it beside
 * this runtime check is exactly the duplication that lets the two disagree. */
export const SPAWN_HELPER_NAME = "spawn-helper";

/** The mode the helper must have. Not `0o700`: the packaged app's own user runs
 * it, but a per-user install that later runs as another account must not lose it
 * to a mode the build did not set. `0755` is what the upstream build produces. */
export const SPAWN_HELPER_MODE = 0o755;

/** `0o100` is the owner-execute bit, and its absence is the whole failure. */
const OWNER_EXECUTE = 0o100;

export interface PtyPlatform {
	platform: NodeJS.Platform | string;
	arch: string;
}

export interface SpawnHelperReport {
	/** The helper's path, or null when the platform has none (or the package is
	 * not where this module expects it). */
	path: string | null;
	/** The mode found before any heal, or null when the check could not run. */
	mode: number | null;
	/** Whether this call had to chmod it. */
	healed: boolean;
	/** Why the check could not run, when it could not. */
	reason?: string;
}

/** The two archive names an unpacked package hides behind. Module scope because a
 * literal inside `unpackedPath` is compiled on every call, and this runs on every
 * spawn-helper check. */
const ASAR_APP = /([/\\])app\.asar([/\\])/;
const ASAR_NODE_MODULES = /([/\\])node_modules\.asar([/\\])/;

/**
 * Rewrite a packaged path to its unpacked twin.
 *
 * The same rewrite node-pty performs internally, and here for the same reason:
 * `asarUnpack` moves bytes OUT of the archive while the archive's copy of the path
 * still resolves, so a mode probe that ignored the rewrite would stat a file inside
 * an archive that cannot hold an exec bit at all and "heal" nothing.
 * `node_modules.asar` is rewritten too, because electron-builder's alternate
 * layout uses that name.
 */
export function unpackedPath(path: string): string {
	return path
		.replace(ASAR_APP, "$1app.asar.unpacked$2")
		.replace(ASAR_NODE_MODULES, "$1node_modules.asar.unpacked$2");
}

/** Where a prebuild directory for one platform/arch lives. */
export function prebuildDir(root: string, target: PtyPlatform): string {
	return join(root, "prebuilds", `${target.platform}-${target.arch}`);
}

/** The helper's path for one platform/arch, whether or not it exists. */
export function spawnHelperPath(root: string, target: PtyPlatform): string {
	return join(prebuildDir(root, target), SPAWN_HELPER_NAME);
}

/**
 * Resolve node-pty's directory.
 *
 * `createRequire` rather than a static import: the caller needs a *path*, and a
 * static import would also load the module — which is the thing `loadNodePty`
 * exists to make survivable. `import.meta.url` is used only when `__filename` is
 * absent (the ESM test bundle); rollup shims it in the CJS main bundle, so both
 * shapes resolve from a real file.
 */
export function resolvePtyRoot(): string {
	const requireFrom = createRequire(
		typeof __filename === "string" ? __filename : import.meta.url,
	);
	return unpackedPath(
		dirname(requireFrom.resolve(`${PTY_PACKAGE}/package.json`)),
	);
}

/**
 * Assert, and if necessary restore, the helper's exec bit.
 *
 * Called before every spawn, because the failure it heals is delivered by an
 * installer or an updater rather than by a developer's checkout: a process that
 * only checked once at startup would still be holding a stale answer after an
 * in-app update replaced the bundle under it. The check is one `statSync`, which
 * is nothing beside the `fork` it precedes.
 *
 * The PACKAGED tree is also fixed at build time (`scripts/console-pack.mjs`, from
 * `afterPack`), and both exist because neither covers the other: the build step
 * cannot help a bundle that arrived by update — a ZIP drops the modes, and
 * `codesign`'s seal does not cover them, so a helper delivered 0644 passes every
 * signature check and fails only at `posix_spawn`.
 */
export function ensureSpawnHelperExecutable(
	root: string,
	target: PtyPlatform,
): SpawnHelperReport {
	const path = spawnHelperPath(root, target);
	try {
		if (!existsSync(path)) {
			return { path: null, mode: null, healed: false, reason: "no helper" };
		}
		const mode = statSync(path).mode & 0o777;
		if ((mode & OWNER_EXECUTE) !== 0) {
			return { path, mode, healed: false };
		}
		chmodSync(path, SPAWN_HELPER_MODE);
		return { path, mode, healed: true };
	} catch (error) {
		return {
			path,
			mode: null,
			healed: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

/** What `loadNodePty` returns: the module, or the reason it is unusable. */
export type PtyLoad =
	| { ok: true; root: string; helper: SpawnHelperReport; module: PtyModule }
	| { ok: false; reason: string };

/** The slice of node-pty this app uses. Exported so the startup path can pass the
 * loaded module to `spawnPty` without re-deriving it. */
export interface PtyModule {
	spawn(
		file: string,
		args: string[] | string,
		options: {
			name: string;
			cols: number;
			rows: number;
			cwd: string;
			env: Record<string, string | undefined>;
		},
	): IPty;
}

let cached: PtyLoad | null = null;

/**
 * Load node-pty, and heal its helper.
 *
 * Never throws: a native module that will not load is a packaging bug, and the
 * design's answer (10.1/15) is that the console capability goes OFF with one log
 * line naming the failure — the app keeps running, the tool is absent because the
 * record says `console: false`, and the pane says why. A throw here would take
 * the whole browser host down with it.
 *
 * WHY A SYNCHRONOUS `createRequire` AND NOT `await import(...)`, which is what this
 * was first: the main bundle is compiled to V8 bytecode, and a dynamic import in
 * bytecode-compiled code fails at run time with `A dynamic import callback was not
 * specified.` — measured on the built app by `scripts/console-host-proof.mjs`, which
 * reported the console capability as unavailable and every console method as
 * `console_unavailable`. A static `import` would work and is the opposite trade:
 * a native module that will not dlopen would then throw while the module is being
 * evaluated, taking the app down instead of turning the feature off. A require
 * through `createRequire` is the shape that is both loadable and catchable.
 *
 * AND WHY IT REQUIRES BY NAME RATHER THAN BY PATH — see the comment at the call:
 * the path that is right for a mode probe is the path that breaks node-pty's own
 * archive rewrite.
 *
 * The result is cached because a failed dlopen repeated per spawn would turn one
 * broken install into a per-call cost; the *helper mode* is not cached, because
 * that is the check that has to survive an update landing under a running app.
 */
export function loadNodePty(): PtyLoad {
	if (cached) return cached;
	try {
		const root = resolvePtyRoot();
		const requireFrom = createRequire(
			typeof __filename === "string" ? __filename : import.meta.url,
		);
		const namespace = requireFrom(PTY_PACKAGE) as
			| PtyModule
			| { default: PtyModule };
		// A CJS external can arrive with its exports under `default` in some bundler
		// shapes and spread in others; both are the same module and only one of them
		// has `spawn`.
		const module = "spawn" in namespace ? namespace : namespace.default;
		if (typeof module?.spawn !== "function") {
			cached = { ok: false, reason: "node-pty loaded but exports no spawn()" };
			return cached;
		}
		const helper = ensureSpawnHelperExecutable(root, {
			platform: process.platform,
			arch: process.arch,
		});
		cached = { ok: true, root, helper, module };
		return cached;
	} catch (error) {
		cached = {
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		};
		return cached;
	}
}

/** Forget the cached load result. Test-only, and honest about that. */
export function resetPtyLoadCache(): void {
	cached = null;
}

export interface SpawnSurfaceOptions {
	file: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	cols: number;
	rows: number;
}

/**
 * Spawn one surface's process.
 *
 * The helper mode is re-asserted immediately before the spawn, not at host start:
 * this is the single call site where the mode matters, so the check cannot be
 * skipped by a path that reached here another way. A heal is reported through
 * `onHeal` rather than swallowed, because it means the artifact or the update
 * path delivered the wrong mode — the packaging defect P13 exists to catch — and
 * a silent heal would hide the next one.
 */
export function spawnPty(
	module: PtyModule,
	options: SpawnSurfaceOptions,
	onHeal?: (report: SpawnHelperReport) => void,
): IPty {
	const load = cached;
	if (load?.ok) {
		const report = ensureSpawnHelperExecutable(load.root, {
			platform: process.platform,
			arch: process.arch,
		});
		if (report.healed) onHeal?.(report);
	}
	return module.spawn(options.file, options.args, {
		// The surface's own name, so a program that asks what terminal it is on gets
		// the pinned answer the window's TERM already declares (design 6.6).
		name: "xterm-256color",
		cols: options.cols,
		rows: options.rows,
		cwd: options.cwd,
		env: options.env,
	});
}
