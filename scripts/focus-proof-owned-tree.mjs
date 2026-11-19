import { execFileSync } from "node:child_process";

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.*)$/;

/** Record exact PID + birth + command identity, never a remembered process group. */
export function readOwnedProcessTable() {
	return execFileSync("ps", ["-axo", "pid=,ppid=,lstart=,command="], {
		encoding: "utf8",
		timeout: 3000,
		env: { ...process.env, LC_ALL: "C" },
	})
		.split("\n")
		.flatMap((line) => {
			const match = PS_ROW.exec(line);
			return match
				? [
						{
							pid: Number(match[1]),
							parent: Number(match[2]),
							birth: match[3],
							command: match[4],
						},
					]
				: [];
		});
}
// The command is audit context, not birth identity: an owned process may exec
// or update its title without becoming a different process.
const same = (a, b) => a.pid === b.pid && a.birth === b.birth;

/**
 * Descendants are remembered by birth identity even after reparenting or root
 * exit. The unique profile additionally discovers an escaped app main. Every
 * signal re-reads identity; an unreadable inventory fails closed, never kills.
 */
export function createFocusProofOwnedTree({
	rootPid,
	profile,
	readTable = readOwnedProcessTable,
	signal = (pid, name) => process.kill(pid, name),
	wait = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
	const owned = new Map();
	const observations = [];
	let unreadable = false;
	const refresh = () => {
		let table;
		try {
			table = readTable();
		} catch {
			unreadable = true;
			return null;
		}
		if (!table.length) {
			unreadable = true;
			return null;
		}
		const root = table.find((row) => row.pid === rootPid);
		if (!owned.has(rootPid) && root) owned.set(rootPid, root);
		for (const row of table) {
			if (
				row.command.includes(`--user-data-dir=${profile} `) ||
				row.command.endsWith(`--user-data-dir=${profile}`)
			)
				owned.set(row.pid, row);
		}
		let changed = true;
		while (changed) {
			changed = false;
			for (const row of table) {
				const parent = owned.get(row.parent);
				if (
					parent &&
					table.some((current) => same(current, parent)) &&
					!owned.has(row.pid)
				) {
					owned.set(row.pid, row);
					changed = true;
				}
			}
		}
		const survivors = table.filter(
			(row) => owned.has(row.pid) && same(row, owned.get(row.pid)),
		);
		observations.push({
			at: Date.now(),
			pids: survivors.map((row) => row.pid),
		});
		return survivors;
	};
	refresh();
	return {
		refresh,
		async stop() {
			const sent = [];
			for (const name of ["SIGTERM", "SIGKILL"]) {
				const live = refresh();
				if (!live) break;
				// Children first, but never trust a snapshot at signal time.
				for (const row of [...live].sort(
					(a, b) => (a.pid === rootPid) - (b.pid === rootPid),
				)) {
					let current;
					try {
						current = readTable().find((item) => item.pid === row.pid);
					} catch {
						unreadable = true;
						continue;
					}
					if (!current || !same(row, current)) continue;
					try {
						signal(row.pid, name);
						sent.push({ pid: row.pid, birth: row.birth, signal: name });
					} catch {
						/* Raced a natural exit; the final inventory decides. */
					}
				}
				await wait(name === "SIGTERM" ? 1000 : 300);
			}
			const survivors = refresh();
			return {
				clean:
					!unreadable &&
					owned.size > 0 &&
					survivors !== null &&
					survivors.length === 0,
				unreadable,
				owned: [...owned.values()],
				survivors,
				sent,
				observations,
			};
		},
	};
}
