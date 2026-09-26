#!/usr/bin/env node
/**
 * Assert that a packed Windows or Linux app carries the bundled `uv` tool its
 * own platform and architecture resolve, and only that one's tree.
 *
 * WHY THIS EXISTS. `uv` is a third-party binary this repository ships inside its
 * artifacts, and on these two platforms every way it can go missing is silent:
 * the staging step does not run (build succeeds, the copy list skips a missing
 * source, and every user's first install quietly reverts to the slower pip path),
 * the `extraResources` copy is dropped in a config edit, or the prune keeps the
 * off-architecture tree. The macOS release gate has carried this assertion since
 * uv was bundled there (`bundledUvToolCheck`, `python-artifact-layout.mjs`); this
 * is the same statement for the two platforms that ship uv now, run in their
 * build jobs on the unpacked output electron-builder leaves behind.
 *
 * WHAT IT DOES NOT CLAIM. Not that the binary RUNS on the release runner: the
 * staging step already executed the host-runnable architecture and asserted its
 * version, and the other architecture's identity is the sha256 its stager
 * verified. Not that the bytes are the upstream release's either - that is the
 * staging step's check, against the release's published `.sha256`, and repeating
 * it here would be a second copy of the pin. This is the artifact-side half: the
 * tree survived packaging, is the one this build's machine can execute, and is a
 * plain executable file rather than a link, a directory, or an empty name.
 *
 * Usage: node scripts/verify-bundled-uv.mjs --dist <dir> --platform <win32|linux> [--arch <x64|arm64>]
 */
import { lstatSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
	UV_NAMESPACE,
	uvBinaryName,
	uvResourceDir,
} from "./bundled-runtime-layout.mjs";
import { isEntryPoint } from "./entry-point.mjs";

/**
 * The unpacked-app directory prefixes electron-builder writes for a platform.
 *
 * `win-unpacked` is the x64 (default-architecture) one and `win-arm64-unpacked`
 * its arm64 sibling; Linux follows the same `<prefix>-<arch>-unpacked` /
 * `<prefix>-unpacked` pattern. The walk below matches by PREFIX and derives the
 * architecture from the directory's own name, so a directory spelling this
 * module has not seen is inspected rather than skipped - the failure worth
 * catching here is one where the artifact exists and nothing checked it.
 */
const PLATFORM_PREFIX = {
	win32: "win",
	linux: "linux",
};

/** The Arch name a `<prefix>[-<arch>]-unpacked` directory carries.
 *
 * `x64` for a name with no architecture segment, and that default is read from
 * electron-builder's own naming rather than guessed: `getAppOutDir` joins
 * `${buildConfigurationKey}${getArchSuffix(arch, defaultArch)}-unpacked`, and
 * `getArchSuffix` emits NO suffix when the arch is the default, which
 * `defaultArchFromString(undefined)` resolves to `x64` (measured against the
 * pinned electron-builder's `out/arch.js`). A directory spelling this check has
 * not seen still derives its own answer rather than defaulting to a pass. */
export function unpackedDirArch(name) {
	const match = /-([a-z0-9]+)-unpacked$/.exec(name);
	return match ? match[1] : "x64";
}

/**
 * Every unpacked-app directory for a platform under `distDir`.
 *
 * Returns absolute paths. A missing `dist` directory is an empty list, which the
 * caller turns into a failure with its own message (a run against the wrong
 * directory must not pass by having found nothing to complain about).
 */
export function findUnpackedDirs(distDir, platform) {
	const prefix = PLATFORM_PREFIX[platform];
	if (!prefix)
		throw new Error(
			`verify-bundled-uv: platform "${platform}" is not one this check knows; expected one of ${Object.keys(PLATFORM_PREFIX).join(", ")}`,
		);
	let entries;
	try {
		entries = readdirSync(distDir, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.filter(
			(entry) =>
				entry.isDirectory() &&
				entry.name.startsWith(`${prefix}-`) &&
				entry.name.endsWith("-unpacked"),
		)
		.map((entry) => join(distDir, entry.name))
		.sort();
}

/**
 * Check one unpacked app directory, returning its asserted path or throwing.
 *
 * The rules mirror `bundledUvToolCheck`'s, one platform over: exactly ONE
 * architecture tree (the prune ran and kept the right one), the binary is a
 * plain file - not a link, not a directory, not a hardlink - carries content,
 * and where the platform has an execute bit it must be set, because a ZIP drops
 * modes and this is the artifact that ships.
 */
export function checkUnpackedUv(appDir, { platform, expectedArch = null }) {
	const resources = join(appDir, "resources");
	const uvRoot = join(resources, UV_NAMESPACE);
	let names;
	try {
		names = readdirSync(uvRoot).filter(
			(name) => name === "x64" || name === "arm64",
		);
	} catch {
		throw new Error(
			`No resources/${UV_NAMESPACE} directory under ${appDir}: this artifact ships no uv, so every install falls back to pip`,
		);
	}
	if (names.length !== 1)
		throw new Error(
			`Expected one architecture-specific bundled uv under ${uvRoot}, found ${names.length === 0 ? "none" : names.join(", ")}`,
		);
	const arch = names[0];
	if (expectedArch != null && arch !== expectedArch)
		throw new Error(
			`${appDir} carries the ${arch} uv but its own name says ${expectedArch}; the app inside it runs on a machine this artifact was not built for`,
		);
	const binary = join(uvRoot, arch, uvBinaryName(platform));
	let stat;
	try {
		stat = lstatSync(binary);
	} catch {
		throw new Error(
			`The ${arch} uv directory ships no ${uvBinaryName(platform)} binary: ${binary} is missing`,
		);
	}
	if (!stat.isFile() || stat.nlink !== 1)
		throw new Error(
			`The bundled uv is not a plain file (a link, hardlink or special file cannot be executed): ${binary}`,
		);
	if (statSync(binary).size === 0)
		throw new Error(`The bundled uv is empty: ${binary}`);
	if (platform !== "win32" && (stat.mode & 0o111) === 0)
		throw new Error(
			`The bundled uv carries no execute bit, so no install can run it: ${binary}`,
		);
	return `${binary} is the ${arch} uv this app runs`;
}

function main(argv) {
	const args = { dist: "dist", platform: process.platform, arch: null };
	for (let index = 0; index < argv.length; index += 1) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--dist" && value) args.dist = value;
		else if (flag === "--platform" && value) args.platform = value;
		else if (flag === "--arch" && value) args.arch = value;
		else
			throw new Error(
				`verify-bundled-uv: unknown argument "${flag}". Usage: node scripts/verify-bundled-uv.mjs --dist <dir> --platform <win32|linux> [--arch <x64|arm64>]`,
			);
		index += 1;
	}
	const dirs = findUnpackedDirs(args.dist, args.platform);
	if (dirs.length === 0)
		throw new Error(
			`verify-bundled-uv: no ${PLATFORM_PREFIX[args.platform]}-*-unpacked directory under ${args.dist}. The check cannot pass on a directory tree it found nothing in.`,
		);
	for (const dir of dirs) {
		const expectedArch = args.arch ?? unpackedDirArch(basename(dir));
		const result = checkUnpackedUv(dir, {
			platform: args.platform,
			expectedArch,
		});
		console.log(`verify-bundled-uv: ${result}`);
	}
	console.log(
		`OK: ${dirs.length} unpacked app director${dirs.length === 1 ? "y" : "ies"} carries the uv its machine runs.`,
	);
}

if (isEntryPoint(import.meta.url)) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
