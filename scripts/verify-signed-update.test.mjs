import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LAYOUT as layout } from "./bundled-runtime-layout.mjs";
import {
	assertNoLegacyNamespaces,
	hashPreSplitVenv,
	makePreSplitVenvInert,
	resolveIncumbentRuntime,
} from "./incumbent-runtime.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

// Published legacy bundles predate checkoutSeedNames. Keep their paths
// independent so a manifest swap cannot move the fixture with the resolver.
const historicalLegacy = { arm64: "python_aarch64", x64: "python" };

function fixture(t, arch = "arm64") {
	const root = mkdtempSync(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"signed-update-test-",
		),
	);
	t.after(() => rmSync(root, { recursive: true }));
	const app = join(root, "Local Operator.app");
	const resources = join(app, "Contents", "Resources");
	return {
		root,
		app,
		resources,
		arch,
		legacy: join(resources, historicalLegacy[arch], "bin", "python3"),
		seed: join(resources, layout.python.seedNamespace, arch, "bin", "python3"),
	};
}

function installInterpreter(path) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
}

test("seed-only incumbent resolves an existing interpreter", (t) => {
	const { app, arch, legacy, seed } = fixture(t);
	installInterpreter(seed);
	assert.equal(existsSync(legacy), false);
	const runtime = resolveIncumbentRuntime(app, arch);
	assert.equal(existsSync(runtime.interpreter), true);
	assert.deepEqual(runtime, {
		kind: "seed",
		interpreter: seed,
		legacyInterpreter: legacy,
	});
});

test("legacy-only incumbents resolve only their historical architecture path", (t) => {
	for (const arch of ["arm64", "x64"]) {
		const { app, resources, legacy, seed } = fixture(t, arch);
		const otherArch = arch === "arm64" ? "x64" : "arm64";
		installInterpreter(
			join(resources, historicalLegacy[otherArch], "bin", "python3"),
		);
		assert.throws(
			() => resolveIncumbentRuntime(app, arch),
			(error) => {
				assert.deepEqual(error.message.split("\n").slice(1), [legacy, seed]);
				return true;
			},
		);
		installInterpreter(legacy);
		assert.deepEqual(resolveIncumbentRuntime(app, arch), {
			kind: "legacy",
			interpreter: legacy,
			legacyInterpreter: legacy,
		});
	}
});

test("legacy wins if both exist, preserving the real across-swap consumer", (t) => {
	const { app, arch, legacy, seed } = fixture(t);
	installInterpreter(legacy);
	installInterpreter(seed);
	assert.equal(resolveIncumbentRuntime(app, arch).interpreter, legacy);
});

test("missing incumbent runtime exits 1 with the verifier's FAIL record and all probes", (t) => {
	const { app, arch, legacy, seed } = fixture(t);
	const manifest = fileURLToPath(
		new URL("../src/shared/bundled-runtime-layout.json", import.meta.url),
	);
	const expectedDetail = (message) =>
		[manifest, legacy, seed].every((path) => message.includes(path));
	assert.throws(
		() => resolveIncumbentRuntime(app, arch),
		(error) => expectedDetail(error.message),
	);
	// Run the same failure handler the VM entry point uses, without emulating the
	// hosted VM or running the gated entry point on the operator's machine.
	const moduleUrl = new URL("./incumbent-runtime.mjs", import.meta.url);
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
		import { recordSignedUpdateFailure, resolveIncumbentRuntime } from ${JSON.stringify(moduleUrl.href)};
		try {
			resolveIncumbentRuntime(process.argv[1], process.argv[2]);
		} catch (error) {
			process.exitCode = recordSignedUpdateFailure(error, (surface, verdict, actual) => {
				console.log(JSON.stringify({ surface, verdict, actual }));
			});
		}
	`,
			app,
			arch,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 1, result.stderr);
	const row = JSON.parse(result.stdout);
	assert.equal(row.surface, "Exact signed update");
	assert.equal(row.verdict, "FAIL");
	assert.ok(expectedDetail(row.actual), row.actual);
});

test(
	"reconstructed pre-split venv is inert and its tree hash detects mutations",
	{
		skip:
			process.platform === "win32" &&
			"macOS fixture requires POSIX venv paths and symlinks",
	},
	(t) => {
		const { root, legacy, seed } = fixture(t);
		const venv = join(root, "Application Support", "local-operator-venv");
		// Create actual CPython config and links. Use the test host Python, not a
		// staged bundle, to exercise the reconstruction without a signed artifact.
		// The host python is a real interpreter, so it gets a stated environment
		// rather than the ambient one: an inherited PYTHONPYCACHEPREFIX/PYTHONHOME
		// would decide where `venv` writes bytecode or which stdlib it builds from
		// (see scripts/python-child-env.mjs for the incident behind the rule).
		execFileSync("python3", ["-B", "-m", "venv", "--without-pip", venv], {
			env: pythonChildEnv(),
		});
		makePreSplitVenvInert(venv, legacy);
		const config = join(venv, "pyvenv.cfg");
		const fields = readFileSync(config, "utf8").split("\n");
		assert.ok(fields.includes(`home = ${dirname(legacy)}`));
		assert.ok(fields.includes(`executable = ${legacy}`));
		assert.ok(fields.includes(`command = ${legacy} -m venv ${venv}`));
		const bin = join(venv, "bin");
		const pythonLinks = readdirSync(bin).filter((name) =>
			name.startsWith("python"),
		);
		assert.ok(pythonLinks.includes("python3"));
		for (const name of pythonLinks)
			assert.equal(readlinkSync(join(bin, name)), legacy);
		// A new bundle may repopulate the same seed path; it cannot revive this venv.
		installInterpreter(seed);
		const originalHash = hashPreSplitVenv(venv);
		// Expected to fail with ENOENT (the inert venv's links dangle), but if the
		// inerting ever regressed this WOULD start a real interpreter, so it states
		// its environment like any other python spawn.
		const launch = spawnSync(
			join(bin, "python3"),
			["-I", "-c", "import webbrowser"],
			{ env: pythonChildEnv() },
		);
		assert.equal(launch.error?.code, "ENOENT");
		assert.equal(hashPreSplitVenv(venv), originalHash);
		appendFileSync(config, "# candidate mutation\n");
		assert.notEqual(hashPreSplitVenv(venv), originalHash);
	},
);

test("candidate namespace check rejects each legacy resource name", (t) => {
	const { app, resources, seed } = fixture(t);
	installInterpreter(seed);
	assert.doesNotThrow(() => assertNoLegacyNamespaces(app));
	for (const name of layout.legacyResourceNames) {
		const namespace = join(resources, name);
		mkdirSync(namespace);
		assert.throws(
			() => assertNoLegacyNamespaces(app),
			(error) => error.message.includes(namespace),
		);
		rmSync(namespace, { recursive: true });
	}
});
