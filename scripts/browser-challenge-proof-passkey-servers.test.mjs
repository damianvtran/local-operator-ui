import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * A FAILED passkey attempt must not leave its loopback listeners behind.
 *
 * WHY THIS IS A CHILD PROCESS AND NOT A SOURCE GUARD. The passkey arm of
 * scripts/browser-challenge-proof.mjs is the one arm that opens listening
 * servers of its own; main()'s outer `servers` variable is deliberately null
 * for it, so nothing above it can close them. A throw between the second
 * `listen` and the attempt's success return therefore left Node holding two
 * referenced listening handles: the process never exited, and every further
 * attempt accumulated another pair (agent review round 1, R1, reproduced with
 * real loopback servers and an injected exception). "The handle is released"
 * is a fact about the event loop, so the only honest oracle is a real process
 * that has to exit on its own — a regex over the source cannot see it.
 *
 * WHAT IS PATCHED, AND WHY THAT IS STILL THE REAL CODE. The patched probe is
 * the committed rig itself, with one throw injected straight after both
 * servers are registered — exactly the failure the finding describes — and its
 * top-level `main()` replaced by a four-line harness that calls the real
 * `runPasskeyAttempt()` and reports what survived it. The wrapper, the
 * `finally`, the close helper and `startServer` are all the shipped ones; only
 * the boot of the app tree is skipped, because it is not what is under test.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = join(ROOT, "scripts", "browser-challenge-proof.mjs");
const SOURCE = readFileSync(SOURCE_PATH, "utf8");

const OWNERS_ANCHOR = "\tconst owners = [];";
const REGISTERED_ANCHOR = "\towners.push(frameServer);";
const ENTRY_ANCHOR = "await main();";
const INJECTED =
	"injected: the attempt failed after both servers were listening";
const INJECTED_FAILURE = /injected: the attempt failed/;

/** Imports the probe needs rewritten so it can run from outside the repo. */
function externalise(module) {
	return `from "./${module}"`;
}

test("a passkey attempt that throws closes both listeners and the process exits", () => {
	/*
	 * The mutation oracle is the assertion itself: delete the wrapper's
	 * `finally` (or move the close back to the success return) and the injected
	 * throw leaves both servers listening, so the child never drains, the
	 * watchdog reports `still-alive` and this test fails on both the exit status
	 * and the reported listener count.
	 */
	const require = createRequire(join(ROOT, "package.json"));
	const scratch = mkdtempSync(
		join(process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(), "passkey-arm-"),
	);
	try {
		for (const anchor of [OWNERS_ANCHOR, REGISTERED_ANCHOR, ENTRY_ANCHOR])
			assert.ok(SOURCE.includes(anchor), `probe anchor missing: ${anchor}`);

		let probe = SOURCE;
		// Bare specifiers and relative imports resolve from the PROBE's location,
		// which is the scratch directory: pin both to this checkout.
		for (const module of [
			"app-tree-teardown.mjs",
			"chrome-keychain.mjs",
			"notifications-off.mjs",
			"telemetry-off.mjs",
		])
			probe = probe.replace(
				externalise(module),
				`from ${JSON.stringify(pathToFileURL(join(ROOT, "scripts", module)).href)}`,
			);
		probe = probe.replace(
			'import sharp from "sharp";',
			`import sharp from ${JSON.stringify(pathToFileURL(require.resolve("sharp")).href)};`,
		);
		probe = probe.replace(
			'createRequire(import.meta.url)("electron")',
			`createRequire(${JSON.stringify(join(ROOT, "package.json"))})("electron")`,
		);
		// Expose the registered owners, so the harness can report what is still
		// listening after the attempt has failed.
		probe = probe.replace(
			OWNERS_ANCHOR,
			"\tconst owners = (globalThis.__passkeyOwners = []);",
		);
		probe = probe.replace(
			REGISTERED_ANCHOR,
			`${REGISTERED_ANCHOR}\n\tthrow new Error(${JSON.stringify(INJECTED)});`,
		);
		probe = probe.replace(
			ENTRY_ANCHOR,
			`const watchdog = setTimeout(() => {
	process.stdout.write(\`\${JSON.stringify({ verdict: "still-alive", owners: globalThis.__passkeyOwners?.length ?? 0, listening: (globalThis.__passkeyOwners ?? []).filter((s) => s.listening).length })}\\n\`);
	process.exit(3);
}, 4000);
watchdog.unref();
let threw = null;
try {
	await runPasskeyAttempt();
} catch (error) {
	threw = String(error?.message ?? error);
}
const owners = globalThis.__passkeyOwners ?? [];
const closed = owners.length === 2 && owners.every((s) => !s.listening);
process.stdout.write(\`\${JSON.stringify({ verdict: "settled", threw, owners: owners.length, closed })}\\n\`);
// Exit only when the handles are provably gone: a leaked listener keeps this
// process alive until the watchdog, which is the failing outcome.
if (closed) process.exit(0);`,
		);

		const probePath = join(scratch, "probe.mjs");
		writeFileSync(probePath, probe);
		const result = spawnSync(process.execPath, [probePath], {
			cwd: ROOT,
			encoding: "utf8",
			// Absorbs the watchdog: a killed child is a different failure than the
			// `still-alive` verdict this test reports as such.
			timeout: 60_000,
		});
		const output = `${result.stdout}${result.stderr}`;
		assert.equal(
			result.error,
			undefined,
			`probe was killed instead of settling: ${output}`,
		);
		const settled = result.stdout
			.split("\n")
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line))
			.at(-1);
		assert.ok(settled, `no verdict line; stdout=${result.stdout}`);
		assert.equal(
			settled.verdict,
			"settled",
			`a failed attempt left a live process behind: ${output}`,
		);
		assert.match(settled.threw ?? "", INJECTED_FAILURE);
		assert.equal(settled.owners, 2, "both servers must have been registered");
		assert.equal(
			settled.closed,
			true,
			"a failed attempt must close both listeners",
		);
		assert.equal(result.status, 0, `child exit ${result.status}: ${output}`);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
