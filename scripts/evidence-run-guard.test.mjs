import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const guard = fileURLToPath(
	new URL("./evidence-run-guard.py", import.meta.url),
);
const env = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("CMUX_")),
);

function fixture(t) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "evidence-guard-test-")),
	);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return join(root, "lease");
}

function attempt(lock, code = 'console.log("admitted")') {
	return spawnSync("python3", [guard, lock, process.execPath, "-e", code], {
		encoding: "utf8",
		env,
		timeout: 5000,
	});
}

async function holder(t, lock, code) {
	const child = spawn("python3", [guard, lock, process.execPath, "-e", code], {
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	t.after(() => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	});
	child.stdout.setEncoding("utf8");
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	const closed = once(child, "close");
	// Wait for actual admission, not an arbitrary sleep that races a slow host.
	while (!output.includes("ready\n")) {
		const event = await Promise.race([
			once(child.stdout, "data"),
			closed.then(() => {
				throw new Error(`holder exited before ready: ${output}`);
			}),
		]);
		assert.ok(event);
	}
	return { child, closed };
}

const waitForStdin =
	'console.log("ready"); process.stdin.resume(); process.stdin.on("end", () => process.exit(0));';

test(
	"contenders defer immediately across working directories; normal exit preserves inode",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const { child, closed } = await holder(t, lock, waitForStdin);
		const inode = statSync(lock).ino;
		// Even apparently dead metadata must not let a contender steal a live lease.
		writeFileSync(lock, "pid=999999999\n");
		const contenders = await Promise.all(
			Array.from({ length: 4 }, async () => {
				const contender = spawn(
					"python3",
					[guard, lock, process.execPath, "-e", 'console.log("UNSAFE")'],
					{
						cwd: "/",
						env: { ...env, HOME: "/nonexistent", TMPDIR: "/nonexistent" },
					},
				);
				let output = "";
				contender.stdout.on("data", (data) => {
					output += data;
				});
				contender.stderr.on("data", (data) => {
					output += data;
				});
				const [status] = await once(contender, "close");
				return { status, output };
			}),
		);
		for (const result of contenders) {
			assert.equal(result.status, 75);
			assert.match(result.output, /DEFERRED.*No frames checked/);
			assert.doesNotMatch(result.output, /UNSAFE/);
		}
		child.stdin.end();
		assert.equal((await closed)[0], 0);
		assert.equal(attempt(lock).status, 0);
		assert.equal(statSync(lock).ino, inode);
	},
);

test(
	"dead-holder recovery never unlinks or trusts PID metadata",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const { child, closed } = await holder(t, lock, waitForStdin);
		const inode = statSync(lock).ino;
		child.kill("SIGKILL");
		assert.equal((await closed)[1], "SIGKILL");
		// A live, unrelated PID (including a reused old PID) is not a lock owner.
		writeFileSync(lock, `pid=${process.pid}\n`);
		const result = attempt(lock);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /admitted/);
		assert.equal(statSync(lock).ino, inode);
	},
);

test(
	"heavy child retains admission after its launcher exits",
	{ timeout: 10000 },
	async (t) => {
		const lock = fixture(t);
		const release = `${lock}-release`;
		const descendant = `console.log('ready'); const tick = setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(release)})) { clearInterval(tick); clearTimeout(deadline); } }, 10); const deadline = setTimeout(() => process.exit(2), 5000);`;
		const code = `const {spawn} = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:['ignore','inherit','inherit',3]}); process.exit(0);`;
		const { child, closed } = await holder(t, lock, code);
		if (child.exitCode === null) await once(child, "exit");
		assert.equal(child.exitCode, 0);
		assert.equal(attempt(lock).status, 75);
		writeFileSync(release, "release");
		await closed;
		assert.equal(attempt(lock).status, 0);
	},
);

test(
	"real CLI defers before frames, retains image lease, and preserves failures",
	{ timeout: 15000 },
	async (t) => {
		const lock = fixture(t);
		const root = dirname(lock);
		const scripts = join(root, "scripts");
		mkdirSync(scripts);
		for (const name of [
			"evidence-run-guard.py",
			"color.mjs",
			"palette-source.mjs",
			/*
			 * `check-evidence.mjs` imports this one for the story `dir` table it holds,
			 * so the fixture's script set has to mirror that edge the way it already
			 * mirrors the two module-level imports. The copy is deliberate over a stub:
			 * the CLI under test is the real one, and it has to resolve its own
			 * dependency for real or this test would be testing a fixture's shape.
			 * `capture-evidence.mjs` is safe to copy here - it reads nothing at import
			 * time and its own `check-evidence.mjs` import resolves to the relocated copy
			 * beside it.
			 */
			"capture-evidence.mjs",
			/*
			 * Both CLIs now resolve their own entry point through this module
			 * (`scripts/entry-point.mjs`), which is the same edge as any other: without it
			 * in the relocated set the copy fails to IMPORT - loudly, and before it reads
			 * anything - which is how this fixture found it. Nothing about the module is
			 * stubbed here either, for the same reason as above.
			 */
			"entry-point.mjs",
		]) {
			copyFileSync(join(dirname(guard), name), join(scripts, name));
		}
		// Only relocate the fixed lock literal in this disposable checkout. There is
		// deliberately no production env override that lets sibling worktrees opt out.
		const source = readFileSync(
			new URL("./check-evidence.mjs", import.meta.url),
			"utf8",
		);
		assert.equal(
			source.split('"/tmp/local-operator-ui-check-evidence.lock"').length,
			2,
		);
		const entry = join(scripts, "check-evidence.mjs");
		writeFileSync(
			entry,
			source.replace(
				'"/tmp/local-operator-ui-check-evidence.lock"',
				JSON.stringify(lock),
			),
		);
		const palettes = join(root, "src/renderer/src/shared/themes/palettes");
		mkdirSync(palettes, { recursive: true });
		writeFileSync(
			join(palettes, "synthetic.ts"),
			'id: "synthetic", palette: { canvas: "#000000" }',
		);
		const evidence = join(root, "docs/evidence");
		mkdirSync(evidence, { recursive: true });
		writeFileSync(join(evidence, "synthetic.webp"), "synthetic image fixture");
		const report = join(root, "image-report.json");
		const magick = join(root, "magick");
		writeFileSync(
			magick,
			`#!/usr/bin/env python3\nimport json, os, stat, subprocess, sys\np = subprocess.run(['python3', ${JSON.stringify(guard)}, ${JSON.stringify(lock)}, sys.executable, '-c', 'print("UNSAFE")'], capture_output=True)\nwith open(${JSON.stringify(report)}, 'w') as f:\n json.dump({'lease_fd': stat.S_ISREG(os.fstat(3).st_mode), 'nice': os.getpriority(os.PRIO_PROCESS, 0), 'contender': p.returncode}, f)\nif os.environ.get('SYNTHETIC_IMAGE_FAIL'): sys.exit(7)\nprint('60: #000000\\n40: #FFFFFF')\n`,
		);
		chmodSync(magick, 0o700);
		const cliEnv = { ...env, PATH: `${root}:${env.PATH}` };
		const cli = (extra = {}) =>
			spawnSync(process.execPath, [entry], {
				env: { ...cliEnv, ...extra },
				encoding: "utf8",
				timeout: 5000,
			});
		const { child, closed } = await holder(t, lock, waitForStdin);
		const deferred = cli();
		assert.equal(deferred.status, 75, deferred.stderr);
		assert.match(deferred.stderr, /DEFERRED/);
		assert.doesNotMatch(deferred.stdout, /Evidence holds/);
		const imported = spawnSync(
			process.execPath,
			["--input-type=module", "-e", `await import(${JSON.stringify(entry)})`],
			{ env: cliEnv, encoding: "utf8", timeout: 5000 },
		);
		assert.equal(imported.status, 0, imported.stderr);
		assert.equal(imported.stdout, "");
		child.stdin.end();
		await closed;
		const passed = cli();
		assert.equal(passed.status, 0, passed.stderr);
		assert.match(passed.stdout, /Evidence holds: 1 frames/);
		const image = JSON.parse(readFileSync(report, "utf8"));
		assert.equal(image.lease_fd, true);
		assert.equal(image.contender, 75);
		assert.ok(image.nice >= 10);
		const failed = cli({ SYNTHETIC_IMAGE_FAIL: "1" });
		assert.equal(failed.status, 1);
		assert.match(failed.stderr, /could not read the image/);
		const unavailable = cli({ PATH: root });
		assert.equal(unavailable.status, 1);
		assert.match(
			unavailable.stderr,
			/BLOCKED.*Python 3 with POSIX flock is required/,
		);
	},
);

test("unsafe lock path and command failure fail closed; priority is inherited", (t) => {
	const lock = fixture(t);
	const target = `${lock}-target`;
	writeFileSync(target, "untouched");
	symlinkSync(target, lock);
	const blocked = attempt(lock);
	assert.equal(blocked.status, 1);
	assert.match(blocked.stderr, /BLOCKED.*admission unavailable/);
	assert.equal(readFileSync(target, "utf8"), "untouched");
	const other = `${lock}-valid`;
	assert.equal(attempt(other, "process.exit(23)").status, 23);
	const priority = attempt(
		other,
		'console.log(require("node:os").getPriority())',
	);
	assert.equal(priority.status, 0, priority.stderr);
	assert.ok(Number(priority.stdout.trim()) >= 10, priority.stdout);
	const missing = spawnSync(
		"python3",
		[guard, other, "/nonexistent/evidence-command"],
		{ env, encoding: "utf8", timeout: 5000 },
	);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /BLOCKED/);
	assert.equal(attempt(other).status, 0);
});

/**
 * The unsupported-HOST path, which no fixture reaches by running the guard
 * normally: it needs a machine whose `fcntl` is absent, and `fcntl` is a
 * POSIX-only stdlib module every CI runner here has. Making the import itself
 * fail is the portable stand-in for that host, and the guard returns before it
 * opens the lease, so this cannot reach a real one.
 *
 * Bound because the message IS this path's deliverable: a reader told only the
 * module's name goes looking for something to install, and `fcntl` has no wheel
 * (design round 1, D1). The claim that nothing was checked is the half a reader
 * would otherwise have to assume, so it is asserted rather than trusted.
 */
test("an unavailable POSIX locking module names the platform, not a module", (t) => {
	const lock = fixture(t);
	const blocked = spawnSync(
		"python3",
		[
			"-c",
			'import sys, runpy; sys.modules["fcntl"] = None; sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name="__main__")',
			guard,
			lock,
			process.execPath,
			"-e",
			'console.log("UNSAFE")',
		],
		{ encoding: "utf8", env, timeout: 5000 },
	);
	assert.equal(blocked.status, 1, blocked.stderr);
	assert.match(blocked.stderr, /BLOCKED: Python 3 with POSIX locking is required/);
	assert.match(blocked.stderr, /No frames checked/);
	assert.match(
		blocked.stderr,
		/Use a supported environment, then rerun `pnpm check-evidence`/,
	);
	// The raw detail stays, after the recovery the reader can act on.
	assert.match(blocked.stderr, /Detail: /);
	assert.doesNotMatch(blocked.stdout, /UNSAFE/);
	assert.equal(existsSync(lock), false);
});
