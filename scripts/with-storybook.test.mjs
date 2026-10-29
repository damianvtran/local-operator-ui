/*
 * Pins scripts/with-storybook.mjs: the Storybook it boots is gone - leader AND its
 * grandchild, port closed - after the wrapped command passes, fails, never spawns, and
 * after the helper itself is sent SIGTERM. Uses the HTTP stub (with-storybook-stub.mjs)
 * through WITH_STORYBOOK_BIN, so it needs no dependency tree and never starts a real
 * Storybook.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER = join(HERE, "with-storybook.mjs");
const STUB = join(HERE, "with-storybook-stub.mjs");
const scratch = mkdtempSync(join(tmpdir(), "with-sb-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const cleanEnv = (extra = {}) => {
	const env = { ...process.env, WITH_STORYBOOK_BIN: STUB, ...extra };
	for (const name of Object.keys(env))
		if (name.startsWith("CMUX_")) delete env[name];
	return env;
};
const pids = (pidfile) =>
	readFileSync(pidfile, "utf8").trim().split(" ").map(Number);

test("passing command: sees STORYBOOK_ORIGIN, then leader and grandchild are gone", () => {
	const pidfile = join(scratch, "pass.pids");
	const run = spawnSync(
		process.execPath,
		[
			HELPER,
			"--",
			process.execPath,
			"-e",
			"fetch(process.env.STORYBOOK_ORIGIN).then(r=>process.exit(r.status===200?0:3))",
		],
		{
			env: cleanEnv({ STUB_PIDFILE: pidfile }),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stderr, /storybook pid=\d+ pgid=\d+ port=\d+/);
	assert.match(run.stderr, /pid gone, port \d+ closed/);
	for (const pid of pids(pidfile))
		assert.equal(alive(pid), false, `pid ${pid} leaked`);
});

test("failing command: its exit code comes back and the server is still gone", () => {
	const pidfile = join(scratch, "fail.pids");
	const run = spawnSync(
		process.execPath,
		[HELPER, "--", process.execPath, "-e", "process.exit(7)"],
		{
			env: cleanEnv({ STUB_PIDFILE: pidfile }),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 7, run.stderr);
	for (const pid of pids(pidfile))
		assert.equal(alive(pid), false, `pid ${pid} leaked`);
});

test("command that cannot spawn: usage error, server still gone", () => {
	const pidfile = join(scratch, "nospawn.pids");
	const run = spawnSync(
		process.execPath,
		[HELPER, "--", "/nonexistent/definitely-not-a-command"],
		{
			env: cleanEnv({ STUB_PIDFILE: pidfile }),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 64, run.stderr);
	for (const pid of pids(pidfile))
		assert.equal(alive(pid), false, `pid ${pid} leaked`);
});

test("server that ignores SIGTERM is escalated to SIGKILL and still gone", () => {
	const pidfile = join(scratch, "stubborn.pids");
	const run = spawnSync(
		process.execPath,
		[HELPER, "--", process.execPath, "-e", "0"],
		{
			env: cleanEnv({ STUB_PIDFILE: pidfile, STUB_IGNORE_TERM: "1" }),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stderr, /needed SIGKILL/);
	for (const pid of pids(pidfile))
		assert.equal(alive(pid), false, `pid ${pid} leaked`);
});

test("server that never becomes ready: exit 69 and nothing left behind", () => {
	const run = spawnSync(
		process.execPath,
		[HELPER, "--ready-timeout-s", "2", "--", process.execPath, "-e", "0"],
		{
			// `true` exits at once without ever listening.
			env: cleanEnv({ WITH_STORYBOOK_BIN: "/usr/bin/true" }),
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(run.status, 69, run.stderr);
	const [, pid] = /storybook pid=(\d+)/.exec(run.stderr) ?? [];
	assert.ok(pid, run.stderr);
	assert.equal(alive(Number(pid)), false);
});

test("SIGTERM to the helper mid-command stops the command and the server", async () => {
	const pidfile = join(scratch, "sigterm.pids");
	const child = spawn(
		process.execPath,
		[HELPER, "--", process.execPath, "-e", "setInterval(()=>{},1000)"],
		{
			env: cleanEnv({ STUB_PIDFILE: pidfile }),
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	let stderr = "";
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const deadline = Date.now() + 30_000;
	while (!stderr.includes("storybook ready") && Date.now() < deadline) {
		await new Promise((done) => setTimeout(done, 100));
	}
	assert.ok(stderr.includes("storybook ready"), stderr);
	assert.ok(existsSync(pidfile));
	const stubPids = pids(pidfile);
	assert.ok(stubPids.every(alive), "stub should be up before the signal");
	child.kill("SIGTERM");
	const status = await new Promise((done) =>
		child.once("exit", (code) => done(code)),
	);
	assert.equal(status, 143, stderr);
	for (const pid of stubPids)
		assert.equal(alive(pid), false, `pid ${pid} leaked`);
});
