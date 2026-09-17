#!/usr/bin/env node
/**
 * Assert that the packaged app carries every package its runtime dependencies
 * resolve to.
 *
 * Why this exists: what electron-builder copies into `app.asar/node_modules` is
 * computed from the *installer's* view of the dependency tree, not the app's. On
 * pnpm 10.29.3+ that view is wrong - `pnpm list --prod --json --depth Infinity`
 * loses dependency edges, so a package that resolves fine in `node_modules` is
 * simply not copied, and the packaged app dies at launch with
 * `Cannot find module '...'` while every build log looks healthy (pnpm/pnpm#10601;
 * the measurements and the current pin are in AGENTS.md, "Which pnpm may install
 * and package"). `check-runtime-deps.mjs` guards *which* packages may be declared;
 * this guards whether the declared closure actually made it into the artefact,
 * which is the half the manifest cannot express.
 *
 * How: resolve the production closure from `package.json` the way Node does
 * (each package's own `dependencies` + `optionalDependencies`, resolved from that
 * package's directory), enumerate the packages present in the produced
 * `app.asar`, and fail on anything in the first set that is missing from the
 * second. It reads no Electron, needs no display, and runs on any runner.
 *
 * Usage: node scripts/check-packaged-closure.mjs [--dist <dir>] [--asar <path>] [--manifest <path>] [--root <dir>]
 */
import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntryPoint } from "./entry-point.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `app.asar` under `dir`, so macOS/Windows/Linux layouts all work. */
function findAsarArchives(dir, found = []) {
	if (!existsSync(dir)) return found;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) findAsarArchives(path, found);
		else if (entry.isFile() && entry.name === "app.asar") found.push(path);
	}
	return found;
}

/**
 * Package names inside an asar, flattened. electron-builder writes a hoisted
 * `node_modules`, but nested `node_modules` appear when two versions of a
 * package are in play, so every level is walked.
 */
export function asarPackages(asarPath) {
	const fd = openSync(asarPath, "r");
	const prefix = Buffer.alloc(16);
	readSync(fd, prefix, 0, 16, 0);
	let header = null;
	// asar 3.x puts the header JSON length at offset 12; the neighbouring words
	// are pickle bookkeeping, so the length is corroborated by parsing.
	for (const lengthAt of [12, 4, 8]) {
		const length = prefix.readUInt32LE(lengthAt);
		const buf = Buffer.alloc(length);
		readSync(fd, buf, 0, length, 16);
		try {
			header = JSON.parse(buf.toString("utf8").replace(/\0+$/, ""));
			break;
		} catch {
			header = null;
		}
	}
	closeSync(fd);
	if (!header)
		throw new Error(`could not parse the asar header of ${asarPath}`);

	const packages = new Set();
	const walk = (node, inNodeModules, scope) => {
		for (const [name, child] of Object.entries(node.files ?? {})) {
			if (!child.files) continue;
			if (name === "node_modules") {
				walk(child, true, null);
				continue;
			}
			if (!inNodeModules) {
				walk(child, false, null);
				continue;
			}
			if (child.files["package.json"]) {
				packages.add(scope ? `${scope}/${name}` : name);
				// A package can carry its own nested dependencies.
				walk(child, false, null);
			} else if (name.startsWith("@")) {
				walk(child, true, name);
			}
		}
	};
	walk(header, false, null);
	return packages;
}

/**
 * The production closure of `manifestPath`, resolved from `rootDir` the way
 * Node resolves it at runtime: a package's own dependencies are resolved from
 * that package's directory, which is what makes pnpm's linked layout work - a
 * transitive dependency is not resolvable from the repository root, only from
 * the package that declares it. `rootDir`, not the manifest's directory, is the
 * resolution base for the same reason: the manifest may be a fixture.
 */
export function productionClosure(
	manifestPath,
	rootDir = dirname(manifestPath),
) {
	const closure = new Map();
	const unresolved = [];

	function locate(name, fromDir) {
		// A require rooted at the containing package: pnpm installs a package's
		// dependencies beside it, not at the top level, so this is the only
		// resolution base that finds them.
		const req = createRequire(join(fromDir, "package.json"));
		try {
			return dirname(req.resolve(`${name}/package.json`));
		} catch {
			// Some packages do not export their own package.json.
		}
		try {
			let dir = req.resolve(name);
			while (dir !== dirname(dir)) {
				if (existsSync(join(dir, "package.json"))) return dir;
				dir = dirname(dir);
			}
		} catch {
			// fall through to the unresolved report
		}
		return null;
	}

	function walk(name, fromDir) {
		const dir = locate(name, fromDir);
		if (!dir) {
			unresolved.push(name);
			return;
		}
		let meta;
		try {
			meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		} catch {
			unresolved.push(name);
			return;
		}
		if (closure.has(meta.name)) return;
		closure.set(meta.name, meta.version);
		for (const dependency of [
			...Object.keys(meta.dependencies ?? {}),
			...Object.keys(meta.optionalDependencies ?? {}),
		]) {
			walk(dependency, dir);
		}
	}

	const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
	const declared = Object.keys(pkg.dependencies ?? {});
	for (const name of declared) walk(name, rootDir);
	return { closure, unresolved, declared };
}

/**
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function checkPackagedClosure({ asarPath, manifestPath, rootDir }) {
	const { closure, unresolved, declared } = productionClosure(
		manifestPath,
		rootDir,
	);
	const shipped = asarPackages(asarPath);
	const missing = [...closure.entries()].filter(([name]) => !shipped.has(name));

	const lines = [
		`check-packaged-closure: ${asarPath}`,
		`  production closure: ${closure.size} package(s) from ${declared.length} declared dependencies`,
		`  shipped in app.asar: ${shipped.size} package(s)`,
	];
	for (const name of unresolved)
		lines.push(`  note: ${name} could not be resolved locally`);

	// A closure smaller than the declared list, or an asar with no node_modules
	// at all, means this check is measuring nothing - the same vacuous pass the
	// runtime-dependency guard refuses.
	if (
		declared.length === 0 ||
		closure.size < declared.length ||
		shipped.size === 0
	) {
		return {
			ok: false,
			lines: [
				...lines,
				"  FAIL: nothing to verify - the closure or the packaged node_modules is empty,\n" +
					"    so a pass here would not be a statement about the artefact.",
			],
		};
	}

	if (missing.length > 0) {
		return {
			ok: false,
			lines: [
				...lines,
				`  FAIL: ${missing.length} resolved package(s) are missing from app.asar:`,
				...missing.map(([name, version]) => `    - ${name}@${version}`),
				"    The app would fail to load them at runtime. This is the shape of the",
				"    pnpm >= 10.29.3 packaging regression: see AGENTS.md, 'Which pnpm may",
				"    install and package'.",
			],
		};
	}

	return {
		ok: true,
		lines: [...lines, "  OK: every resolved production dependency is present"],
	};
}

function main(argv) {
	const option = (name, fallback) => {
		const index = argv.indexOf(name);
		return index === -1 ? fallback : argv[index + 1];
	};
	const manifestPath = resolve(
		option("--manifest", join(repoRoot, "package.json")),
	);
	// The manifest supplies the dependency list; the root supplies the
	// node_modules the closure is resolved in, so a fixture manifest can be
	// checked against the real install.
	const rootDir = resolve(option("--root", repoRoot));
	const explicitAsar = option("--asar", null);
	let asarPath = explicitAsar ? resolve(explicitAsar) : null;

	if (!asarPath) {
		const dist = resolve(option("--dist", join(repoRoot, "dist")));
		const found = findAsarArchives(dist);
		if (found.length === 0) {
			console.error(
				`check-packaged-closure: no app.asar under ${dist}
    There is nothing to verify yet, so this step cannot pass: run the
    packaging command for this platform first.`,
			);
			return 1;
		}
		asarPath = found[0];
		if (found.length > 1) {
			console.log(
				`check-packaged-closure: ${found.length} asar archives found, checking ${asarPath}`,
			);
		}
	}

	if (!statSync(asarPath).isFile()) {
		console.error(`check-packaged-closure: ${asarPath} is not a file`);
		return 2;
	}

	const report = checkPackagedClosure({ asarPath, manifestPath, rootDir });
	for (const line of report.lines) {
		if (report.ok) console.log(line);
		else console.error(line);
	}
	return report.ok ? 0 : 1;
}

if (isEntryPoint(import.meta.url)) {
	process.exit(main(process.argv.slice(2)));
}
