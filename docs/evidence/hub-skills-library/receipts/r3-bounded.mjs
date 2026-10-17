import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { createMemoryWatchdog, sampleGroup, killTree } = await import(
	pathToFileURL(path.resolve("scripts/desktop-test-memory-guard.mjs"))
);
const seconds = Number(process.argv[2]);
const child = spawn(process.argv[3], process.argv.slice(4), {
	stdio: "inherit",
	detached: true,
	env: process.env,
});
const keeper = spawn(
	process.execPath,
	[path.resolve("scripts/desktop-test-keeper.mjs"), String(child.pid)],
	{ stdio: ["pipe", "ignore", "ignore"], detached: true },
);
keeper.stdin.on("error", () => {});
keeper.unref();
let exit = 0,
	last = [],
	finishing = false;
console.log(
	"BOUNDED START",
	JSON.stringify({
		pid: child.pid,
		seconds,
		budgetMiB: 6144,
		nodeOptions: process.env.NODE_OPTIONS ?? null,
	}),
);
const stop = async (code) => {
	if (finishing) return;
	finishing = true;
	exit = code;
	watch.stop();
	console.error("BOUNDED REAP", code, await killTree(child.pid, last));
};
const watch = createMemoryWatchdog({
	leaderPid: child.pid,
	budgetBytes: 6144 * 1024 ** 2,
	sample: async () => {
		const r = await sampleGroup(child.pid);
		if (r) {
			last = r.members;
			console.log(
				"FOOTPRINT",
				JSON.stringify({
					MiB: Math.round(r.totalBytes / 1024 ** 2),
					blind: r.blind,
					processes: r.members.length,
				}),
			);
		}
		return r;
	},
	onBreach: () => {
		exit = 137;
	},
	onBlind: (n) => {
		console.error("FOOTPRINT BLIND", n);
		void stop(125);
	},
});
watch.start();
const deadline = setTimeout(() => void stop(124), seconds * 1000);
for (const sig of ["SIGTERM", "SIGINT"])
	process.once(sig, () => void stop(143));
const code = await new Promise((resolve) => {
	child.once("error", (e) => {
		console.error(e);
		resolve(1);
	});
	child.once("exit", (c, s) => resolve(c ?? (s ? 143 : 1)));
});
clearTimeout(deadline);
watch.stop();
keeper.stdin.end("done\n");
console.log(
	"BOUNDED END",
	JSON.stringify({ pid: child.pid, exit: exit || code }),
);
process.exitCode = exit || code;
