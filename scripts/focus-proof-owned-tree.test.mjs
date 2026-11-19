import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { createFocusProofOwnedTree } from "./focus-proof-owned-tree.mjs";

test(
	"real owned descendant is reaped after its root exits",
	{
		skip:
			process.platform === "win32" &&
			"ps birth inventory is a macOS/POSIX probe",
		timeout: 10000,
	},
	async () => {
		const processRoot = spawn(
			process.execPath,
			[
				"-e",
				"const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);process.stdin.once('data',()=>process.exit(0));setInterval(()=>{},1000);",
			],
			{ stdio: ["pipe", "pipe", "ignore"] },
		);
		const [chunk] = await once(processRoot.stdout, "data");
		const descendant = Number(String(chunk).trim());
		const tree = createFocusProofOwnedTree({
			rootPid: processRoot.pid,
			profile: `/not-a-real-profile/${processRoot.pid}`,
		});
		try {
			const exit = once(processRoot, "exit");
			processRoot.stdin.end("exit");
			await exit;
			const result = await tree.stop();
			assert.equal(result.clean, true, JSON.stringify(result));
			assert.ok(result.owned.some((row) => row.pid === descendant));
			assert.ok(result.sent.some((row) => row.pid === descendant));
		} finally {
			const result = await tree.stop();
			assert.equal(result.clean, true, JSON.stringify(result));
		}
	},
);

const root = {
	pid: 100,
	parent: 1,
	birth: "root-birth",
	command: "Electron --user-data-dir=/owned/profile",
};
const child = {
	pid: 101,
	parent: 100,
	birth: "child-birth",
	command: "Electron Helper",
};
const unrelated = {
	pid: 900,
	parent: 1,
	birth: "other-birth",
	command: "unrelated",
};

test("remembers descendants after root exit and reparenting, with exact signals", async () => {
	let table = [root, child, unrelated];
	const sent = [];
	const tree = createFocusProofOwnedTree({
		rootPid: 100,
		profile: "/owned/profile",
		readTable: () => table,
		wait: async () => {},
		signal: (pid, name) => {
			sent.push([pid, name]);
			table = table.filter((row) => row.pid !== pid);
		},
	});
	table = [{ ...child, parent: 1 }, unrelated];
	const result = await tree.stop();
	assert.equal(result.clean, true);
	assert.deepEqual(sent, [[101, "SIGTERM"]]);
	assert.equal(result.owned.length, 2);
});

test("PID reuse never signals a different birth identity", async () => {
	let table = [root, child, unrelated];
	const sent = [];
	const tree = createFocusProofOwnedTree({
		rootPid: 100,
		profile: "/owned/profile",
		readTable: () => table,
		wait: async () => {},
		signal: (pid) => sent.push(pid),
	});
	table = [{ ...child, parent: 1, birth: "reused-birth" }, unrelated];
	assert.equal((await tree.stop()).clean, true);
	assert.deepEqual(sent, []);
});

test("an unreadable final inventory fails closed without signalling", async () => {
	let broken = false;
	const sent = [];
	const tree = createFocusProofOwnedTree({
		rootPid: 100,
		profile: "/owned/profile",
		readTable: () => {
			if (broken) throw Error("no ps");
			return [root, unrelated];
		},
		wait: async () => {},
		signal: (pid) => sent.push(pid),
	});
	broken = true;
	assert.equal((await tree.stop()).clean, false);
	assert.deepEqual(sent, []);
});

test("a surviving descendant makes teardown fail", async () => {
	const tree = createFocusProofOwnedTree({
		rootPid: 100,
		profile: "/owned/profile",
		readTable: () => [root, child, unrelated],
		wait: async () => {},
		signal: () => {},
	});
	const result = await tree.stop();
	assert.equal(result.clean, false);
	assert.equal(result.survivors.length, 2);
});
