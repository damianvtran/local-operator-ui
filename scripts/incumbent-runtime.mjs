import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	existsSync,
	lstatSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYOUT as layout } from "./bundled-runtime-layout.mjs";

const manifestPath = fileURLToPath(
	new URL("../src/shared/bundled-runtime-layout.json", import.meta.url),
);
const appResources = (app) => resolve(app, "Contents", "Resources");
const pythonLink = /^python(?:\d+(?:\.\d+)?)?$/;

export function resolveIncumbentRuntime(app, arch) {
	const resources = appResources(app);
	const legacyName = layout.python.checkoutSeedNames[arch];
	assert.ok(
		layout.architectures.includes(arch) &&
			layout.legacyResourceNames.includes(legacyName),
		`No legacy Python resource name for architecture ${arch} in ${manifestPath}`,
	);
	const legacyInterpreter = join(resources, legacyName, "bin", "python3");
	const seedInterpreter = join(
		resources,
		layout.python.seedNamespace,
		arch,
		"bin",
		"python3",
	);
	// Prefer legacy if both exist: only this path exercises a real consumer losing
	// its original interpreter/stdlib in the interval before candidate launch.
	if (existsSync(legacyInterpreter))
		return {
			kind: "legacy",
			interpreter: legacyInterpreter,
			legacyInterpreter,
		};
	if (existsSync(seedInterpreter))
		return { kind: "seed", interpreter: seedInterpreter, legacyInterpreter };
	throw new Error(
		`No incumbent Python interpreter for ${arch}; probed these paths from ${manifestPath}:\n${legacyInterpreter}\n${seedInterpreter}`,
	);
}

export function makePreSplitVenvInert(venv, legacyInterpreter) {
	assert.equal(
		existsSync(legacyInterpreter),
		false,
		"Pre-split interpreter must already be absent",
	);
	// Match the in-app references in docs/evidence/update-robustness/self-seal.txt,
	// pointing at the old namespace in the *disposable* app, not /Applications.
	// Leaving even one seed reference usable would model a different environment:
	// the incoming bundle can repopulate the exact same seed path after the swap.
	const config = join(venv, "pyvenv.cfg");
	const fields = {
		home: dirname(legacyInterpreter),
		executable: legacyInterpreter,
		command: `${legacyInterpreter} -m venv ${venv}`,
	};
	let contents = readFileSync(config, "utf8");
	for (const [key, value] of Object.entries(fields)) {
		const pattern = new RegExp(`^${key} = .*$`, "m");
		assert.match(contents, pattern, `Python venv must declare ${key}`);
		contents = contents.replace(pattern, () => `${key} = ${value}`);
	}
	const bin = join(venv, "bin");
	const links = readdirSync(bin).filter((name) => pythonLink.test(name));
	assert.ok(links.includes("python3"), "Python venv must have bin/python3");
	for (const name of links) {
		const path = join(bin, name);
		assert.ok(
			lstatSync(path).isSymbolicLink(),
			`Expected a Python venv symlink: ${path}`,
		);
		unlinkSync(path);
		symlinkSync(legacyInterpreter, path);
	}
	writeFileSync(config, contents);
}

export function assertNoLegacyNamespaces(app) {
	for (const name of layout.legacyResourceNames) {
		const path = join(appResources(app), name);
		// A dangling namespace link is still an unexpected bundle entry.
		assert.equal(
			lstatSync(path, { throwIfNoEntry: false }),
			undefined,
			`Candidate ships legacy Python namespace: ${path}`,
		);
	}
}

export function hashPreSplitVenv(venv) {
	const hash = createHash("sha256");
	function visit(relative) {
		const path = join(venv, relative);
		const stat = lstatSync(path);
		// Include paths, modes, bytes, and link targets, never following dangling
		// links out into the app. Ignore timestamps: they aren't file contents.
		let payload;
		if (stat.isSymbolicLink()) payload = readlinkSync(path);
		else if (stat.isFile())
			payload = createHash("sha256").update(readFileSync(path)).digest("hex");
		else
			assert.ok(stat.isDirectory(), `Unexpected pre-split venv entry: ${path}`);
		hash.update(JSON.stringify([relative, stat.mode, payload]));
		if (stat.isDirectory())
			for (const name of readdirSync(path).sort()) visit(join(relative, name));
	}
	visit("");
	return hash.digest("hex");
}

export function recordSignedUpdateFailure(error, record) {
	// BLOCKED is reserved for already-recorded capability refusals. A broken
	// incumbent fixture (including a missing runtime) belongs in FAIL evidence.
	if (error.blocked) return 2;
	record("Exact signed update", "FAIL", error.stack ?? String(error));
	return 1;
}
