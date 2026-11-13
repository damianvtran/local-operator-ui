import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	diagnosticsDir,
	preserveLaunchDiagnostics,
} from "./team-bridge-launch-diagnostics.mjs";

/**
 * QA round 2 on ui#1889 (Q2-1): the bench's launch died in `waitForTarget` and the
 * scratch reap deleted everything that could say why. These cases drive the
 * diagnostics with a FAKE child and a FAKE CDP endpoint - no Electron - in the
 * bench's own order: failure, preserve, THEN reap the scratch, and assert the
 * evidence survived the reap and the one stderr line names what is knowable.
 */

/** A scratch laid out like the bench's: logs/, profile/logs, and config/ secrets. */
function fakeScratch() {
	const root = mkdtempSync(join(tmpdir(), "tb-launch-diag-"));
	const scratch = join(root, "run");
	mkdirSync(join(scratch, "logs"), { recursive: true });
	writeFileSync(join(scratch, "logs", "main.log"), "main: booting\n");
	mkdirSync(join(scratch, "profile", "logs"), { recursive: true });
	writeFileSync(join(scratch, "profile", "logs", "renderer.log"), "r: hi\n");
	mkdirSync(join(scratch, "config", "run"), { recursive: true });
	writeFileSync(join(scratch, "config", "run", "serve"), "SECRET-CLAIM\n");
	return { root, scratch };
}

function appRecord(child, scratch) {
	return {
		child,
		userData: join(scratch, "profile"),
		stdout: () => "app stdout line\n",
		stderr: () => "app stderr: GPU process crashed\n",
		argv: ["/usr/bin/node", "electron/cli.js", "."],
		envKeys: ["HOME", "LOCAL_OPERATOR_LOG_DIR"],
	};
}

function exited(child) {
	return new Promise((done) => child.once("exit", done));
}

/** A DevTools endpoint answering with a browser target and no page target. */
async function fakeEndpoint() {
	const server = createServer((request, response) => {
		response.setHeader("content-type", "application/json");
		if (request.url === "/json/list")
			response.end(JSON.stringify([{ type: "browser", url: "" }]));
		else response.end(JSON.stringify({ Browser: "Chrome/fake" }));
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return { server, port: server.address().port };
}

function readKept(dir) {
	const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
	return { summary, files: (name) => readFileSync(join(dir, name), "utf8") };
}

test("a child that exited is classified as such, and its evidence survives the reap", async () => {
	const { root, scratch } = fakeScratch();
	try {
		const child = spawn(process.execPath, ["-e", "process.exit(3)"], {
			stdio: "ignore",
			env: { PATH: process.env.PATH, SHOULD_NOT_APPEAR: "tok-123" },
		});
		await exited(child);
		const dir = join(root, "diag");
		const kept = await preserveLaunchDiagnostics({
			dir,
			app: appRecord(child, scratch),
			scratch,
			port: null,
			error: new Error(
				"the renderer never exposed a page target: no application target yet (0 page targets)",
			),
			startedAt: Date.now() - 90_000,
			phase: "waitForTarget",
		});
		// The bench's reap, in the bench's order: AFTER the preserve.
		rmSync(scratch, { recursive: true, force: true });

		assert.equal(kept.classification.kind, "child-exited");
		assert.match(
			kept.line,
			/launch failed during waitForTarget - child exited \(code=3 signal=null\); diagnostics kept at /,
		);
		for (const name of [
			"summary.json",
			"stdout.log",
			"stderr.log",
			"cdp-json-list.txt",
			"cdp-json-version.txt",
			"logs/main.log",
			"profile-logs/renderer.log",
		])
			assert.ok(existsSync(join(dir, name)), `${name} should be kept`);
		const { summary, files } = readKept(dir);
		assert.match(files("stderr.log"), /GPU process crashed/);
		assert.match(files("cdp-json-list.txt"), /NO ANSWER/);
		assert.equal(summary.exit.code, 3);
		assert.ok(summary.elapsedMs >= 90_000);
		assert.ok(summary.uptime, "uptime load must be recorded");
		assert.equal(summary.loadavg.length, 3);
		assert.deepEqual(summary.envKeysSet, ["HOME", "LOCAL_OPERATOR_LOG_DIR"]);
		// No secrets: the config tree (claim material) is not copied, and no env value
		// reaches any file.
		assert.ok(!existsSync(join(dir, "config")));
		const everything = [
			"summary.json",
			"stdout.log",
			"stderr.log",
			"cdp-json-list.txt",
		]
			.map(files)
			.join("\n");
		assert.doesNotMatch(everything, /SECRET-CLAIM|tok-123/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a running child whose endpoint answers with no page target is 'still running'", async () => {
	const { root, scratch } = fakeScratch();
	const { server, port } = await fakeEndpoint();
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
		stdio: "ignore",
	});
	try {
		const dir = join(root, "diag");
		const kept = await preserveLaunchDiagnostics({
			dir,
			app: appRecord(child, scratch),
			scratch,
			port,
			error: new Error("the renderer never exposed a page target"),
			startedAt: Date.now(),
			phase: "waitForTarget",
		});
		assert.equal(kept.classification.kind, "running-no-target");
		assert.match(
			kept.line,
			/child still running, endpoint answered with 0 page targets/,
		);
		const { files } = readKept(dir);
		assert.match(files("cdp-json-list.txt"), /"type":"browser"/);
		assert.match(files("cdp-json-version.txt"), /Chrome\/fake/);
	} finally {
		child.kill("SIGKILL");
		await exited(child);
		await new Promise((done) => server.close(done));
		rmSync(root, { recursive: true, force: true });
	}
});

test("a running child whose endpoint never answers is 'endpoint never answered'", async () => {
	const { root, scratch } = fakeScratch();
	// A port that was just free and is now closed: connection refused.
	const { server, port } = await fakeEndpoint();
	await new Promise((done) => server.close(done));
	const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
		stdio: "ignore",
	});
	try {
		const kept = await preserveLaunchDiagnostics({
			dir: join(root, "diag"),
			app: appRecord(child, scratch),
			scratch,
			port,
			error: new Error("the renderer never exposed a page target"),
			startedAt: Date.now(),
			phase: "waitForTarget",
		});
		assert.equal(kept.classification.kind, "endpoint-silent");
		assert.match(
			kept.line,
			/child still running, CDP endpoint never answered \(ECONNREFUSED\)/,
		);
	} finally {
		child.kill("SIGKILL");
		await exited(child);
		rmSync(root, { recursive: true, force: true });
	}
});

test("a failure before the spawn is 'never spawned', not 'still running'", async () => {
	const { root, scratch } = fakeScratch();
	try {
		const kept = await preserveLaunchDiagnostics({
			dir: join(root, "diag"),
			app: null,
			scratch,
			port: null,
			error: new Error("no build at out/renderer/index.html"),
			startedAt: Date.now(),
			phase: "launch",
		});
		assert.equal(kept.classification.kind, "never-launched");
		assert.match(
			kept.line,
			/launch failed during launch - the app was never spawned/,
		);
		// The scratch's own log dir is still worth keeping when it exists.
		assert.ok(existsSync(join(root, "diag", "logs", "main.log")));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("the default directory sits beside --json and is run-unique", () => {
	assert.equal(
		diagnosticsDir({
			explicit: null,
			jsonOut: "/x/evidence/run.json",
			scratchRoot: "/s",
			now: 17,
			pid: 42,
		}),
		"/x/evidence/launch-diagnostics-17-42",
	);
	assert.equal(
		diagnosticsDir({
			explicit: null,
			jsonOut: null,
			scratchRoot: "/s",
			now: 17,
			pid: 42,
		}),
		"/s/launch-diagnostics-17-42",
	);
	assert.equal(
		diagnosticsDir({
			explicit: "/d",
			jsonOut: "/x/r.json",
			scratchRoot: "/s",
			now: 1,
			pid: 1,
		}),
		"/d",
	);
});
