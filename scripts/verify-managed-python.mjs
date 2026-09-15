#!/usr/bin/env node
/** Local/native runtime proof only, NOT a signed installed-app update claim.
 * The supplied seed is read-only input. Every execution, venv, bytecode cache,
 * support/config file and log lives in a fresh scratch root printed below.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
const execute = promisify(execFile);
const seedArgument = process.argv.indexOf("--seed");
if (seedArgument < 0) throw new Error("Pass --seed <complete signed Python root>; never an installed app to modify");
const source = resolve(process.argv[seedArgument + 1]);
const scratch = mkdtempSync(join(tmpdir(), "lo174-runtime-proof-"));
console.log(`Evidence: ${scratch}`);
const home = join(scratch, "home"); mkdirSync(home);
const support = join(home, "Library", "Application Support", "Local Operator"); mkdirSync(support, { recursive: true });
const app = join(scratch, "Candidate.app");
const resources = join(app, "Contents", "Resources");
const seed = join(resources, "python-runtime-seed", process.arch);
await execute("/usr/bin/ditto", [source, seed]);
const env = { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TMPDIR: scratch, TERM: "xterm-256color", LANG: "en_US.UTF-8" };
const code = await build({ stdin: { contents: 'export * from "./src/main/backend/managed-python";', resolveDir: process.cwd() }, bundle: true, platform: "node", format: "esm", write: false });
const runtime = await import(`data:text/javascript;base64,${Buffer.from(code.outputFiles[0].text).toString("base64")}`);
const options = { support, resources, packaged: true, arch: process.arch };
const before = runtime.runtimeId(runtime.runtimeManifest(seed, process.arch));
const legacy = join(support, "local-operator-venv"); mkdirSync(legacy);
writeFileSync(join(legacy, "user-owned.txt"), "preserve legacy bytes\n");
let installs = 0;
const selection = await runtime.prepareManagedPython(options, async (venv, python) => {
	installs++;
	console.log(`Actual shipped script: python=${python} venv=${venv}`);
	const installEnv = { ...env, PYTHON_BIN: python, LOCAL_OPERATOR_VENV_PATH: venv, LOCAL_OPERATOR_SUPPORT_PATH: support, LOCAL_OPERATOR_CONFIG_DIR: join(home, "config"), LOCAL_OPERATOR_HOME: join(home, ".local-operator") };
	try {
		const result = await execute("/bin/bash", [resolve("src/main/backend/scripts/macos-install-script.sh")], { env: installEnv, timeout: 900_000, maxBuffer: 32 * 1024 * 1024 });
		writeFileSync(join(scratch, "install.log"), result.stdout + result.stderr);
		return true;
	} catch (error) {
		writeFileSync(join(scratch, "install.log"), `${error.stdout ?? ""}\n${error.stderr ?? ""}\n${error.message}`);
		throw error;
	}
});
assert.equal(installs, 1);
assert.equal(runtime.runtimeId(runtime.runtimeManifest(seed, process.arch)), before);
assert.equal(readFileSync(join(legacy, "user-owned.txt"), "utf8"), "preserve legacy bytes\n");
assert.equal(await runtime.managedSelectionReady(options), true);
const repeated = await Promise.all([runtime.prepareManagedPython(options, () => { throw new Error("Reuse must not reinstall"); }), runtime.prepareManagedPython(options, () => { throw new Error("Concurrent reuse must not reinstall"); })]);
assert.deepEqual(repeated, [selection, selection]);
renameSync(app, join(scratch, "source-namespace-unavailable"));
const probe = "import os,sys,sysconfig,encodings,webbrowser,_ssl,_sqlite3,json; p=[sys._base_executable,sys.base_prefix,sysconfig.get_path('stdlib'),encodings.__file__,webbrowser.__file__]+sys.path; assert all('.app/' not in os.path.realpath(x).lower() for x in p if x),p; print(json.dumps(p))";
for (const flag of ["-E", "-I"]) {
	const response = await execute(join(selection.venv, "bin", "python"), [flag, "-c", probe], { env, timeout: 30_000 });
	console.log(`${flag}: ${response.stdout.trim()}`);
}
// The source namespace is restored only for readiness validation; uncontrolled
// imports above were allowed to create harmless caches in the external runtime.
renameSync(join(scratch, "source-namespace-unavailable"), app);
assert.equal(await runtime.managedSelectionReady(options), true);
writeFileSync(join(scratch, "selection.json"), JSON.stringify(selection, null, 2));
console.log("PASS actual shipped install; backend health; selected final paths; source namespace unavailable; -E/-I imports; cache-tolerant signed reuse; concurrent reuse; legacy bytes preserved");
