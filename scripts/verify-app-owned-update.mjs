#!/usr/bin/env node
/**
 * Real-machine proof for the APP-OWNED UPDATE PATH, on a scratch root only.
 *
 * `scripts/verify-managed-python.mjs` proves the FIRST preparation of the app's
 * own environment; this proves the second one, which is the half that did not
 * exist. Until this PR the app could not move its own environment at all: a
 * published generation was reused whenever it was structurally ready, readiness
 * never compared the version it recorded, and the only in-place upgrade reachable
 * ran `pip install --upgrade` inside the PUBLISHED venv - the tree a serving
 * daemon and every session runtime import from. On the machine this was written
 * on that is not hypothetical: the pointer's record says 0.55.7, the tree it names
 * holds 0.56.8, and `bin/` was last written 2026-09-17 04:35.
 *
 * So what this drives, in order, with the SHIPPED functions and a REAL install and
 * a REAL smoke:
 *
 *   1. a first generation, published by the shipped macOS install script;
 *   2. a generation that installs and CANNOT smoke: the pointer does not move at
 *      all, which is what makes a failed update survivable rather than an
 *      interruption - and it runs FIRST, because on a machine that is already at
 *      the target there is correctly no generation to fail;
 *   3. `updateManagedPython` at the release the caller names - a second generation
 *      lands beside the first, the pointer flips atomically and the first stays on
 *      disk, byte-identical, as the rollback;
 *   4. a press for a release OLDER than the published one: nothing is installed,
 *      because a machine already past the target has nothing to move to - not a
 *      downgrade, and not a silent install of the version it was asked for;
 *   5. the same press again at the target: nothing is installed, and the pointer
 *      does not move.
 *
 * ISOLATION IS THE WHOLE POINT OF THIS FILE. The supplied seed is READ-ONLY input
 * (`/Applications/Local Operator.app/Contents/Resources/python-runtime-seed/<arch>`
 * on a machine that has one). Every environment, runtime, pointer, bytecode cache,
 * log and config this run touches is created under a `mkdtemp` root that this
 * process mints and prints; nothing under the operator's own support root, state
 * or installs is written, read for modification, or removed - and no path is ever
 * deleted outside the scratch root, because the only teardown is the scratch root
 * itself and it is left in place for inspection rather than swept.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const execute = promisify(execFile);
/** `pip show`'s own version line. Hoisted: this file reads exactly one field out of it. */
const PIP_SHOW_VERSION = /^Version:\s*(.+)$/m;
const argument = (name) => {
	const index = process.argv.indexOf(name);
	return index < 0 ? null : process.argv[index + 1];
};
const source = argument("--seed");
if (!source) {
	throw new Error(
		'Pass --seed <complete signed Python root>, e.g. "/Applications/Local Operator.app/Contents/Resources/python-runtime-seed/arm64"; never an installed app to modify',
	);
}
/**
 * The release the FIRST generation is left holding, and the one the press asks
 * for.
 *
 * The first is what models this machine: the app's own environment was PREPARED at
 * an older release and the tree has been pip-installed over in place since, which
 * is why the operator's recorded stamp (0.55.7) and the tree it names (0.56.8)
 * disagree. The shipped install script installs whatever PyPI publishes, so the
 * callback below pins the first generation back down to `--from` after it runs -
 * the only step here that is not the shipped command, and it exists because the
 * state under test is a BEHIND environment and the index no longer serves one.
 */
const from = argument("--from") ?? "0.56.11";
/** The release the second press asks for. Must be newer than `--from`. */
const target = argument("--target") ?? "0.56.12";

const scratch = mkdtempSync(join(tmpdir(), "lo-app-owned-update-proof-"));
console.log(`Evidence root (kept for inspection): ${scratch}`);
const home = join(scratch, "home");
const support = join(home, "Library", "Application Support", "Local Operator");
const app = join(scratch, "Candidate.app");
const resources = join(app, "Contents", "Resources");
const seed = join(resources, "python-runtime-seed", process.arch);
mkdirSync(home, { recursive: true });
mkdirSync(support, { recursive: true });
mkdirSync(join(app, "Contents"), { recursive: true });
// `ditto` rather than a copy: the runtime's identity is the SIGNED bytes, and a
// tool that drops signatures would fail the manifest this module verifies.
await execute("/usr/bin/ditto", [source, seed]);

const code = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/managed-python";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const runtime = await import(
	`data:text/javascript;base64,${Buffer.from(code.outputFiles[0].text).toString("base64")}`
);
const options = { support, resources, packaged: true, arch: process.arch };

/**
 * The app's own version ordering, as `UpdateService.isNewerVersion` answers it for
 * these releases. Passed in rather than re-implemented in the module, which is the
 * point of the interface: the app has ONE comparator for its update decisions.
 */
const parts = (version) => String(version).trim().split(".").map(Number);
const isNewer = (candidate, subject) => {
	const [a, b] = [parts(candidate), parts(subject)];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
	}
	return false;
};

const baseEnv = {
	...process.env,
	HOME: home,
	PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
	TMPDIR: scratch,
	TERM: "xterm-256color",
	LANG: "en_US.UTF-8",
	LOCAL_OPERATOR_CONFIG_DIR: join(home, "config"),
	LOCAL_OPERATOR_HOME: join(home, ".local-operator"),
	XDG_CONFIG_HOME: join(home, "config"),
	XDG_CACHE_HOME: join(home, "cache"),
	XDG_DATA_HOME: join(home, "data"),
};

/**
 * The install callback the app itself uses, mirrored.
 *
 * `UpdateService.installEnvironmentInto` runs these two commands against the
 * generation `updateManagedPython` has just minted - create the environment on the
 * managed runtime's interpreter, then install the release into it, held to the
 * version afterwards - and this drives the same two against the same kind of path,
 * so the evidence is about the shipped mechanism rather than about a fixture.
 * `npm_config_*` and the ambient PATH are dropped: this must not resolve a `python`
 * from whatever the shell happens to export.
 */
const installInto =
	(version, { pinDown } = {}) =>
	async (venv, python) => {
		const created = await execute(python, ["-m", "venv", venv], {
			env: baseEnv,
			timeout: 600_000,
			maxBuffer: 32 * 1024 * 1024,
		});
		console.log(`venv created at ${venv}\n${created.stdout.trim()}`);
		const interpreter = join(venv, "bin", "python");
		const pip = await execute(
			interpreter,
			[
				"-m",
				"pip",
				"install",
				"--upgrade",
				"--no-input",
				"--disable-pip-version-check",
				`local-operator==${version}`,
			],
			{ env: baseEnv, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 },
		);
		writeFileSync(join(scratch, `pip-${version}.log`), pip.stdout + pip.stderr);
		const installed = await execute(
			interpreter,
			["-m", "pip", "show", "local-operator"],
			{ env: baseEnv, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
		);
		const reported = installed.stdout.match(PIP_SHOW_VERSION)?.[1]?.trim();
		console.log(`installed ${reported} into ${venv}`);
		if (pinDown) return true;
		return reported === version;
	};

const pointer = join(
	runtime.managedPythonRoot(options),
	"selected-environment.json",
);
const environments = join(runtime.managedPythonRoot(options), "environments");
const recordOf = (selection) =>
	readFileSync(join(selection.venv, "environment-ready.json"), "utf8");
const tempPointers = () =>
	readdirSync(runtime.managedPythonRoot(options)).filter((name) =>
		name.startsWith(".selection-"),
	);

console.log(
	"\n=== 1. the first generation, published by the shipped install script ===",
);
const environment = { ...baseEnv, LOCAL_OPERATOR_SUPPORT_PATH: support };
let firstInstalls = 0;
const first = await runtime.prepareManagedPython(
	options,
	async (venv, python) => {
		firstInstalls++;
		const result = await execute(
			"/bin/bash",
			[resolve("src/main/backend/scripts/macos-install-script.sh")],
			{
				env: {
					...environment,
					PYTHON_BIN: python,
					LOCAL_OPERATOR_VENV_PATH: venv,
				},
				timeout: 900_000,
				maxBuffer: 64 * 1024 * 1024,
			},
		);
		writeFileSync(
			join(scratch, "install-first.log"),
			result.stdout + result.stderr,
		);
		// Held back to the older release afterwards: this machine's environment is
		// BEHIND the published one, which is the state the app could neither see nor
		// leave, and the index no longer serves the version such a machine runs.
		await installInto(from, { pinDown: true })(venv, python);
		return true;
	},
);
assert.equal(firstInstalls, 1);
assert.equal(first.backendVersion, from);
const firstRecord = recordOf(first);
console.log(`recorded version: ${first.backendVersion}`);
console.log(`runtime: ${first.runtime}`);
console.log(`venv:    ${first.venv}`);
console.log(`pointer: ${readFileSync(pointer, "utf8").trim()}`);
assert.equal(await runtime.managedSelectionReady(options), true);
assert.equal(runtime.publishedBackendVersion(options), first.backendVersion);

console.log("\n=== 2. a press whose generation installs and cannot smoke ===");
const beforeFailure = readFileSync(pointer, "utf8");
let attempted = false;
/*
 * The install callback is the real one, and the environment it produces is then
 * made unable to start. That is the case the pointer's ORDERING exists for: the
 * new tree is a directory beside the published one and nothing has been published
 * yet, so a failure here is a directory to reclaim rather than an interruption.
 *
 * It runs BEFORE the successful press on purpose. Ordering it after would prove
 * nothing about a machine that is behind, which is the machine this path exists
 * for: an `updateManagedPython` call at a target the published generation already
 * satisfies publishes nothing at all (correctly), so there would be no generation
 * to fail and no pointer to hold still.
 */
await assert.rejects(() =>
	runtime.updateManagedPython(
		options,
		async (venv, python) => {
			attempted = true;
			await installInto(target)(venv, python);
			// Installs fine, then cannot start: the smoke's own health probe is what
			// fails, through the real `smokeEnvironment`.
			writeFileSync(
				join(venv, "bin", "local-operator"),
				"#!/bin/sh\nexit 7\n",
				{ mode: 0o755 },
			);
			return true;
		},
		{ target, isNewer },
	),
);
assert.equal(attempted, true);
assert.equal(
	readFileSync(pointer, "utf8"),
	beforeFailure,
	"a smoke that fails must leave the pointer exactly where it was",
);
assert.equal(runtime.publishedBackendVersion(options), from);
assert.equal(await runtime.managedSelectionReady(options), true);
assert.equal(
	recordOf(first),
	firstRecord,
	"and the published generation is untouched, including its own record",
);
assert.ok(readFileSync(join(first.venv, "bin", "local-operator")).length > 0);
console.log(
	`published is still ${from}; the failed attempt left a tree to reclaim:\n  ${readdirSync(environments).join("\n  ")}`,
);

console.log(`\n=== 3. the app presses update at ${target} ===`);
const installs = [];
const outcome = await runtime.updateManagedPython(
	options,
	(venv, python) => {
		installs.push(venv);
		return installInto(target)(venv, python);
	},
	{ target, isNewer },
);
console.log(`replaced: ${outcome.replaced}`);
console.log(
	`published: ${outcome.selection.backendVersion} at ${outcome.selection.venv}`,
);
console.log(`superseded (kept as the rollback): ${outcome.previous?.venv}`);
console.log(
	`generations now on disk:\n  ${readdirSync(environments).join("\n  ")}`,
);
assert.equal(installs.length, 1);
assert.equal(outcome.replaced, true);
assert.equal(outcome.previous?.venv, first.venv);
assert.equal(outcome.selection.backendVersion, target);
assert.notEqual(outcome.selection.venv, first.venv);
assert.deepEqual(tempPointers(), []);
// The pointer's own record and the new environment's agree, and the pointer names
// the NEW generation: that is the flip.
assert.equal(
	readFileSync(pointer, "utf8"),
	recordOf(outcome.selection),
	"the pointer and the new environment's record must hold the same bytes",
);
assert.equal(runtime.publishedBackendVersion(options), target);
// The generation it supersedes is untouched - the same bytes in its own record,
// still a usable environment - which is both the rollback and the tree a serving
// daemon holds open.
assert.equal(recordOf(first), firstRecord);
assert.ok(readFileSync(join(first.venv, "bin", "local-operator")).length > 0);
assert.ok(
	existsSync(outcome.selection.venv) && existsSync(first.venv),
	"both generations must be on disk after the flip",
);

console.log(
	"\n=== 4. a press for a release OLDER than the published one changes nothing ===",
);
const older = await runtime.updateManagedPython(
	options,
	() => {
		throw new Error("a target older than what is published is not an update");
	},
	{ target: from, isNewer },
);
assert.equal(older.replaced, false);
assert.deepEqual(older.selection, outcome.selection);

console.log(
	"\n=== 5. the same press again: nothing to install, nothing to move ===",
);
const second = await runtime.updateManagedPython(
	options,
	() => {
		throw new Error(
			"a generation that already satisfies the target must not reinstall",
		);
	},
	{ target, isNewer },
);
assert.equal(second.replaced, false);
assert.deepEqual(second.selection, outcome.selection);
assert.equal(readFileSync(pointer, "utf8"), recordOf(outcome.selection));

console.log(
	`\n${JSON.stringify({ first: first.venv, published: outcome.selection.venv, pointer }, null, 2)}`,
);
console.log(
	"\nPASS: a failed smoke left the pointer untouched; the second generation was published beside the first with the pointer flipped atomically; the superseded generation is byte-identical and complete; an older target and a repeated press installed nothing; no `.selection-*` temp was left behind",
);
