import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const WAIT_REFUSAL =
	/Backend preparation is blocked by an existing lock record/;
const MISSING_LOCK = /ENOENT/;
const UNKNOWN_LOCK = /Unrecognized preparation lock/;
const APP_ROOT = /app/i;
const CANCELLED = /synthetic cancellation/;
const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const compiled = await build({
	entryPoints: [join(repo, "src/main/backend/managed-python.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { managedPythonRoot, reapSupersededGenerations } = await import(
	`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);

function owned(t) {
	const support = fs.mkdtempSync(join(tmpdir(), "managed-transaction-"));
	t.after(() => fs.rmSync(support, { recursive: true, force: true }));
	const options = {
		support,
		resources: "",
		packaged: true,
		arch: process.arch,
	};
	const root = managedPythonRoot(options);
	fs.mkdirSync(root, { recursive: true });
	return { options, root, lock: join(root, "preparation.lock") };
}

async function holder(t, lock) {
	// A real separate PID holds the existing shlock record. No Electron, Python
	// seed, signatures or application launch participates in these lock cases.
	const code = `const {execFileSync}=require('node:child_process');
execFileSync('/usr/bin/shlock',['-p',String(process.pid),'-f',process.argv[1]]);
console.log('held');setInterval(()=>{},1000);`;
	const child = spawn(process.execPath, ["-e", code, lock], {
		env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await once(child, "exit");
		}
	});
	const [output] = await once(child.stdout, "data");
	assert.equal(output.toString().trim(), "held");
	return child;
}

const native = {
	skip:
		process.platform !== "darwin"
			? "Existing companion shlock contract is macOS-only"
			: false,
};

test(
	"standalone reap owns and releases the whole app-root transaction",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		assert.deepEqual(await reapSupersededGenerations(options, {}), []);
		assert.equal(fs.existsSync(lock), false);
		assert.deepEqual(
			await Promise.all([
				reapSupersededGenerations(options, {}),
				reapSupersededGenerations(options, {}),
			]),
			[[], []],
		);
		assert.equal(fs.existsSync(lock), false);
	},
);

test(
	"crashed shlock holder is reclaimed by native shlock, not by timestamp",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		const child = await holder(t, lock);
		child.kill("SIGKILL");
		await once(child, "exit");
		assert.equal(fs.readFileSync(lock, "utf8").trim(), String(child.pid));
		assert.deepEqual(await reapSupersededGenerations(options, {}), []);
		assert.equal(fs.existsSync(lock), false);
	},
);

test(
	"a live unrelated PID is preserved on bounded refusal (PID reuse stays conservative)",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		const child = await holder(t, lock);
		const before = fs.readFileSync(lock);
		// shlock cannot prove birth identity. This is the reused-PID equivalent:
		// the record names a live unrelated process and MUST NOT be age-reclaimed.
		// Scale only the clock, not the native refusal; no two-minute idle test.
		let ticks = 0;
		t.mock.method(Date, "now", () => ++ticks * 120_001);
		await assert.rejects(reapSupersededGenerations(options, {}), WAIT_REFUSAL);
		assert.deepEqual(fs.readFileSync(lock), before);
		assert.equal(child.exitCode, null);
	},
);

test(
	"a waiter succeeds after native owner death without force or lock deletion",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		const child = await holder(t, lock);
		const waiting = reapSupersededGenerations(options, {});
		setTimeout(() => child.kill("SIGKILL"), 40);
		assert.deepEqual(await waiting, []);
		if (child.exitCode === null && child.signalCode === null)
			await once(child, "exit");
		assert.equal(fs.existsSync(lock), false);
	},
);

test(
	"missing lock during cleanup cannot strand the process-local preparation queue",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		const read = fs.readFileSync;
		let reads = 0;
		t.mock.method(fs, "readFileSync", function (path, ...args) {
			if (path === lock && ++reads === 3) fs.unlinkSync(lock);
			return read.call(this, path, ...args);
		});
		await assert.rejects(reapSupersededGenerations(options, {}), MISSING_LOCK);
		assert.deepEqual(await reapSupersededGenerations(options, {}), []);
		assert.equal(fs.existsSync(lock), false);
	},
);

test(
	"malformed/foreign lock is preserved without adopting a different root",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		fs.writeFileSync(lock, "not a PID\n");
		await assert.rejects(reapSupersededGenerations(options, {}), UNKNOWN_LOCK);
		assert.equal(fs.readFileSync(lock, "utf8"), "not a PID\n");
		const forbidden = {
			...options,
			support: join(dirname(lock), "Forged.app", "inside"),
		};
		await assert.rejects(reapSupersededGenerations(forbidden, {}), APP_ROOT);
	},
);

test(
	"an exception before mutation releases owned shlock and the duplicate preparation queue",
	native,
	async (t) => {
		const { options, lock } = owned(t);
		const read = fs.readFileSync;
		let cancelled = false;
		t.mock.method(fs, "readFileSync", function (path, ...args) {
			if (path === lock && !cancelled) {
				cancelled = true;
				throw new Error("synthetic cancellation before mutation");
			}
			return read.call(this, path, ...args);
		});
		await assert.rejects(reapSupersededGenerations(options, {}), CANCELLED);
		assert.equal(fs.existsSync(lock), false);
		assert.deepEqual(await reapSupersededGenerations(options, {}), []);
	},
);
